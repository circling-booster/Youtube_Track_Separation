import re
import logging

logger = logging.getLogger(__name__)

class TextCleaner:
    """
    자막 및 가사 텍스트 정제 엔진
    배경음, 화자 표시, HTML 태그 등 비발화 요소를 제거하여 순수 텍스트만 추출
    """
    
    def __init__(self):
        # 정규표현식 컴파일 (성능 최적화)
        self.patterns = [
            # 1. 괄호로 묶인 배경음/효과음/감정 ([Music], (Sighs), *gasp*)
            (re.compile(r'\[.*?\]'), ''), 
            (re.compile(r'\(.*?\)'), ''),
            (re.compile(r'\*.*?\*'), ''),
            
            # 2. 음악 관련 기호 (♪, ♫, ♬, ♩, #)
            (re.compile(r'[♪♫♬♩#]'), ''),
            
            # 3. 화자 식별 (Name:, >>) - 줄의 시작 부분 매칭
            (re.compile(r'^[A-Za-z0-9가-힣\s]+:\s*'), ''),
            (re.compile(r'^>>\s*'), ''),
            
            # 4. HTML 및 서식 태그 (<i>, </i>, <font...>, {\an8} 등)
            (re.compile(r'<[^>]+>'), ''),
            (re.compile(r'\{.*?\}'), ''),
            
            # 5. 특수 공백 및 중복 공백 정리
            (re.compile(r'\s+'), ' ') 
        ]

    def clean_text(self, text: str) -> str:
        """단일 라인 정제"""
        if not text:
            return ""
            
        cleaned = text
        for pattern, replacement in self.patterns:
            cleaned = pattern.sub(replacement, cleaned)
            
        return cleaned.strip()

    def parse_vtt_to_text(self, file_path: str) -> str:
        """
        VTT 파일에서 타임스탬프와 메타데이터를 제외한 순수 텍스트만 추출
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()

            lines = content.split('\n')
            cleaned_lines = []
            prev_line = ""
            
            # VTT 타임스탬프 패턴 (00:00:00.000 --> 00:00:00.000)
            time_pattern = re.compile(r'\d{2}:\d{2}:\d{2}\.\d{3}\s-->\s\d{2}:\d{2}:\d{2}\.\d{3}')

            for line in lines:
                line = line.strip()
                
                # 구조적 메타데이터 스킵
                if not line: continue
                if line == 'WEBVTT': continue
                if line.startswith('Kind:') or line.startswith('Language:'): continue
                if time_pattern.match(line): continue
                
                # 텍스트 정제
                cleaned = self.clean_text(line)
                
                if not cleaned: continue

                # 중복 라인 제거 (자동 생성 자막의 롤업 현상 방지)
                if cleaned != prev_line:
                    cleaned_lines.append(cleaned)
                    prev_line = cleaned

            return ' '.join(cleaned_lines)
            
        except Exception as e:
            logger.error(f"[TextUtils] VTT 파싱 오류: {e}")
            return None