from flask_socketio import SocketIO
from download import YouTubeDownloader
from demucs_processor import DemucsProcessor
from audio_sync import AudioSyncProcessor
from config import DOWNLOADS_DIR

# SocketIO 객체 생성 (나중에 app과 연결)
socketio = SocketIO()

# 서비스 객체 초기화
downloader = YouTubeDownloader(str(DOWNLOADS_DIR))
processor = DemucsProcessor(str(DOWNLOADS_DIR))
sync_processor = AudioSyncProcessor()

# 실행 중인 작업 추적 (전역 상태)
active_jobs = {}
