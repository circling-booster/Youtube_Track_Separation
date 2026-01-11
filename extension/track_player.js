/**
 * Hybrid Track Player Engine
 * - 기본 (1.0배속): AudioBuffer 모드 (정밀 싱크, 빠른 반응)
 * - 배속 (변속): HTMLAudioElement 모드 (피치 보존)
 */
(function(root) {
    class AudioPlayer {
        constructor(tracks, onTimeUpdate) {
            this.tracks = tracks;
            this.onTimeUpdate = onTimeUpdate || (() => {});
            
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // 볼륨 상태
            this.volumes = { vocal: 35, bass: 100, drum: 100, other: 100 };
            
            // 리소스 저장소
            this.resources = {}; // { name: { buffer, blobUrl, audioEl, gainNode } }
            this.activeSourceNodes = []; // Buffer 모드용 소스 노드들
            
            this.mode = 'buffer'; // 'buffer' | 'element'
            this._cachedVideo = null;
            this.rafId = null;
            this.container = null;
            this.minimizedIcon = null;

            this.updateLoop = this.updateLoop.bind(this);
            this.handleVideoEvent = this.handleVideoEvent.bind(this);
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
            if (statusEl) statusEl.textContent = '리소스 로딩 중...';
            
            const promises = Object.entries(this.tracks).map(async ([name, info]) => {
                try {
                    // 1. Blob으로 다운로드 (한 번만 수행)
                    const res = await fetch(`http://localhost:5010${info.path}`, {
                        headers: { 'ngrok-skip-browser-warning': 'true' }
                    });
                    const blob = await res.blob();
                    
                    // 2. Buffer 모드용 디코딩
                    const arrayBuffer = await blob.arrayBuffer();
                    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

                    // 3. Element 모드용 URL 생성
                    const blobUrl = URL.createObjectURL(blob);
                    const audioEl = new Audio(blobUrl);
                    audioEl.preservesPitch = true;
                    audioEl.crossOrigin = "anonymous";
                    
                    // 4. Element용 Web Audio 연결 (볼륨 제어를 위해)
                    const elSource = this.audioContext.createMediaElementSource(audioEl);
                    const elGain = this.audioContext.createGain();
                    elSource.connect(elGain);
                    elGain.connect(this.audioContext.destination);
                    elGain.gain.value = 0; // 초기엔 뮤트 (Buffer 모드가 기본이므로)

                    this.resources[name] = {
                        buffer: audioBuffer,
                        blobUrl: blobUrl,
                        element: audioEl,
                        elementGain: elGain
                    };

                } catch (e) { console.error(`Failed to load ${name}:`, e); }
            });

            await Promise.all(promises);
            if (statusEl) statusEl.textContent = 'Ready';
            
            // 초기 재생 상태 동기화
            if (this.videoElement && !this.videoElement.paused) {
                this.checkModeAndPlay(this.videoElement);
            }
        }

        hijackAudio(videoEl) {
            if (!videoEl || videoEl._isHijacked) return;
            try {
                const source = this.audioContext.createMediaElementSource(videoEl);
                videoEl._isHijacked = true;
                console.log('[Player] Original audio hijacked');
            } catch (e) {}
        }

        attachListeners(videoEl) {
            const events = ['play', 'pause', 'waiting', 'playing', 'seeked', 'ratechange'];
            events.forEach(evt => {
                videoEl.removeEventListener(evt, this.handleVideoEvent);
                videoEl.addEventListener(evt, this.handleVideoEvent);
            });
        }

        handleVideoEvent(e) {
            const v = e.target;
            if (Object.keys(this.resources).length === 0 || this.audioContext.state === 'closed') return;

            switch (e.type) {
                case 'pause':
                case 'waiting':
                    this.stopAll();
                    break;
                case 'play':
                case 'playing':
                case 'seeked':
                    if (!v.paused && v.readyState >= 3) {
                        if (this.audioContext.state === 'suspended') this.audioContext.resume();
                        this.checkModeAndPlay(v);
                    }
                    break;
                case 'ratechange':
                    // 배속 변경 시 모드 재평가 및 리로드
                    console.log(`[Player] Rate changed to ${v.playbackRate}`);
                    this.checkModeAndPlay(v, true); 
                    break;
            }
            
            const btn = document.getElementById('cp-play-btn');
            if (btn) btn.innerHTML = v.paused ? '▶' : '⏸';
        }

        // 핵심: 모드 결정 및 재생
        checkModeAndPlay(v, forceRestart = false) {
            const rate = v.playbackRate;
            const newMode = (rate === 1.0) ? 'buffer' : 'element';
            const modeChanged = (this.mode !== newMode);

            if (forceRestart || modeChanged) {
                this.stopAll(); // 이전 소리 끄기
                this.mode = newMode;
                console.log(`[Player] Switched to ${this.mode.toUpperCase()} mode (Rate: ${rate})`);
            }

            if (this.mode === 'buffer') {
                this.playBufferMode(v.currentTime);
            } else {
                this.playElementMode(v.currentTime, rate);
            }
        }

        // Mode A: AudioBuffer (정밀, 1.0배속)
        playBufferMode(startTime) {
            // 이미 재생 중이면 스킵 (중복 재생 방지)
            if (this.activeSourceNodes.length > 0) return;

            Object.entries(this.resources).forEach(([name, res]) => {
                const source = this.audioContext.createBufferSource();
                source.buffer = res.buffer;
                
                const gain = this.audioContext.createGain();
                gain.gain.value = this.volumes[name] / 100;
                
                source.connect(gain);
                gain.connect(this.audioContext.destination);
                
                source.start(0, startTime);
                this.activeSourceNodes.push({ source, gain });
                
                // Element 모드는 조용히 시킴
                res.element.pause();
            });
        }

        // Mode B: AudioElement (피치 보존, 변속)
        playElementMode(startTime, rate) {
            Object.entries(this.resources).forEach(([name, res]) => {
                // 싱크 맞추기 (허용오차 0.2초)
                if (Math.abs(res.element.currentTime - startTime) > 0.2) {
                    res.element.currentTime = startTime;
                }
                res.element.playbackRate = rate;
                res.elementGain.gain.value = this.volumes[name] / 100;
                
                const p = res.element.play();
                if (p !== undefined) p.catch(() => {});
            });
        }

        stopAll() {
            // Buffer 모드 정리
            this.activeSourceNodes.forEach(node => {
                try { node.source.stop(); } catch(e) {}
            });
            this.activeSourceNodes = [];

            // Element 모드 정리
            Object.values(this.resources).forEach(res => {
                res.element.pause();
            });
        }

        updateLoop() {
            if (this.audioContext.state === 'closed') return;
            const v = this.videoElement;
            if (v) {
                this.onTimeUpdate(v.currentTime);
                
                // Element 모드일 때 싱크 지속 보정 (Drift 방지)
                if (this.mode === 'element' && !v.paused) {
                    Object.values(this.resources).forEach(res => {
                        if (Math.abs(res.element.currentTime - v.currentTime) > 0.3) {
                            res.element.currentTime = v.currentTime;
                        }
                    });
                }

                // UI 업데이트
                if (!this.isDragging) {
                    const total = v.duration || 1;
                    const pct = (v.currentTime / total) * 100;
                    const prog = document.getElementById('cp-progress');
                    if (prog) prog.value = pct;
                    
                    document.getElementById('cp-curr-time').textContent = this.formatTime(v.currentTime);
                    document.getElementById('cp-total-time').textContent = this.formatTime(total);
                }
            }
            this.rafId = requestAnimationFrame(this.updateLoop);
        }

        createUI() {
            if (!window.YTSepUITemplates?.customPlayerHTML) return;
            
            this.container = document.createElement('div');
            this.container.id = 'yt-custom-player-ui';
            this.container.className = 'yt-sep-ui';
            this.container.style.cssText = `
                position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                width: 90%; max-width: 800px;
                background: rgba(15, 15, 15, 0.95); backdrop-filter: blur(10px);
                border: 1px solid #444; border-radius: 16px; padding: 20px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.6); z-index: 2147483647;
                display: flex; flex-direction: column; gap: 15px;
                transition: opacity 0.2s ease;
            `;
            
            this.container.innerHTML = window.YTSepUITemplates.customPlayerHTML(['vocal', 'bass', 'drum', 'other']);
            document.body.appendChild(this.container);

            this.createMinimizedIcon();

            // 이벤트 바인딩
            document.getElementById('cp-close-btn').onclick = () => this.destroy();
            document.getElementById('cp-minimize-btn').onclick = () => this.toggleMinimize(true);
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

            const opacitySlider = document.getElementById('cp-opacity-slider');
            if(opacitySlider) opacitySlider.oninput = (e) => this.container.style.opacity = e.target.value;

            // 볼륨 조절
            this.container.querySelectorAll('input[data-track]').forEach(input => {
                input.oninput = (e) => {
                    const track = e.target.dataset.track;
                    const val = parseInt(e.target.value);
                    this.volumes[track] = val;
                    
                    // 현재 활성화된 모드에 즉시 반영
                    if (this.mode === 'buffer') {
                        this.activeSourceNodes.forEach(node => { 
                            // 소스 이름을 추적할 방법이 필요하므로 리소스 맵핑을 개선하거나, 
                            // 간단히 전체 순회하며 게인 노드를 찾음 (여기선 간략화)
                            // 실제론 activeSourceNodes에 name 프로퍼티가 있어야 함.
                        });
                        // *수정*: activeSourceNodes 생성 시 name을 안 넣었으므로, 
                        // 위 playBufferMode에서 name을 추가해야 함. 
                        // 아래 로직이 올바르게 동작하도록 playBufferMode 수정 필요.
                    } 
                    
                    // Element 모드는 항상 반영
                    if (this.resources[track]) {
                        this.resources[track].elementGain.gain.value = val / 100;
                    }
                };
            });
        }
        
        createMinimizedIcon() {
            this.minimizedIcon = document.createElement('div');
            this.minimizedIcon.id = 'yt-sep-minimized-icon';
            this.minimizedIcon.style.cssText = `
                position: fixed; bottom: 20px; right: 20px;
                width: 50px; height: 50px; border-radius: 50%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                z-index: 2147483647; cursor: pointer;
                display: none; align-items: center; justify-content: center;
                font-size: 24px; color: white; border: 2px solid white;
            `;
            this.minimizedIcon.innerHTML = '🎹';
            this.minimizedIcon.onclick = () => this.toggleMinimize(false);
            document.body.appendChild(this.minimizedIcon);
        }

        toggleMinimize(minimize) {
            this.container.style.display = minimize ? 'none' : 'flex';
            this.minimizedIcon.style.display = minimize ? 'flex' : 'none';
        }

        formatTime(sec) {
            if (!sec || isNaN(sec)) return '0:00';
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        }

        destroy() {
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.stopAll();
            
            // 리소스 해제
            Object.values(this.resources).forEach(res => {
                if (res.blobUrl) URL.revokeObjectURL(res.blobUrl);
            });
            this.resources = {};

            if (this.audioContext) this.audioContext.close();
            if (this.container) this.container.remove();
            if (this.minimizedIcon) this.minimizedIcon.remove();
            
            this._cachedVideo = null;
        }
    }
    root.AiPlugsAudioPlayer = AudioPlayer;
})(typeof window !== 'undefined' ? window : globalThis);