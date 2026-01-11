"""
통합 파이프라인: 다운로드 → 분리 → 정렬 → 응답
VRAM 메모리 안전성 보장 & 스마트 캐싱 & 로직 통합
수정사항: 자막 우선 처리 및 VTT 파싱 로직 강화 (Broken VTT 대응)
"""

import logging
import gc
import torch
import time
import re
import subprocess
from pathlib import Path
from typing import Callable, Optional, Dict, Any

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
            
            # Whisper 정렬을 위해 실제 파일 절대 경로 미리 저장
            vocal_absolute_path = None
            if 'vocal' in tracks:
                vocal_absolute_path = tracks['vocal']['path']

            # 클라이언트용 URL 생성
            for t, info in tracks.items():
                info['path'] = f"/downloads/{video_id}/{t}.wav"
            result['tracks'] = tracks

            # ====================================================
            # [수정된 로직] 텍스트 리소스 확보 전략
            # Priority 1: 자막 (Subtitles) - 항상 최우선 시도
            # Priority 2: 가사 크롤링 (Official인 경우만)
            # ====================================================
            lyrics_text = None
            
            if progress_callback: progress_callback(70, '자막/가사 검색 중...')

            # 3-A. 자막 다운로드 시도 (최우선)
            try:
                sub_file = self._download_subtitles(video_id, work_dir)
                if sub_file:
                    logger.info(f"[Text] 자막 파일 발견: {sub_file}")
                    lyrics_text = self._parse_subtitles(sub_file)
                    if lyrics_text:
                        logger.info("[Text] 자막 파싱 및 정제 성공")
            except Exception as e:
                logger.warning(f"[Text] 자막 처리 중 오류: {e}")

            # 3-B. 자막이 없고 & 공식 음원인 경우 -> 크롤링 시도
            if not lyrics_text and meta.get('sourceType') == 'official' and meta.get('title'):
                if progress_callback: progress_callback(75, '공식 가사 검색 중...')
                try:
                    logger.info(f"[Text] 공식 음원 가사 크롤링 시도: {meta['title']}")
                    res = self.lyrics_crawler.fetch_lyrics(meta['title'], meta['artist'], meta['album'])
                    if res: 
                        lyrics_text = res['lyrics']
                        logger.info("[Text] 가사 크롤링 성공")
                except Exception as e:
                    logger.warning(f"[Text] 크롤링 오류: {e}")

            # [4단계] Whisper 정렬 (텍스트 존재 시)
            if lyrics_text and len(lyrics_text) > 10:
                if progress_callback: progress_callback(85, 'AI 싱크 정렬 중...')
                try:
                    if vocal_absolute_path:
                        # 정렬 수행
                        lrc = align_lyrics(
                            vocal_absolute_path, 
                            lyrics_text, 
                            device='cuda' if torch.cuda.is_available() else 'cpu'
                        )
                        if lrc:
                            result['lyrics_lrc'] = lrc
                            (work_dir / 'aligned.lrc').write_text(lrc, encoding='utf-8')
                            logger.info("[Align] 정렬 완료 및 저장됨")
                    else:
                        logger.warning("[Align] 정렬 실패: 보컬 트랙 경로 없음")
                except Exception as e:
                    logger.error(f"[Align] 정렬 실패: {e}")
            else:
                logger.info("[Workflow] 텍스트 리소스 없음 - 오디오만 반환")
            
            result['success'] = True
            if progress_callback: progress_callback(100, '완료!')
            return result

        except Exception as e:
            logger.error(f"Workflow Error: {e}")
            import traceback
            logger.error(traceback.format_exc())
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
        """yt-dlp로 자막 다운로드 (수동 자막 우선, 자동 자막 차선)"""
        url = f"https://www.youtube.com/watch?v={video_id}"
        
        # 1차 시도: 수동 자막 (Clean Subs)
        cmd_manual = [
            'yt-dlp',
            '--write-sub',
            '--sub-lang', 'ko,en',
            '--skip-download',
            '-o', str(output_dir / '%(title)s.manual'),
            url
        ]
        
        # 2차 시도: 자동 자막 (Auto Subs)
        cmd_auto = [
            'yt-dlp',
            '--write-auto-sub',
            '--sub-lang', 'ko,en',
            '--skip-download',
            '-o', str(output_dir / '%(title)s.auto'),
            url
        ]

        def run_and_find(cmd, suffix_pattern):
            try:
                subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                # 파일 검색
                candidates = list(output_dir.glob(f'*.{suffix_pattern}.*.vtt'))
                if not candidates: return None
                
                # 한국어 우선 선택
                for f in candidates:
                    if '.ko.' in f.name.lower(): return f
                return candidates[0]
            except Exception:
                return None

        # 수동 자막 시도
        found = run_and_find(cmd_manual, 'manual')
        if found: return str(found)
        
        # 자동 자막 시도
        found = run_and_find(cmd_auto, 'auto')
        if found: return str(found)
        
        return None

    def _parse_subtitles(self, path):
        """
        VTT 파일 파싱 및 정제 (Broken VTT, 태그, 중복 라인 제거)
        """
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()

            lines = content.split('\n')
            cleaned_lines = []
            prev_line = ""

            # 정규표현식 컴파일
            # 1. 태그 제거: <c>, <00:00:00> 등
            tag_pattern = re.compile(r'<[^>]+>')
            # 2. 메타데이터 제거: align:start position:0% 등
            meta_pattern = re.compile(r'\s+align:\S+|position:\S+|line:\S+')
            # 3. 타임스탬프 라인 식별
            time_pattern = re.compile(r'\d{2}:\d{2}:\d{2}\.\d{3}\s-->\s\d{2}:\d{2}:\d{2}\.\d{3}')

            for line in lines:
                line = line.strip()
                
                # 건너뛰기 조건
                if not line: continue
                if line == 'WEBVTT': continue
                if line.startswith('Kind:'): continue
                if line.startswith('Language:'): continue
                if time_pattern.match(line): continue
                
                # 태그 및 메타데이터 정제
                # 예: "안녕하세요.<00:11><c> 반가워요</c>" -> "안녕하세요. 반가워요"
                line = tag_pattern.sub('', line)
                line = meta_pattern.sub('', line)
                line = line.strip()
                
                if not line: continue

                # 중복 제거 (바로 윗줄과 같다면 스킵 - 자동자막의 누적 문제 해결)
                # strip() 된 상태에서 비교하므로 공백 차이로 인한 중복도 방지
                if line != prev_line:
                    cleaned_lines.append(line)
                    prev_line = line

            # 결과 합치기
            full_text = ' '.join(cleaned_lines)
            
            # 너무 짧으면 유효하지 않음
            if len(full_text) < 10:
                return None
                
            return full_text

        except Exception as e:
            logger.error(f"[_parse_subtitles] 파싱 오류: {e}")
            return None