"""
통합 파이프라인: 다운로드 → 분리 → 정렬 → 응답
VRAM 메모리 안전성 보장 & 스마트 캐싱 & 로직 통합
"""

import logging
import gc
import torch
from pathlib import Path
from typing import Callable, Optional, Dict, Any
import subprocess

# 로컬 모듈
from download import YouTubeDownloader
from demucs_processor import DemucsProcessor
from audio_sync import AudioSyncProcessor # 복구됨
from extract_lyrics import BugsLyricsCrawler
from align_force import align_lyrics

logger = logging.getLogger(__name__)

class TrackSeparationWorkflow:
    def __init__(self, download_dir: str):
        self.download_dir = Path(download_dir)
        self.downloader = YouTubeDownloader(str(download_dir))
        self.lyrics_crawler = BugsLyricsCrawler()
        self.audio_sync = AudioSyncProcessor() # 인스턴스 유지

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

        try:
            work_dir = self.download_dir / video_id
            work_dir.mkdir(parents=True, exist_ok=True)

            # [1단계] 오디오 다운로드
            if progress_callback: progress_callback(5, '오디오 다운로드 중...')
            audio_file = self.downloader.download(video_id, output_dir=work_dir)
            if not audio_file: raise Exception("오디오 다운로드 실패")

            # [2단계] Demucs 분리
            if progress_callback: progress_callback(20, 'AI 오디오 분리 중...')
            demucs = DemucsProcessor(str(self.download_dir))
            separation_dir = work_dir / 'separated'
            
            success = demucs.process_and_stream(
                audio_file, separation_dir, model=model, progress_callback=progress_callback
            )
            
            # VRAM 정리
            del demucs
            gc.collect()
            torch.cuda.empty_cache()

            if not success: raise Exception("Demucs 분리 실패")

            # 트랙 경로 매핑
            demucs_check = DemucsProcessor(str(self.download_dir))
            tracks = demucs_check.get_separated_tracks(str(separation_dir))
            
            if not tracks: raise Exception("분리된 트랙 없음")
            
            for t, info in tracks.items():
                info['path'] = f"/downloads/{video_id}/{t}.wav"
            result['tracks'] = tracks

            # [3단계] 텍스트 리소스 확보
            lyrics_text = None
            if progress_callback: progress_callback(70, '가사/자막 확보 중...')

            # 3-A. 공식 음원 (크롤링)
            if meta.get('sourceType') == 'official' and meta.get('title'):
                try:
                    res = self.lyrics_crawler.fetch_lyrics(meta['title'], meta['artist'], meta['album'])
                    if res: lyrics_text = res['lyrics']
                except Exception: pass
            
            # 3-B. 일반 영상 (자막 다운로드)
            if not lyrics_text:
                try:
                    sub_file = self._download_subtitles(video_id, work_dir)
                    if sub_file: lyrics_text = self._parse_subtitles(sub_file)
                except Exception: pass

            # [4단계] Whisper 정렬 (가사 존재 시)
            if lyrics_text and len(lyrics_text) > 10:
                if progress_callback: progress_callback(85, 'AI 싱크 정렬 중...')
                try:
                    # Whisper VRAM 사용을 위해 다시 캐시 정리
                    torch.cuda.empty_cache()
                    
                    lrc = align_lyrics(str(audio_file), lyrics_text, device='cuda' if torch.cuda.is_available() else 'cpu')
                    if lrc:
                        result['lyrics_lrc'] = lrc
                        (work_dir / 'aligned.lrc').write_text(lrc, encoding='utf-8')
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
            gc.collect()
            torch.cuda.empty_cache()

    def _check_cache(self, video_id: str) -> Optional[Dict]:
        """캐시된 트랙 및 가사 확인"""
        work_dir = self.download_dir / video_id
        separation_dir = work_dir / 'separated'
        
        # 트랙 확인
        demucs = DemucsProcessor(str(self.download_dir))
        tracks = demucs.get_separated_tracks(str(separation_dir))
        
        required = ['vocal', 'drum', 'bass', 'other']
        if not all(k in tracks for k in required):
            return None
            
        # URL 매핑
        for t, info in tracks.items():
            info['path'] = f"/downloads/{video_id}/{t}.wav"
            
        # 가사 확인
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
        """
        yt-dlp로 자막 다운로드 (한국어 우선 선택 로직 적용)
        """
        url = f"https://www.youtube.com/watch?v={video_id}"
        
        cmd = [
            'yt-dlp',
            '--write-auto-sub',    # 자동 생성 자막 허용
            '--write-sub',         # 수동 자막 허용
            '--sub-lang', 'ko,en', # 한국어, 영어 모두 요청
            '--skip-download',     # 영상 다운로드는 생략
            '-o', str(output_dir / '%(title)s'), # 파일명 템플릿
            url
        ]

        logger.info(f"[자막] 다운로드 명령어: {' '.join(cmd)}")

        try:
            # 1. yt-dlp 실행
            subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )

            # 2. 다운로드된 VTT 파일 목록 조회
            vtt_files = list(output_dir.glob('*.vtt'))
            if not vtt_files:
                return None

            # 3. 우선순위 결정 로직 (한국어 > 영어 > 기타)
            selected_file = None
            
            # 3-1. 한국어(.ko)가 포함된 파일 찾기
            for f in vtt_files:
                # 파일명에 .ko. 또는 .ko-KR. 등이 포함되어 있는지 확인
                if '.ko' in f.name.lower(): 
                    selected_file = f
                    logger.info(f"[자막] 한국어 자막 선택됨: {f.name}")
                    break
            
            # 3-2. 한국어가 없으면 영어(.en) 찾기
            if not selected_file:
                for f in vtt_files:
                    if '.en' in f.name.lower():
                        selected_file = f
                        logger.info(f"[자막] 영어 자막 선택됨 (한국어 없음): {f.name}")
                        break
            
            # 3-3. 둘 다 없으면 첫 번째 파일 선택 (Fallback)
            if not selected_file:
                selected_file = vtt_files[0]
                logger.info(f"[자막] 기본 자막 선택됨: {selected_file.name}")

            return str(selected_file)

        except Exception as e:
            logger.warning(f"[자막] 다운로드 오류: {e}")

        return None

    def _parse_subtitles(self, path):
        # VTT -> Text 파싱
        try:
            with open(path, 'r', encoding='utf-8') as f:
                lines = [l.strip() for l in f if l.strip() and '-->' not in l and not l.strip().isdigit() and l.strip() != 'WEBVTT']
            return ' '.join(list(dict.fromkeys(lines))) # 중복제거
        except: return None