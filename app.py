import logging
from datetime import datetime
import torch
from flask import Flask
from flask_cors import CORS
from config import Config
from extensions import socketio
# processor import 제거
from controllers.routes import bp as main_bp
from controllers.socket_events import register_socket_events

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    CORS(app, resources={r"/*": {"origins": "*"}})
    app.register_blueprint(main_bp)
    
    socketio.init_app(
        app,
        cors_allowed_origins="*",
        ping_timeout=120,
        ping_interval=25,
        async_mode='threading'
    )
    register_socket_events(socketio)
    return app

app = create_app()

if __name__ == '__main__':
    logger.info("="*70)
    logger.info("🚀 YouTube Track Separator Server Starting...")
    
    # GPU 정보 직접 조회로 변경 (processor 객체 의존성 제거)
    if torch.cuda.is_available():
        logger.info(f"📊 GPU: {torch.cuda.get_device_name(0)}")
        logger.info(f"💾 VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    else:
        logger.info("🔧 Device: CPU")
        
    socketio.run(app, host='0.0.0.0', port=5010, debug=True, allow_unsafe_werkzeug=True)