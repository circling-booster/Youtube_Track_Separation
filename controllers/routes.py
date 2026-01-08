import logging
from datetime import datetime
from flask import Blueprint, jsonify, request, send_file, render_template
import torch
from extensions import downloader, processor, active_jobs
from config import DOWNLOADS_DIR

# Blueprint 생성
bp = Blueprint('main', __name__)
logger = logging.getLogger(__name__)

@bp.route('/')
def index():
    """서버 메인 페이지"""
    # 템플릿에 전달할 GPU 정보 준비
    gpu_info = "NVIDIA CUDA (활성화됨)" if torch.cuda.is_available() else "CPU 모드"
    device_info = f"{torch.cuda.get_device_name(0)}" if torch.cuda.is_available() else "cpu"
    
    vram_gb = "N/A"
    if torch.cuda.is_available():
        vram_gb = f"{torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB"
    
    return render_template('index.html', 
                         gpu_info=gpu_info, 
                         device_info=device_info, 
                         vram_info=vram_gb)

@bp.route('/api/health', methods=['GET'])
def healthcheck():
    """서버 상태 확인 API"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'gpu_available': processor.has_gpu(),
        'device': processor.device,
        'version': '1.0.0'
    })

@bp.route('/api/video-info/<video_id>', methods=['GET'])
def get_video_info(video_id):
    """비디오 정보 및 처리 상태 조회"""
    output_dir = DOWNLOADS_DIR / video_id
    
    # 이미 처리된 결과가 있는지 확인
    tracks = {}
    if output_dir.exists():
        # 예상되는 트랙 파일들
        track_mapping = {
            'vocals.wav': 'vocal',
            'bass.wav': 'bass',
            'drums.wav': 'drum',
            'other.wav': 'other'
        }
        
        # 디렉토리 순회하며 파일 찾기
        for subdir in output_dir.rglob('*'):
            if subdir.is_file():
                for wav_name, track_name in track_mapping.items():
                    if subdir.name == wav_name:
                        # 상대 경로 계산
                        rel_path = f"/downloads/{video_id}/{track_name}.wav"
                        tracks[track_name] = {
                            'path': rel_path,
                            'size': subdir.stat().st_size / (1024 * 1024)
                        }

    return jsonify({
        'status': 'completed' if tracks else 'not_processed',
        'video_id': video_id,
        'tracks': tracks
    })

@bp.route('/downloads/<video_id>/<filename>', methods=['GET'])
def download_track(video_id, filename):
    """분리된 트랙 파일 다운로드"""
    output_dir = DOWNLOADS_DIR / video_id
    
    # 파일명 매핑 (URL -> 실제 파일명)
    track_mapping = {
        'vocal.wav': 'vocals.wav',
        'bass.wav': 'bass.wav',
        'drum.wav': 'drums.wav',
        'other.wav': 'other.wav'
    }
    
    actual_filename = track_mapping.get(filename, filename)
    logger.info(f"[다운로드 요청] {filename} -> {actual_filename}")

    # 파일 찾기 (재귀 검색)
    for file_path in output_dir.rglob(actual_filename):
        if file_path.is_file():
            logger.info(f"[다운로드] 파일 전송: {file_path}")
            logger.info(f"[다운로드] 크기: {file_path.stat().st_size / 1024 / 1024:.1f} MB")
            return send_file(
                file_path,
                mimetype='audio/wav',
                as_attachment=False, # 브라우저 바로 재생 지원
                download_name=filename
            )
    
    logger.error(f"[다운로드 실패] 파일을 찾을 수 없음: {actual_filename} in {output_dir}")
    logger.info(f"디렉토리 내용: {list(output_dir.rglob('*.wav'))}")
    return jsonify({'error': f'File not found: {filename}'}), 404
