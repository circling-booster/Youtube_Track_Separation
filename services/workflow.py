"""
통합 파이프라인: 다운로드 → 분리 → 정렬 → 응답
VRAM 메모리 안전성 보장 & 스마트 캐싱 & 로직 통합
"""

import logging
import gc
import torch
import time
import subprocess
from pathlib import Path
from typing import Callable, Optional, Dict, Any

# 로컬 모듈
from download import YouTubeDownloader
from demucs_processor import DemucsProcessor
from extract_lyrics import BugsLyricsCrawler
from align_force import align_lyrics
from services.text_utils import TextCleaner

logger = logging.getLogger(__name__)

class TrackSeparationWorkflow:
    def __init__(self, download_dir: str):
        self.download_dir = Path(download_dir)
        self.downloader = YouTubeDownloader(str(download_dir))
        self.lyrics_crawler = BugsLyricsCrawler()
        self.text_cleaner = TextCleaner()

    def process_video(
        self,
        video_id: str,
        model: str = 'htdemucs',
        meta: Optional[Dict[str, Any]] = None,
        progress_callback: Optional[Callable] = None
    ) -> Dict[str, Any]:
        
        logger.info(f"\n{'='*70}\n[Workflow] 영상 처리: {video_id}\n{'='*70}")

        # [0단계] 캐시 확인
        cached = self._check_cache(video_id)
        if cached:
            if progress_callback: progress_callback(100, '캐시 데이터 로드 완료')
            return cached

        if meta is None:
            meta = {'sourceType': 'general', 'artist': None, 'title': None}

        result = {
            'success': False,
            'video_id': video_id,
            'tracks': {},
            'lyrics_lrc': None,
            'error': None
        }

        demucs_model = None

        try:
            work_dir = self.download_dir / video_id
            work_dir.mkdir(parents=True, exist_ok=True)

            # [1단계] 오디오 다운로드
            if progress_callback: progress_callback(5, '오디오 다운로드 중...')
            audio_file = self.downloader.download(video_id, output_dir=work_dir)
            if not audio_file: raise Exception("오디오 다운로드 실패")

            # [2단계] Demucs 분리 (VRAM 관리 핵심)
            if progress_callback: progress_callback(20, 'AI 오디오 분리 중...')
            
            processor = DemucsProcessor(str(self.download_dir))
            separation_dir = work_dir / 'separated'
            
            # 2-1. 모델 로드 (여기서만 존재)
            demucs_model = processor.load_model(model)
            
            # 2-2. 분리 수행
            success = processor.process_with_model(
                demucs_model, 
                audio_file, 
                separation_dir, 
                progress_callback=progress_callback
            )
            
            # 2-3. 모델 즉시 해제 (Whisper를 위해 VRAM 확보 필수)
            del demucs_model
            demucs_model = None
            gc.collect()
            torch.cuda.empty_cache()
            time.sleep(2) # 메모리 해제 안정화 대기

            if not success: raise Exception("Demucs 분리 실패")

            # [3단계] 트랙 정보 수집
            tracks = processor.get_separated_tracks(str(separation_dir))
            if not tracks: raise Exception("분리된 트랙 없음")
            
            vocal_absolute_path = tracks.get('vocal', {}).get('path')
            
            # 클라이언트용 경로 매핑
            for t, info in tracks.items():
                info['path'] = f"/downloads/{video_id}/{t}.wav"
            result['tracks'] = tracks

            # [4단계] 텍스트 리소스 확보 (SourceType 기반 분기)
            lyrics_text = None
            source_type = meta.get('sourceType', 'general')

            if progress_callback: progress_callback(70, '자막/가사 검색 중...')

            # 4-A. 공식 음원 (Official) -> 크롤링 우선
            if source_type == 'official' and meta.get('title'):
                try:
                    logger.info(f"[Text] 공식 음원 크롤링 시도: {meta['title']}")
                    res = self.lyrics_crawler.fetch_lyrics(meta['title'], meta['artist'], meta['album'])
                    if res:
                        lyrics_text = self.text_cleaner.clean_text(res['lyrics'])
                        logger.info("[Text] 크롤링 성공")
                except Exception as e:
                    logger.warning(f"[Text] 크롤링 실패: {e}")

            # 4-B. 일반 영상 (General) 또는 크롤링 실패 -> 자막 다운로드
            if not lyrics_text:
                try:
                    logger.info("[Text] 유튜브 자막 검색 시도")
                    sub_file = self._download_subtitles(video_id, work_dir)
                    if sub_file:
                        # VTT -> Pure Text (with TextCleaner)
                        lyrics_text = self.text_cleaner.parse_vtt_to_text(sub_file)
                        if lyrics_text:
                            logger.info("[Text] 자막 확보 및 정제 완료")
                except Exception as e:
                    logger.warning(f"[Text] 자막 처리 실패: {e}")

            # [5단계] Whisper 정렬 (텍스트 존재 시)
            # Demucs 메모리가 해제된 상태에서 실행됨
            if lyrics_text and len(lyrics_text) > 10 and vocal_absolute_path:
                if progress_callback: progress_callback(85, 'AI 싱크 정렬 중...')
                try:
                    lrc = align_lyrics(
                        vocal_absolute_path, 
                        lyrics_text, 
                        device='cuda' if torch.cuda.is_available() else 'cpu'
                    )
                    if lrc:
                        result['lyrics_lrc'] = lrc
                        (work_dir / 'aligned.lrc').write_text(lrc, encoding='utf-8')
                        logger.info("[Align] 정렬 완료")
                except Exception as e:
                    logger.error(f"[Align] 정렬 실패: {e}")
            else:
                logger.info("[Workflow] 텍스트 리소스 없음 - 오디오만 반환")
            
            result['success'] = True
            if progress_callback: progress_callback(100, '완료!')
            return result

        except Exception as e:
            logger.error(f"Workflow Error: {e}")
            result['error'] = str(e)
            if progress_callback: progress_callback(0, f"Error: {e}")
            return result
            
        finally:
            # 안전장치: 혹시 모델이 남아있다면 해제
            if demucs_model:
                del demucs_model
            gc.collect()
            torch.cuda.empty_cache()

    def _check_cache(self, video_id: str) -> Optional[Dict]:
        """캐시 확인"""
        work_dir = self.download_dir / video_id
        separation_dir = work_dir / 'separated'
        
        processor = DemucsProcessor(str(self.download_dir))
        tracks = processor.get_separated_tracks(str(separation_dir))
        
        required = ['vocal', 'drum', 'bass', 'other']
        if not all(k in tracks for k in required):
            return None
            
        for t, info in tracks.items():
            info['path'] = f"/downloads/{video_id}/{t}.wav"
            
        lrc = None
        lrc_path = work_dir / 'aligned.lrc'
        if lrc_path.exists():
            lrc = lrc_path.read_text(encoding='utf-8')
            
        return {
            'success': True,
            'video_id': video_id,
            'tracks': tracks,
            'lyrics_lrc': lrc,
            'cached': True
        }

    def _download_subtitles(self, video_id: str, output_dir: Path) -> Optional[str]:
        """yt-dlp로 자막 다운로드"""
        url = f"https://www.youtube.com/watch?v={video_id}"
        
        # 한국어, 영어 순으로 자막 다운로드 시도
        cmd = [
            'yt-dlp',
            '--write-sub', '--write-auto-sub',
            '--sub-lang', 'ko,en',
            '--skip-download',
            '-o', str(output_dir / '%(title)s.%(ext)s'),
            url
        ]

        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            candidates = list(output_dir.glob('*.vtt'))
            if not candidates: return None
            
            # 한국어 우선
            for f in candidates:
                if '.ko' in f.name: return str(f)
            return str(candidates[0])
            
        except Exception:
            return None