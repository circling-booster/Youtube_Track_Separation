import os
from pathlib import Path

# 기본 디렉토리 설정
BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS_DIR = BASE_DIR / 'downloads'
DOWNLOADS_DIR.mkdir(exist_ok=True)

class Config:
    SECRET_KEY = 'youtube-track-separator-secret-key-2026'
    DOWNLOADS_DIR = DOWNLOADS_DIR
