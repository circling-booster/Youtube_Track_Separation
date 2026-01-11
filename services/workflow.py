"""
통합 파이프라인: 다운로드 → 분리 → 정렬(JSON) → 응답
VRAM 메모리 안전성 보장 & 스마트 캐싱 & 로직 통합
"""

import logging
import gc
import torch
import time
import subprocess
import json
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
        self.MAX_FILE_SIZE_MB = 30
        self.REQUIRE_MANUAL_SUBTITLES = True 

    def process_video(
        self,
        video_id: str,
        model: str = 'htdemucs',
        meta: Optional[Dict[str, Any]] = None,
        progress_callback: Optional[Callable] = None
    ) -> Dict[str, Any]:
        
        logger.info(f"\n{'='*70}\n[Workflow] 영상 처리: {video_id}\n{'='*70}")

        # [0단계] 캐시 확인 (JSON 우선)
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
            'lyrics_lrc': None, # 클라이언트는 이 필드에서 JSON/LRC를 모두 받음
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

            file_size_mb = audio_file.stat().st_size / (1024 * 1024)
            if file_size_mb > self.MAX_FILE_SIZE_MB:
                try: audio_file.unlink()
                except: pass
                raise Exception(f"파일 크기 초과 ({file_size_mb:.1f}MB > 30MB)")

            # [2단계] Demucs 분리 (VRAM 관리)
            if progress_callback: progress_callback(20, 'AI 오디오 분리 및 MP3 변환 중 (GPU)...')
            
            processor = DemucsProcessor(str(self.download_dir))
            separation_dir = work_dir / 'separated'
            
            # 모델 로드 및 처리
            demucs_model = processor.load_model(model)
            success = processor.process_with_model(demucs_model, audio_file, separation_dir, progress_callback)
            
            # 모델 즉시 해제
            del demucs_model
            demucs_model = None
            gc.collect()
            torch.cuda.empty_cache()
            time.sleep(2)

            if not success: raise Exception("Demucs 분리 실패")

            # [3단계] 트랙 정보 수집
            tracks = processor.get_separated_tracks(str(separation_dir))
            if not tracks: raise Exception("분리된 트랙 없음")
            
            vocal_absolute_path = tracks.get('vocal', {}).get('path')
            
            for t, info in tracks.items():
                info['path'] = f"/downloads/{video_id}/{t}.mp3"
            result['tracks'] = tracks

            # [4단계] 텍스트 리소스 확보
            lyrics_text = None
            source_type = meta.get('sourceType', 'general')

            if progress_callback: progress_callback(70, '자막/가사 검색 중...')

            # 4-A. 공식 음원 크롤링
            if source_type == 'official' and meta.get('title'):
                try:
                    res = self.lyrics_crawler.fetch_lyrics(meta['title'], meta['artist'], meta['album'])
                    if res: lyrics_text = self.text_cleaner.clean_text(res['lyrics'])
                except Exception as e:
                    logger.warning(f"[Text] 크롤링 실패: {e}")

            # 4-B. 자막 다운로드
            if not lyrics_text:
                try:
                    sub_file = self._download_subtitles(video_id, work_dir)
                    if sub_file:
                        lyrics_text = self.text_cleaner.parse_vtt_to_text(sub_file)
                except Exception as e:
                    logger.warning(f"[Text] 자막 실패: {e}")

            # [5단계] Whisper 정렬 (JSON 출력)
            if lyrics_text and len(lyrics_text) > 10 and vocal_absolute_path:
                if progress_callback: progress_callback(85, 'AI 정밀 정렬 중 (Whisper)...')
                try:
                    device = 'cuda' if torch.cuda.is_available() else 'cpu'
                    
                    # align_lyrics가 이제 JSON 문자열을 반환한다고 가정
                    lyrics_json_str = align_lyrics(vocal_absolute_path, lyrics_text, device=device)
                    
                    if lyrics_json_str:
                        # JSON 파일로 저장
                        (work_dir / 'aligned.json').write_text(lyrics_json_str, encoding='utf-8')
                        
                        # 결과에 포함 (변수명은 호환성을 위해 lyrics_lrc 유지)
                        result['lyrics_lrc'] = lyrics_json_str
                        logger.info("[Align] 정렬 및 JSON 저장 완료")
                except Exception as e:
                    logger.error(f"[Align] 정렬 실패: {e}")
            
            result['success'] = True
            if progress_callback: progress_callback(100, '완료!')
            return result

        except Exception as e:
            logger.error(f"Workflow Error: {e}")
            result['error'] = str(e)
            if progress_callback: progress_callback(0, f"Error: {e}")
            return result
            
        finally:
            if demucs_model: del demucs_model
            gc.collect()
            torch.cuda.empty_cache()

    def _check_cache(self, video_id: str) -> Optional[Dict]:
        """캐시 확인 (JSON -> LRC 순)"""
        work_dir = self.download_dir / video_id
        separation_dir = work_dir / 'separated'
        
        processor = DemucsProcessor(str(self.download_dir))
        tracks = processor.get_separated_tracks(str(separation_dir))
        
        required = ['vocal', 'drum', 'bass', 'other']
        if not all(k in tracks for k in required):
            return None
            
        for t, info in tracks.items():
            info['path'] = f"/downloads/{video_id}/{t}.mp3"
            
        lyrics_content = None
        
        # 1. JSON 캐시 확인
        json_path = work_dir / 'aligned.json'
        if json_path.exists():
            lyrics_content = json_path.read_text(encoding='utf-8')
        else:
            # 2. LRC 캐시 확인 (하위 호환)
            lrc_path = work_dir / 'aligned.lrc'
            if lrc_path.exists():
                lyrics_content = lrc_path.read_text(encoding='utf-8')
            
        return {
            'success': True,
            'video_id': video_id,
            'tracks': tracks,
            'lyrics_lrc': lyrics_content,
            'cached': True
        }

    def _download_subtitles(self, video_id: str, output_dir: Path) -> Optional[str]:
        url = f"https://www.youtube.com/watch?v={video_id}"
        
        # 기존 자막 삭제
        for old_file in output_dir.glob("*.vtt"):
            try: old_file.unlink()
            except: pass

        def try_download(is_auto: bool):
            cmd = [
                'yt-dlp',
                '--write-auto-sub' if is_auto else '--write-sub',
                '--sub-lang', 'ko,en',
                '--skip-download',
                '-o', str(output_dir / '%(title)s.%(ext)s'),
                url
            ]
            subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            candidates = list(output_dir.glob('*.vtt'))
            if not candidates: return None
            for f in candidates:
                if '.ko' in f.name: return str(f)
            return str(candidates[0])

        manual_sub = try_download(False)
        if manual_sub: return manual_sub
        
        if self.REQUIRE_MANUAL_SUBTITLES: return None
            
        return try_download(True)