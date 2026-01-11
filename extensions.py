"""
Flask Extensions 초기화
- 모델 Pre-load 제거 (메모리 안전)
- 설정만 유지
"""

from flask_socketio import SocketIO
from download import YouTubeDownloader
from demucs_processor import DemucsProcessor
from audio_sync import AudioSyncProcessor
from config import DOWNLOADS_DIR

# SocketIO 객체 생성 (나중에 app과 연결)
socketio = SocketIO()

# 다운로더는 가벼워서 미리 초기화 가능
downloader = YouTubeDownloader(str(DOWNLOADS_DIR))

# ⚠️ 모델은 절대로 미리 로드하지 않음
# processor와 sync_processor는 None으로 유지
# 필요할 때만 workflow.py에서 동적으로 생성

# 대신 factory 함수 제공
def get_demucs_processor():
    """필요할 때만 Demucs 프로세서 생성"""
    return DemucsProcessor(str(DOWNLOADS_DIR))

def get_audio_sync_processor():
    """필요할 때만 AudioSync 프로세서 생성"""
    return AudioSyncProcessor()

# 실행 중인 작업 추적
active_jobs = {}
