"""
통합 파이프라인: 다운로드 → 분리 → 정렬 → 응답
VRAM 메모리 안전성 보장 & 스마트 캐싱 & 로직 통합
"""

import logging
import gc
import torch
import time
from pathlib import Path
from typing import Callable, Optional, Dict, Any
import subprocess

# 로컬 모듈
from download import YouTubeDownloader
from demucs_processor import DemucsProcessor
from audio_sync import AudioSyncProcessor
from extract_lyrics import BugsLyricsCrawler
from align_force import align_lyrics

logger = logging.getLogger(__name__)

class TrackSeparationWorkflow:
    def __init__(self, download_dir: str):
        self.download_dir = Path(download_dir)
        self.downloader = YouTubeDownloader(str(download_dir))
        self.lyrics_crawler = BugsLyricsCrawler()
        self.audio_sync = AudioSyncProcessor()

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
            
            # 2-1. 모델 로드
            demucs_model = processor.load_model(model)
            
            # 2-2. 분리 수행
            success = processor.process_with_model(
                demucs_model, 
                audio_file, 
                separation_dir, 
                progress_callback=progress_callback
            )
            
            # 2-3. 모델 즉시 해제 (Whisper를 위해 VRAM 확보)
            del demucs_model
            demucs_model = None
            gc.collect()
            torch.cuda.empty_cache()
            time.sleep(1) # VRAM 해제 대기

            if not success: raise Exception("Demucs 분리 실패")

            # [3단계] 트랙 경로 매핑 및 텍스트 리소스 확보
            tracks = processor.get_separated_tracks(str(separation_dir))
            if not tracks: raise Exception("분리된 트랙 없음")
            
            # [Fix] Whisper 정렬을 위해 실제 파일 절대 경로 미리 저장 (URL 덮어쓰기 전)
            vocal_absolute_path = None
            if 'vocal' in tracks:
                vocal_absolute_path = tracks['vocal']['path']

            # [Fix] 클라이언트용 URL 생성 (라우터 규칙에 맞게 /separated 제거)
            # routes.py의 rglob이 하위 폴더를 검색하므로 단순 경로가 안전함
            for t, info in tracks.items():
                info['path'] = f"/downloads/{video_id}/{t}.wav"
            result['tracks'] = tracks

            lyrics_text = None
            if progress_callback: progress_callback(70, '가사/자막 확보 중...')

            # 3-A. 공식 음원 (크롤링)
            if meta.get('sourceType') == 'official' and meta.get('title'):
                try:
                    res = self.lyrics_crawler.fetch_lyrics(meta['title'], meta['artist'], meta['album'])
                    if res: lyrics_text = res['lyrics']
                except Exception: pass
            
            # 3-B. 일반 영상 또는 크롤링 실패 (자막 다운로드)
            if not lyrics_text:
                try:
                    sub_file = self._download_subtitles(video_id, work_dir)
                    if sub_file: lyrics_text = self._parse_subtitles(sub_file)
                except Exception: pass

            # [4단계] Whisper 정렬 (가사 존재 시)
            if lyrics_text and len(lyrics_text) > 10:
                if progress_callback: progress_callback(85, 'AI 싱크 정렬 중...')
                try:
                    # [Fix] 역산한 경로 대신 저장해둔 절대 경로 사용
                    if vocal_absolute_path:
                        lrc = align_lyrics(vocal_absolute_path, lyrics_text, device='cuda' if torch.cuda.is_available() else 'cpu')
                        if lrc:
                            result['lyrics_lrc'] = lrc
                            (work_dir / 'aligned.lrc').write_text(lrc, encoding='utf-8')
                    else:
                        logger.warning("정렬 실패: 보컬 트랙 경로를 찾을 수 없음")
                except Exception as e:
                    logger.error(f"정렬 실패: {e}")
            
            result['success'] = True
            if progress_callback: progress_callback(100, '완료!')
            return result

        except Exception as e:
            logger.error(f"Workflow Error: {e}")
            result['error'] = str(e)
            if progress_callback: progress_callback(0, f"Error: {e}")
            return result
        finally:
            # 안전장치: 모델이 남아있다면 해제
            if demucs_model:
                del demucs_model
            gc.collect()
            torch.cuda.empty_cache()

    def _check_cache(self, video_id: str) -> Optional[Dict]:
        """캐시된 트랙 및 가사 확인"""
        work_dir = self.download_dir / video_id
        separation_dir = work_dir / 'separated'
        
        processor = DemucsProcessor(str(self.download_dir))
        tracks = processor.get_separated_tracks(str(separation_dir))
        
        required = ['vocal', 'drum', 'bass', 'other']
        if not all(k in tracks for k in required):
            return None
            
        for t, info in tracks.items():
            # [Fix] 캐시 URL도 동일하게 수정
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
        cmd = [
            'yt-dlp',
            '--write-auto-sub',
            '--write-sub',
            '--sub-lang', 'ko,en',
            '--skip-download',
            '-o', str(output_dir / '%(title)s'),
            url
        ]
        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            vtt_files = list(output_dir.glob('*.vtt'))
            if not vtt_files: return None

            selected_file = None
            for f in vtt_files: # 한국어 우선
                if '.ko' in f.name.lower(): 
                    selected_file = f
                    break
            if not selected_file: selected_file = vtt_files[0]
            return str(selected_file)

        except Exception as e:
            logger.warning(f"[자막] 다운로드 오류: {e}")
            return None

    def _parse_subtitles(self, path):
        """VTT -> Text 파싱"""
        try:
            with open(path, 'r', encoding='utf-8') as f:
                lines = [l.strip() for l in f if l.strip() and '-->' not in l and not l.strip().isdigit() and l.strip() != 'WEBVTT']
            return ' '.join(list(dict.fromkeys(lines)))
        except: return None