import stable_whisper
import torch
import os
import datetime

# 파일 설정
AUDIO_FILE = 'vocal.wav'
LYRIC_TEXT_FILE = 'lyric.txt'
OUTPUT_LRC_FILE = 'vocal_forced.lrc'

def format_timestamp(seconds):
    """초(seconds)를 LRC 포맷 [mm:ss.xx] 문자열로 변환"""
    if seconds is None:
        return "[00:00.00]"
    td = datetime.timedelta(seconds=seconds)
    total_seconds = int(td.total_seconds())
    minutes = total_seconds // 60
    seconds_remainder = total_seconds % 60
    milliseconds = int(td.microseconds / 10000)
    return f"[{minutes:02d}:{seconds_remainder:02d}.{milliseconds:02d}]"

def save_lrc_manually(result, output_path):
    """
    stable-ts 결과 객체에서 직접 데이터를 꺼내 LRC 파일을 생성합니다.
    """
    count = 0
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("[by:AiPlugs]\n")
        
        # result.segments는 세그먼트(문장) 리스트입니다.
        for segment in result.segments:
            # 각 세그먼트 안의 단어(words) 리스트를 확인
            # (객체 속성으로 접근하거나 딕셔너리로 접근)
            words = getattr(segment, 'words', None) or segment.get('words')
            
            if words:
                for word in words:
                    # 단어 객체에서 시작 시간과 텍스트 추출
                    start = getattr(word, 'start', None) or word.get('start')
                    text = getattr(word, 'word', None) or word.get('word')
                    
                    if start is not None and text:
                        timestamp = format_timestamp(start)
                        f.write(f"{timestamp} {text.strip()}\n")
                        count += 1
    return count

def main():
    print("--- 강제 정렬(Forced Alignment) 시작 ---")
    
    if not os.path.exists(LYRIC_TEXT_FILE):
        print("오류: 가사 파일이 반드시 필요합니다.")
        return
        
    with open(LYRIC_TEXT_FILE, 'r', encoding='utf-8') as f:
        lyric_text = f.read()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"모델 로딩 중 (medium) - Device: {device}")
    
    try:
        model = stable_whisper.load_model('medium', device=device)
    except Exception as e:
        print(f"모델 로드 실패: {e}")
        return

    print("정렬 수행 중...")
    try:
        # GPU 가속 정렬 수행
        result = model.align(
            AUDIO_FILE, 
            lyric_text, 
            language='ko',
            original_split=True
        )
    except Exception as e:
        print(f"정렬 중 오류 발생: {e}")
        return

    print("파일 저장 중 (수동 모드)...")
    try:
        # 라이브러리 함수 대신 직접 만든 저장 함수 사용
        word_count = save_lrc_manually(result, OUTPUT_LRC_FILE)
        
        print(f"--- 완료 ---")
        print(f"총 {word_count}개의 단어 싱크 저장됨")
        print(f"결과 파일: {os.path.abspath(OUTPUT_LRC_FILE)}")
        
    except Exception as e:
        print(f"저장 중 치명적 오류: {e}")
        # 디버깅을 위해 결과 구조 일부 출력
        print("Debug Info:", type(result.segments[0]) if result.segments else "No segments")

if __name__ == "__main__":
    main()