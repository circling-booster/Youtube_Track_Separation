"""
오디오 동기화 처리 (수정 완료)
- librosa.beat.tempo 변경 대응 (0.10+ 호환성)
- 지연 보정
- 품질 분석
- 안정적인 예외 처리
"""

import librosa
import numpy as np
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class AudioSyncProcessor:
    """오디오 동기화 처리"""

    def __init__(self):
        self.sync_info = {}
        self.reference_tempo = None

    def analyze_track(self, audio_path):
        """
        트랙 분석
        
        Args:
            audio_path: 오디오 파일 경로
            
        Returns:
            bool: 성공 여부
        """
        try:
            audio_path = str(audio_path)
            logger.info(f'[분석] 시작: {audio_path}')
            
            # 오디오 로드
            y, sr = librosa.load(audio_path, sr=None)
            logger.info(f'[분석] 로드 완료 - SR: {sr}, 길이: {len(y)} samples')
            
            # 템포 분석 (librosa 0.10+ 호환성)
            try:
                # 새 버전 (0.10+) - librosa.feature.rhythm.tempo()
                tempo_result = librosa.feature.rhythm.tempo(y=y, sr=sr)
                if isinstance(tempo_result, np.ndarray):
                    tempo = float(tempo_result[0])
                else:
                    tempo = float(tempo_result)
                logger.info(f'[분석] 새 버전 API 사용: {tempo:.2f} BPM')
                
            except AttributeError:
                # 구 버전 호환 - librosa.beat.tempo()
                try:
                    tempo_result = librosa.beat.tempo(y=y, sr=sr)
                    if isinstance(tempo_result, tuple):
                        tempo = float(tempo_result[0])
                    elif isinstance(tempo_result, np.ndarray):
                        tempo = float(tempo_result[0])
                    else:
                        tempo = float(tempo_result)
                    logger.info(f'[분석] 구 버전 API 사용: {tempo:.2f} BPM')
                    
                except Exception as e:
                    logger.warning(f'[분석] 템포 분석 실패, 기본값 120 사용: {str(e)}')
                    tempo = 120.0
            
            # Onset 분석 (음악의 비트 감지)
            logger.info(f'[분석] Onset 감지 중...')
            onset_frames = librosa.onset.onset_detect(y=y, sr=sr)
            onset_times = librosa.frames_to_time(onset_frames, sr=sr)
            logger.info(f'[분석] Onset 감지됨: {len(onset_times)} 개')
            
            # 에너지 분석 (음량 프로파일)
            logger.info(f'[분석] 에너지 분석 중...')
            S = librosa.feature.melspectrogram(y=y, sr=sr)
            energy = np.mean(librosa.power_to_db(S, ref=np.max), axis=0)
            logger.info(f'[분석] 에너지 프로파일 생성됨: {len(energy)} 포인트')
            
            # 지속시간
            duration = float(librosa.get_duration(y=y, sr=sr))
            logger.info(f'[분석] 지속시간: {duration:.2f}초')
            
            # 트랙 이름 추출
            track_name = Path(audio_path).stem
            
            # 동기화 정보 저장
            self.sync_info[track_name] = {
                'tempo': tempo,
                'onset_times': onset_times.tolist() if hasattr(onset_times, 'tolist') else list(onset_times),
                'energy_profile': energy.tolist() if hasattr(energy, 'tolist') else list(energy),
                'duration': duration,
                'sr': int(sr),
                'num_onsets': int(len(onset_times)),
                'num_energy_points': int(len(energy))
            }
            
            logger.info(f'✓ {track_name} 분석 완료')
            logger.info(f'  - 템포: {tempo:.2f} BPM')
            logger.info(f'  - 지속시간: {duration:.2f}초')
            logger.info(f'  - Onset: {len(onset_times)}개')
            logger.info(f'  - 샘플레이트: {sr} Hz')
            
            return True
            
        except FileNotFoundError:
            logger.error(f'[분석] 파일을 찾을 수 없음: {audio_path}')
            return False
            
        except Exception as e:
            logger.error(f'[분석] 트랙 분석 오류: {str(e)}')
            import traceback
            logger.error(f'[분석] 추적 정보:\n{traceback.format_exc()}')
            return False

    def calculate_delay_correction(self, reference_track, target_track):
        """
        지연 보정 계산
        
        Args:
            reference_track: 기준 트랙명
            target_track: 대상 트랙명
            
        Returns:
            float: 지연 시간 (초)
        """
        try:
            ref_info = self.sync_info.get(reference_track, {})
            target_info = self.sync_info.get(target_track, {})
            
            ref_onsets = ref_info.get('onset_times', [])
            target_onsets = target_info.get('onset_times', [])
            
            if len(ref_onsets) > 0 and len(target_onsets) > 0:
                delay = ref_onsets[0] - target_onsets[0]
                logger.info(f'[보정] {reference_track} vs {target_track}: {delay:.3f}초')
                return float(delay)
            
            logger.warning(f'[보정] Onset 정보 부족')
            return 0.0
            
        except Exception as e:
            logger.error(f'[보정] 지연 계산 오류: {str(e)}')
            return 0.0

    def get_sync_info(self):
        """
        동기화 정보 반환
        
        Returns:
            dict: 동기화 정보
        """
        return self.sync_info

    def validate_sync(self, track_paths):
        """
        동기화 검증
        
        Args:
            track_paths: 트랙 경로 리스트
            
        Returns:
            bool: 동기화 유효 여부
        """
        try:
            durations = []
            
            for track_path in track_paths:
                track_name = Path(track_path).stem
                
                if track_name in self.sync_info:
                    duration = self.sync_info[track_name].get('duration', 0)
                    durations.append(duration)
            
            if durations and len(durations) > 1:
                max_duration = max(durations)
                min_duration = min(durations)
                
                if max_duration > 0:
                    deviation = (max_duration - min_duration) / max_duration * 100
                    logger.info(f'[검증] 동기화 편차: {deviation:.2f}%')
                    logger.info(f'[검증] 최대 지속시간: {max_duration:.2f}초')
                    logger.info(f'[검증] 최소 지속시간: {min_duration:.2f}초')
                    
                    # 2% 이내 편차 허용
                    is_valid = deviation < 2.0
                    logger.info(f'[검증] 결과: {"✓ 유효" if is_valid else "✗ 부정확"}')
                    
                    return is_valid
            
            logger.warning(f'[검증] 비교 대상이 부족함')
            return True
            
        except Exception as e:
            logger.error(f'[검증] 동기화 검증 오류: {str(e)}')
            import traceback
            logger.error(f'[검증] 추적 정보:\n{traceback.format_exc()}')
            return False

    def get_tempo_info(self):
        """
        템포 정보 반환
        
        Returns:
            dict: 각 트랙의 템포 정보
        """
        tempo_info = {}
        
        for track_name, info in self.sync_info.items():
            tempo_info[track_name] = {
                'tempo': info.get('tempo', 120.0),
                'duration': info.get('duration', 0),
                'sr': info.get('sr', 44100)
            }
        
        return tempo_info

    def get_energy_profile(self, track_name):
        """
        특정 트랙의 에너지 프로파일 반환
        
        Args:
            track_name: 트랙명
            
        Returns:
            list: 에너지 프로파일 (또는 None)
        """
        if track_name in self.sync_info:
            return self.sync_info[track_name].get('energy_profile', [])
        return None

    def reset(self):
        """
        모든 분석 정보 초기화
        """
        self.sync_info = {}
        self.reference_tempo = None
        logger.info('[초기화] 모든 동기화 정보 초기화됨')
