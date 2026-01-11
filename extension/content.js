/**
 * YouTube Track Separator - Refactored Content Script
 * Features:
 * - Robust Audio Hijacking (No Echo/Conflicts)
 * - Separate Lyrics Module Integration
 * - Socket.IO Communication
 */

(function () {
  // ==========================================
  // 1. Main Application Controller
  // ==========================================
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

      this.init();
    }

    init() {
      console.log('[App] Initializing Track Separator...');
      this.injectGlobalStyles();
      this.startUrlObserver();
    }

    injectGlobalStyles() {
      if (document.getElementById('yt-sep-main-style')) return;
      const style = document.createElement('style');
      style.id = 'yt-sep-main-style';
      style.textContent = `
        .yt-sep-ui { font-family: 'Roboto', sans-serif; color: white; }
        .yt-sep-countdown { 
            position: fixed; top: 80px; right: 20px; 
            background: rgba(33, 33, 33, 0.95); border: 1px solid #444;
            padding: 15px; border-radius: 8px; font-size: 13px; z-index: 9999; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: none;
        }
        .yt-sep-countdown.active { display: block; animation: fadeIn 0.3s; }
        .yt-sep-btn { 
            padding: 6px 12px; margin-right: 5px; margin-top: 8px;
            background: #3ea6ff; color: #0f0f0f; border: none; border-radius: 18px; 
            cursor: pointer; font-weight: 500; font-size: 12px; transition: 0.2s;
        }
        .yt-sep-btn:hover { background: #65b8ff; }
        .yt-sep-btn.cancel { background: #444; color: #fff; }
        .yt-sep-btn.cancel:hover { background: #555; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
      `;
      document.head.appendChild(style);
    }

    startUrlObserver() {
      let lastUrl = location.href;
      new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
          lastUrl = url;
          this.handleNavigation();
          this.tryAddButton();
        }
      }).observe(document.body, { childList: true, subtree: true });
      this.handleNavigation();
    }

    handleNavigation() {
      const urlParams = new URLSearchParams(window.location.search);
      const newVideoId = urlParams.get('v');

      if (newVideoId && newVideoId !== this.videoId) {
        console.log('[App] New video detected:', newVideoId);
        this.cleanupPreviousVideo();
        this.videoId = newVideoId;
        
        // 새 비디오 시작 시 자동 처리 타이머 가동
        this.isAutoProcessCancelled = false;
        this.startAutoProcessTimer();
      }
    }

    cleanupPreviousVideo() {
      if (this.autoProcessTimer) clearTimeout(this.autoProcessTimer);
      if (this.countdownInterval) clearInterval(this.countdownInterval);
      
      if (this.customPlayer) {
        this.customPlayer.destroy();
        this.customPlayer = null;
      }
      
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      
      this.hideCountdownUI();
      this.isProcessing = false;
      
      // 오버레이 제거
      const overlay = document.getElementById('aiplugs-lyrics-overlay');
      if (overlay) overlay.remove();
    }

    // --- UI & Timer Logic ---

    startAutoProcessTimer() {
      this.showCountdownUI();
      this.autoProcessCountdown = 10;
      this.updateCountdownDisplay();

      this.countdownInterval = setInterval(() => {
        this.autoProcessCountdown--;
        this.updateCountdownDisplay();
        if (this.autoProcessCountdown <= 0) {
            clearInterval(this.countdownInterval);
        }
      }, 1000);

      this.autoProcessTimer = setTimeout(() => {
        if (!this.isAutoProcessCancelled && !this.isProcessing) {
          this.startAutoProcess();
        }
        this.hideCountdownUI();
      }, 10000);
    }

    showCountdownUI() {
      let el = document.getElementById('yt-sep-countdown');
      if (!el) {
        el = document.createElement('div');
        el.id = 'yt-sep-countdown';
        el.className = 'yt-sep-countdown';
        el.innerHTML = `
            <div style="font-weight:bold; margin-bottom:5px;">🎹 AI 트랙 분리</div>
            <div id="yt-sep-countdown-msg" style="color:#aaa; margin-bottom:5px;">10초 후 자동 시작...</div>
            <button id="yt-sep-auto-now" class="yt-sep-btn">지금 시작</button>
            <button id="yt-sep-auto-cancel" class="yt-sep-btn cancel">취소</button>
        `;
        document.body.appendChild(el);
        
        document.getElementById('yt-sep-auto-now').onclick = () => {
            this.cleanupPreviousVideo(); // 기존 타이머 클리어
            this.videoId = new URLSearchParams(window.location.search).get('v'); // ID 재확인
            this.startAutoProcess();
        };
        document.getElementById('yt-sep-auto-cancel').onclick = () => {
            this.isAutoProcessCancelled = true;
            this.hideCountdownUI();
        };
      }
      el.classList.add('active');
    }

    hideCountdownUI() {
        const el = document.getElementById('yt-sep-countdown');
        if (el) el.classList.remove('active');
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        if (this.autoProcessTimer) clearTimeout(this.autoProcessTimer);
    }

    updateCountdownDisplay() {
        const el = document.getElementById('yt-sep-countdown-msg');
        if (el) el.textContent = `${this.autoProcessCountdown}초 후 자동 시작...`;
    }

    // --- Core Process Logic ---

    startAutoProcess() {
        // 메타데이터 추출
        let meta = { sourceType: 'general' };
        if (window.YoutubeMetaExtractor) {
            meta = window.YoutubeMetaExtractor.getMusicInfo();
        }
        this.processVideo(meta);
    }

    processVideo(meta) {
        if (!this.videoId || this.isProcessing) return;
        this.isProcessing = true;
        this.tryAddButton();
        this.openSetupPanel(true);

        if (!this.socket) {
            this.socket = io(this.serverUrl, { transports: ['websocket'] });
            this.socket.on('progress', data => this.handleProgress(data));
            this.socket.on('complete', data => this.handleComplete(data));
            this.socket.on('error', data => {
                alert('Server Error: ' + (data.error || 'Unknown'));
                this.isProcessing = false;
                document.getElementById('yt-sep-setup-panel')?.remove();
            });
        }

        this.socket.emit('process_video', {
            video_id: this.videoId,
            model: 'htdemucs', // 기본 모델
            meta: meta
        });
    }

    handleProgress(data) {
        const bar = document.getElementById('sep-progress-bar');
        const pctText = document.getElementById('sep-percent');
        const statusText = document.getElementById('sep-status-text');
        
        if (bar) {
            bar.style.width = data.progress + '%';
            if (pctText) pctText.textContent = Math.round(data.progress) + '%';
            if (statusText) statusText.textContent = data.message;
        }
    }

    handleComplete(data) {
        console.log('[Complete]', data);
        this.tracks = data.tracks;
        this.isProcessing = false;
        document.getElementById('yt-sep-setup-panel')?.remove();
        
        this.launchCustomPlayer(data.lyrics_lrc);
    }

    launchCustomPlayer(lrcContent) {
        if (this.customPlayer) this.customPlayer.destroy();
        
        // 가사 오버레이 컨테이너 생성
        let overlay = document.getElementById('aiplugs-lyrics-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'aiplugs-lyrics-overlay';
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                z-index: 2147483640; pointer-events: none; overflow: hidden;
            `;
            document.body.appendChild(overlay);
        }

        // 분리된 파일(lyrics_overlay.js)의 엔진 사용
        let lyricsEngine = null;
        if (window.AiPlugsLyricsOverlay) {
            lyricsEngine = new window.AiPlugsLyricsOverlay();
            lyricsEngine.init(overlay);
            if (lrcContent) {
                lyricsEngine.parseLrc(lrcContent);
            }
        } else {
            console.error('Lyrics Engine script not loaded!');
        }

        // Robust Player 실행
        this.customPlayer = new CustomAudioPlayer(this.tracks, lyricsEngine);
    }

    tryAddButton() {
      const controls = document.querySelector('.ytp-right-controls');
      if (controls && !document.getElementById('yt-sep-trigger-btn')) {
        const btn = document.createElement('button');
        btn.id = 'yt-sep-trigger-btn';
        btn.className = 'ytp-button';
        btn.innerHTML = '<span style="font-size:18px;">🎹</span>';
        btn.title = "트랙 분리 스튜디오 열기";
        btn.onclick = (e) => {
            e.stopPropagation();
            this.isAutoProcessCancelled = true;
            this.hideCountdownUI();
            this.openSetupPanel(false);
        };
        controls.insertBefore(btn, controls.firstChild);
      }
    }

    openSetupPanel(isAuto = false) {
      if (document.getElementById('yt-sep-setup-panel')) return;
      if (!window.YTSepUITemplates?.setupPanelHTML) return;

      const panel = document.createElement('div');
      panel.id = 'yt-sep-setup-panel';
      panel.className = 'yt-sep-ui';
      panel.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
        background: #212121; padding: 25px; border-radius: 12px; 
        z-index: 9999; width: 320px; border: 1px solid #444; box-shadow: 0 10px 30px rgba(0,0,0,0.8);
      `;
      panel.innerHTML = window.YTSepUITemplates.setupPanelHTML();
      document.body.appendChild(panel);

      if (isAuto) {
          const pArea = document.getElementById('sep-progress-area');
          const sBtn = document.getElementById('sep-start-btn');
          if(pArea) pArea.style.display = 'block';
          if(sBtn) sBtn.style.display = 'none';
      }

      const startBtn = document.getElementById('sep-start-btn');
      if(startBtn) {
          startBtn.onclick = () => {
              let meta = window.YoutubeMetaExtractor ? window.YoutubeMetaExtractor.getMusicInfo() : { sourceType: 'general' };
              this.processVideo(meta);
          };
      }
      
      const closeBtn = document.getElementById('sep-close-btn');
      if(closeBtn) closeBtn.onclick = () => panel.remove();
    }
  }

  // ==========================================
  // 2. Custom Audio Player (Robust Version)
  // ==========================================
  class CustomAudioPlayer {
    constructor(tracks, lyricsEngine) {
      this.tracks = tracks;
      this.lyricsEngine = lyricsEngine;
      
      // AudioContext 초기화
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();
      
      this.volumes = { vocal: 35, bass: 100, drum: 100, other: 100 };
      this.audioBuffers = {};
      this.activeSources = [];
      
      this._cachedVideo = null;
      this.rafId = null;
      this.isDragging = false;

      // 바인딩
      this.updateLoop = this.updateLoop.bind(this);
      this.handleVideoEvent = this.handleVideoEvent.bind(this);

      this.init();
    }

    get videoElement() {
      // 기존 참조가 유효한지 확인
      if (this._cachedVideo && this._cachedVideo.isConnected) {
        return this._cachedVideo;
      }
      // 유튜브 메인 비디오 요소 찾기
      const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (v) {
        console.log('[Player] Binding to video element');
        this._cachedVideo = v;
        this.attachListeners(v);
        this.hijackAudio(v);
      }
      return v;
    }

    async init() {
      this.createUI();
      await this.loadAllTracks();
      // 루프 시작
      this.updateLoop();
    }

    async loadAllTracks() {
      const statusEl = document.getElementById('cp-status');
      if (statusEl) statusEl.textContent = '리소스 로딩 중...';
      
      const promises = Object.entries(this.tracks).map(async ([name, info]) => {
        try {
            // ngrok 헤더 이슈 방지용 옵션 추가
            const res = await fetch(`http://localhost:5010${info.path}`, {
                headers: { 'ngrok-skip-browser-warning': 'true' }
            });
            const buf = await res.arrayBuffer();
            this.audioBuffers[name] = await this.audioContext.decodeAudioData(buf);
        } catch (e) {
            console.error(`Failed to load track ${name}:`, e);
        }
      });

      await Promise.all(promises);
      
      if (statusEl) statusEl.textContent = 'Ready';
      console.log('[Player] All tracks loaded');

      // 이미 재생 중이면 싱크 맞춰 재생
      if (this.videoElement && !this.videoElement.paused) {
        this.playAudio(this.videoElement.currentTime);
      }
    }

    hijackAudio(videoEl) {
      if (!videoEl) return;
      try {
        if (!videoEl._isHijacked) {
            // 원본 오디오를 Context로 가져오지만 destination에 연결하지 않음 (Mute 효과)
            const source = this.audioContext.createMediaElementSource(videoEl);
            // source.connect(this.audioContext.destination); // <-- 이 줄을 주석처리하여 원본 소리 차단
            videoEl._isHijacked = true;
            console.log('[Player] Original audio hijacked (muted)');
        }
      } catch (e) {
        // 이미 연결된 경우 등 경고 무시
        console.warn('[Player] Hijack warning:', e.message);
      }
    }

    attachListeners(videoEl) {
      // 기존 리스너 제거 (중복 방지)
      const events = ['play', 'pause', 'waiting', 'playing', 'seeked'];
      events.forEach(evt => videoEl.removeEventListener(evt, this.handleVideoEvent));
      events.forEach(evt => videoEl.addEventListener(evt, this.handleVideoEvent));
    }

    handleVideoEvent(e) {
      const v = e.target;
      // 아직 트랙 로딩 전이면 무시
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
            // AudioContext가 중지상태면 재개
            if (this.audioContext.state === 'suspended') this.audioContext.resume();
            this.playAudio(v.currentTime);
          }
          break;
      }
      
      // UI Play 버튼 상태 업데이트
      const btn = document.getElementById('cp-play-btn');
      if (btn) btn.innerHTML = v.paused ? '▶' : '⏸';
    }

    playAudio(startTime) {
      // 기존 소스 정리
      this.stopAudio();

      Object.entries(this.audioBuffers).forEach(([name, buffer]) => {
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        // 비디오 재생 속도 동기화
        source.playbackRate.value = this.videoElement ? this.videoElement.playbackRate : 1.0;

        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = this.volumes[name] / 100;

        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // 시작 시간 지정
        source.start(0, startTime);

        this.activeSources.push({ source, gainNode, name });
      });
    }

    stopAudio() {
      this.activeSources.forEach(s => {
        try { s.source.stop(); } catch(e) {}
      });
      this.activeSources = [];
    }

    updateLoop() {
      const v = this.videoElement;
      if (v) {
        // 1. 가사 업데이트
        if (this.lyricsEngine) {
            this.lyricsEngine.update(v.currentTime);
        }

        // 2. UI 슬라이더 업데이트 (드래그 중 아닐 때만)
        if (!this.isDragging) {
            const total = v.duration || 1;
            const pct = (v.currentTime / total) * 100;
            const prog = document.getElementById('cp-progress');
            if (prog) prog.value = pct;
            
            const currText = document.getElementById('cp-curr-time');
            if(currText) currText.textContent = this.formatTime(v.currentTime);
            const totalText = document.getElementById('cp-total-time');
            if(totalText) totalText.textContent = this.formatTime(total);
        }
      }
      this.rafId = requestAnimationFrame(this.updateLoop);
    }

    createUI() {
      if (!window.YTSepUITemplates?.customPlayerHTML) return;
      
      const container = document.createElement('div');
      container.id = 'yt-custom-player-ui';
      container.className = 'yt-sep-ui';
      // content_old.js의 스타일 차용
      container.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        width: 90%; max-width: 800px;
        background: rgba(15, 15, 15, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid #444; border-radius: 16px; padding: 20px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.6); z-index: 2147483647;
        display: flex; flex-direction: column; gap: 15px;
      `;
      
      container.innerHTML = window.YTSepUITemplates.customPlayerHTML([
        'vocal', 'bass', 'drum', 'other'
      ]);

      document.body.appendChild(container);

      // 이벤트 바인딩
      document.getElementById('cp-close-btn').onclick = () => this.destroy();
      document.getElementById('cp-play-btn').onclick = () => {
        const v = this.videoElement;
        if(v) v.paused ? v.play() : v.pause();
      };

      const progress = document.getElementById('cp-progress');
      progress.oninput = () => this.isDragging = true;
      progress.onchange = () => {
        this.isDragging = false;
        if(this.videoElement) {
            this.videoElement.currentTime = (progress.value / 100) * this.videoElement.duration;
        }
      };

      container.querySelectorAll('input[data-track]').forEach(input => {
        input.oninput = (e) => {
            const track = e.target.dataset.track;
            const val = parseInt(e.target.value);
            this.volumes[track] = val;
            this.activeSources.forEach(s => {
                if(s.name === track) s.gainNode.gain.value = val / 100;
            });
        };
      });
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
          // 플레이어 종료 시 원본 소리가 안 들릴 수 있으므로 안내
          // (Context를 복구하는 것은 복잡하므로 보통 새로고침 유도 or Hijack 방식 변경)
          // 여기서는 단순히 안내만 합니다.
          console.log('[Player] Destroyed. Reload to restore original audio context completely.');
      }

      const ui = document.getElementById('yt-custom-player-ui');
      if (ui) ui.remove();
      
      this._cachedVideo = null;
    }
  }

  // 앱 시작 (페이지 로드 대기)
  setTimeout(() => {
    new YouTubeTrackSeparator();
  }, 1000);
})();