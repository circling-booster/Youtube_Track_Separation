/**
 * YouTube 메타데이터 및 소스 유형 추출
 * - Official: '음악' 섹션이 있는 공식 음원 (가사 크롤링 시도)
 * - General: 일반 영상 (자막 다운로드 시도)
 */

function getMusicInfo() {
  // "음악" 선반(Shelf) 존재 여부 확인
  const shelves = Array.from(
    document.querySelectorAll('ytd-horizontal-card-list-renderer')
  );

  const musicShelf = shelves.find(shelf => {
    const titleEl = shelf.querySelector('ytd-rich-list-header-renderer #title');
    return titleEl && titleEl.textContent.trim() === '음악';
  });

  let sourceType = 'general';
  let artist = null;
  let title = null;
  let album = null;

  if (musicShelf) {
    // 공식 음원: 메타데이터 상세 추출
    sourceType = 'official';
    const card = musicShelf.querySelector('yt-video-attribute-view-model');

    if (card) {
      const titleEl = card.querySelector('.yt-video-attribute-view-model__title');
      const artistEl = card.querySelector('.yt-video-attribute-view-model__subtitle span');
      const albumEl = card.querySelector('.yt-video-attribute-view-model__secondary-subtitle a');

      title = titleEl ? titleEl.textContent.trim() : null;
      artist = artistEl ? artistEl.textContent.trim() : null;
      album = albumEl ? albumEl.textContent.trim() : null;
    }
  }

  // 일반 영상: 영상 제목을 title로 사용
  if (sourceType === 'general' || !title) {
    const titleElement = document.querySelector('h1.title yt-formatted-string');
    if (titleElement) {
      title = titleElement.textContent.trim();
    }
  }

  console.log(`[ExtractInfo] Source: ${sourceType}, Title: ${title}, Artist: ${artist}`);

  return {
    sourceType: sourceType,
    artist: artist,
    title: title,
    album: album
  };
}

// 모듈 내보내기 (확장 프로그램 환경 고려)
if (typeof module !== 'undefined') {
  module.exports = { getMusicInfo };
} else {
  // 전역 스코프에 주입
  window.YoutubeMetaExtractor = { getMusicInfo };
}

/**
 * YouTube Track Separator - Integrated Client
 * 포함 기능: 자동 처리 타이머, 소켓 통신, 커스텀 플레이어, 가사 엔진(LyricsEngine)
 */

(function () {
  // ==========================================
  // 1. Lyrics Engine (가사 렌더링 및 싱크)
  // ==========================================
  class LyricsEngine {
    constructor(overlayContainer) {
      this.lyrics = [];
      this.container = overlayContainer;
      this.linesBox = null;
      this.domLines = [];
      this.config = {
        baseFontSize: 34,
        activeScale: 1.2,
        syncOffset: 0.0,
        gapThreshold: 2.0,
        anticipation: 1.5
      };
    }

    initHTML() {
      this.container.innerHTML = ''; // 초기화
      this.linesBox = document.createElement('div');
      this.linesBox.className = 'ap-lyrics-box';
      this.container.appendChild(this.linesBox);
      this.injectStyles();
    }

    injectStyles() {
      if (document.getElementById('yt-lyrics-styles')) return;
      const style = document.createElement('style');
      style.id = 'yt-lyrics-styles';
      style.innerHTML = `
        :root { --ap-font-size: ${this.config.baseFontSize}px; --ap-active-scale: ${this.config.activeScale}; }
        .ap-lyrics-box { position: absolute; top: 50%; left: 0; width: 100%; text-align: center; transition: transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94); }
        .ap-line { height: calc(var(--ap-font-size) * 3); display: flex; align-items: center; justify-content: center; font-size: var(--ap-font-size); font-weight: 900; color: rgba(255,255,255,0.4); transition: all 0.2s; white-space: nowrap; -webkit-text-stroke: 1px rgba(0,0,0,0.5); }
        .ap-line.active { color: #ffffff !important; opacity: 1 !important; transform: scale(var(--ap-active-scale)) !important; -webkit-text-stroke: 2px black; text-shadow: 3px 3px 0px #000, 0 0 15px rgba(0, 255, 255, 0.8); z-index: 10; }
        .ap-line.near { opacity: 0.7; color: #ddd; -webkit-text-stroke: 1px black; }
        .ap-dots { position: absolute; top: 15%; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; opacity: 0; }
        .ap-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff3333; box-shadow: 0 0 5px red; }
        .ap-line.show-cnt .ap-dots { opacity: 1; }
      `;
      document.head.appendChild(style);
    }

    parseLrc(lrcContent) {
      if (!lrcContent) return;
      const lines = lrcContent.split('\n');
      const patternFull = /\[(\d+:\d+(?:\.\d+)?)\]\s*<(\d+:\d+(?:\.\d+)?)>\s*(.*)/; // [start] <end> text
      const patternStd = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/; // [mm:ss.xx] text

      let rawLyrics = [];
      lines.forEach(line => {
        line = line.trim();
        if (!line) return;
        let startT = 0, endT = null, text = "", matched = false;

        let mFull = line.match(patternFull);
        if (mFull) {
          startT = this.parseTime(mFull[1]);
          endT = this.parseTime(mFull[2]);
          text = mFull[3].trim();
          matched = true;
        } else {
          let mStd = line.match(patternStd);
          if (mStd) {
            startT = parseInt(mStd[1]) * 60 + parseInt(mStd[2]) + (parseFloat("0." + (mStd[3] || "0")));
            text = mStd[4].trim();
            matched = true;
          }
        }
        if (matched && text) rawLyrics.push({ time: startT, endTime: endT, text: text });
      });

      rawLyrics.sort((a, b) => a.time - b.time);
      
      // 종료 시간 보정
      for (let i = 0; i < rawLyrics.length; i++) {
        if (rawLyrics[i].endTime === null) {
          rawLyrics[i].endTime = (i < rawLyrics.length - 1) ? rawLyrics[i + 1].time : rawLyrics[i].time + 5.0;
        }
      }
      this.lyrics = rawLyrics;
      this.calculateGaps();
      this.renderDOM();
    }

    parseTime(timeStr) {
      const parts = timeStr.split(':');
      return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }

    calculateGaps() {
      for (let i = 0; i < this.lyrics.length; i++) {
        this.lyrics[i].needsCountdown = false;
        let gap = (i === 0) ? this.lyrics[i].time : (this.lyrics[i].time - this.lyrics[i-1].endTime);
        if (gap >= this.config.gapThreshold) this.lyrics[i].needsCountdown = true;
      }
    }

    renderDOM() {
      this.linesBox.innerHTML = '';
      this.domLines = [];
      this.lyrics.forEach(line => {
        const div = document.createElement('div');
        div.className = 'ap-line';
        div.innerHTML = `<span>${line.text}</span>`;
        if (line.needsCountdown) {
          div.innerHTML += `<div class="ap-dots"><div class="ap-dot"></div><div class="ap-dot"></div><div class="ap-dot"></div></div>`;
        }
        this.linesBox.appendChild(div);
        this.domLines.push(div);
      });
    }

    update(currentTime) {
      if (!this.lyrics.length) return;
      const time = currentTime + this.config.syncOffset;
      
      // 현재 인덱스 찾기
      let idx = -1;
      for (let i = 0; i < this.lyrics.length; i++) {
        if (time >= this.lyrics[i].time) idx = i;
        else break;
      }

      // 스크롤 처리
      const lineHeight = this.config.baseFontSize * 3;
      this.linesBox.style.transform = `translateY(${-idx * lineHeight}px)`;

      // 스타일 업데이트
      this.domLines.forEach((div, i) => {
        div.classList.remove('active', 'near', 'show-cnt');
        
        // 카운트다운
        if (i > idx && this.lyrics[i].needsCountdown) {
          const remain = this.lyrics[i].time - time;
          if (remain > 0 && remain <= this.config.anticipation) {
            div.classList.add('show-cnt');
            const dots = div.querySelectorAll('.ap-dot');
            dots.forEach((d, di) => {
              const th = (3 - di) * (this.config.anticipation / 3.0);
              d.style.opacity = (remain <= th) ? 1 : 0.2;
            });
          }
        }

        if (i === idx) {
          div.classList.add('active');
        } else if (Math.abs(i - idx) <= 2) {
          div.classList.add('near');
          div.style.transform = 'scale(0.9)';
        } else {
          div.style.transform = 'scale(0.8)';
          div.style.opacity = 0.1;
        }
      });
    }
  }

  // ==========================================
  // 2. Main Application Class
  // ==========================================
  class YouTubeTrackSeparator {
    constructor() {
      this.serverUrl = 'http://localhost:5010/';
      this.videoId = null;
      this.socket = null;
      this.isProcessing = false;
      this.tracks = {};
      this.customPlayer = null;
      this.lyricsEngine = null;

      // 자동 처리 관련
      this.autoProcessTimer = null;
      this.autoProcessCountdown = 10;
      this.isAutoProcessCancelled = false;
      this.countdownInterval = null;

      this.init();
    }

    init() {
      console.log('[App] 초기화 시작');
      this.injectGlobalStyles();
      this.startUrlObserver();
    }

    injectGlobalStyles() {
      if (document.getElementById('yt-sep-styles')) return;
      const style = document.createElement('style');
      style.id = 'yt-sep-styles';
      style.textContent = `
        .yt-sep-ui { font-family: Roboto, Arial, sans-serif; color: white; }
        .yt-sep-countdown { position: fixed; top: 20px; right: 20px; background: rgba(58, 158, 255, 0.95); padding: 15px; border-radius: 12px; font-size: 14px; z-index: 9998; display: none; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
        .yt-sep-countdown.active { display: block; animation: fadeIn 0.3s; }
        .yt-sep-countdown-btn { padding: 6px 14px; margin: 5px 4px 0 0; background: white; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px; }
        .yt-sep-countdown-btn:hover { background: #f0f0f0; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
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
        console.log('[App] 새 비디오 감지:', newVideoId);
        this.cleanupPreviousVideo();
        this.videoId = newVideoId;
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
      
      // 오버레이 제거
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

    startAutoProcessTimer() {
      this.showCountdownUI();
      this.autoProcessCountdown = 10;
      this.updateCountdownDisplay();

      this.countdownInterval = setInterval(() => {
        this.autoProcessCountdown--;
        this.updateCountdownDisplay();
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
        el.className = 'yt-sep-countdown active';
        el.innerHTML = `
          <div style="margin-bottom:8px; font-weight:bold;">⚡ 자동 트랙 분리 대기중</div>
          <div id="yt-sep-countdown-time" style="margin-bottom:8px;">10초 후 시작</div>
          <button class="yt-sep-countdown-btn" id="yt-sep-cancel">취소</button>
          <button class="yt-sep-countdown-btn" id="yt-sep-now">지금 실행</button>
        `;
        document.body.appendChild(el);
        document.getElementById('yt-sep-cancel').onclick = () => {
          this.isAutoProcessCancelled = true;
          this.hideCountdownUI();
        };
        document.getElementById('yt-sep-now').onclick = () => {
          this.cleanupPreviousVideo();
          this.startAutoProcess();
        };
      } else {
        el.classList.add('active');
      }
    }

    hideCountdownUI() {
      const el = document.getElementById('yt-sep-countdown');
      if (el) el.classList.remove('active');
      if (this.countdownInterval) clearInterval(this.countdownInterval);
    }

    updateCountdownDisplay() {
      const el = document.getElementById('yt-sep-countdown-time');
      if (el) el.textContent = `${this.autoProcessCountdown}초 후 시작`;
    }

    startAutoProcess() {
      // 메타데이터 추출을 위해 extract_info.js의 함수 사용
      let meta = { sourceType: 'general' };
      if (window.YoutubeMetaExtractor && window.YoutubeMetaExtractor.getMusicInfo) {
        meta = window.YoutubeMetaExtractor.getMusicInfo();
      } else if (typeof getMusicInfo === 'function') {
        meta = getMusicInfo();
      }
      this.processVideo(meta);
    }

    processVideo(meta) {
      if (!this.videoId || this.isProcessing) return;
      this.isProcessing = true;
      this.tryAddButton();

      this.openSetupPanel(true); // UI 표시

      if (!this.socket) {
        this.socket = io(this.serverUrl, { transports: ['websocket'] });
        this.socket.on('progress', data => this.handleProgress(data));
        this.socket.on('complete', data => this.handleComplete(data)); // completed -> complete
        this.socket.on('error', data => {
          alert('오류: ' + (data.error || data.message));
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
      if (bar) {
        bar.style.width = data.progress + '%';
        document.getElementById('sep-percent').textContent = Math.round(data.progress) + '%';
        document.getElementById('sep-status-text').textContent = data.message;
      }
    }

    handleComplete(data) {
      console.log('[완료]', data);
      this.tracks = data.tracks;
      this.isProcessing = false;
      document.getElementById('yt-sep-setup-panel')?.remove();
      
      // 플레이어 및 가사 엔진 시작
      this.launchCustomPlayer(data.lyrics_lrc);
    }

    launchCustomPlayer(lrcContent) {
      if (this.customPlayer) this.customPlayer.destroy();
      
      // 가사 오버레이 생성
      let overlay = document.getElementById('aiplugs-lyrics-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'aiplugs-lyrics-overlay';
        overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2147483640; pointer-events: none; overflow: hidden;`;
        document.body.appendChild(overlay);
      }
      
      this.lyricsEngine = new LyricsEngine(overlay);
      this.lyricsEngine.initHTML();
      
      if (lrcContent) {
        this.lyricsEngine.parseLrc(lrcContent);
      }

      // 플레이어 실행 시 가사 엔진을 넘겨줌
      this.customPlayer = new CustomAudioPlayer(this.tracks, this.lyricsEngine);
    }

    tryAddButton() {
      const controls = document.querySelector('.ytp-right-controls');
      if (controls && !document.getElementById('yt-sep-trigger-btn')) {
        const btn = document.createElement('button');
        btn.id = 'yt-sep-trigger-btn';
        btn.className = 'ytp-button';
        btn.innerHTML = '<span style="font-size:18px;">🎹</span>';
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
      panel.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #212121; padding: 25px; border-radius: 12px; z-index: 9999; width: 320px; border: 1px solid #444;`;
      panel.innerHTML = window.YTSepUITemplates.setupPanelHTML();
      document.body.appendChild(panel);

      if (isAuto) {
        document.getElementById('sep-progress-area').style.display = 'block';
        document.getElementById('sep-start-btn').style.display = 'none';
      }

      document.getElementById('sep-start-btn').onclick = () => {
        let meta = { sourceType: 'general' };
        if (window.YoutubeMetaExtractor) meta = window.YoutubeMetaExtractor.getMusicInfo();
        this.processVideo(meta);
      };
      document.getElementById('sep-close-btn').onclick = () => panel.remove();
    }
  }

  // ==========================================
  // 3. Custom Audio Player (Robust)
  // ==========================================
  class CustomAudioPlayer {
    constructor(tracks, lyricsEngine) {
      this.tracks = tracks;
      this.lyricsEngine = lyricsEngine;
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
      if (this._cachedVideo && this._cachedVideo.isConnected) return this._cachedVideo;
      const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (v) {
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
        try {
          const res = await fetch(`http://localhost:5010${info.path}`);
          const buf = await res.arrayBuffer();
          this.audioBuffers[name] = await this.audioContext.decodeAudioData(buf);
        } catch(e) { console.error(e); }
      });
      await Promise.all(promises);
      if (statusEl) statusEl.textContent = 'Ready';
      if (this.videoElement && !this.videoElement.paused) this.playAudio(this.videoElement.currentTime);
    }

    hijackAudio(videoEl) {
      if (!videoEl || videoEl._isHijacked) return;
      try {
        const source = this.audioContext.createMediaElementSource(videoEl);
        // Destination에 연결하지 않음 -> 음소거 효과
        videoEl._isHijacked = true;
      } catch (e) { console.warn(e); }
    }

    attachListeners(videoEl) {
      ['play', 'pause', 'waiting', 'playing', 'seeked'].forEach(evt => {
        videoEl.removeEventListener(evt, this.handleVideoEvent);
        videoEl.addEventListener(evt, this.handleVideoEvent);
      });
    }

    handleVideoEvent(e) {
      const v = e.target;
      if (!this.audioBuffers['vocal']) return;
      if (e.type === 'pause' || e.type === 'waiting') this.stopAudio();
      else if (!v.paused && v.readyState >= 3) this.playAudio(v.currentTime);
      
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
        source.connect(gainNode).connect(this.audioContext.destination);
        source.start(0, startTime);
        this.activeSources.push({ source, gainNode, name });
      });
    }

    stopAudio() {
      this.activeSources.forEach(s => { try { s.source.stop(); } catch(e){} });
      this.activeSources = [];
    }

    createUI() {
      if (!window.YTSepUITemplates?.customPlayerHTML) return;
      const container = document.createElement('div');
      container.id = 'yt-custom-player-ui';
      container.className = 'yt-sep-ui';
      container.style.cssText = `position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); width: 90%; max-width: 800px; background: rgba(15, 15, 15, 0.98); backdrop-filter: blur(10px); border: 1px solid #444; border-radius: 16px; padding: 20px; z-index: 2147483647; display: flex; flex-direction: column; gap: 15px;`;
      container.innerHTML = window.YTSepUITemplates.customPlayerHTML(['vocal', 'bass', 'drum', 'other']);
      document.body.appendChild(container);

      document.getElementById('cp-close-btn').onclick = () => this.destroy();
      document.getElementById('cp-play-btn').onclick = () => {
        const v = this.videoElement;
        if(v) v.paused ? v.play() : v.pause();
      };
      
      const progress = document.getElementById('cp-progress');
      progress.oninput = () => this.isDragging = true;
      progress.onchange = () => {
        this.isDragging = false;
        if(this.videoElement) this.videoElement.currentTime = (progress.value / 100) * this.videoElement.duration;
      };

      container.querySelectorAll('input[data-track]').forEach(input => {
        input.oninput = (e) => {
          this.volumes[e.target.dataset.track] = parseInt(e.target.value);
          this.activeSources.forEach(s => {
            if(s.name === e.target.dataset.track) s.gainNode.gain.value = e.target.value / 100;
          });
        };
      });
    }

    updateLoop() {
      const v = this.videoElement;
      if (v) {
        // 가사 업데이트
        if (this.lyricsEngine) this.lyricsEngine.update(v.currentTime);

        if (!this.isDragging) {
          const total = v.duration || 1;
          const pct = (v.currentTime / total) * 100;
          const prog = document.getElementById('cp-progress');
          if (prog) prog.value = pct;
          const currText = document.getElementById('cp-curr-time');
          if (currText) currText.textContent = this.formatTime(v.currentTime);
          const totalText = document.getElementById('cp-total-time');
          if (totalText) totalText.textContent = this.formatTime(total);
        }
      }
      this.rafId = requestAnimationFrame(this.updateLoop);
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
      document.getElementById('yt-custom-player-ui')?.remove();
      this._cachedVideo = null;
    }
  }

  // 앱 시작
  new YouTubeTrackSeparator();
})();