import logging
import traceback
from extensions import socketio, active_jobs, downloader, processor, sync_processor
from config import DOWNLOADS_DIR

logger = logging.getLogger(__name__)

def process_video_background(video_id, model, client_sid):
    """백그라운드 비디오 처리 작업"""
    try:
        # 작업 디렉토리 설정
        output_dir = DOWNLOADS_DIR / video_id
        output_dir.mkdir(exist_ok=True)

        # 1. 다운로드 단계
        logger.info(f"[{video_id}] 1. 다운로드 시작")
        socketio.emit('progress', {
            'video_id': video_id,
            'stage': 'download',
            'progress': 0,
            'message': 'YouTube 오디오 다운로드 중...'
        }, room=client_sid)

        mp3_path = downloader.download(video_id, output_dir)
        if not mp3_path:
            raise Exception("MP3 다운로드 실패")
        
        logger.info(f"[{video_id}] MP3 다운로드 완료: {mp3_path}")
        socketio.emit('progress', {
            'video_id': video_id,
            'stage': 'download',
            'progress': 100,
            'message': 'MP3 다운로드 완료'
        }, room=client_sid)

        # 2. DEMUCS 분리 단계
        logger.info(f"[{video_id}] 2. DEMUCS 분리 시작")
        socketio.emit('progress', {
            'video_id': video_id,
            'stage': 'demucs',
            'progress': 10,
            'message': 'DEMUCS 모델 로딩 및 트랙 분리 시작... (예상: 1-5분)'
        }, room=client_sid)

        # 진행률 콜백 함수
        def demucs_progress(progress, track_name):
            socketio.emit('track_chunk', {
                'video_id': video_id,
                'track': track_name,
                'progress': progress
            }, room=client_sid)

        success = processor.process_and_stream(
            mp3_path, 
            output_dir, 
            model=model,
            progress_callback=demucs_progress
        )

        if not success:
            raise Exception("DEMUCS 처리 실패")
            
        logger.info(f"[{video_id}] DEMUCS 처리 완료")

        # 3. 동기화 및 후처리
        logger.info(f"[{video_id}] 3. 후처리 및 동기화 분석")
        socketio.emit('progress', {
            'video_id': video_id,
            'stage': 'sync',
            'progress': 85,
            'message': '오디오 동기화 및 정합성 검증 중...'
        }, room=client_sid)

        # 분리된 트랙 정보 수집
        tracks = processor.get_separated_tracks(str(output_dir))
        if not tracks:
            raise Exception("분리된 트랙을 찾을 수 없습니다")

        logger.info(f"[{video_id}] 발견된 트랙: {list(tracks.keys())}")

        # 동기화 분석 수행
        for track_name, track_info in tracks.items():
            logger.info(f"[{video_id}] 분석 중: {track_name}")
            sync_processor.analyze_track(track_info['path'])

        logger.info(f"[{video_id}] 동기화 검증 완료")
        
        socketio.emit('progress', {
            'video_id': video_id,
            'stage': 'sync',
            'progress': 95,
            'message': '최종 파일 정리 중...'
        }, room=client_sid)

        # 4. 완료 처리
        logger.info(f"[{video_id}] 4. 작업 완료")
        
        # 클라이언트용 경로 변환 (절대 경로 -> 상대 경로)
        client_tracks = {}
        for track_name, track_info in tracks.items():
            # URL 경로로 변환 (downloads/video_id/track.wav)
            client_tracks[track_name] = {
                'path': f"/downloads/{video_id}/{track_name}.wav",
                'size': track_info['size']
            }
            logger.info(f"[{video_id}] {track_name}")
            logger.info(f"  - 파일: {client_tracks[track_name]['path']}")
            logger.info(f"  - 크기: {track_info['size']:.1f} MB")

        # 완료 이벤트 전송
        socketio.emit('completed', {
            'video_id': video_id,
            'tracks': client_tracks,
            'message': '모든 작업이 완료되었습니다.',
            'sync_info': sync_processor.get_sync_info()
        }, room=client_sid)

        logger.info(f"[{video_id}] 클라이언트 전송 완료")
        active_jobs[video_id]['status'] = 'completed'

    except Exception as e:
        logger.error(f"[{video_id}] 치명적 오류: {str(e)}")
        error_msg = str(e)
        logger.error(f"[{video_id}] 추적 정보:\n{traceback.format_exc()}")
        
        socketio.emit('error', {
            'video_id': video_id,
            'message': f"처리 중 오류가 발생했습니다: {error_msg}"
        }, room=client_sid)
        
        if video_id in active_jobs:
            active_jobs[video_id]['status'] = 'failed'
