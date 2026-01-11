"""
Demucs를 이용한 오디오 트랙 분리
- 외부 모델 주입 방식
- 메모리 안전성 최적화
"""

import subprocess
import logging
import torch
import os
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)

class DemucsProcessor:
    """DEMUCS를 이용한 오디오 분리"""

    MODELS = {
        'htdemucs': 'facebook/demucs-htdemucs',
        'htdemucs_ft': 'facebook/demucs-htdemucs_ft'
    }

    def __init__(self, download_dir):
        self.download_dir = Path(download_dir)
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        
        # 생성 시에는 시스템 체크만 수행 (모델 로드 X)
        self._check_demucs()

    def _check_demucs(self):
        try:
            subprocess.run(['demucs', '--help'], capture_output=True, timeout=10)
        except Exception:
            logger.warning("⚠ DEMUCS를 설치해야 합니다: pip install demucs")

    def process_and_stream(
        self,
        input_file: Path,
        output_dir: Path,
        model: str = 'htdemucs',
        progress_callback: Optional[Callable] = None
    ) -> bool:
        """
        오디오 파일을 분리 (Subprocess 실행으로 메모리 격리 효과)
        """
        input_file = Path(input_file)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        if model not in self.MODELS:
            model = 'htdemucs'

        logger.info(f"[분리] 시작: {input_file.name} (Model: {model})")

        if progress_callback:
            progress_callback(10, 'AI 모델 로딩 중...')

        try:
            env = os.environ.copy()
            env['PYTHONIOENCODING'] = 'utf-8'

            # Demucs는 별도 프로세스로 실행하여 메인 프로세스 메모리 보호
            cmd = [
                'demucs',
                '-n', model,
                '-d', self.device,
                '-o', str(output_dir),
                str(input_file)
            ]

            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                errors='replace',
                env=env
            )

            stdout, stderr = process.communicate(timeout=1800) # 30분 타임아웃

            if process.returncode != 0:
                logger.error(f"[분리] 실패: {stderr}")
                return False

            if progress_callback:
                progress_callback(90, '트랙 분리 완료')

            # 결과 확인
            return self._verify_output(output_dir, model)

        except subprocess.TimeoutExpired:
            process.kill()
            logger.error("[분리] 타임아웃")
            return False
        except Exception as e:
            logger.error(f"[분리] 오류: {e}")
            return False

    def _verify_output(self, output_dir: Path, model_name: str) -> bool:
        """분리된 파일이 실제로 존재하는지 확인"""
        # Demucs 구조: output_dir / model_name / input_filename / instruments.wav
        # 여기서는 간단히 wav 파일 존재 여부만 체크
        for item in output_dir.rglob('*.wav'):
            return True
        return False

    def get_separated_tracks(self, output_dir_str: str) -> dict:
        """분리된 트랙 경로 조회"""
        output_dir = Path(output_dir_str)
        results = {}
        
        # Demucs 출력 구조 탐색
        target_dir = None
        for item in output_dir.rglob('vocal*'): # vocal 파일이 있는 폴더 찾기
            if item.parent.is_dir():
                target_dir = item.parent
                break
        
        if not target_dir:
            return {}

        track_mapping = {
            'vocals.wav': 'vocal',
            'bass.wav': 'bass',
            'drums.wav': 'drum',
            'other.wav': 'other'
        }

        for wav_name, track_name in track_mapping.items():
            wav_path = target_dir / wav_name
            if wav_path.exists():
                results[track_name] = {
                    'path': str(wav_path),
                    'size': wav_path.stat().st_size / (1024 * 1024)
                }

        return results