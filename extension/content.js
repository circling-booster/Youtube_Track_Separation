/**
 * YouTube Track Separation - Main Controller
 * 수정사항: 10초 자동 시작 카운트다운 로직 완전 제거
 */

(function () {
  class YouTubeTrackSeparator {
    constructor() {
      this.serverUrl = 'http://localhost:5010/';
      this.videoId = null;
      this.socket = null;
      this.isProcessing = false;
      this.player = null;
      this.lyricsEngine = null;
      
      // 상태 관리
      this.lastUrl = location.href;
      
      this.init();
    }

    init() {
      console.log('[App] Initializing...');
      this.injectGlobalStyles();
      
      // SPA 네비게이션 감지
      new MutationObserver(() => this.checkNavigation()).observe(document.body, { childList: true, subtree: true });
      setInterval(() => this.checkNavigation(), 1000);
      
      // 초기 실행
      this.checkNavigation();
    }

    checkNavigation() {
      if (location.href !== this.lastUrl) {
        this.lastUrl = location.href;
        this.handleNavigation();
      }
      const currentVideoId = new URLSearchParams(window.location.search).get('v');
      if (currentVideoId && currentVideoId !== this.videoId) {
        this.handleNavigation();
      }
    }

    handleNavigation() {
      const urlParams = new URLSearchParams(window.location.search);
      const newVideoId = urlParams.get('v');

      if (newVideoId && newVideoId !== this.videoId) {
        console.log(`[App] Video changed: ${this.videoId} -> ${newVideoId}`);
        this.cleanup(); // 이전 리소스 정리
        this.videoId = newVideoId;
        
        this.tryAddButton();
        // 자동 시작 타이머 로직 제거됨
      }
    }

    cleanup() {
        // 플레이어 정리
        if (this.player) {
            this.player.destroy();
            this.player = null;
        }
        
        // UI 및 소켓 정리
        document.getElementById('aiplugs-lyrics-overlay')?.remove();
        document.getElementById('yt-sep-setup-panel')?.remove();
        document.getElementById('yt-custom-player-ui')?.remove();
        document.getElementById('yt-sep-minimized-icon')?.remove();
        // 카운트다운 UI 정리 로직 제거됨

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isProcessing = false;
    }

    // --- UI Styles ---

    injectGlobalStyles() {
      if (document.getElementById('yt-sep-main-style')) return;
      const style = document.createElement('style');
      style.id = 'yt-sep-main-style';
      style.textContent = `
        .yt-sep-btn { 
            padding: 6px 12px; margin-right: 5px; margin-top: 5px;
            background: #3ea6ff; color: #0f0f0f; border: none; border-radius: 18px; 
            cursor: pointer; font-weight: 600; font-size: 12px; transition: 0.2s;
        }
        .yt-sep-btn:hover { background: #65b8ff; }
        .yt-sep-btn.cancel { background: #444; color: #fff; }
        .yt-sep-btn.cancel:hover { background: #555; }
        
        /* 카운트다운 관련 스타일 제거됨 */
      `;
      document.head.appendChild(style);
    }

    tryAddButton() {
      const controls = document.querySelector('.ytp-right-controls');
      if (controls && !document.getElementById('yt-sep-trigger-btn')) {
        const btn = document.createElement('button');
        btn.id = 'yt-sep-trigger-btn';
        btn.className = 'ytp-button';
        btn.innerHTML = '<span style="font-size:18px;">🎹</span>';
        btn.title = "트랙 분리 스튜디오";
        btn.style.verticalAlign = 'middle';
        btn.onclick = (e) => {
            e.stopPropagation();
            this.openSetupPanel();
        };
        controls.insertBefore(btn, controls.firstChild);
      }
    }

    openSetupPanel() {
      if (document.getElementById('yt-sep-setup-panel')) return;
      if (!window.YTSepUITemplates?.setupPanelHTML) return;

      const panel = document.createElement('div');
      panel.id = 'yt-sep-setup-panel';
      panel.className = 'yt-sep-ui';
      panel.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: #212121; padding: 25px; border-radius: 12px; 
        z-index: 9999; width: 320px; border: 1px solid #444; 
        box-shadow: 0 10px 30px rgba(0,0,0,0.8); color: white;
      `;
      panel.innerHTML = window.YTSepUITemplates.setupPanelHTML();
      document.body.appendChild(panel);

      document.getElementById('sep-start-btn').onclick = () => this.startProcessLogic();
      document.getElementById('sep-close-btn').onclick = () => panel.remove();
    }

    startProcessLogic() {
        // 메타데이터 추출 및 소스 타입 식별
        let meta = window.YoutubeMetaExtractor ? window.YoutubeMetaExtractor.getMusicInfo() : { sourceType: 'general' };
        this.processVideo(meta);
    }

    processVideo(meta) {
        if (!this.videoId || this.isProcessing) return;
        this.isProcessing = true;
        
        // UI가 열려있지 않다면 염
        this.openSetupPanel();

        const startBtn = document.getElementById('sep-start-btn');
        const progressArea = document.getElementById('sep-progress-area');
        if(startBtn) startBtn.style.display = 'none';
        if(progressArea) progressArea.style.display = 'block';

        if (!this.socket) {
            this.socket = io(this.serverUrl, { transports: ['websocket'] });
            this.socket.on('progress', data => this.handleProgress(data));
            this.socket.on('complete', data => this.handleComplete(data));
            this.socket.on('error', data => {
                alert('Error: ' + (data.error || 'Unknown'));
                this.isProcessing = false;
                this.cleanup();
            });
        }

        // 요청 전송
        const modelSelect = document.getElementById('sep-model');
        const model = modelSelect ? modelSelect.value : 'htdemucs';
        
        this.socket.emit('process_video', {
            video_id: this.videoId,
            model: model,
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
        this.isProcessing = false;
        document.getElementById('yt-sep-setup-panel')?.remove();
        
        // 가사 엔진 로드
        this.initLyricsEngine(data.lyrics_lrc);
        
        // 플레이어 로드
        if (window.AiPlugsAudioPlayer) {
            this.player = new window.AiPlugsAudioPlayer(data.tracks, (currentTime) => {
                if (this.lyricsEngine) this.lyricsEngine.update(currentTime);
            });
            this.player.init();
        }
    }

    initLyricsEngine(lrcContent) {
        if (window.AiPlugsLyricsOverlay) {
            let overlay = document.getElementById('aiplugs-lyrics-overlay');
            if (overlay) overlay.remove();

            overlay = document.createElement('div');
            overlay.id = 'aiplugs-lyrics-overlay';
            // 기본 스타일 주입
            overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2147483640; pointer-events: none; overflow: hidden;`;
            document.body.appendChild(overlay);

            this.lyricsEngine = new window.AiPlugsLyricsOverlay();
            this.lyricsEngine.init(overlay);
            if (lrcContent) {
                this.lyricsEngine.parseLrc(lrcContent);
            }
        }
    }
  }

  // 유튜브 페이지 로드 타이밍 고려하여 지연 실행
  setTimeout(() => { new YouTubeTrackSeparator(); }, 2000);
})();