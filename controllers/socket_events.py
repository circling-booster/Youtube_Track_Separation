# controllers/socket_events.py
from flask_socketio import emit
from services.workflow import TrackSeparationWorkflow
from config import DOWNLOADS_DIR

def register_socket_events(socketio):
    workflow = TrackSeparationWorkflow(str(DOWNLOADS_DIR))
    
    @socketio.on('process_video')
    def handle_process(data):
        video_id = data.get('video_id')
        model = data.get('model', 'htdemucs')
        meta = data.get('meta')
        
        def progress_callback(progress, message):
            emit('progress', {
                'progress': progress,
                'message': message
            })
        
        result = workflow.process_video(
            video_id=video_id,
            model=model,
            meta=meta,
            progress_callback=progress_callback
        )
        
        if result['success']:
            emit('complete', result)
        else:
            emit('error', {'error': result['error']})
