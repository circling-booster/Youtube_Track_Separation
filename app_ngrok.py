import logging
from datetime import datetime
import torch
from flask import Flask
from flask_cors import CORS
from config import Config
from extensions import socketio, processor
from controllers.routes import bp as main_bp
from controllers.socket_events import register_socket_events

# ================================
# 🔧 ngrok 설정 상수 (개발 단계)
# ================================
NGROK_ENABLED = False                                    # ngrok 활성화 여부
NGROK_AUTHTOKEN = "37QLnjfq83O3XwSEdW258hT1ROg_D1shCBzCwbDHZYMUYAPZ"             # ngrok 토큰 (발급받은 토큰으로 교체)
NGROK_PORT = 5010                                      # ngrok 터널 포트

# ================================
# 🖥️ 서버 설정 상수
# ================================
SERVER_HOST = '0.0.0.0'                                # 서버 바인드 주소
SERVER_PORT = 5010                                     # 서버 포트
SERVER_DEBUG = False                                    # 디버그 모드
FLASK_ENV = 'development'                              # Flask 환경

# ================================
# 📊 SocketIO 설정 상수
# ================================
SOCKETIO_CORS_ORIGINS = "*"                            # CORS 허용 출처
SOCKETIO_PING_TIMEOUT = 120                            # ping 타임아웃 (초)
SOCKETIO_PING_INTERVAL = 25                            # ping 간격 (초)
SOCKETIO_ASYNC_MODE = 'threading'                      # 비동기 모드

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)


def create_app():
    """Flask 애플리케이션 팩토리"""
    app = Flask(__name__)

    # 설정 로드
    app.config.from_object(Config)
    app.config['ENV'] = FLASK_ENV

    # CORS 설정
    CORS(app,  resources={r"/*": {"origins": "*"}}, allow_headers=['ngrok-skip-browser-warning', 'Content-Type'])

    # Blueprint 등록
    app.register_blueprint(main_bp)

    # Extensions 초기화
    # SocketIO는 create_app 외부에서 관리되는 객체에 app을 연결
    socketio.init_app(
        app,
        cors_allowed_origins=SOCKETIO_CORS_ORIGINS,
        ping_timeout=SOCKETIO_PING_TIMEOUT,
        ping_interval=SOCKETIO_PING_INTERVAL,
        async_mode=SOCKETIO_ASYNC_MODE
    )

    # 소켓 이벤트 등록
    register_socket_events(socketio)

    return app


app = create_app()


if __name__ == '__main__':
    logger.info("=" * 70)
    logger.info("🚀 YouTube Track Separator Server Starting...")
    logger.info("=" * 70)
    logger.info(f"🕒 Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info(f"🖥️ GPU Available: {processor.has_gpu()}")
    logger.info(f"🔧 Device: {processor.device}")

    if processor.has_gpu():
        logger.info(f"📊 GPU: {torch.cuda.get_device_name(0)}")
        logger.info(f"💾 VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    logger.info(f"🌐 Server URL: http://localhost:{SERVER_PORT}")
    logger.info(f"📂 Downloads: {Config.DOWNLOADS_DIR}")

    # ================================
    # 🔗 ngrok 초기화
    # ================================
    ngrok_url = None
    if NGROK_ENABLED:
        try:
            from pyngrok import ngrok
            ngrok.set_auth_token(NGROK_AUTHTOKEN)
            ngrok_url = ngrok.connect(NGROK_PORT)
            logger.info(f"✅ ngrok Connected!")
            logger.info(f"🌐 ngrok Public URL: {ngrok_url}")
        except Exception as e:
            logger.warning(f"⚠️ ngrok initialization failed: {e}")
            logger.warning("⚠️ Server will run without ngrok (local access only)")
    else:
        logger.info("⚠️ ngrok is disabled (set NGROK_ENABLED=True to enable)")

    logger.info("=" * 70)

    # 서버 실행
    socketio.run(
        app,
        host=SERVER_HOST,
        port=SERVER_PORT,
        debug=SERVER_DEBUG,
        allow_unsafe_werkzeug=True
    )
