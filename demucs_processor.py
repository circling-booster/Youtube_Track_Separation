"""
Demucs를 이용한 오디오 트랙 분리
- 외부 모델 주입 방식
- 메모리 안전성 최적화
"""

import subprocess
import logging
import torch
import torchaudio
import os
import gc
from pathlib import Path
from typing import Callable, Optional, Any

logger = logging.getLogger(__name__)

class DemucsProcessor:
    """DEMUCS를 이용한 오디오 분리"""

    MODELS = {
        'htdemucs': 'facebook/demucs-htdemucs',
        'htdemucs_ft': 'facebook/demucs-htdemucs_ft'
    }

    def __init__(self, download_dir):
        """
        Args:
            download_dir: 작업 디렉토리
        """
        self.download_dir = Path(download_dir)
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        
        logger.info(f"🖥️ Device: {self.device}")
        if self.device == 'cuda':
            logger.info(f"📊 GPU: {torch.cuda.get_device_name(0)}")
            logger.info(f"💾 VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
        
        self._check_demucs()

    def has_gpu(self):
        """GPU 사용 가능 여부"""
        return torch.cuda.is_available()

    def _check_demucs(self):
        """DEMUCS 설치 확인"""
        try:
            result = subprocess.run(
                ['demucs', '--help'],
                capture_output=True,
                timeout=10
            )
            if result.returncode == 0:
                logger.info("✓ DEMUCS 설치됨")
                return True
        except Exception:
            pass
        
        logger.warning("⚠ DEMUCS를 설치해야 합니다: pip install demucs")
        return False

    def process_and_stream(
        self,
        input_file: Path,
        output_dir: Path,
        model: str = 'htdemucs',
        progress_callback: Optional[Callable] = None
    ) -> bool:
        """
        오디오 파일을 분리하고 실시간으로 진행 상황 콜백
        
        Args:
            input_file: 입력 MP3 파일
            output_dir: 출력 디렉토리
            model: 사용할 DEMUCS 모델
            progress_callback: 진행 상황 콜백 함수
        
        Returns:
            bool: 성공 여부
        """
        input_file = Path(input_file)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        if model not in self.MODELS:
            logger.warning(f"알 수 없는 모델: {model}")
            model = 'htdemucs'

        logger.info(f"[분리] 입력: {input_file}")
        logger.info(f"[분리] 모델: {model}")
        logger.info(f"[분리] 출력: {output_dir}")

        if progress_callback:
            progress_callback(0, 'preparing')

        try:
            env = os.environ.copy()
            env['PYTHONIOENCODING'] = 'utf-8'

            cmd = [
                'demucs',
                '-n', model,
                '-d', self.device,
                '-o', str(output_dir),
                str(input_file)
            ]

            logger.info(f"[분리] DEMUCS 실행 중...")
            if progress_callback:
                progress_callback(10, 'demucs_loading')

            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                errors='replace',
                env=env
            )

            try:
                stdout, stderr = process.communicate(timeout=1800)
                
                logger.info(f"[분리] STDOUT: {stdout}")
                if stderr:
                    logger.info(f"[분리] STDERR: {stderr}")

                if process.returncode == 0:
                    logger.info("✓ DEMUCS 처리 완료")
                    if progress_callback:
                        progress_callback(90, 'demucs_complete')
                else:
                    logger.error(f"DEMUCS 반환 코드: {process.returncode}")
                    if progress_callback:
                        progress_callback(0, 'error')
                    return False

            except subprocess.TimeoutExpired:
                process.kill()
                logger.error("DEMUCS 타임아웃")
                if progress_callback:
                    progress_callback(0, 'timeout')
                return False

            # 분리된 파일 확인
            logger.info(f"[분리] 출력 디렉토리 확인: {output_dir}")
            separated_dirs = []

            if output_dir.exists():
                for item in output_dir.iterdir():
                    if item.is_dir():
                        logger.info(f"발견된 폴더: {item.name}")
                        separated_dirs.append(item)

            separated_dir = None
            for d in separated_dirs:
                if d.name in self.MODELS:
                    separated_dir = d
                    logger.info(f"올바른 분리 폴더: {separated_dir}")
                    break

            if not separated_dir and separated_dirs:
                separated_dir = separated_dirs
                logger.info(f"첫 번째 폴더 사용: {separated_dir}")

            if separated_dir and separated_dir.exists():
                wav_files = list(separated_dir.glob('*.wav'))
                logger.info(f"생성된 파일: {[f.name for f in wav_files]}")
                if progress_callback:
                    progress_callback(95, 'conversion_complete')
                return True
            else:
                logger.error("분리된 파일을 찾을 수 없음")
                return False

        except Exception as e:
            logger.error(f"[분리] 처리 오류: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            if progress_callback:
                progress_callback(0, 'error')
            return False

    def get_separated_tracks(self, output_dir_str: str) -> dict:
        """
        분리된 WAV 파일 경로 반환
        
        Args:
            output_dir_str: DEMUCS 출력 디렉토리
        
        Returns:
            dict: 각 트랙의 정보
        """
        output_dir = Path(output_dir_str)
        results = {}

        try:
            separated_dir = None
            logger.info(f"[트랙조회] 검색 위치: {output_dir}")

            if output_dir.exists():
                for d in output_dir.iterdir():
                    if d.is_dir() and d.name in self.MODELS:
                        separated_dir = d
                        logger.info(f"발견: {d.name}")
                        break

            if not separated_dir:
                if output_dir.exists():
                    dirs = [d for d in output_dir.iterdir() if d.is_dir()]
                    if dirs:
                        separated_dir = dirs
                        logger.info(f"첫 번째 폴더 사용: {separated_dir.name}")

            if not separated_dir:
                logger.error(f"분리된 파일을 찾을 수 없음: {output_dir}")
                return {}

            # input 서브디렉토리 처리
            input_subdir = separated_dir / 'input'
            if input_subdir.exists() and input_subdir.is_dir():
                separated_dir = input_subdir

            # 트랙 매핑
            track_mapping = {
                'vocals.wav': 'vocal',
                'bass.wav': 'bass',
                'drums.wav': 'drum',
                'other.wav': 'other'
            }

            for wav_name, track_name in track_mapping.items():
                wav_path = separated_dir / wav_name
                if wav_path.exists():
                    file_size = wav_path.stat().st_size / (1024 * 1024)
                    logger.info(f"✓ {track_name}: {file_size:.1f} MB")
                    results[track_name] = {
                        'path': str(wav_path),
                        'size': file_size
                    }
                else:
                    logger.warning(f"파일 없음: {wav_path}")

            return results

        except Exception as e:
            logger.error(f"트랙조회 오류: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return {}
