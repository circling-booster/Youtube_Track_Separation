import logging
from datetime import datetime
import torch
from flask import Flask
from flask_cors import CORS
from config import Config
from extensions import socketio, processor
from controllers.routes import bp as main_bp
from controllers.socket_events import register_socket_events

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def create_app():
    app = Flask(__name__)
    
    # 설정 로드
    app.config.from_object(Config)
    
    # CORS 설정
    CORS(app, resources={r"/*": {"origins": "*"}})
    
    # Blueprint 등록
    app.register_blueprint(main_bp)
    
    # Extensions 초기화
    # SocketIO는 create_app 외부에서 관리되는 객체에 app을 연결
    socketio.init_app(
        app,
        cors_allowed_origins="*",
        ping_timeout=120,
        ping_interval=25,
        async_mode='threading'
    )
    
    # 소켓 이벤트 등록
    register_socket_events(socketio)
    
    return app

app = create_app()

if __name__ == '__main__':
    logger.info("="*70)
    logger.info("🚀 YouTube Track Separator Server Starting...")
    logger.info("="*70)
    logger.info(f"🕒 Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info(f"🖥️ GPU Available: {processor.has_gpu()}")
    logger.info(f"🔧 Device: {processor.device}")
    
    if processor.has_gpu():
        logger.info(f"📊 GPU: {torch.cuda.get_device_name(0)}")
        logger.info(f"💾 VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
        
    logger.info(f"🌐 Server URL: http://localhost:5010")
    logger.info(f"📂 Downloads: {Config.DOWNLOADS_DIR}")
    logger.info("="*70)
    
    # 서버 실행
    socketio.run(
        app, 
        host='0.0.0.0', 
        port=5010, 
        debug=True, 
        allow_unsafe_werkzeug=True
    )
