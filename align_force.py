"""
Stable-Whisper를 이용한 강제 정렬 (모듈화 버전)
- Strict Output Format: [mm:ss.xx] <mm:ss.xx> Word
"""

import stable_whisper
import torch
import datetime
import logging
import gc

logger = logging.getLogger(__name__)

def format_timestamp(seconds: float) -> str:
    """초 단위를 mm:ss.xx 형식으로 변환"""
    if seconds is None: return "00:00.00"
    td = datetime.timedelta(seconds=seconds)
    total_seconds = int(td.total_seconds())
    minutes = total_seconds // 60
    seconds_remainder = total_seconds % 60
    milliseconds = int(td.microseconds / 10000)
    return f"{minutes:02d}:{seconds_remainder:02d}.{milliseconds:02d}"

def align_lyrics(audio_path: str, text: str, device: str = 'cuda', language: str = 'ko') -> str:
    """
    음성과 텍스트를 강제 정렬하여 LRC 생성
    """
    logger.info(f"[Align] Whisper 정렬 시작 (Device: {device})")
    
    model = None
    try:
        # 모델 로드 (함수 내 로컬 로드 -> 종료 시 해제 보장)
        model = stable_whisper.load_model('medium', device=device)
        
        # 정렬 수행
        result = model.align(audio_path, text, language=language)
        
        # LRC 변환 (Duration 포함 포맷)
        lines = ["[by:AiPlugs-TrackSeparation]"]
        
        for segment in result.segments:
            for word in segment.words:
                start = word.start
                end = word.end
                w_text = word.word.strip()
                if not w_text: continue
                
                ts_start = format_timestamp(start)
                ts_end = format_timestamp(end)
                # 프론트엔드 요구 포맷: [시작] <끝> 단어
                lines.append(f"[{ts_start}] <{ts_end}> {w_text}")
        
        return '\n'.join(lines)
    
    except Exception as e:
        logger.error(f"[Align] Whisper 처리 중 오류 발생: {e}")
        return None
    
    finally:
        # 메모리 명시적 해제 (Demucs와의 충돌 방지 핵심)
        if model: 
            del model
        gc.collect()
        torch.cuda.empty_cache()