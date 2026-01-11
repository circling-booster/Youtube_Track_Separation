"""
Demucs를 이용한 오디오 트랙 분리 (Stateless)
- 모델 생명주기를 외부(workflow)에서 제어하도록 수정
"""

import logging
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
        외부에서 주입된 모델 객체를 사용하여 분리 수행
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

            # 저장
            if progress_callback: progress_callback(60, '트랙 저장 중...')
            
            kwargs = {
                'samplerate': model.samplerate,
                'bitrate': 320,
                'clip': 'rescale',
                'as_float': False,
                'bits_per_sample': 16
            }
            
            track_names = model.sources
            for source, name in zip(sources, track_names):
                stem = output_dir / f"{name}.wav"
                save_audio(source.cpu(), str(stem), **kwargs)

            logger.info("[Demucs] 분리 완료")
            return True

        except Exception as e:
            logger.error(f"[Demucs] 오류: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return False

    def get_separated_tracks(self, output_dir_str: str) -> dict:
        """분리된 트랙 파일 확인"""
        output_dir = Path(output_dir_str)
        results = {}
        
        track_mapping = {
            'vocals.wav': 'vocal',
            'bass.wav': 'bass',
            'drums.wav': 'drum',
            'other.wav': 'other'
        }

        for wav_name, track_name in track_mapping.items():
            wav_path = output_dir / wav_name
            if wav_path.exists():
                results[track_name] = {
                    'path': str(wav_path),
                    'size': wav_path.stat().st_size / (1024 * 1024)
                }

        return results