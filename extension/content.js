/**
 * YouTube에서 메타데이터 추출
 * sourceType: 'official' (음악 선반 존재) 또는 'general'
 */

function getMusicInfo() {
  // "음악" 선반이 존재하는지 확인 (공식 음원 판단)
  const shelves = Array.from(
    document.querySelectorAll('ytd-horizontal-card-list-renderer')
  );

  const musicShelf = shelves.find(shelf => {
    const titleEl = shelf.querySelector(
      'ytd-rich-list-header-renderer #title'
    );
    return titleEl && titleEl.textContent.trim() === '음악';
  });

  let sourceType = 'general';
  let artist = null;
  let title = null;
  let album = null;

  if (musicShelf) {
    // 공식 음원: 음악 선반에서 메타데이터 추출
    sourceType = 'official';
    const card = musicShelf.querySelector('yt-video-attribute-view-model');

    if (card) {
      const titleEl = card.querySelector(
        '.yt-video-attribute-view-model__title'
      );
      const artistEl = card.querySelector(
        '.yt-video-attribute-view-model__subtitle span'
      );
      const albumEl = card.querySelector(
        '.yt-video-attribute-view-model__secondary-subtitle a'
      );

      title = titleEl ? titleEl.textContent.trim() : null;
      artist = artistEl ? artistEl.textContent.trim() : null;
      album = albumEl ? albumEl.textContent.trim() : null;
    }
  }

  // sourceType가 general이면 YouTube 제목에서 추출 시도
  if (sourceType === 'general') {
    // h1.title yt-formatted-string에서 전체 제목 추출
    const titleElement = document.querySelector('h1.title yt-formatted-string');
    if (titleElement) {
      title = titleElement.textContent.trim();
    }
  }

  return {
    sourceType: sourceType,
    artist: artist,
    title: title,
    album: album
  };
}

// 모듈 export 또는 전역 함수로 제공
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getMusicInfo };
}

/**
 * YouTube Track Separator - 통합 클라이언트
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
      .yt-sep-countdown { 
        position: fixed; top: 20px; right: 20px; 
        background: rgba(58, 158, 255, 0.9); 
        padding: 12px 16px; 
        border-radius: 8px; font-size: 14px; z-index: 9998; display: none;
      }
      .yt-sep-countdown.active { display: block; }
      .yt-sep-countdown-btn { 
        padding: 4px 12px; margin: 0 4px; background: white; color: #000; 
        border: none; border-radius: 4px; cursor: pointer; font-size: 12px;
      }
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
    this.tracks = {};
    if (this.socket) this.socket.disconnect();
    this.socket = null;
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

  updateCountdownDisplay() {
    const timeDisplay = document.getElementById('yt-sep-countdown-time');
    if (timeDisplay) timeDisplay.textContent = `${this.autoProcessCountdown}초 후 자동 처리`;
  }

  showCountdownUI() {
    let el = document.getElementById('yt-sep-countdown');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yt-sep-countdown';
      el.className = 'yt-sep-countdown active';
      el.innerHTML = `
        <div style="margin-bottom:8px"><span id="yt-sep-countdown-time">10초 후 자동 처리</span></div>
        <button class="yt-sep-countdown-btn" id="yt-sep-cancel">취소</button>
        <button class="yt-sep-countdown-btn" id="yt-sep-now">지금 실행</button>
      `;
      document.body.appendChild(el);
      
      document.getElementById('yt-sep-cancel').onclick = () => {
        this.isAutoProcessCancelled = true;
        this.cleanupPreviousVideo(); // 타이머 등 정리
        console.log('[App] 자동 처리 취소됨');
      };
      document.getElementById('yt-sep-now').onclick = () => {
        this.cleanupPreviousVideo(); // 타이머 정리
        this.startAutoProcess();
      };
    } else {
      el.classList.add('active');
    }
  }

  hideCountdownUI() {
    const el = document.getElementById('yt-sep-countdown');
    if (el) el.classList.remove('active');
  }

  startAutoProcess() {
    const musicInfo = typeof getMusicInfo === 'function' ? getMusicInfo() : { sourceType: 'general' };
    console.log('[App] 메타데이터:', musicInfo);
    this.processVideo(musicInfo);
  }

  processVideo(meta) {
    if (!this.videoId || this.isProcessing) return;
    this.isProcessing = true;
    this.tryAddButton(); // 버튼 확보

    // UI 패널 열기 (진행상황 표시용)
    if (window.YTSepUITemplates?.setupPanelHTML) {
        // 이미 있으면 제거 후 재생성
        const oldPanel = document.getElementById('yt-sep-setup-panel');
        if (oldPanel) oldPanel.remove();
        
        const panel = document.createElement('div');
        panel.id = 'yt-sep-setup-panel';
        panel.className = 'yt-sep-ui';
        panel.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #212121; padding: 25px; border-radius: 12px; z-index: 9999; width: 320px; border: 1px solid #333;`;
        panel.innerHTML = window.YTSepUITemplates.setupPanelHTML();
        document.body.appendChild(panel);
        document.getElementById('sep-progress-area').style.display = 'block';
        document.getElementById('sep-start-btn').style.display = 'none'; // 자동 시작이므로 버튼 숨김
    }

    if (!this.socket) {
      this.socket = io(this.serverUrl, { transports: ['websocket'] });
      this.socket.on('progress', data => this.handleProgress(data));
      this.socket.on('completed', data => this.handleComplete(data));
      this.socket.on('error', data => {
        alert('오류: ' + data.message);
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
    
    // 플레이어 실행
    this.customPlayer = new CustomAudioPlayer(this.tracks);
    
    // 가사(LRC)가 있다면 오버레이 실행 (추후 구현 가능, 현재는 데이터 수신만 확인)
    if (data.lyrics_lrc) {
        console.log("LRC 데이터 수신됨 (가사 기능 활성화 가능)");
        // 여기에 LyricsEngine 연동 코드를 추가할 수 있음
    }
  }

  tryAddButton() {
    const controls = document.querySelector('.ytp-right-controls');
    if (controls && !document.getElementById('yt-sep-trigger-btn')) {
      const btn = document.createElement('button');
      btn.id = 'yt-sep-trigger-btn';
      btn.className = 'ytp-button';
      btn.innerHTML = '🎹';
      btn.onclick = (e) => {
        e.stopPropagation();
        this.isAutoProcessCancelled = true; // 수동 조작 시 자동 취소
        this.hideCountdownUI();
        // 수동 패널 열기 로직...
        this.startAutoProcess(); // 편의상 바로 시작으로 연결
      };
      controls.insertBefore(btn, controls.firstChild);
    }
  }
}

/**
 * CustomAudioPlayer (기존 코드 복구 및 필수 기능 포함)
 */
class CustomAudioPlayer {
  constructor(tracks) {
    this.tracks = tracks;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.volumes = { vocal: 100, bass: 100, drum: 100, other: 100 };
    this.audioBuffers = {};
    this.activeSources = [];
    this.init();
  }

  async init() {
    this.createUI();
    const promises = Object.entries(this.tracks).map(async ([name, info]) => {
      try {
          const res = await fetch(`http://localhost:5010${info.path}`);
          const buf = await res.arrayBuffer();
          this.audioBuffers[name] = await this.audioContext.decodeAudioData(buf);
      } catch(e) { console.error(e); }
    });
    await Promise.all(promises);
    
    const v = document.querySelector('video');
    if(v) {
        this.hijackAudio(v);
        v.addEventListener('play', () => this.play(v.currentTime));
        v.addEventListener('pause', () => this.stop());
        v.addEventListener('seeked', () => { if(!v.paused) this.play(v.currentTime); });
        if(!v.paused) this.play(v.currentTime);
    }
  }

  hijackAudio(videoEl) {
      if(!videoEl._hijacked) {
          try {
            const src = this.audioContext.createMediaElementSource(videoEl);
            // destination 연결 안함 -> 음소거
            videoEl._hijacked = true;
          } catch(e) {}
      }
  }

  play(time) {
    if(this.audioContext.state === 'suspended') this.audioContext.resume();
    this.stop();
    Object.entries(this.audioBuffers).forEach(([name, buf]) => {
      const src = this.audioContext.createBufferSource();
      src.buffer = buf;
      const gain = this.audioContext.createGain();
      gain.gain.value = this.volumes[name] / 100;
      src.connect(gain).connect(this.audioContext.destination);
      src.start(0, time);
      this.activeSources.push({src, gain, name});
    });
  }

  stop() {
    this.activeSources.forEach(s => { try{s.src.stop()}catch(e){} });
    this.activeSources = [];
  }

  createUI() {
     if (!window.YTSepUITemplates?.customPlayerHTML) return;
     const div = document.createElement('div');
     div.id = 'yt-custom-player-ui';
     div.className = 'yt-sep-ui';
     div.style.cssText = `position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); width: 600px; background: rgba(0,0,0,0.8); padding: 20px; border-radius: 10px; z-index: 99999;`;
     div.innerHTML = window.YTSepUITemplates.customPlayerHTML(['vocal','bass','drum','other']);
     document.body.appendChild(div);
     
     // 이벤트 바인딩 간소화
     document.getElementById('cp-close-btn').onclick = () => this.destroy();
     div.querySelectorAll('input[type=range]').forEach(input => {
         if(input.dataset.track) {
             input.oninput = (e) => {
                 this.volumes[e.target.dataset.track] = e.target.value;
                 this.activeSources.forEach(s => {
                     if(s.name === e.target.dataset.track) s.gain.gain.value = e.target.value / 100;
                 });
             };
         }
     });
  }

  destroy() {
    this.stop();
    document.getElementById('yt-custom-player-ui')?.remove();
  }
}

new YouTubeTrackSeparator();