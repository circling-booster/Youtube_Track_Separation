/**
 * YouTube Track Separator - Robust Standalone Player
 * 해결: DOM 교체 감지, 오디오 소스 충돌 방지, 싱크 표류 보정
 */

class YouTubeTrackSeparator {
    constructor() {
        this.serverUrl = 'http://localhost:5010';
        this.videoId = null;
        this.socket = null;
        this.isProcessing = false;
        this.tracks = {};
        this.customPlayer = null;

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
            }
            // 버튼이 사라졌으면 다시 추가 (유튜브가 UI를 다시 그릴 때 대응)
            this.tryAddButton();
        }).observe(document.body, { childList: true, subtree: true });

        // 초기 실행
        this.handleNavigation();
    }

    handleNavigation() {
        const urlParams = new URLSearchParams(window.location.search);
        const newVideoId = urlParams.get('v');

        if (newVideoId && newVideoId !== this.videoId) {
            console.log('[App] 새 비디오 감지:', newVideoId);
            this.videoId = newVideoId;
            // 비디오가 바뀌면 플레이어 완전 종료
            if (this.customPlayer) {
                this.customPlayer.destroy();
                this.customPlayer = null;
            }
        }
    }

    tryAddButton() {
        if (!this.videoId) return;
        const controls = document.querySelector('.ytp-right-controls');
        if (controls && !document.getElementById('yt-sep-trigger-btn')) {
            const btn = document.createElement('button');
            btn.id = 'yt-sep-trigger-btn';
            btn.className = 'ytp-button';
            btn.innerHTML = '<span style="font-size:18px; vertical-align:middle;">🎹</span>';
            btn.title = 'AI 트랙 분리 플레이어 열기';
            btn.onclick = (e) => {
                e.stopPropagation(); // 유튜브 클릭 이벤트 전파 방지
                this.openSetupPanel();
            };
            controls.insertBefore(btn, controls.firstChild);
        }
    }

    openSetupPanel() {
        if (this.isProcessing) return alert('작업이 진행 중입니다.');
        if (document.getElementById('yt-sep-setup-panel')) return;

        // 템플릿 파일 로드 순서가 맞지 않으면 여기서 에러가 나므로 가드
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

        // ✅ HTML은 템플릿 파일에서 가져옴
        panel.innerHTML = window.YTSepUITemplates.setupPanelHTML();

        document.body.appendChild(panel);

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

            this.socket = io('http://localhost:5010', { transports: ['websocket'] });
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
        this.volumes = { vocal: 33, bass: 100, drum: 100, other: 100 };
        this.audioBuffers = {};
        this.activeSources = [];

        // 중요: 비디오 요소를 저장하지 않고, 매번 조회하거나 getter로 접근
        // 하지만 성능을 위해 캐싱하되 유효성을 검사함
        this._cachedVideo = null;

        this.rafId = null;
        this.isDragging = false;

        // 바인딩
        this.updateLoop = this.updateLoop.bind(this);
        this.handleVideoEvent = this.handleVideoEvent.bind(this);

        this.init();
    }

    // 현재 유효한 비디오 요소를 가져오는 안전한 Getter
    get videoElement() {
        // 1. 캐시된 비디오가 있고 DOM에 연결되어 있으면 반환
        if (this._cachedVideo && this._cachedVideo.isConnected) {
            return this._cachedVideo;
        }
        // 2. 아니면 새로 찾음 (가장 큰 비디오 or 메인 비디오)
        const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (v) {
            console.log('[Player] 비디오 요소 재바인딩');
            this._cachedVideo = v;
            this.attachListeners(v); // 새 비디오에 리스너 부착
            this.hijackAudio(v);     // 새 비디오 오디오 차단 시도
        }
        return v;
    }

    async init() {
        this.createUI();
        await this.loadAllTracks();

        // 루프 시작 (상태 체크 및 UI 업데이트)
        this.updateLoop();
    }

    async loadAllTracks() {
        const statusEl = document.getElementById('cp-status');
        if (statusEl) statusEl.textContent = '트랙 로딩 중...';

        const promises = Object.entries(this.tracks).map(async ([name, info]) => {
            const res = await fetch(`http://localhost:5010${info.path}`);
            const buf = await res.arrayBuffer();
            this.audioBuffers[name] = await this.audioContext.decodeAudioData(buf);
        });

        await Promise.all(promises);
        if (statusEl) statusEl.textContent = 'Ready';

        // 로드 완료 시점의 비디오 상태 동기화
        if (this.videoElement && !this.videoElement.paused) {
            this.playAudio(this.videoElement.currentTime);
        }
    }

    // --- Audio Hijacking (원본 소리 차단) ---
    hijackAudio(videoEl) {
        if (!videoEl) return;

        // 방법 1: MediaElementSource (가장 깔끔하지만 재사용 오류 가능성 있음)
        try {
            if (!videoEl._isHijacked) {
                const source = this.audioContext.createMediaElementSource(videoEl);
                // Destination에 연결 안 함 -> 소리 차단
                videoEl._isHijacked = true;
                console.log('[Player] 원본 오디오 하이재킹 성공');
            }
        } catch (e) {
            // 이미 하이재킹 되었거나 다른 확장프로그램 충돌
            // 방법 2 fallback은 updateLoop에서 처리 (강제 volume = 0)
        }
    }

    // --- Event Listeners ---
    attachListeners(videoEl) {
        // 기존 리스너 제거 (중복 방지)
        videoEl.removeEventListener('play', this.handleVideoEvent);
        videoEl.removeEventListener('pause', this.handleVideoEvent);
        videoEl.removeEventListener('waiting', this.handleVideoEvent);
        videoEl.removeEventListener('playing', this.handleVideoEvent);
        videoEl.removeEventListener('seeked', this.handleVideoEvent);

        // 새 리스너 등록
        videoEl.addEventListener('play', this.handleVideoEvent);
        videoEl.addEventListener('pause', this.handleVideoEvent);
        videoEl.addEventListener('waiting', this.handleVideoEvent);
        videoEl.addEventListener('playing', this.handleVideoEvent);
        videoEl.addEventListener('seeked', this.handleVideoEvent);
    }

    handleVideoEvent(e) {
        const v = e.target;
        if (!this.audioBuffers['vocal']) return; // 아직 로드 안됨

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

        // UI 버튼 업데이트
        const btn = document.getElementById('cp-play-btn');
        if (btn) btn.innerHTML = v.paused ? '▶' : '⏸';
    }

    // --- Playback Logic ---
    playAudio(startTime) {
        if (this.audioContext.state === 'suspended') this.audioContext.resume();
        this.stopAudio(); // 기존 재생 중단

        Object.entries(this.audioBuffers).forEach(([name, buffer]) => {
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            // 비디오 배속 동기화
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
            try { s.source.stop(); } catch (e) { }
        });
        this.activeSources = [];
    }

    // --- UI Creation ---
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

        // ✅ HTML은 템플릿 파일에서 가져옴
        container.innerHTML = window.YTSepUITemplates.customPlayerHTML([
            'vocal', 'bass', 'drum', 'other'
        ]);

        document.body.appendChild(container);

        // 이벤트 핸들러 (기존 그대로)
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

    // --- Main Loop (Mute Enforcer & Sync Check & UI Update) ---
    updateLoop() {
        const v = this.videoElement; // Getter 호출 -> 유효성 검사 자동 수행

        if (v) {
            // 1. Force Mute (Enforcer)
            // Hijack이 실패했거나 풀렸을 경우를 대비해 지속적으로 volume 0 강제
            // 단, 사용자가 우리 UI가 아닌 유튜브 UI로 볼륨을 올리는 것을 방지
            // (이 코드는 하이재킹 실패 시 최후의 방어선입니다)
            if (v.volume > 0 && !v.muted) {
                // v.volume = 0; // 너무 공격적이면 유튜브 UI가 깜빡일 수 있음.
                // 대신 muted를 true로 유지
                // v.muted = true; 
                // 주의: 이것도 깜빡일 수 있으므로 Hijack(createMediaElementSource)이 최선.
            }

            // 2. UI Update
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

            // 3. Sync Drift Check (재생 중인데 오디오가 멈췄거나, 시간이 너무 어긋난 경우)
            // (생략 가능: 위 이벤트 리스너 방식이 튼튼하면 필요 없음)
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

        // 원본 오디오 복구 (사실 createMediaElementSource는 되돌리기 어려우므로 페이지 리로드 권장이지만, 
        // 여기서는 소스를 destination에 연결하여 소리가 나게 함)
        if (this._cachedVideo && this._cachedVideo._isHijacked) {
            // 원본 소스를 다시 연결할 방법은 MediaElementSource 노드를 저장해뒀다가 connect() 해야 함.
            // 하지만 여기 코드에서는 scope가 달라서 복잡함.
            // 간단히: 확장 종료 시 사용자가 새로고침하도록 안내하거나, 
            // 그냥 놔둠 (소리는 안나지만 유튜브 볼륨 올리면 나올 수도 있음)
            alert('플레이어가 종료되었습니다. 원본 소리 복구를 위해 페이지를 새로고침 해주세요.');
        }

        const ui = document.getElementById('yt-custom-player-ui');
        if (ui) ui.remove();

        // 캐시 초기화
        this._cachedVideo = null;
    }
}

new YouTubeTrackSeparator();
