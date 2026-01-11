"""
Stable-Whisper를 이용한 강제 정렬 (Korean Character-Level Optimization)
- 영어: 단어(Word) 단위 정렬
- 한국어: 글자(Character/Syllable) 단위 정밀 정렬
- [수정] 단어 연결 정보(^) 포함: 클라이언트에서 단어/글자 단위 선택 가능
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
    Whisper 입력용 텍스트 전처리
    (기존 로직 유지: 한국어는 글자 단위로 띄어쓰기하여 입력)
    """
    if not text: return ""
    text = text.replace('\n', ' ').strip()
    tokens = []
    raw_words = text.split()
    
    for word in raw_words:
        has_korean = any(ord('가') <= ord(c) <= ord('힣') for c in word)
        if has_korean:
            for char in word: tokens.append(char)
        else:
            tokens.append(word)
    return " ".join(tokens)

def align_lyrics(audio_path: str, text: str, device: str = 'cuda', language: str = 'ko') -> str:
    """
    음성과 텍스트를 강제 정렬하여 LRC 생성
    - 단어 내부의 글자(이어지는 글자)에는 '^' 접두어를 붙임
    """
    logger.info(f"[Align] Whisper 정렬 시작 (Device: {device})")
    
    model = None
    try:
        # 1. 원본 텍스트 분석하여 '이어지는 글자' 여부 파악
        # original_tokens: [{'text': '사', 'is_start': True}, {'text': '랑', 'is_start': False}, ...]
        original_tokens = []
        raw_words = text.replace('\n', ' ').strip().split()
        
        for word in raw_words:
            has_korean = any(ord('가') <= ord(c) <= ord('힣') for c in word)
            if has_korean:
                for i, char in enumerate(word):
                    original_tokens.append({
                        'text': char,
                        'is_start': (i == 0) # 단어의 첫 글자만 True
                    })
            else:
                original_tokens.append({'text': word, 'is_start': True})

        # 2. Whisper 입력용 텍스트 생성
        processed_text = " ".join([t['text'] for t in original_tokens])
        
        # 3. 모델 로드 및 정렬
        model = stable_whisper.load_model('medium', device=device)
        result = model.align(audio_path, processed_text, language=language)
        
        # 4. LRC 변환 (Whisper 결과와 원본 토큰 매핑)
        lines = ["[by:AiPlugs-TrackSeparation]"]
        
        # Whisper 결과 플랫하게 펼치기
        whisper_words = []
        for segment in result.segments:
            for word in segment.words:
                w_text = word.word.strip()
                if w_text:
                    whisper_words.append({
                        'start': word.start,
                        'end': word.end,
                        'text': w_text
                    })
        
        # 1:1 매핑 시도 (Whisper가 토큰을 생략하지 않았다고 가정)
        # 만약 개수가 다르면 안전하게 접두어를 붙이지 않음 (Fail-safe)
        use_markers = len(whisper_words) == len(original_tokens)
        if not use_markers:
            logger.warning(f"[Align] 토큰 개수 불일치(Orig:{len(original_tokens)} vs Whisper:{len(whisper_words)}). 단어 그룹핑 비활성화.")

        for i, w_obj in enumerate(whisper_words):
            start = format_timestamp(w_obj['start'])
            end = format_timestamp(w_obj['end'])
            text_content = w_obj['text']
            
            # 이어지는 글자 마킹 (^)
            prefix = ""
            if use_markers:
                # 원본 토큰의 is_start가 False이면(이어지는 글자면) ^ 붙임
                if not original_tokens[i]['is_start']:
                    prefix = "^"
            
            lines.append(f"[{start}] <{end}> {prefix}{text_content}")
        
        logger.info(f"[Align] 정렬 완료: {len(lines)}개의 타임스탬프 생성")
        return '\n'.join(lines)
    
    except Exception as e:
        logger.error(f"[Align] Whisper 처리 중 오류 발생: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None
    
    finally:
        if model: del model
        gc.collect()
        torch.cuda.empty_cache()