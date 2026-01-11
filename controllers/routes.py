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
    separation_dir = output_dir / 'separated'
    
    if separation_dir.exists():
        # processor의 메서드 활용 (MP3 기준 확인)
        tracks_info = processor.get_separated_tracks(str(separation_dir))
        # 웹 서빙용 경로로 변환
        for track_name, info in tracks_info.items():
            # info['path']는 절대 경로이므로 URL 경로로 변환 필요
            # 확장자를 .mp3로 통일
            tracks[track_name] = {
                'path': f"/downloads/{video_id}/{track_name}.mp3",
                'size': info['size']
            }

    return jsonify({
        'status': 'completed' if tracks else 'not_processed',
        'video_id': video_id,
        'tracks': tracks
    })

@bp.route('/downloads/<video_id>/<filename>', methods=['GET'])
def download_track(video_id, filename):
    output_dir = DOWNLOADS_DIR / video_id / 'separated'
    
    # 트랙 이름 매핑 (URL filename -> 실제 파일명)
    # 클라이언트가 'vocal.mp3' 또는 'vocals.mp3'를 요청할 수 있음
    track_mapping = {
        'vocal.mp3': 'vocals.mp3',
        'bass.mp3': 'bass.mp3',
        'drum.mp3': 'drums.mp3',
        'other.mp3': 'other.mp3'
    }
    
    actual_filename = track_mapping.get(filename, filename)
    file_path = output_dir / actual_filename
    
    if file_path.exists() and file_path.is_file():
        # MP3 MIME Type 설정
        return send_file(file_path, mimetype='audio/mpeg')
            
    return jsonify({'error': 'File not found'}), 404