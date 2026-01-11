import stable_whisper
import torch
import os
import datetime

base_dir = os.path.dirname(os.path.abspath(__file__))


# 파일 설정
AUDIO_FILE =  os.path.join(base_dir, 'input.mp3') 
LYRIC_TEXT_FILE = os.path.join(base_dir, 'lyric.txt')
OUTPUT_LRC_FILE = os.path.join(base_dir, 'vocal_forced.lrc')

def format_timestamp(seconds):
    """초(seconds)를 타임스탬프 문자열로 변환 (분:초.밀리초)"""
    if seconds is None:
        return "00:00.00"
    td = datetime.timedelta(seconds=seconds)
    total_seconds = int(td.total_seconds())
    minutes = total_seconds // 60
    seconds_remainder = total_seconds % 60
    milliseconds = int(td.microseconds / 10000)
    return f"{minutes:02d}:{seconds_remainder:02d}.{milliseconds:02d}"

def save_lrc_with_duration(result, output_path):
    """
    stable-ts 결과에서 시작(start)과 끝(end) 시간을 모두 추출하여 저장
    형식: [mm:ss.xx] <mm:ss.xx> 단어
    """
    count = 0
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("[by:AiPlugs]\n")
        
        # result.segments는 문장 단위입니다.
        for segment in result.segments:
            # 단어(words) 리스트 추출
            words = getattr(segment, 'words', None) or segment.get('words')
            
            if words:
                for word in words:
                    # 시작, 끝, 텍스트 추출
                    start = getattr(word, 'start', None) or word.get('start')
                    end = getattr(word, 'end', None) or word.get('end')
                    text = getattr(word, 'word', None) or word.get('word')
                    
                    if start is not None and text:
                        # 끝 시간이 없는 경우 시작 시간 + 0.5초로 임시 처리
                        if end is None: end = start + 0.5

                        ts_start = format_timestamp(start)
                        ts_end = format_timestamp(end)
                        
                        # 사용자 지정 포맷: [시작] <끝> 텍스트
                        f.write(f"[{ts_start}] <{ts_end}> {text.strip()}\n")
                        count += 1
    return count

def main():
    print("--- 강제 정렬(Forced Alignment) : Start & End Time ---")
    
    if not os.path.exists(LYRIC_TEXT_FILE):
        print("오류: 가사 파일이 반드시 필요합니다.")
        return
        
    with open(LYRIC_TEXT_FILE, 'r', encoding='utf-8') as f:
        lyric_text = f.read()

    # [수정됨] 가사 전처리: 괄호 기호 '(', ')' 제거
    original_len = len(lyric_text)
    lyric_text = lyric_text.replace("(", "").replace(")", "").replace(",", "")#.replace(")", "")
    
    if len(lyric_text) != original_len:
        print("알림: 가사 텍스트에서 괄호 기호를 제거했습니다.")

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

    print("파일 저장 중 (Duration 포함)...")
    try:
        word_count = save_lrc_with_duration(result, OUTPUT_LRC_FILE)
        
        print(f"--- 완료 ---")
        print(f"총 {word_count}개의 단어 싱크 저장됨")
        print(f"결과 파일: {os.path.abspath(OUTPUT_LRC_FILE)}")
        
    except Exception as e:
        print(f"저장 중 치명적 오류: {e}")

if __name__ == "__main__":
    main()