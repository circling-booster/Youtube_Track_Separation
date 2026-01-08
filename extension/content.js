
/**
 * YouTube Track Separator - Robust Standalone Player
 * 개선사항:
 * 1. URL 변경 시 완전한 오디오 초기화
 * 2. 영상 진입 후 10초 자동 demucs 처리
 * 3. 타이머 및 자동 처리 취소 기능
 */

class YouTubeTrackSeparator {
  constructor() {
    this.serverUrl = 'http://localhost:5010/';
    this.videoId = null;
    this.socket = null;
    this.isProcessing = false;
    this.tracks = {};
    this.customPlayer = null;

    // 자동 처리 관련
    this.autoProcessTimer = null;
    this.autoProcessCountdown = 10;
    this.isAutoProcessCancelled = false;
    this.countdownInterval = null;

    // 싱글톤 스타일 초기화
    this.init();
  }

  init() {
    console.log('[App] 초기화 시작');
    this.injectGlobalStyles();
    this.startUrlObserver();
  }

  injectGlobalStyles() {
    if (document.getElementById('yt-separator-styles')) return;
    const style = document.createElement('style');
    style.id = 'yt-separator-styles';
    style.textContent = `
      .yt-sep-ui { font-family: Roboto, Arial, sans-serif; color: white; }
      .yt-sep-btn { cursor: pointer; transition: transform 0.1s; border: none; }
      .yt-sep-btn:active { transform: scale(0.95); }
      .yt-sep-slider { -webkit-appearance: none; background: #444; height: 4px; border-radius: 2px; outline: none; }
      .yt-sep-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: #3ea6ff; border-radius: 50%; cursor: pointer; }
      .yt-sep-countdown { 
        position: fixed; top: 20px; right: 20px; 
        background: rgba(58, 158, 255, 0.9); 
        padding: 12px 16px; 
        border-radius: 8px; 
        font-size: 14px; 
        z-index: 9998;
        display: none;
      }
      .yt-sep-countdown.active { display: block; }
      .yt-sep-countdown-text { margin-bottom: 8px; }
      .yt-sep-countdown-btn { 
        padding: 4px 12px; 
        margin: 0 4px; 
        background: white; 
        color: #000; 
        border: none; 
        border-radius: 4px; 
        cursor: pointer; 
        font-size: 12px;
      }
      .yt-sep-countdown-btn:hover { background: #f0f0f0; }
    `;
    document.head.appendChild(style);
  }

  startUrlObserver() {
    // 1. URL 변경 감지 (SPA 대응)
    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        this.handleNavigation();

        // 버튼이 사라졌으면 다시 추가
        this.tryAddButton();
      }
    }).observe(document.body, { childList: true, subtree: true });

    // 초기 실행
    this.handleNavigation();
  }

  handleNavigation() {
    const urlParams = new URLSearchParams(window.location.search);
    const newVideoId = urlParams.get('v');

    if (newVideoId && newVideoId !== this.videoId) {
      console.log('[App] 새 비디오 감지:', newVideoId);

      // 이전 비디오의 모든 리소스 완전 정리
      this.cleanupPreviousVideo();

      // 새 비디오 ID 설정
      this.videoId = newVideoId;
      this.isAutoProcessCancelled = false;

      // 자동 처리 시작
      this.startAutoProcessTimer();
    }
  }

  cleanupPreviousVideo() {
    // 자동 처리 타이머 취소
    if (this.autoProcessTimer) {
      clearTimeout(this.autoProcessTimer);
      this.autoProcessTimer = null;
    }

    // 카운트다운 인터벌 취소
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // 커스텀 플레이어 완전 종료
    if (this.customPlayer) {
      this.customPlayer.destroy();
      this.customPlayer = null;
    }

    // 트랙 초기화
    this.tracks = {};

    // Socket 정리
    if (this.socket && this.socket.connected) {
      this.socket.disconnect();
      this.socket = null;
    }

    // 카운트다운 UI 숨김
    this.hideCountdownUI();

    // 진행 중인 작업 중단
    this.isProcessing = false;

    console.log('[App] 이전 비디오 리소스 정리 완료');
  }

  startAutoProcessTimer() {
    // 카운트다운 UI 표시
    this.showCountdownUI();
    this.autoProcessCountdown = 10;
    this.updateCountdownDisplay();

    // 카운트다운 업데이트
    this.countdownInterval = setInterval(() => {
      this.autoProcessCountdown--;
      this.updateCountdownDisplay();
    }, 1000);

    // 10초 후 자동 처리 시작
    this.autoProcessTimer = setTimeout(() => {
      if (!this.isAutoProcessCancelled && !this.isProcessing) {
        console.log('[App] 자동 처리 시작');
        this.startAutoProcess();
      }
      this.hideCountdownUI();
    }, 10000);
  }

  updateCountdownDisplay() {
    const countdownEl = document.getElementById('yt-sep-countdown');
    if (countdownEl) {
      const timeDisplay = document.getElementById('yt-sep-countdown-time');
      if (timeDisplay) {
        timeDisplay.textContent = `${this.autoProcessCountdown}초 후 자동 처리`;
      }
    }
  }

  showCountdownUI() {
    let countdownEl = document.getElementById('yt-sep-countdown');
    if (countdownEl) {
      countdownEl.classList.add('active');
      return;
    }

    countdownEl = document.createElement('div');
    countdownEl.id = 'yt-sep-countdown';
    countdownEl.className = 'yt-sep-countdown active';
    countdownEl.innerHTML = `
      <div class="yt-sep-countdown-text">
        <span id="yt-sep-countdown-time">10초 후 자동 처리</span>
      </div>
      <div>
        <button class="yt-sep-countdown-btn" id="yt-sep-auto-cancel">취소</button>
        <button class="yt-sep-countdown-btn" id="yt-sep-auto-now">지금 처리</button>
      </div>
    `;
    document.body.appendChild(countdownEl);

    // 이벤트 바인딩
    document.getElementById('yt-sep-auto-cancel').onclick = () => {
      this.cancelAutoProcess();
    };

    document.getElementById('yt-sep-auto-now').onclick = () => {
      this.cancelCountdown();
      this.startAutoProcess();
    };
  }

  hideCountdownUI() {
    const countdownEl = document.getElementById('yt-sep-countdown');
    if (countdownEl) {
      countdownEl.classList.remove('active');
    }

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  cancelCountdown() {
    if (this.autoProcessTimer) {
      clearTimeout(this.autoProcessTimer);
      this.autoProcessTimer = null;
    }
    this.hideCountdownUI();
  }

  cancelAutoProcess() {
    this.isAutoProcessCancelled = true;
    this.cancelCountdown();
    console.log('[App] 자동 처리 취소됨');
  }

  startAutoProcess() {
    // 자동 처리: demucs 모델로 시작
    this.isAutoProcessCancelled = false;
    this.tryAddButton();

    // 설정 패널 자동 열기
    setTimeout(() => {
      this.openSetupPanel(true); // true = 자동 처리 모드
    }, 500);
  }

  tryAddButton() {
    if (!this.videoId) return;
    const controls = document.querySelector('.ytp-right-controls');
    if (controls && !document.getElementById('yt-sep-trigger-btn')) {
      const btn = document.createElement('button');
      btn.id = 'yt-sep-trigger-btn';
      btn.className = 'ytp-button';
      btn.innerHTML = '🎹';
      btn.title = 'AI 트랙 분리 플레이어 열기';
      btn.onclick = (e) => {
        e.stopPropagation();
        this.cancelCountdown(); // 수동 클릭 시 자동 처리 취소
        this.isAutoProcessCancelled = true;
        this.openSetupPanel(false);
      };
      controls.insertBefore(btn, controls.firstChild);
    }
  }

  openSetupPanel(isAutoMode = false) {
    if (this.isProcessing) return alert('작업이 진행 중입니다.');
    if (document.getElementById('yt-sep-setup-panel')) return;

    if (!window.YTSepUITemplates?.setupPanelHTML) {
      alert('UI 템플릿이 로드되지 않았습니다. yt-sep-ui-templates.js 로드 순서를 확인하세요.');
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'yt-sep-setup-panel';
    panel.className = 'yt-sep-ui';
    panel.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: #212121; padding: 25px; border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.8); z-index: 9999; width: 320px;
      border: 1px solid #333;
    `;

    panel.innerHTML = window.YTSepUITemplates.setupPanelHTML();
    document.body.appendChild(panel);

    // 자동 모드면 demucs 선택 및 자동 시작
    if (isAutoMode) {
      const modelSelect = document.getElementById('sep-model');
      if (modelSelect) {
        modelSelect.value = 'demucs'; // 기본 모델 설정
      }
      setTimeout(() => {
        this.startProcess();
      }, 300);
    }

    document.getElementById('sep-start-btn').onclick = () => this.startProcess();
    document.getElementById('sep-close-btn').onclick = () => panel.remove();
  }

  async startProcess() {
    const model = document.getElementById('sep-model').value;
    this.isProcessing = true;
    document.getElementById('sep-start-btn').disabled = true;
    document.getElementById('sep-progress-area').style.display = 'block';

    try {
      await this.connectSocket();
      this.socket.emit('process_video', { video_id: this.videoId, model: model });
    } catch (e) {
      alert('연결 실패: ' + e.message);
      this.isProcessing = false;
    }
  }

  connectSocket() {
    return new Promise((resolve, reject) => {
      if (this.socket && this.socket.connected) return resolve();
      if (typeof io === 'undefined') return reject(new Error('Socket.IO 로드 안됨'));

      this.socket = io('http://localhost:5010/', { transports: ['websocket'] });

      this.socket.on('connect', resolve);
      this.socket.on('connect_error', reject);

      this.socket.on('progress', (data) => {
        const bar = document.getElementById('sep-progress-bar');
        if (bar) {
          bar.style.width = data.progress + '%';
          document.getElementById('sep-percent').textContent = Math.round(data.progress) + '%';
          document.getElementById('sep-status-text').textContent = data.message;
        }
      });

      this.socket.on('completed', (data) => {
        this.isProcessing = false;
        this.tracks = data.tracks;
        const panel = document.getElementById('yt-sep-setup-panel');
        if (panel) panel.remove();
        this.launchCustomPlayer();
      });

      this.socket.on('error', (data) => {
        alert('오류: ' + data.message);
        this.isProcessing = false;
      });
    });
  }

  launchCustomPlayer() {
    if (this.customPlayer) this.customPlayer.destroy();
    this.customPlayer = new CustomAudioPlayer(this.tracks);
  }
}

/**
 * Core Class: Robust Custom Player
 * 특징: 동적 비디오 바인딩, 강제 음소거 유지, 싱크 표류 방지
 */
class CustomAudioPlayer {
  constructor(tracks) {
    this.tracks = tracks;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.volumes = { vocal: 100, bass: 100, drum: 100, other: 30 };
    this.audioBuffers = {};
    this.activeSources = [];

    this._cachedVideo = null;
    this.rafId = null;
    this.isDragging = false;

    this.updateLoop = this.updateLoop.bind(this);
    this.handleVideoEvent = this.handleVideoEvent.bind(this);
    this.init();
  }

  get videoElement() {
    if (this._cachedVideo && this._cachedVideo.isConnected) {
      return this._cachedVideo;
    }

    const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (v) {
      console.log('[Player] 비디오 요소 재바인딩');
      this._cachedVideo = v;
      this.attachListeners(v);
      this.hijackAudio(v);
    }

    return v;
  }

  async init() {
    this.createUI();
    await this.loadAllTracks();
    this.updateLoop();
  }

  async loadAllTracks() {
    const statusEl = document.getElementById('cp-status');
    if (statusEl) statusEl.textContent = '트랙 로딩 중...';

    const promises = Object.entries(this.tracks).map(async ([name, info]) => {
      const res = await fetch(
        `http://localhost:5010/${info.path}`, {
        headers: { 'ngrok-skip-browser-warning': 'true' }

      }


      );
      const buf = await res.arrayBuffer();
      this.audioBuffers[name] = await this.audioContext.decodeAudioData(buf);
    });

    await Promise.all(promises);

    if (statusEl) statusEl.textContent = 'Ready';

    if (this.videoElement && !this.videoElement.paused) {
      this.playAudio(this.videoElement.currentTime);
    }
  }

  hijackAudio(videoEl) {
    if (!videoEl) return;

    try {
      if (!videoEl._isHijacked) {
        const source = this.audioContext.createMediaElementSource(videoEl);
        videoEl._isHijacked = true;
        console.log('[Player] 원본 오디오 하이재킹 성공');
      }
    } catch (e) {
      console.warn('[Player] 오디오 하이재킹 실패:', e.message);
    }
  }

  attachListeners(videoEl) {
    videoEl.removeEventListener('play', this.handleVideoEvent);
    videoEl.removeEventListener('pause', this.handleVideoEvent);
    videoEl.removeEventListener('waiting', this.handleVideoEvent);
    videoEl.removeEventListener('playing', this.handleVideoEvent);
    videoEl.removeEventListener('seeked', this.handleVideoEvent);

    videoEl.addEventListener('play', this.handleVideoEvent);
    videoEl.addEventListener('pause', this.handleVideoEvent);
    videoEl.addEventListener('waiting', this.handleVideoEvent);
    videoEl.addEventListener('playing', this.handleVideoEvent);
    videoEl.addEventListener('seeked', this.handleVideoEvent);
  }

  handleVideoEvent(e) {
    const v = e.target;
    if (!this.audioBuffers['vocal']) return;

    switch (e.type) {
      case 'pause':
      case 'waiting':
        this.stopAudio();
        break;
      case 'play':
      case 'playing':
      case 'seeked':
        if (!v.paused && v.readyState >= 3) {
          this.playAudio(v.currentTime);
        }
        break;
    }

    const btn = document.getElementById('cp-play-btn');
    if (btn) btn.innerHTML = v.paused ? '▶' : '⏸';
  }

  playAudio(startTime) {
    if (this.audioContext.state === 'suspended') this.audioContext.resume();
    this.stopAudio();

    Object.entries(this.audioBuffers).forEach(([name, buffer]) => {
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;

      source.playbackRate.value = this.videoElement ? this.videoElement.playbackRate : 1.0;

      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = this.volumes[name] / 100;

      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      source.start(0, startTime);

      this.activeSources.push({ source, gainNode, name });
    });
  }

  stopAudio() {
    this.activeSources.forEach(s => {
      try {
        s.source.stop();
      } catch (e) { }
    });
    this.activeSources = [];
  }

  createUI() {
    if (!window.YTSepUITemplates?.customPlayerHTML) {
      alert('UI 템플릿이 로드되지 않았습니다. yt-sep-ui-templates.js 로드 순서를 확인하세요.');
      return;
    }

    const container = document.createElement('div');
    container.id = 'yt-custom-player-ui';
    container.className = 'yt-sep-ui';
    container.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      width: 90%; max-width: 800px;
      background: rgba(15, 15, 15, 0.98);
      backdrop-filter: blur(10px);
      border: 1px solid #444; border-radius: 16px; padding: 20px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6); z-index: 2147483647;
      display: flex; flex-direction: column; gap: 15px;
    `;

    container.innerHTML = window.YTSepUITemplates.customPlayerHTML([
      'vocal', 'bass', 'drum', 'other'
    ]);

    document.body.appendChild(container);

    document.getElementById('cp-close-btn').onclick = () => this.destroy();
    document.getElementById('cp-play-btn').onclick = () => {
      const v = this.videoElement;
      if (v) v.paused ? v.play() : v.pause();
    };

    const progress = document.getElementById('cp-progress');
    progress.oninput = () => {
      this.isDragging = true;
      if (this.videoElement) {
        const time = (progress.value / 100) * this.videoElement.duration;
        document.getElementById('cp-curr-time').textContent = this.formatTime(time);
      }
    };

    progress.onchange = () => {
      this.isDragging = false;
      if (this.videoElement) {
        this.videoElement.currentTime = (progress.value / 100) * this.videoElement.duration;
      }
    };

    container.querySelectorAll('input[data-track]').forEach(input => {
      input.oninput = (e) => {
        const track = e.target.dataset.track;
        const val = parseInt(e.target.value);
        this.volumes[track] = val;
        this.activeSources.forEach(s => {
          if (s.name === track) s.gainNode.gain.value = val / 100;
        });
      };
    });
  }

  updateLoop() {
    const v = this.videoElement;
    if (v) {
      if (!this.isDragging) {
        const total = v.duration || 1;
        const curr = v.currentTime;
        const pct = (curr / total) * 100;
        const prog = document.getElementById('cp-progress');
        if (prog) prog.value = pct;

        const currText = document.getElementById('cp-curr-time');
        if (currText) currText.textContent = this.formatTime(curr);

        const totalText = document.getElementById('cp-total-time');
        if (totalText) totalText.textContent = this.formatTime(total);
      }
    }

    this.rafId = requestAnimationFrame(this.updateLoop.bind(this));
  }

  formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.stopAudio();

    if (this._cachedVideo && this._cachedVideo._isHijacked) {
      //   alert('플레이어가 종료되었습니다. 원본 소리 복구를 위해 페이지를 새로고침 해주세요.');
      location.reload()
    }

    const ui = document.getElementById('yt-custom-player-ui');
    if (ui) ui.remove();

    this._cachedVideo = null;
  }
}

// 페이지 로드 시 앱 시작
new YouTubeTrackSeparator();