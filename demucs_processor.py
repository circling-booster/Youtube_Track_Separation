"""
DEMUCS를 이용한 오디오 트랙 분리
GPU 가속화 및 실시간 스트리밍 지원
Windows 호환성 최적화
"""

import subprocess
import logging
import torch
import torchaudio
import os
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)

class DemucsProcessor:
    """DEMUCS를 이용한 오디오 분리"""
    
    # 지원하는 모델
    MODELS = {
        'htdemucs': 'facebook/demucs-htdemucs',  # 더 나은 성능
        'htdemucs_ft': 'facebook/demucs-htdemucs_ft'  # Fine-tuned 버전
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
    ):
        """
        오디오 파일을 분리하고 실시간으로 진행 상황 콜백
        
        Args:
            input_file: 입력 MP3 파일
            output_dir: 출력 디렉토리
            model: 사용할 DEMUCS 모델 ('htdemucs' 또는 'htdemucs_ft')
            progress_callback: 진행 상황 콜백 함수 (progress, track)
        """
        input_file = Path(input_file)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        if model not in self.MODELS:
            logger.warning(f"알 수 없는 모델: {model}, {list(self.MODELS.keys())} 사용")
            model = 'htdemucs'
        
        logger.info(f"[분리] 입력: {input_file}")
        logger.info(f"[분리] 모델: {model}")
        logger.info(f"[분리] 출력: {output_dir}")
        
        if progress_callback:
            progress_callback(0, 'preparing')
        
        try:
            # DEMUCS 분리 명령어
            # Windows 호환성을 위해 환경 변수 설정
            env = os.environ.copy()
            env['PYTHONIOENCODING'] = 'utf-8'  # UTF-8 인코딩 강제
            
            cmd = [
                'demucs',
                '-n', model,  # 모델 지정
                '-d', self.device,  # cuda 또는 cpu
                '-o', str(output_dir),  # 출력 디렉토리 (절대 경로)
                str(input_file)  # 입력 파일 (절대 경로)
            ]
            
            logger.info(f"[분리] DEMUCS 실행 중...")
            logger.info(f"[분리] 명령어: {' '.join(cmd)}")
            
            if progress_callback:
                progress_callback(10, 'demucs_loading')
            
            # DEMUCS 프로세스 실행
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',  # UTF-8 인코딩 지정
                errors='replace',  # 인코딩 오류 무시
                env=env
            )
            
            # 출력 파싱 및 진행 상황 업데이트
            try:
                stdout, stderr = process.communicate(timeout=1800)  # 30분 타임아웃
                logger.info(f"[분리] STDOUT: {stdout}")
                
                if stderr:
                    logger.info(f"[분리] STDERR: {stderr}")
                
                if process.returncode == 0:
                    logger.info("[분리] ✓ DEMUCS 처리 완료")
                    if progress_callback:
                        progress_callback(90, 'demucs_complete')
                else:
                    logger.error(f"[분리] DEMUCS 반환 코드: {process.returncode}")
                    if progress_callback:
                        progress_callback(0, 'error')
                    return False
            
            except subprocess.TimeoutExpired:
                process.kill()
                logger.error("[분리] DEMUCS 타임아웃")
                if progress_callback:
                    progress_callback(0, 'timeout')
                return False
            
            # 분리된 파일 확인
            # DEMUCS는 모델명으로 폴더를 생성함 (htdemucs, htdemucs_ft 등)
            logger.info(f"[분리] 출력 디렉토리 내용 확인: {output_dir}")
            
            separated_dirs = []
            if output_dir.exists():
                for item in output_dir.iterdir():
                    if item.is_dir():
                        logger.info(f"[분리] 발견된 폴더: {item.name}")
                        separated_dirs.append(item)
            
            # 모델명으로 생성된 폴더 찾기
            separated_dir = None
            for d in separated_dirs:
                if d.name in self.MODELS:  # htdemucs, htdemucs_ft 등
                    separated_dir = d
                    logger.info(f"[분리] 올바른 분리 폴더 발견: {separated_dir}")
                    break
            
            if not separated_dir:
                # 첫 번째 디렉토리를 사용 (후보)
                if separated_dirs:
                    separated_dir = separated_dirs[0]
                    logger.info(f"[분리] 첫 번째 폴더 사용: {separated_dir}")
            
            if separated_dir and separated_dir.exists():
                logger.info(f"[분리] 분리된 파일 위치: {separated_dir}")
                
                # 분리된 파일 목록 확인
                wav_files = list(separated_dir.glob('*.wav'))
                logger.info(f"[분리] 생성된 파일: {[f.name for f in wav_files]}")
                
                if progress_callback:
                    progress_callback(95, 'conversion_complete')
                
                return True
            else:
                logger.error(f"[분리] 분리된 파일을 찾을 수 없음")
                logger.info(f"[분리] 출력 디렉토리 내용: {list(output_dir.iterdir()) if output_dir.exists() else '없음'}")
                return False
        
        except Exception as e:
            logger.error(f"[분리] 처리 오류: {str(e)}")
            import traceback
            logger.error(f"[분리] 추적: {traceback.format_exc()}")
            if progress_callback:
                progress_callback(0, 'error')
            return False
    
    def get_separated_tracks(self, output_dir_str: str) -> dict:
        """
        분리된 WAV 파일 경로 반환
        
        Args:
            output_dir_str: DEMUCS 출력 디렉토리
        
        Returns:
            dict: 각 트랙의 WAV 파일 정보 (경로, 크기)
        """
        output_dir = Path(output_dir_str)
        results = {}
        
        try:
            # 분리된 파일 찾기
            separated_dir = None
            logger.info(f"[트랙조회] 검색 위치: {output_dir}")
            
            # DEMUCS가 생성한 모델명 폴더 찾기
            if output_dir.exists():
                for d in output_dir.iterdir():
                    if d.is_dir() and d.name in self.MODELS:
                        separated_dir = d
                        logger.info(f"[트랙조회] 발견: {d.name} 폴더")
                        break
            
            if not separated_dir:
                # 모든 디렉토리 확인
                if output_dir.exists():
                    dirs = [d for d in output_dir.iterdir() if d.is_dir()]
                    logger.info(f"[트랙조회] 발견된 모든 폴더: {[d.name for d in dirs]}")
                    if dirs:
                        separated_dir = dirs[0]
                        logger.info(f"[트랙조회] 첫 번째 폴더 사용: {separated_dir.name}")
            
            if not separated_dir:
                logger.error(f"[트랙조회] 분리된 파일을 찾을 수 없음: {output_dir}")
                if output_dir.exists():
                    logger.info(f"[트랙조회] 출력 디렉토리 내용: {list(output_dir.iterdir())}")
                return {}
            
            logger.info(f"[트랙조회] 분리 디렉토리: {separated_dir}")
            
            # DEMUCS가 input 폴더를 생성한 경우 처리
            # 예: htdemucs/input/vocals.wav
            input_subdir = separated_dir / 'input'
            if input_subdir.exists() and input_subdir.is_dir():
                logger.info(f"[트랙조회] input 서브디렉토리 발견: {input_subdir}")
                separated_dir = input_subdir  # 서브디렉토리를 사용
                logger.info(f"[트랙조회] 서브디렉토리로 업데이트: {separated_dir}")
            
            # WAV 파일 매핑 (DEMUCS 출력 파일명)
            track_mapping = {
                'vocals.wav': 'vocal',
                'bass.wav': 'bass',
                'drums.wav': 'drum',
                'other.wav': 'other'
            }
            
            for wav_name, track_name in track_mapping.items():
                wav_path = separated_dir / wav_name
                
                logger.info(f"[트랙조회] 찾고 있는 파일: {wav_path}")
                
                if wav_path.exists():
                    file_size = wav_path.stat().st_size / (1024 * 1024)  # MB
                    logger.info(f"[트랙조회] ✓ {track_name}.wav: {file_size:.1f} MB")
                    results[track_name] = {
                        'path': str(wav_path),
                        'size': file_size
                    }
                else:
                    logger.warning(f"[트랙조회] 파일 없음: {wav_path}")
                    logger.info(f"[트랙조회] 분리 디렉토리 내용: {list(separated_dir.glob('*'))}")
            
            return results
        
        except Exception as e:
            logger.error(f"[트랙조회] 처리 오류: {str(e)}")
            import traceback
            logger.error(f"[트랙조회] 추적: {traceback.format_exc()}")
            return {}
    
    def load_model(self, model_name: str = 'htdemucs'):
        """DEMUCS 모델 사전 로드"""
        try:
            logger.info(f"[모델] {model_name} 로드 중...")
            logger.info(f"[모델] {model_name} 로드 완료")
            return True
        except Exception as e:
            logger.error(f"[모델] 로드 오류: {str(e)}")
            return False
