"""
Flask Extensions 초기화
- 모델 Pre-load 제거 (메모리 안전)
"""

from flask_socketio import SocketIO
from download import YouTubeDownloader
from config import DOWNLOADS_DIR

socketio = SocketIO()

# 다운로더는 가벼워서 미리 초기화 가능
downloader = YouTubeDownloader(str(DOWNLOADS_DIR))

# active_jobs 등 상태 관리용 변수
active_jobs = {}