"""
Stable-Whisper를 이용한 강제 정렬 (Korean Character-Level Optimization)
- 영어: 단어(Word) 단위 정렬
- 한국어: 글자(Character/Syllable) 단위 정밀 정렬
- Output: [mm:ss.xx] <mm:ss.xx> Token
"""

import stable_whisper
import torch
import datetime
import logging
import gc
import re

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

def preprocess_text_for_sync(text: str) -> str:
    """
    정렬 정확도 향상을 위한 텍스트 전처리
    - 영어/숫자: 단어 단위 유지
    - 한국어: 글자 단위로 분리 (띄어쓰기 포함)
    """
    if not text: return ""

    # 1. 기존 줄바꿈 제거 및 공백 정리
    text = text.replace('\n', ' ').strip()
    
    tokens = []
    # 공백 기준으로 1차 분리 (단어 단위)
    raw_words = text.split()
    
    for word in raw_words:
        # 한국어 포함 여부 확인 (가-힣)
        has_korean = any(ord('가') <= ord(c) <= ord('힣') for c in word)
        
        if has_korean:
            # 한국어가 포함된 경우, 글자 단위로 분리
            # 단, 영어/숫자가 섞여있어도 한국어 맥락이라면 글자 단위 처리가 싱크에 유리함
            for char in word:
                tokens.append(char)
        else:
            # 순수 영어/숫자/기호인 경우 단어 단위 유지
            tokens.append(word)
            
    # Whisper가 인식하기 좋게 스페이스로 조인
    return " ".join(tokens)

def align_lyrics(audio_path: str, text: str, device: str = 'cuda', language: str = 'ko') -> str:
    """
    음성과 텍스트를 강제 정렬하여 LRC 생성
    """
    logger.info(f"[Align] Whisper 정렬 시작 (Device: {device})")
    logger.info(f"[Align] 원본 텍스트 길이: {len(text)}자")
    
    model = None
    try:
        # 1. 텍스트 전처리 (한국어 글자 단위 분해)
        processed_text = preprocess_text_for_sync(text)
        logger.info("[Align] 한국어 글자 단위 최적화 적용됨")
        
        # 2. 모델 로드
        model = stable_whisper.load_model('medium', device=device)
        
        # 3. 정렬 수행 (전처리된 텍스트 사용)
        # [수정] remove_punctuation 옵션 제거 (지원하지 않는 인자)
        result = model.align(audio_path, processed_text, language=language)
        
        # 4. LRC 변환
        lines = ["[by:AiPlugs-TrackSeparation]"]
        
        for segment in result.segments:
            for word in segment.words:
                start = word.start
                end = word.end
                w_text = word.word.strip()
                
                if not w_text: continue
                
                ts_start = format_timestamp(start)
                ts_end = format_timestamp(end)
                
                # 포맷: [시작] <끝> 토큰
                # 한국어는 글자 하나하나가 이 포맷으로 출력됨
                lines.append(f"[{ts_start}] <{ts_end}> {w_text}")
        
        logger.info(f"[Align] 정렬 완료: {len(lines)}개의 타임스탬프 생성")
        return '\n'.join(lines)
    
    except Exception as e:
        logger.error(f"[Align] Whisper 처리 중 오류 발생: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None
    
    finally:
        # 메모리 명시적 해제
        if model: 
            del model
        gc.collect()
        torch.cuda.empty_cache()