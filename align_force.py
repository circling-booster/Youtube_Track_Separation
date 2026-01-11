"""
Stable-Whisper를 이용한 강제 정렬 (모듈화 버전)
"""

import stable_whisper
import torch
import datetime
import logging
import gc

logger = logging.getLogger(__name__)

def format_timestamp(seconds: float) -> str:
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
    Returns: [mm:ss.xx] <mm:ss.xx> 텍스트 포맷
    """
    logger.info(f"[Align] Whisper 정렬 시작 (Device: {device})")
    
    model = None
    try:
        # 1. 텍스트 전처리
        text = text.replace("(", "").replace(")", "").replace(",", "")
        
        # 2. 모델 로드 (함수 내 로컬 로드 -> 종료 시 해제)
        model = stable_whisper.load_model('medium', device=device)
        
        # 3. 정렬 수행
        result = model.align(audio_path, text, language=language)
        
        # 4. LRC 변환 (Duration 포함)
        lines = ["[by:AiPlugs]"]
        for segment in result.segments:
            for word in segment.words:
                start = word.start
                end = word.end
                w_text = word.word.strip()
                if not w_text: continue
                
                ts_start = format_timestamp(start)
                ts_end = format_timestamp(end)
                lines.append(f"[{ts_start}] <{ts_end}> {w_text}")
        
        return '\n'.join(lines)
    
    except Exception as e:
        logger.error(f"[Align] 오류 발생: {e}")
        return None
    
    finally:
        # 5. 메모리 명시적 해제
        if model: del model
        gc.collect()
        torch.cuda.empty_cache()