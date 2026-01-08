import logging
from datetime import datetime
from flask import request
from flask_socketio import emit
from extensions import socketio, active_jobs
from services.workflow import process_video_background

logger = logging.getLogger(__name__)

def register_socket_events(socketio_instance):
    """소켓 이벤트 핸들러 등록"""
    
    @socketio_instance.on('connect')
    def handle_connect():
        logger.info(f"Client connected: {request.sid}")
        emit('connection_response', {
            'data': 'Connected to YouTube Track Separator Server',
            'server_time': datetime.now().isoformat()
        })

    @socketio_instance.on('disconnect')
    def handle_disconnect():
        logger.info(f"Client disconnected: {request.sid}")

    @socketio_instance.on('process_video')
    def handle_process_video(data):
        """비디오 처리 요청 핸들러"""
        video_id = data.get('video_id', '').strip()
        model = data.get('model', 'htdemucs')
        
        if not video_id:
            logger.warning(f"잘못된 요청: video_id 없음")
            emit('error', {'message': 'Video ID is required'})
            return

        # 이미 처리 중인지 확인
        if video_id in active_jobs and active_jobs[video_id]['status'] == 'processing':
            logger.warning(f"이미 처리 중인 비디오: {video_id}")
            emit('info', {'message': f"Video {video_id} is already being processed."})
            return

        logger.info(f"작업 시작 요청: Video ID={video_id}, Model={model}")
        
        # 작업 상태 등록
        active_jobs[video_id] = {
            'status': 'processing',
            'progress': 0
        }
        
        # 백그라운드 작업 시작
        socketio_instance.start_background_task(
            process_video_background, 
            video_id, 
            model, 
            request.sid
        )
