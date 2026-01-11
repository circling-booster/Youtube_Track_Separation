/**
 * YouTube Track Separation - Main Controller
 * 수정: 네비게이션 시 리소스 리셋 강화, 중복 실행 방지, 캐싱 로직 연동
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

      // 자동 처리 타이머 관련
      this.autoProcessTimer = null;
      this.autoProcessCountdown = 10;
      this.isAutoProcessCancelled = false;
      this.countdownInterval = null;
      
      // URL 감지용 상태
      this.lastUrl = location.href;

      this.init();
    }

    init() {
      console.log('[App] Initializing Track Separator Controller...');
      this.injectGlobalStyles();
      
      // 1. MutationObserver (DOM 변경 및 URL 변화 감지)
      new MutationObserver(() => {
        this.checkNavigation();
        this.tryAddButton();
      }).observe(document.body, { childList: true, subtree: true });

      // 2. Interval (URL 변경 감지 백업 - SPA 대응)
      setInterval(() => this.checkNavigation(), 1000);
      
      // 초기 실행
      this.checkNavigation();
    }

    checkNavigation() {
      // URL 변경 감지
      if (location.href !== this.lastUrl) {
        this.lastUrl = location.href;
        this.handleNavigation();
      }
      // URL은 그대로인데 내부적으로 비디오 ID만 바뀐 경우 대비
      const currentVideoId = new URLSearchParams(window.location.search).get('v');
      if (currentVideoId && currentVideoId !== this.videoId) {
          this.handleNavigation();
      }
    }

    handleNavigation() {
      const urlParams = new URLSearchParams(window.location.search);
      const newVideoId = urlParams.get('v');

      if (newVideoId && newVideoId !== this.videoId) {
        console.log(`[App] Navigation detected: ${this.videoId} -> ${newVideoId}`);
        
        // 중요: 이전 리소스(플레이어, 소켓, 타이머) 파괴
        this.cleanupPreviousVideo(); 
        
        this.videoId = newVideoId;
        this.isAutoProcessCancelled = false;
        
        // 버튼 추가 시도
        this.tryAddButton();

        // 2초 뒤 자동 처리 타이머 시작 (페이지 로딩 안정화 대기)
        setTimeout(() => this.startAutoProcessTimer(), 2000);
      }
    }

    cleanupPreviousVideo() {
      console.log('[App] Cleaning up previous video resources...');
      
      // 1. 타이머 제거
      if (this.autoProcessTimer) clearTimeout(this.autoProcessTimer);
      if (this.countdownInterval) clearInterval(this.countdownInterval);
      
      // 2. 플레이어 인스턴스 제거
      if (this.player) {
        this.player.destroy();
        this.player = null;
      }
      
      // 3. 가사 엔진 및 DOM 제거
      const overlay = document.getElementById('aiplugs-lyrics-overlay');
      if (overlay) overlay.remove();
      this.lyricsEngine = null;

      // 4. UI 패널 제거 (설정창, 플레이어 UI, 카운트다운)
      document.getElementById('yt-sep-setup-panel')?.remove();
      document.getElementById('yt-custom-player-ui')?.remove();
      this.hideCountdownUI();

      // 5. 소켓 연결 해제
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
        .yt-sep-countdown { 
            position: fixed; top: 80px; right: 20px; 
            background: rgba(33, 33, 33, 0.95); border: 1px solid #444;
            padding: 15px; border-radius: 8px; font-size: 13px; z-index: 9999; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: none;
            backdrop-filter: blur(5px);
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

    // --- Timer & Auto Process Logic ---

    startAutoProcessTimer() {
      // 이미 재생 중(플레이어 UI 존재)이거나 처리 중이면 자동 실행 패스
      if (this.isProcessing || document.getElementById('yt-custom-player-ui')) return;

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
            this.hideCountdownUI();
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

    // --- Core Processing Logic ---

    startAutoProcess() {
        // 메타데이터 추출 시도
        let meta = { sourceType: 'general' };
        if (window.YoutubeMetaExtractor) {
            meta = window.YoutubeMetaExtractor.getMusicInfo();
        }
        this.processVideo(meta);
    }

    processVideo(meta) {
        if (!this.videoId || this.isProcessing) return;
        this.isProcessing = true;
        
        // UI 버튼이 없다면 추가
        this.tryAddButton();
        // 설정 패널을 '자동 모드'로 열기
        this.openSetupPanel(true);

        // 소켓 연결
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

        // 서버로 작업 요청
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
        console.log('[Complete] Track Separation Finished:', data);
        this.isProcessing = false;
        
        // 설정/진행 패널 닫기
        document.getElementById('yt-sep-setup-panel')?.remove();
        
        // 플레이어 및 가사 모듈 실행
        this.launchModules(data.tracks, data.lyrics_lrc);
    }

    launchModules(tracks, lrcContent) {
        // 1. 가사 모듈 초기화
        this.initLyricsEngine(lrcContent);

        // 2. 오디오 플레이어 초기화
        // 플레이어 인스턴스가 있으면 먼저 파괴 (안전장치)
        if (this.player) this.player.destroy();

        if (window.AiPlugsAudioPlayer) {
            this.player = new window.AiPlugsAudioPlayer(tracks, (currentTime) => {
                // 플레이어 시간 업데이트 시 가사 싱크 맞춤
                if (this.lyricsEngine) {
                    this.lyricsEngine.update(currentTime);
                }
            });
            this.player.init();
        } else {
            console.error('AiPlugsAudioPlayer script not loaded!');
        }
    }

    initLyricsEngine(lrcContent) {
        if (window.AiPlugsLyricsOverlay) {
            // 기존 오버레이 삭제
            let overlay = document.getElementById('aiplugs-lyrics-overlay');
            if (overlay) overlay.remove();

            // 오버레이 컨테이너 생성
            overlay = document.createElement('div');
            overlay.id = 'aiplugs-lyrics-overlay';
            // CSS는 lyrics_overlay.js 또는 global style에서 처리되지만 안전을 위해 기본 스타일 지정
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                z-index: 2147483640; pointer-events: none; overflow: hidden;
            `;
            document.body.appendChild(overlay);

            this.lyricsEngine = new window.AiPlugsLyricsOverlay();
            this.lyricsEngine.init(overlay);
            
            if (lrcContent) {
                this.lyricsEngine.parseLrc(lrcContent);
                console.log('Lyrics loaded into engine');
            }
        }
    }

    // --- UI Helpers ---

    tryAddButton() {
      const controls = document.querySelector('.ytp-right-controls');
      // 이미 버튼이 있으면 패스
      if (controls && !document.getElementById('yt-sep-trigger-btn')) {
        const btn = document.createElement('button');
        btn.id = 'yt-sep-trigger-btn';
        btn.className = 'ytp-button';
        btn.innerHTML = '<span style="font-size:18px;">🎹</span>';
        btn.title = "트랙 분리 스튜디오 열기";
        btn.style.verticalAlign = 'middle';
        
        btn.onclick = (e) => {
            e.stopPropagation();
            // 수동 클릭 시 자동 처리 카운트다운 취소
            this.isAutoProcessCancelled = true;
            this.hideCountdownUI();
            this.openSetupPanel(false);
        };
        
        // 컨트롤 바 가장 앞에 추가
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
        z-index: 9999; width: 320px; border: 1px solid #444; 
        box-shadow: 0 10px 30px rgba(0,0,0,0.8);
      `;
      panel.innerHTML = window.YTSepUITemplates.setupPanelHTML();
      document.body.appendChild(panel);

      // 자동 모드일 경우: 시작 버튼 숨기고 진행 바 표시
      if (isAuto) {
          const pArea = document.getElementById('sep-progress-area');
          const sBtn = document.getElementById('sep-start-btn');
          if(pArea) pArea.style.display = 'block';
          if(sBtn) sBtn.style.display = 'none';
      }

      // 이벤트 바인딩
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

  // 유튜브 페이지 로드 타이밍을 고려하여 약간 지연 후 시작
  setTimeout(() => {
    new YouTubeTrackSeparator();
  }, 2000);
})();