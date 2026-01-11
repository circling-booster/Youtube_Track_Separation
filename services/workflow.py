"""
통합 파이프라인: 다운로드 → 분리 → 정렬 → 응답
VRAM 메모리 안전성 보장 (Sequential Execution)
"""

import logging
import gc
import torch
from pathlib import Path
from typing import Callable, Optional, Dict, Any
import subprocess

# 로컬 모듈 임포트
from download import YouTubeDownloader
from demucs_processor import DemucsProcessor
from audio_sync import AudioSyncProcessor
from extract_lyrics import BugsLyricsCrawler
from align_force import align_lyrics

logger = logging.getLogger(__name__)

class TrackSeparationWorkflow:
    """전체 파이프라인 오케스트레이션"""

    def __init__(self, download_dir: str):
        """
        Args:
            download_dir: 작업 디렉토리
        """
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
        """
        통합 워크플로우 실행
        
        Args:
            video_id: YouTube 비디오 ID
            model: Demucs 모델 ('htdemucs' 또는 'htdemucs_ft')
            meta: 메타데이터 {'sourceType', 'artist', 'title', 'album'}
            progress_callback: 진행 상황 콜백 함수
        
        Returns:
            dict: 처리 결과
        """
        
        logger.info(f"\n{'='*70}")
        logger.info(f"[Workflow] 영상 처리 시작: {video_id}")
        logger.info(f"[Workflow] 메타데이터: {meta}")
        logger.info(f"{'='*70}\n")

        # 기본값 설정
        if meta is None:
            meta = {
                'sourceType': 'general',
                'artist': None,
                'title': None,
                'album': None
            }

        result = {
            'success': False,
            'video_id': video_id,
            'tracks': {},
            'lyrics_lrc': None,
            'error': None
        }

        try:
            # ============================================================
            # [1단계] 오디오 다운로드
            # ============================================================
            if progress_callback:
                progress_callback(5, '오디오 다운로드 중...')

            logger.info("▶ [1/5] 오디오 다운로드 시작")
            
            work_dir = self.download_dir / video_id
            work_dir.mkdir(exist_ok=True, parents=True)

            audio_file = self.downloader.download(video_id, output_dir=work_dir)
            if not audio_file:
                raise Exception("오디오 다운로드 실패")

            logger.info(f"✓ 다운로드 완료: {audio_file}")

            # ============================================================
            # [2단계] 오디오 분리 (Demucs)
            # ============================================================
            if progress_callback:
                progress_callback(25, 'AI 오디오 분리 중...')

            logger.info("▶ [2/5] Demucs 분리 시작")

            # Demucs 프로세서 동적 생성 (메모리 최소화)
            demucs = DemucsProcessor(str(self.download_dir))

            separation_dir = work_dir / 'separated'
            success = demucs.process_and_stream(
                audio_file,
                separation_dir,
                model=model,
                progress_callback=progress_callback
            )

            if not success:
                raise Exception("Demucs 분리 실패")

            logger.info(f"✓ 분리 완료")

            # VRAM 메모리 해제 (중요!)
            del demucs
            gc.collect()
            torch.cuda.empty_cache()
            logger.info("✓ Demucs 메모리 해제 완료")

            # 분리된 트랙 조회
            demucs_check = DemucsProcessor(str(self.download_dir))
            tracks = demucs_check.get_separated_tracks(str(separation_dir))
            del demucs_check

            if not tracks:
                raise Exception("분리된 트랙을 찾을 수 없음")

            result['tracks'] = tracks
            logger.info(f"발견된 트랙: {list(tracks.keys())}")

            # ============================================================
            # [3단계] 가사 및 자막 처리
            # ============================================================
            lyrics_text = None

            if progress_callback:
                progress_callback(70, '가사 처리 중...')

            logger.info("▶ [3/5] 가사 처리 시작")

            # Official 음원인 경우 BugsLyricsCrawler 사용
            if (meta['sourceType'] == 'official' and 
                meta['artist'] and 
                meta['title']):
                
                logger.info("▶ [가사] 공식 음원 - BugsLyricsCrawler 사용")
                
                try:
                    lyrics_result = self.lyrics_crawler.fetch_lyrics(
                        meta['title'],
                        artist_name=meta['artist'],
                        album_name=meta['album']
                    )
                    
                    if lyrics_result and 'lyrics' in lyrics_result:
                        lyrics_text = lyrics_result['lyrics']
                        logger.info(f"✓ 가사 수집 완료 ({len(lyrics_text)} 글자)")
                
                except Exception as e:
                    logger.warning(f"[가사] BugsLyricsCrawler 실패: {e}")
                    logger.info("▶ [가사] General 로직으로 Fallback")

            # General 음원이거나 Official 실패 시 yt-dlp 자막 사용
            if not lyrics_text:
                logger.info("▶ [가사] General - yt-dlp 자막 다운로드")
                
                try:
                    subtitle_file = self._download_subtitles(video_id, work_dir)
                    if subtitle_file:
                        lyrics_text = self._parse_subtitles(subtitle_file)
                        logger.info(f"✓ 자막 추출 완료 ({len(lyrics_text) if lyrics_text else 0} 글자)")
                
                except Exception as e:
                    logger.warning(f"[가사] 자막 다운로드 실패: {e}")

            # ============================================================
            # [4단계] Whisper 정렬 (가사 있을 때만)
            # ============================================================
            if lyrics_text and len(lyrics_text) > 10:
                if progress_callback:
                    progress_callback(80, 'Whisper 정렬 중...')

                logger.info("▶ [4/5] Whisper 정렬 시작")

                try:
                    device = 'cuda' if torch.cuda.is_available() else 'cpu'
                    lrc_content = align_lyrics(
                        str(audio_file),
                        lyrics_text,
                        device=device,
                        language='ko'
                    )

                    if lrc_content:
                        result['lyrics_lrc'] = lrc_content

                        # LRC 파일 저장
                        lrc_path = work_dir / 'aligned.lrc'
                        with open(lrc_path, 'w', encoding='utf-8') as f:
                            f.write(lrc_content)

                        logger.info(f"✓ 정렬 완료: {lrc_path}")

                except Exception as e:
                    logger.warning(f"[정렬] Whisper 정렬 실패: {e}")
                    logger.info("▶ [정렬] 가사 없이 계속 진행")

                finally:
                    # Whisper 메모리 해제 (중요!)
                    gc.collect()
                    torch.cuda.empty_cache()
                    logger.info("✓ Whisper 메모리 해제 완료")

            else:
                logger.info("▶ [4/5] 가사 없음 - 정렬 스킵")

            # ============================================================
            # [5단계] 오디오 동기화 분석 (선택적)
            # ============================================================
            if progress_callback:
                progress_callback(90, '동기화 분석 중...')

            logger.info("▶ [5/5] 오디오 동기화 분석")

            try:
                for track_name, track_info in tracks.items():
                    if self.audio_sync.analyze_track(track_info['path']):
                        logger.info(f"✓ {track_name} 동기화 분석 완료")

            except Exception as e:
                logger.warning(f"[동기화] 분석 실패: {e}")

            # ============================================================
            # 최종 완료
            # ============================================================
            result['success'] = True

            if progress_callback:
                progress_callback(100, '완료!')

            logger.info("\n" + "="*70)
            logger.info(f"✅ [Workflow] 처리 완료")
            logger.info(f" - 분리된 트랙: {list(tracks.keys())}")
            logger.info(f" - 가사 정렬: {'예' if result['lyrics_lrc'] else '아니오'}")
            logger.info("="*70 + "\n")

            return result

        except Exception as e:
            logger.error(f"\n❌ [Workflow] 처리 실패: {e}")
            import traceback
            logger.error(traceback.format_exc())
            result['error'] = str(e)

            if progress_callback:
                progress_callback(0, f'오류: {str(e)}')

            return result

        finally:
            # 최종 메모리 정리
            gc.collect()
            torch.cuda.empty_cache()
            logger.info("[Workflow] 최종 메모리 정리 완료")

    def _download_subtitles(self, video_id: str, output_dir: Path) -> Optional[str]:
        """
        yt-dlp로 자막 다운로드
        
        Args:
            video_id: YouTube 비디오 ID
            output_dir: 저장 디렉토리
        
        Returns:
            str: 다운로드된 자막 파일 경로 또는 None
        """
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

        logger.info(f"[자막] 다운로드 명령어: {' '.join(cmd)}")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode == 0:
                # VTT 파일 찾기
                vtt_files = list(output_dir.glob('*.vtt'))
                if vtt_files:
                    logger.info(f"[자막] VTT 파일 발견: {vtt_files}")
                    return str(vtt_files)

        except Exception as e:
            logger.warning(f"[자막] 다운로드 오류: {e}")

        return None

    def _parse_subtitles(self, subtitle_file: str) -> Optional[str]:
        """
        VTT 자막을 순수 텍스트로 변환
        
        Args:
            subtitle_file: VTT 파일 경로
        
        Returns:
            str: 추출된 텍스트 또는 None
        """
        try:
            with open(subtitle_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # VTT 포맷 파싱
            lines = content.split('\n')
            text_lines = []

            for line in lines:
                # 타임스탬프 라인, 헤더, 빈 줄 제외
                if '-->' in line or line.startswith('WEBVTT') or not line.strip():
                    continue
                text_lines.append(line.strip())

            lyrics_text = ' '.join(text_lines)
            logger.info(f"[자막] 추출 완료: {len(lyrics_text)} 글자")
            return lyrics_text

        except Exception as e:
            logger.error(f"[자막] 파싱 오류: {e}")
            return None
