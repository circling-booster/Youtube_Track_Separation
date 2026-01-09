import whisper
import torch
import os
import datetime

# 파일 경로 설정
AUDIO_FILE = 'vocal.wav'
LYRIC_TEXT_FILE = 'lyric.txt'
OUTPUT_WORD_LRC_FILE = 'vocal_word_level.lrc'

def format_timestamp(seconds):
    """
    초(seconds)를 LRC 포맷 [mm:ss.xx] 문자열로 변환합니다.
    """
    if seconds is None:
        return "[00:00.00]"
    
    td = datetime.timedelta(seconds=seconds)
    total_seconds = int(td.total_seconds())
    minutes = total_seconds // 60
    seconds_remainder = total_seconds % 60
    milliseconds = int(td.microseconds / 10000)
    
    return f"[{minutes:02d}:{seconds_remainder:02d}.{milliseconds:02d}]"

def main():
    print(f"--- 단어 단위 싱크 작업 시작 ---")
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"사용 장치: {device}")
    
    if not os.path.exists(AUDIO_FILE):
        print(f"오류: {AUDIO_FILE} 파일이 없습니다.")
        return

    # 가사 텍스트 읽기 (힌트용)
    lyric_prompt = ""
    if os.path.exists(LYRIC_TEXT_FILE):
        try:
            with open(LYRIC_TEXT_FILE, 'r', encoding='utf-8') as f:
                lyric_prompt = f.read().strip()
            print(f"가사 힌트 로드됨 ({len(lyric_prompt)}자)")
        except Exception as e:
            print(f"가사 읽기 오류: {e}")

    print("모델 로딩 중 (medium)...")
    try:
        # 단어 단위 분석은 정밀도가 중요하므로 medium 이상 권장
        model = whisper.load_model("medium", device=device)
    except Exception as e:
        print(f"모델 로드 실패: {e}")
        return

    print("오디오 분석 및 단어 단위 추출 중 (시간이 조금 더 소요될 수 있습니다)...")
    
    # word_timestamps=True 설정이 핵심입니다.
    # 잡음이 많으므로 beam_size를 5로 늘려 탐색 정확도를 높입니다.
    result = model.transcribe(
        AUDIO_FILE, 
        initial_prompt=lyric_prompt,
        language='ko',
        word_timestamps=True,   # 단어 단위 타임스탬프 활성화
        beam_size=5,            # 잡음 대비 탐색 폭 확대
        fp16=True               # GPU 사용 시 가속
    )

    segments = result['segments']
    word_count = 0

    print(f"분석 완료. 파일 저장 중...")
    
    with open(OUTPUT_WORD_LRC_FILE, 'w', encoding='utf-8') as f:
        f.write("[by:AiPlugs]\n")
        
        for segment in segments:
            # 각 세그먼트(문장) 안에 있는 'words' 리스트를 순회합니다.
            if 'words' in segment:
                for word_info in segment['words']:
                    start_time = word_info['start']
                    end_time = word_info['end']
                    word_text = word_info['word'].strip()
                    
                    if not word_text:
                        continue

                    # 타임스탬프 포맷팅
                    ts_start = format_timestamp(start_time)
                    
                    # 출력 포맷: [시작시간] 단어
                    # (필요시 노래방 자막처럼 <끝시간>을 추가할 수도 있습니다)
                    f.write(f"{ts_start} {word_text}\n")
                    word_count += 1
            else:
                # 만약 단어 정보가 없다면 세그먼트 통째로 기록 (예외처리)
                ts_start = format_timestamp(segment['start'])
                f.write(f"{ts_start} {segment['text'].strip()}\n")

    print(f"--- 완료 ---")
    print(f"총 {word_count}개의 단어 추출")
    print(f"결과 파일: {os.path.abspath(OUTPUT_WORD_LRC_FILE)}")

if __name__ == "__main__":
    main()