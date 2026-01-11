/**
 * YouTube Track Separation - Main Controller
 * Features:
 * - Coordinates Socket.IO, Audio Player, and Lyrics Overlay
 * - Manages UI state and Auto-processing logic
 */

(function () {
  class YouTubeTrackSeparator {
    constructor() {
      this.serverUrl = 'http://localhost:5010/';
      this.videoId = null;
      this.socket = null;
      this.isProcessing = false;
      
      // 모듈 인스턴스
      this.player = null;
      this.lyricsEngine = null;

      // 자동 처리 관련
      this.autoProcessTimer = null;
      this.autoProcessCountdown = 10;
      this.isAutoProcessCancelled = false;
      this.countdownInterval = null;

      this.init();
    }

    init() {
      console.log('[App] Initializing Track Separator Controller...');
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
        
        this.isAutoProcessCancelled = false;
        this.startAutoProcessTimer();
      }
    }

    cleanupPreviousVideo() {
      if (this.autoProcessTimer) clearTimeout(this.autoProcessTimer);
      if (this.countdownInterval) clearInterval(this.countdownInterval);
      
      // 모듈 정리
      if (this.player) {
        this.player.destroy();
        this.player = null;
      }
      
      // 가사 오버레이 DOM 제거
      const overlay = document.getElementById('aiplugs-lyrics-overlay');
      if (overlay) overlay.remove();
      this.lyricsEngine = null;

      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      
      this.hideCountdownUI();
      this.isProcessing = false;
    }

    // --- Timer & UI Logic ---

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
            this.cleanupPreviousVideo(); 
            this.videoId = new URLSearchParams(window.location.search).get('v');
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

    // --- Core Processing ---

    startAutoProcess() {
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
            model: 'htdemucs',
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
        this.isProcessing = false;
        document.getElementById('yt-sep-setup-panel')?.remove();
        
        this.launchModules(data.tracks, data.lyrics_lrc);
    }

    launchModules(tracks, lrcContent) {
        // 1. 가사 모듈 초기화
        this.initLyricsEngine(lrcContent);

        // 2. 플레이어 모듈 초기화 (가사 업데이트 콜백 주입)
        if (window.AiPlugsAudioPlayer) {
            this.player = new window.AiPlugsAudioPlayer(tracks, (currentTime) => {
                if (this.lyricsEngine) {
                    this.lyricsEngine.update(currentTime);
                }
            });
            this.player.init();
        } else {
            console.error('Audio Player script not loaded!');
        }
    }

    initLyricsEngine(lrcContent) {
        if (window.AiPlugsLyricsOverlay) {
            // 가사 컨테이너 DOM 생성
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

            this.lyricsEngine = new window.AiPlugsLyricsOverlay();
            this.lyricsEngine.init(overlay);
            
            if (lrcContent) {
                this.lyricsEngine.parseLrc(lrcContent);
                console.log('Lyrics loaded into engine');
            } else {
                console.log('No lyrics available, engine idle');
            }
        } else {
            console.warn('Lyrics Overlay script not loaded!');
        }
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

  // 앱 시작
  setTimeout(() => {
    new YouTubeTrackSeparator();
  }, 3000);
})();