import logging
from datetime import datetime
from flask import Blueprint, jsonify, request, send_file, render_template
import torch
from extensions import downloader # downloader는 가벼워서 유지됨
from demucs_processor import DemucsProcessor # 클래스 직접 import
from config import DOWNLOADS_DIR

bp = Blueprint('main', __name__)
logger = logging.getLogger(__name__)

@bp.route('/')
def index():
    gpu_info = "NVIDIA CUDA (활성화됨)" if torch.cuda.is_available() else "CPU 모드"
    return render_template('index.html', gpu_info=gpu_info)

@bp.route('/api/health', methods=['GET'])
def healthcheck():
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'gpu_available': torch.cuda.is_available()
    })

@bp.route('/api/video-info/<video_id>', methods=['GET'])
def get_video_info(video_id):
    # DemucsProcessor 인스턴스 일시 생성 (상태 확인용, VRAM 사용 안함)
    processor = DemucsProcessor(str(DOWNLOADS_DIR))
    output_dir = DOWNLOADS_DIR / video_id
    
    # 기존 로직: 분리된 트랙이 있는지 확인
    tracks = {}
    if output_dir.exists():
        # processor의 메서드 활용
        tracks_info = processor.get_separated_tracks(str(output_dir))
        # 웹 서빙용 경로로 변환
        for track_name, info in tracks_info.items():
            # info['path']는 절대 경로이므로 URL 경로로 변환 필요
            # 기존 workflow.py 로직 참조: /downloads/video_id/name.wav
            tracks[track_name] = {
                'path': f"/downloads/{video_id}/{track_name}.wav",
                'size': info['size']
            }

    return jsonify({
        'status': 'completed' if tracks else 'not_processed',
        'video_id': video_id,
        'tracks': tracks
    })

@bp.route('/downloads/<video_id>/<filename>', methods=['GET'])
def download_track(video_id, filename):
    output_dir = DOWNLOADS_DIR / video_id
    # 기존과 동일하게 파일 서빙
    # (파일명 매핑 로직 유지)
    track_mapping = {
        'vocal.wav': 'vocals.wav',
        'bass.wav': 'bass.wav',
        'drum.wav': 'drums.wav',
        'other.wav': 'other.wav'
    }
    actual_filename = track_mapping.get(filename, filename)
    
    for file_path in output_dir.rglob(actual_filename):
        if file_path.is_file():
            return send_file(file_path, mimetype='audio/wav')
            
    return jsonify({'error': 'File not found'}), 404