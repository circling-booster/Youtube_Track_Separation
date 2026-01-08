"""
yt-dlp를 이용한 YouTube MP3 다운로드

최고 음질 MP3 변환 및 메타데이터 처리
"""

import subprocess
import logging
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)


class YouTubeDownloader:
    """YouTube 비디오를 MP3로 다운로드"""

    def __init__(self, download_dir):
        """
        Args:
            download_dir: 다운로드 저장 디렉토리
        """
        self.download_dir = Path(download_dir)
        self.download_dir.mkdir(exist_ok=True)
        self._check_dependencies()

    def _check_dependencies(self):
        """필수 도구 설치 확인"""
        tools = {
            'yt-dlp': 'pip install yt-dlp',
            'ffmpeg': 'ffmpeg를 설치하세요 (https://ffmpeg.org/download.html)'
        }

        for tool, install_cmd in tools.items():
            try:
                if tool == 'ffmpeg':
                    subprocess.run(
                        ['ffmpeg', '-version'],
                        capture_output=True,
                        check=True,
                        timeout=5
                    )
                else:
                    subprocess.run(
                        ['yt-dlp', '--version'],
                        capture_output=True,
                        check=True,
                        timeout=5
                    )

                logger.info(f"✓ {tool} 설치됨")

            except (subprocess.CalledProcessError, FileNotFoundError):
                logger.warning(f"⚠ {tool}을 설치해야 합니다: {install_cmd}")

    def download(self, video_id, output_dir=None):
        """
        YouTube 비디오를 MP3로 다운로드

        Args:
            video_id: YouTube video ID
            output_dir: 저장할 디렉토리 (None이면 self.download_dir 사용)

        Returns:
            Path: 다운로드한 MP3 파일 경로, 실패 시 None
        """

        if output_dir is None:
            output_dir = self.download_dir
        else:
            output_dir = Path(output_dir)

        output_dir.mkdir(parents=True, exist_ok=True)

        # 유튜브 URL 구성
        url = f"https://www.youtube.com/watch?v={video_id}"
        output_path = output_dir / "input.mp3"

        # 이미 존재하면 사용
        if output_path.exists():
            logger.info(f"[{video_id}] MP3 파일이 이미 존재합니다: {output_path}")
            return output_path

        logger.info(f"[{video_id}] 다운로드 시작: {url}")

        try:
            # yt-dlp 명령어로 최고 음질 MP3 다운로드
            # Windows 호환성: --audio-quality 제거하고 ffmpeg-acodec로 최고음질 유지
            cmd = [
                'yt-dlp',
                '-f', 'bestaudio/best',  # 최고 음질 선택
                '-x',  # 오디오만 추출
                '--audio-format', 'mp3',  # MP3 형식
                    '--js-runtimes', 'deno',  # ← 이 줄만 추가!

                '-o', str(output_path),  # 출력 경로 (절대 경로)
                url
            ]

            logger.info(f"[{video_id}] yt-dlp 실행 중...")
            logger.info(f"[{video_id}] 명령어: {' '.join(cmd)}")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5분 타임아웃
            )

            if result.returncode != 0:
                logger.error(f"[{video_id}] yt-dlp 오류: {result.stderr}")
                logger.error(f"[{video_id}] 표준출력: {result.stdout}")
                return None

            if output_path.exists():
                file_size = output_path.stat().st_size / (1024 * 1024)  # MB
                logger.info(f"[{video_id}] ✓ 다운로드 완료: {file_size:.1f} MB")
                return output_path

            else:
                logger.error(f"[{video_id}] MP3 파일이 생성되지 않았습니다")
                return None

        except subprocess.TimeoutExpired:
            logger.error(f"[{video_id}] 다운로드 타임아웃 (5분)")
            return None

        except Exception as e:
            logger.error(f"[{video_id}] 다운로드 오류: {str(e)}")
            return None

    def get_video_info(self, video_id):
        """비디오 정보 조회"""
        url = f"https://www.youtube.com/watch?v={video_id}"

        try:
            cmd = [
                'yt-dlp',
                '--dump-json',
                url
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode == 0:
                import json
                info = json.loads(result.stdout)
                return {
                    'title': info.get('title', 'Unknown'),
                    'duration': info.get('duration', 0),
                    'uploader': info.get('uploader', 'Unknown')
                }

        except Exception as e:
            logger.error(f"[{video_id}] 정보 조회 오류: {str(e)}")

        return None
