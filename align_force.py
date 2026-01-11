"""
Stable-Whisper를 이용한 강제 정렬 (모듈화 버전)
- 함수 기반 아키텍처
- Word-level timestamps with duration 유지: [mm:ss.xx] <mm:ss.xx> text
"""

import stable_whisper
import torch
import datetime
import logging

logger = logging.getLogger(__name__)

def format_timestamp(seconds: float) -> str:
    """
    초(seconds)를 타임스탬프 문자열로 변환
    포맷: mm:ss.xx (분:초.밀리초)
    """
    if seconds is None:
        return "00:00.00"
    
    td = datetime.timedelta(seconds=seconds)
    total_seconds = int(td.total_seconds())
    minutes = total_seconds // 60
    seconds_remainder = total_seconds % 60
    milliseconds = int(td.microseconds / 10000)
    
    return f"{minutes:02d}:{seconds_remainder:02d}.{milliseconds:02d}"

def format_lrc_with_duration(result, output_format: str = 'lrc') -> str:
    """
    Stable-Whisper 결과를 LRC 포맷으로 변환
    
    포맷: [mm:ss.xx] <mm:ss.xx> 단어 (시작 시간, 종료 시간, 텍스트)
    
    Args:
        result: stable-whisper의 align 결과
        output_format: 'lrc' (기본값)
    
    Returns:
        str: LRC 포맷의 가사
    """
    lines = ["[by:AiPlugs]"]
    word_count = 0
    
    try:
        for segment in result.segments:
            words = getattr(segment, 'words', None) or segment.get('words', [])
            
            if not words:
                continue
            
            for word in words:
                start = getattr(word, 'start', None) or word.get('start')
                end = getattr(word, 'end', None) or word.get('end')
                text = getattr(word, 'word', None) or word.get('word')
                
                if start is not None and text:
                    # 끝 시간이 없으면 시작 시간 + 0.5초
                    if end is None:
                        end = start + 0.5
                    
                    ts_start = format_timestamp(start)
                    ts_end = format_timestamp(end)
                    
                    # LRC 포맷: [시작] <끝> 단어
                    line = f"[{ts_start}] <{ts_end}> {text.strip()}"
                    lines.append(line)
                    word_count += 1
    
    except Exception as e:
        logger.error(f"LRC 변환 오류: {e}")
        raise
    
    logger.info(f"✓ {word_count}개 단어 정렬 완료")
    return '\n'.join(lines)

def align_lyrics(
    audio_path: str,
    text: str,
    device: str = 'cuda',
    language: str = 'ko'
) -> str:
    """
    음성과 텍스트를 강제 정렬하여 LRC 생성
    
    Args:
        audio_path: 오디오 파일 경로 (MP3, WAV 등)
        text: 정렬할 텍스트 (순수 텍스트)
        device: 'cuda' 또는 'cpu'
        language: 언어 코드 ('ko', 'en', 등)
    
    Returns:
        str: LRC 포맷의 가사 ([mm:ss.xx] <mm:ss.xx> 텍스트 포맷)
    """
    
    logger.info(f"[Align] 시작")
    logger.info(f" - 오디오: {audio_path}")
    logger.info(f" - 언어: {language}")
    logger.info(f" - 장치: {device}")
    logger.info(f" - 텍스트 길이: {len(text)} 글자")
    
    try:
        # 텍스트 전처리 (괄호 제거)
        original_len = len(text)
        text = text.replace("(", "").replace(")", "").replace(",", "")
        
        if len(text) != original_len:
            logger.info(f"[Align] 전처리 완료: {original_len} → {len(text)} 글자")
        
        # Stable-Whisper 모델 로드
        logger.info(f"[Align] 모델 로드 중 (medium)...")
        model = stable_whisper.load_model('medium', device=device)
        logger.info(f"[Align] ✓ 모델 로드 완료")
        
        # 강제 정렬 수행
        logger.info(f"[Align] 정렬 수행 중...")
        result = model.align(
            audio_path,
            text,
            language=language,
            original_split=True
        )
        logger.info(f"[Align] ✓ 정렬 완료")
        
        # LRC 포맷 변환
        lrc_content = format_lrc_with_duration(result, output_format='lrc')
        
        return lrc_content
    
    except Exception as e:
        logger.error(f"[Align] 정렬 실패: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise
    
    finally:
        # 메모리 해제
        import gc
        gc.collect()
        torch.cuda.empty_cache()
        logger.info(f"[Align] ✓ 메모리 해제 완료")

# 테스트 및 사용 예시
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    # 예제
    # audio_file = "vocal.wav"
    # text = "Hello world this is a test"
    # result = align_lyrics(audio_file, text, device='cuda', language='en')
    # print(result)
