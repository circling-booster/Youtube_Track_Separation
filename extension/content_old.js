
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
    }, 1000);
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
    this.volumes = { vocal: 35, bass: 100, drum: 100, other: 100 };
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

(function() {
    // 1. 기존 오버레이 제거 (중복 실행 방지)
    const existingPlayer = document.getElementById('aiplugs-lyrics-overlay');
    if (existingPlayer) existingPlayer.remove();

    // ==========================================
    // 2. 설정 (Configuration)
    // ==========================================
    const config = {
        baseFontSize: 34,      // 기본 폰트 크기 (가독성을 위해 키움)
        activeScale: 1.2,      // 활성 라인 확대 배수 (1.2 = 1.2배)
        syncOffset: 0.0,       // 싱크 조절 (초)
        gapThreshold: 2.0,     // 카운트다운 발동 간격
        anticipation: 1.5      // 카운트다운 표시 시간
    };

    // ==========================================
    // 3. 핵심 로직 (Lyrics Engine)
    // ==========================================
    class LyricsEngine {
        constructor() {
            this.lyrics = [];
            this.mergeThreshold = 0.1;
        }

        parseTime(timeStr) {
            try {
                const parts = timeStr.split(':');
                return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
            } catch (e) { return 0.0; }
        }

        parseLrc(lrcContent) {
            const lines = lrcContent.split('\n');
            const patternFull = /\[(\d+:\d+(?:\.\d+)?)\]\s*<(\d+:\d+(?:\.\d+)?)>\s*(.*)/;
            const patternStd = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;

            let rawLyrics = [];
            lines.forEach(line => {
                line = line.trim();
                if (!line) return;
                
                let startT = 0, endT = null, text = "", matched = false;
                
                // 패턴 1: [시작] <끝> 가사
                let mFull = line.match(patternFull);
                if (mFull) {
                    startT = this.parseTime(mFull[1]);
                    endT = this.parseTime(mFull[2]);
                    text = mFull[3].trim();
                    matched = true;
                } else {
                    // 패턴 2: [시작] 가사
                    let mStd = line.match(patternStd);
                    if (mStd) {
                        const mins = parseInt(mStd[1], 10);
                        const secs = parseInt(mStd[2], 10);
                        let ms = mStd[3] ? parseInt(mStd[3], 10) : 0;
                        if (String(mStd[3]).length === 2) ms *= 10;
                        startT = mins * 60 + secs + (ms / 1000.0);
                        text = mStd[4].trim();
                        matched = true;
                    }
                }

                if (matched && text) rawLyrics.push({ time: startT, endTime: endT, text: text });
            });

            rawLyrics.sort((a, b) => a.time - b.time);

            // 종료 시간 자동 계산
            for (let i = 0; i < rawLyrics.length; i++) {
                if (rawLyrics[i].endTime === null) {
                    if (i < rawLyrics.length - 1) rawLyrics[i].endTime = rawLyrics[i + 1].time;
                    else rawLyrics[i].endTime = rawLyrics[i].time + 3.0;
                }
            }

            this.lyrics = this.mergeShortLines(rawLyrics);
            this.calculateGaps();
        }

        mergeShortLines(lyrics) {
            if (!lyrics.length) return [];
            const merged = [];
            let i = 0;
            while (i < lyrics.length) {
                let current = { ...lyrics[i] };
                let j = 1;
                while ((i + j < lyrics.length) && (j < 3)) {
                    let nextItem = lyrics[i + j];
                    if ((current.endTime - current.time) > this.mergeThreshold) break;
                    if ((nextItem.time - current.endTime) > 0.15) break;

                    current.text += " " + nextItem.text;
                    current.endTime = nextItem.endTime;
                    j++;
                }
                merged.push(current);
                i += j;
            }
            return merged;
        }

        calculateGaps() {
            for (let i = 0; i < this.lyrics.length; i++) {
                this.lyrics[i].needsCountdown = false;
                let gap = (i === 0) ? this.lyrics[i].time : (this.lyrics[i].time - this.lyrics[i-1].endTime);
                if (gap >= config.gapThreshold) this.lyrics[i].needsCountdown = true;
            }
        }

        getCurrentIdx(time) {
            let idx = -1;
            for (let i = 0; i < this.lyrics.length; i++) {
                if (time >= this.lyrics[i].time) idx = i;
                else break;
            }
            return idx;
        }
    }

    // ==========================================
    // 4. 스타일 (CSS) - 선명도 & 확대 로직 강화
    // ==========================================
    const style = document.createElement('style');
    style.innerHTML = `
        :root {
            --ap-font-size: ${config.baseFontSize}px;
            --ap-active-scale: ${config.activeScale};
        }
        #aiplugs-lyrics-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            z-index: 2147483647; pointer-events: none;
            font-family: 'Pretendard', 'Malgun Gothic', sans-serif;
            overflow: hidden; background: transparent;
        }
        /* 컨트롤 패널 */
        .ap-controls {
            position: absolute; top: 20px; left: 20px;
            background: rgba(0, 0, 0, 0.85); padding: 15px; border-radius: 12px;
            pointer-events: auto; color: white; display: flex; flex-direction: column; gap: 8px;
            backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.2);
            width: 240px; font-size: 13px; box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        }
        .ap-row { display: flex; justify-content: space-between; align-items: center; }
        .ap-input { width: 50px; background: #333; border: 1px solid #555; color: white; padding: 3px; border-radius: 4px; text-align: center; }
        
        /* 가사 컨테이너 */
        .ap-lyrics-box {
            position: absolute; top: 50%; left: 0; width: 100%; text-align: center;
            transition: transform 0.1s linear; /* 부드러운 스크롤 */
        }
        .ap-line {
            height: calc(var(--ap-font-size) * 3);
            display: flex; align-items: center; justify-content: center;
            white-space: nowrap; 
            font-size: var(--ap-font-size);
            font-weight: 900; /* 굵게 */
            color: rgba(255,255,255,0.4);
            transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); /* 쫀득한 모션 */
            -webkit-text-stroke: 1px rgba(0,0,0,0.5); /* 기본 테두리 */
            position: relative;
        }

        /* [핵심] 활성 라인 스타일 (선명도 + 확대) */
        .ap-line.active {
            color: #ffffff !important;
            opacity: 1 !important;
            z-index: 10;
            
            /* 1. 확대: CSS 변수 사용 + !important로 강제 적용 */
            transform: scale(var(--ap-active-scale)) !important;
            
            /* 2. 선명도: 검은 테두리와 딱딱한 그림자 */
            -webkit-text-stroke: 2px black;
            text-shadow: 
                3px 3px 0px #000000, 
                0 0 10px rgba(0, 255, 255, 0.7);
        }

        .ap-line.near { opacity: 0.7; color: #ddd; -webkit-text-stroke: 1px black; }

        /* 카운트다운 점 */
        .ap-dots {
            position: absolute; top: 15%; left: 50%; transform: translateX(-50%);
            display: flex; gap: 6px; opacity: 0; transition: opacity 0.2s;
        }
        .ap-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff3333; box-shadow: 0 0 5px red; }
        .ap-line.show-cnt .ap-dots { opacity: 1; }

        .ap-hidden { display: none; }
        .ap-btn {
            background: linear-gradient(90deg, #00c6ff, #0072ff); border: none; border-radius: 5px;
            color: white; padding: 8px; font-weight: bold; cursor: pointer; width: 100%; margin-top: 5px;
        }
        .ap-btn:hover { filter: brightness(1.1); }
        .ap-btn.red { background: #ff4444; }
        hr { border: 0; border-top: 1px solid #444; width: 100%; margin: 8px 0; }
    `;
    document.head.appendChild(style);

    // ==========================================
    // 5. DOM 생성
    // ==========================================
    const overlay = document.createElement('div');
    overlay.id = 'aiplugs-lyrics-overlay';
    document.body.appendChild(overlay);

    const lyricsBox = document.createElement('div');
    lyricsBox.className = 'ap-lyrics-box';
    overlay.appendChild(lyricsBox);

    const controls = document.createElement('div');
    controls.className = 'ap-controls';
    controls.innerHTML = `
        <div style="font-weight:bold; text-align:center;">AiPlugs Ultimate</div>
        <hr>
        <div class="ap-row"><label>크기 (px)</label><input type="number" id="cfg-size" class="ap-input" value="${config.baseFontSize}"></div>
        <div class="ap-row"><label>확대 (배)</label><input type="number" id="cfg-scale" class="ap-input" value="${config.activeScale}" step="0.1"></div>
        <div class="ap-row"><label>싱크 (초)</label><input type="number" id="cfg-sync" class="ap-input" value="${config.syncOffset}" step="0.1"></div>
        <div style="font-size:11px; color:#aaa; text-align:right; margin-bottom:5px;">(Scale 1.0~2.0 권장)</div>
        <hr>
        <button class="ap-btn" onclick="document.getElementById('inp-audio').click()">🎵 Audio 파일</button>
        <button class="ap-btn" onclick="document.getElementById('inp-lrc').click()">📄 LRC 파일</button>
        <div id="status-msg" style="font-size:11px; color:#ccc; text-align:center; margin-top:5px;">대기중...</div>
        <button class="ap-btn red" id="btn-close">종료</button>
        <input type="file" id="inp-audio" class="ap-hidden" accept="audio/*">
        <input type="file" id="inp-lrc" class="ap-hidden" accept=".lrc,.txt">
    `;
    overlay.appendChild(controls);

    // ==========================================
    // 6. 실행 로직 (Logic Binding)
    // ==========================================
    const engine = new LyricsEngine();
    const audio = new Audio();
    let frameId;
    let domLines = [];
    const statusMsg = document.getElementById('status-msg');

    // 설정 변경 이벤트
    document.getElementById('cfg-size').addEventListener('input', e => {
        document.documentElement.style.setProperty('--ap-font-size', e.target.value + "px");
    });
    document.getElementById('cfg-scale').addEventListener('input', e => {
        let val = parseFloat(e.target.value);
        // 안전 장치: 실수로 100 입력 시 100배가 되지 않도록 경고 및 처리 (보통 2.0 이하 사용)
        if(val > 5) { 
            statusMsg.textContent = "⚠️ 확대 비율이 너무 큽니다!";
            statusMsg.style.color = "orange";
        } else {
            statusMsg.style.color = "#ccc";
        }
        document.documentElement.style.setProperty('--ap-active-scale', val);
    });
    document.getElementById('cfg-sync').addEventListener('input', e => config.syncOffset = parseFloat(e.target.value));

    // 파일 로드
    document.getElementById('inp-audio').addEventListener('change', e => {
        if(e.target.files[0]) {
            audio.src = URL.createObjectURL(e.target.files[0]);
            statusMsg.textContent = "오디오 준비완료";
            if(engine.lyrics.length) audio.play();
        }
    });
    document.getElementById('inp-lrc').addEventListener('change', e => {
        if(e.target.files[0]) {
            const r = new FileReader();
            r.onload = evt => {
                engine.parseLrc(evt.target.result);
                renderDOM();
                statusMsg.textContent = `가사 로드됨 (${engine.lyrics.length}줄)`;
                if(audio.src) audio.play();
                loop();
            };
            r.readAsText(e.target.files[0]);
        }
    });
    document.getElementById('btn-close').addEventListener('click', () => {
        audio.pause();
        cancelAnimationFrame(frameId);
        overlay.remove();
        style.remove();
    });

    function renderDOM() {
        lyricsBox.innerHTML = '';
        domLines = [];
        engine.lyrics.forEach(line => {
            const div = document.createElement('div');
            div.className = 'ap-line';
            div.innerHTML = `<span>${line.text}</span>`;
            
            if(line.needsCountdown) {
                const dots = document.createElement('div');
                dots.className = 'ap-dots';
                dots.innerHTML = '<div class="ap-dot"></div><div class="ap-dot"></div><div class="ap-dot"></div>';
                div.appendChild(dots);
            }
            lyricsBox.appendChild(div);
            domLines.push(div);
        });
    }

    function loop() {
        cancelAnimationFrame(frameId);
        function update() {
            if(!audio.paused) {
                const time = audio.currentTime + config.syncOffset;
                const idx = engine.getCurrentIdx(time);
                
                // 스크롤 (폰트크기 * 3 = 줄높이)
                const lineHeight = parseInt(document.getElementById('cfg-size').value) * 3;
                lyricsBox.style.transform = `translateY(${-idx * lineHeight}px)`;

                domLines.forEach((div, i) => {
                    div.classList.remove('active', 'near', 'show-cnt');
                    
                    // 카운트다운
                    if (i > idx && engine.lyrics[i].needsCountdown) {
                        const remain = engine.lyrics[i].time - time;
                        if (remain > 0 && remain <= config.anticipation) {
                            div.classList.add('show-cnt');
                            const dots = div.querySelectorAll('.ap-dot');
                            dots.forEach((d, di) => {
                                const th = (3 - di) * (config.anticipation / 3.0);
                                d.style.opacity = (remain <= th) ? 1 : 0.2;
                            });
                        }
                    }

                    // 활성 라인 처리
                    if(i === idx) {
                        div.classList.add('active'); // CSS !important로 scale 강제 적용
                    } else if (Math.abs(i - idx) <= 2) {
                        div.classList.add('near');
                        div.style.transform = 'scale(0.9)'; // 주변 가사는 작게
                        div.style.opacity = Math.max(0.2, 1 - Math.abs(i - idx)*0.3);
                    } else {
                        div.style.transform = 'scale(0.8)';
                        div.style.opacity = 0.1;
                    }
                });
            }
            frameId = requestAnimationFrame(update);
        }
        update();
    }

    console.log("%c AiPlugs Ultimate Player Loaded ", "background: black; color: #00c6ff; font-weight: bold; padding: 5px; font-size: 14px;");
})();

// 페이지 로드 시 앱 시작
new YouTubeTrackSeparator();

