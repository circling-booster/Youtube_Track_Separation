import re
import logging
import html

logger = logging.getLogger(__name__)

class TextCleaner:
    """
    자막 및 가사 텍스트 정제 엔진
    배경음, 화자 표시, HTML 태그 등 비발화 요소를 제거하여 순수 텍스트만 추출
    """
    
    def __init__(self):
        # 정규표현식 컴파일 (성능 최적화)
        self.patterns = [
            # 1. VTT/SRT 타임스탬프 잔여물 제거 (ex: 00:00:12.345 --> ...)
            (re.compile(r'.*-->.*'), ''), 

            # 2. 괄호로 묶인 배경음/효과음/감정 ([Music], (Sighs), *gasp*)
            (re.compile(r'\[.*?\]'), ''), 
            (re.compile(r'\(.*?\)'), ''),
            (re.compile(r'\*.*?\*'), ''),
            
            # 3. 음악 관련 기호 (♪, ♫, ♬, ♩, #)
            (re.compile(r'[♪♫♬♩#]'), ''),
            
            # 4. 화자 식별 및 꺾쇠 (Name:, >>) 
            # [수정] 문장 중간의 '>>' 도 제거하도록 수정 (ex: Hello >> World -> Hello World)
            (re.compile(r'^[A-Za-z0-9가-힣\s]+:\s*'), ''),
            (re.compile(r'>>+'), ''),  # >>, >>> 등 모든 꺾쇠 제거
            
            # 5. HTML 및 서식 태그 (<i>, </i>, <font...>, {\an8} 등)
            (re.compile(r'<[^>]+>'), ''),
            (re.compile(r'\{.*?\}'), ''),
            
            # 6. 특수 공백 및 중복 공백 정리
            (re.compile(r'\s+'), ' ') 
        ]

    def clean_text(self, text: str) -> str:
        """단일 라인 정제"""
        if not text:
            return ""
        
        # HTML 엔티티 디코딩 (ex: &nbsp; -> space, &gt; -> >)
        cleaned = html.unescape(text)
        
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
                if line.startswith('NOTE'): continue # 주석 라인 스킵
                
                # [수정] 타임스탬프 라인 필터링 강화
                if time_pattern.match(line) or '-->' in line: 
                    continue
                
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