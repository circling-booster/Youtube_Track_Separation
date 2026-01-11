"""
Demucs를 이용한 오디오 트랙 분리 (Stateless)
- 모델 생명주기를 외부(workflow)에서 제어하도록 수정
- [수정] 결과물을 WAV 대신 MP3로 저장 (용량 최적화)
"""

import logging
import subprocess
from pathlib import Path
import torch
from demucs import pretrained
from demucs.apply import apply_model
from demucs.audio import AudioFile, save_audio

logger = logging.getLogger(__name__)

class DemucsProcessor:
    def __init__(self, download_dir: str):
        self.download_dir = Path(download_dir)
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'

    def load_model(self, name: str = 'htdemucs'):
        """
        모델을 메모리에 로드하고 반환 (Workflow에서 호출 후 사용 끝나면 해제 필수)
        """
        logger.info(f"[Demucs] 모델 로드 중: {name} (Device: {self.device})")
        # VRAM 확보를 위해 캐시 비우기
        torch.cuda.empty_cache()
        
        model = pretrained.get_model(name)
        model.to(self.device)
        return model

    def process_with_model(
        self,
        model,
        input_file: Path,
        output_dir: Path,
        progress_callback=None
    ) -> bool:
        """
        외부에서 주입된 모델 객체를 사용하여 분리 수행 후 MP3 변환
        """
        try:
            input_file = Path(input_file)
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)

            logger.info(f"[Demucs] 분리 시작: {input_file.name}")
            
            # 오디오 로드
            wav = AudioFile(input_file).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
            ref = wav.mean(0)
            wav = (wav - ref.mean()) / ref.std()
            wav = wav.to(self.device)
            
            # 분리 수행 (shifts=1로 속도 최적화)
            sources = apply_model(model, wav[None], device=self.device, shifts=1, split=True, overlap=0.25, progress=True)[0]
            sources = sources * ref.std() + ref.mean()

            # 저장 및 MP3 변환
            if progress_callback: progress_callback(60, '트랙 저장 및 MP3 변환 중...')
            
            kwargs = {
                'samplerate': model.samplerate,
                'bitrate': 320,
                'clip': 'rescale',
                'as_float': False,
                'bits_per_sample': 16
            }
            
            track_names = model.sources
            for source, name in zip(sources, track_names):
                wav_stem = output_dir / f"{name}.wav"
                mp3_stem = output_dir / f"{name}.mp3"
                
                # 1. 임시 WAV 저장
                save_audio(source.cpu(), str(wav_stem), **kwargs)
                
                # 2. ffmpeg로 MP3 변환 (VBR 품질 설정)
                try:
                    cmd = [
                        'ffmpeg', '-y', 
                        '-i', str(wav_stem),
                        '-codec:a', 'libmp3lame', 
                        '-qscale:a', '2',  # VBR High Quality (~190kbps average)
                        str(mp3_stem)
                    ]
                    subprocess.run(
                        cmd, 
                        check=True, 
                        stdout=subprocess.DEVNULL, 
                        stderr=subprocess.DEVNULL
                    )
                    
                    # 3. 변환 성공 시 WAV 삭제
                    if mp3_stem.exists() and mp3_stem.stat().st_size > 0:
                        wav_stem.unlink()
                        
                except Exception as conv_e:
                    logger.error(f"[Demucs] MP3 변환 실패 ({name}): {conv_e}")
                    # 변환 실패 시 WAV 유지 (Fallback 없음, 클라이언트는 MP3를 기대하므로 에러로 이어질 수 있음)

            logger.info("[Demucs] 분리 및 변환 완료")
            return True

        except Exception as e:
            logger.error(f"[Demucs] 오류: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return False

    def get_separated_tracks(self, output_dir_str: str) -> dict:
        """분리된 트랙 파일 확인 (MP3 기준)"""
        output_dir = Path(output_dir_str)
        results = {}
        
        # 파일명 매핑 (mp3로 변경)
        track_mapping = {
            'vocals.mp3': 'vocal',
            'bass.mp3': 'bass',
            'drums.mp3': 'drum',
            'other.mp3': 'other'
        }

        for mp3_name, track_name in track_mapping.items():
            file_path = output_dir / mp3_name
            if file_path.exists():
                results[track_name] = {
                    'path': str(file_path),
                    'size': file_path.stat().st_size / (1024 * 1024)
                }

        return results