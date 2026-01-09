import pygame
import re
import sys
import os

# --- 설정 ---
AUDIO_FILE = 'vocal.wav'
# 방금 만든 forced lrc 파일이 있다면 그것을 우선 사용
LRC_FILE = 'vocal_forced.lrc' if os.path.exists('vocal_forced.lrc') else 'vocal_word_level.lrc'

# 폰트 및 디자인 설정
FONT_NAME = "malgungothic" # 맑은 고딕
FONT_SIZE = 40
WINDOW_WIDTH = 1000
WINDOW_HEIGHT = 400
TEXT_COLOR = (150, 150, 150) # 대기 가사 (어두운 회색)
ACTIVE_COLOR = (255, 220, 0) # 현재 가사 (밝은 금색)
BG_COLOR = (20, 20, 20)      # 배경색 (거의 검정)

# ★ 핵심 설정: 가사를 얼마나 빨리 보여줄 것인가? (초 단위)
# 1.0이면 1초 먼저 가사가 뜸 (노래방처럼 준비 시간 확보)
DEFAULT_OFFSET = 0.5 

def parse_lrc(lrc_path):
    """LRC 파일을 파싱하여 시간순 리스트 반환"""
    lyrics = []
    if not os.path.exists(lrc_path):
        print(f"오류: {lrc_path} 파일을 찾을 수 없습니다.")
        return []

    print(f"가사 파일 로드 중: {lrc_path}")
    with open(lrc_path, 'r', encoding='utf-8') as f:
        for line in f:
            # 타임스탬프 파싱 [mm:ss.xx]
            match = re.match(r'\[(\d+):(\d+)\.(\d+)\](.*)', line)
            if match:
                minutes = int(match.group(1))
                seconds = int(match.group(2))
                milliseconds = int(match.group(3))
                # 밀리초 자릿수 보정 (2자리=10ms단위, 3자리=1ms단위)
                if len(match.group(3)) == 2:
                    milliseconds *= 10
                
                text = match.group(4).strip()
                if not text: continue
                
                total_seconds = minutes * 60 + seconds + milliseconds / 1000.0
                lyrics.append({'time': total_seconds, 'text': text})
    
    lyrics.sort(key=lambda x: x['time'])
    return lyrics

def main():
    pygame.init()
    pygame.mixer.init()
    
    screen = pygame.display.set_mode((WINDOW_WIDTH, WINDOW_HEIGHT))
    pygame.display.set_caption("AiPlugs Lyrics Player (Improved)")
    clock = pygame.time.Clock()
    
    # 폰트 로드
    try:
        font = pygame.font.SysFont(FONT_NAME, FONT_SIZE, bold=True)
        # 정보 표시용 작은 폰트
        info_font = pygame.font.SysFont("arial", 20)
    except:
        font = pygame.font.Font(None, FONT_SIZE)
        info_font = pygame.font.Font(None, 20)

    # 데이터 로드
    lyrics = parse_lrc(LRC_FILE)
    if not lyrics:
        return

    try:
        pygame.mixer.music.load(AUDIO_FILE)
    except pygame.error as e:
        print(f"오디오 로드 실패: {e}")
        return

    pygame.mixer.music.play()
    print("재생 시작. (위/아래 화살표: 싱크 조절, 스페이스바: 일시정지)")

    start_ticks = pygame.time.get_ticks()
    paused_at = 0
    is_paused = False
    
    # 싱크 오프셋 변수 (기본 1초)
    sync_offset = DEFAULT_OFFSET 
    
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            
            # 키보드 컨트롤 추가
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    if is_paused:
                        pygame.mixer.music.unpause()
                        is_paused = False
                        # 멈춰있던 시간만큼 start_ticks 보정
                        start_ticks += pygame.time.get_ticks() - paused_at
                    else:
                        pygame.mixer.music.pause()
                        is_paused = True
                        paused_at = pygame.time.get_ticks()
                
                # 싱크 미세 조절 (0.1초 단위)
                elif event.key == pygame.K_UP:
                    sync_offset += 0.1
                elif event.key == pygame.K_DOWN:
                    sync_offset -= 0.1

        # 화면 지우기
        screen.fill(BG_COLOR)

        if not is_paused:
            # 현재 실제 재생 시간
            real_time = (pygame.time.get_ticks() - start_ticks) / 1000.0
        else:
            # 일시정지 상태면 시간 멈춤
            real_time = (paused_at - start_ticks) / 1000.0

        # ★ 핵심 로직: 가사 검색용 시간 (실제 시간 + 오프셋)
        # 예: 실제 5초 + 오프셋 1초 = 6초. (6초짜리 가사를 지금 보여줌)
        display_time = real_time + sync_offset

        # 현재 가사 인덱스 찾기
        current_index = -1
        for i, lyric in enumerate(lyrics):
            if display_time >= lyric['time']:
                current_index = i
            else:
                break
        
        # --- 렌더링 ---
        
        # 1. 가사 출력 (현재 가사 위주로 5줄 표시)
        center_y = WINDOW_HEIGHT // 2
        line_height = 60
        
        display_range = 2 # 위아래 2줄씩
        start_idx = max(0, current_index - display_range)
        end_idx = min(len(lyrics), current_index + display_range + 1)
        
        for i in range(start_idx, end_idx):
            item = lyrics[i]
            is_active = (i == current_index)
            
            # 활성 가사는 색상 변경 및 크기 확대 효과
            color = ACTIVE_COLOR if is_active else TEXT_COLOR
            
            # 텍스트 렌더링
            text_surf = font.render(item['text'], True, color)
            
            # 위치 계산 (현재 가사가 항상 중앙에 오도록)
            # i - current_index : 현재 가사와의 거리 (-2, -1, 0, 1, 2)
            y_pos = center_y + (i - current_index) * line_height
            
            rect = text_surf.get_rect(center=(WINDOW_WIDTH // 2, y_pos))
            screen.blit(text_surf, rect)

        # 2. 하단 정보 표시 (싱크 조절 상태 확인용)
        offset_text = f"Sync Offset: {sync_offset:+.1f}s (Early)"
        info_surf = info_font.render(offset_text, True, (100, 200, 255))
        screen.blit(info_surf, (10, WINDOW_HEIGHT - 30))
        
        # 3. 재생 바 (실제 재생 시간 기준)
        if lyrics:
            total_duration = lyrics[-1]['time'] + 5 # 마지막 가사 + 5초 여유
            if total_duration > 0:
                progress = min(1.0, real_time / total_duration)
                pygame.draw.rect(screen, (50, 50, 50), (0, WINDOW_HEIGHT - 5, WINDOW_WIDTH, 5))
                pygame.draw.rect(screen, (0, 255, 0), (0, WINDOW_HEIGHT - 5, int(WINDOW_WIDTH * progress), 5))

        pygame.display.flip()
        clock.tick(30)
        
        # 자동 종료
        if not pygame.mixer.music.get_busy() and not is_paused and real_time > 1:
            running = False

    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    main()