/**
 * Hybrid Track Player Engine
 * - 기본 (1.0배속): AudioBuffer 모드 (정밀 싱크, 빠른 반응)
 * - 배속 (변속): HTMLAudioElement 모드 (피치 보존)
 * - [Fix] 볼륨 조절 실시간 동기화
 * - [New] 몰입 모드 (UI 토글) 지원
 */
(function(root) {
    class AudioPlayer {
        constructor(tracks, onTimeUpdate) {
            this.tracks = tracks;
            this.onTimeUpdate = onTimeUpdate || (() => {});
            
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            this.volumes = { vocal: 35, bass: 100, drum: 100, other: 100 };
            
            this.resources = {};
            this.activeSourceNodes = [];
            
            this.mode = 'buffer'; 
            this._cachedVideo = null;
            this.rafId = null;
            this.container = null;
            this.minimizedIcon = null;

            this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
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
            this.attachFullscreenListener();
            await this.loadAllTracks();
            this.updateLoop();
        }

        attachFullscreenListener() {
            document.addEventListener('fullscreenchange', this.handleFullscreenChange);
            document.addEventListener('webkitfullscreenchange', this.handleFullscreenChange);
        }

        handleFullscreenChange() {
            if (!this.container) return;
            const isFullscreen = !!document.fullscreenElement || !!document.webkitFullscreenElement;
            
            if (isFullscreen) {
                this.container.classList.add('fs-mode');
            } else {
                this.container.classList.remove('fs-mode');
                // 전체화면 나가면 숨김 모드 해제 (선택사항, UX상 이게 자연스러움)
                this.container.classList.remove('hide-peripherals');
            }
        }

        async loadAllTracks() {
            const statusEl = document.getElementById('cp-status');
            if (statusEl) statusEl.textContent = '리소스 로딩 중...';
            
            const promises = Object.entries(this.tracks).map(async ([name, info]) => {
                try {
                    const res = await fetch(`http://localhost:5010${info.path}`, {
                        headers: { 'ngrok-skip-browser-warning': 'true' }
                    });
                    const blob = await res.blob();
                    
                    const arrayBuffer = await blob.arrayBuffer();
                    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

                    const blobUrl = URL.createObjectURL(blob);
                    const audioEl = new Audio(blobUrl);
                    audioEl.preservesPitch = true;
                    audioEl.crossOrigin = "anonymous";
                    
                    const elSource = this.audioContext.createMediaElementSource(audioEl);
                    const elGain = this.audioContext.createGain();
                    elSource.connect(elGain);
                    elGain.connect(this.audioContext.destination);
                    elGain.gain.value = 0; 

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
            
            if (this.videoElement && !this.videoElement.paused) {
                this.checkModeAndPlay(this.videoElement);
            }
        }

        hijackAudio(videoEl) {
            if (!videoEl || videoEl._isHijacked) return;
            try {
                const source = this.audioContext.createMediaElementSource(videoEl);
                videoEl._isHijacked = true;
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
                    this.checkModeAndPlay(v, true); 
                    break;
            }
            
            const btn = document.getElementById('cp-play-btn');
            if (btn) btn.innerHTML = v.paused ? '▶' : '⏸';
        }

        checkModeAndPlay(v, forceRestart = false) {
            const rate = v.playbackRate;
            const newMode = (rate === 1.0) ? 'buffer' : 'element';
            const modeChanged = (this.mode !== newMode);

            if (forceRestart || modeChanged) {
                this.stopAll();
                this.mode = newMode;
            }

            if (this.mode === 'buffer') {
                this.playBufferMode(v.currentTime);
            } else {
                this.playElementMode(v.currentTime, rate);
            }
        }

        playBufferMode(startTime) {
            if (this.activeSourceNodes.length > 0) return;

            Object.entries(this.resources).forEach(([name, res]) => {
                const source = this.audioContext.createBufferSource();
                source.buffer = res.buffer;
                
                const gain = this.audioContext.createGain();
                gain.gain.value = this.volumes[name] / 100;
                
                source.connect(gain);
                gain.connect(this.audioContext.destination);
                
                source.start(0, startTime);
                
                this.activeSourceNodes.push({ source, gain, name });
                
                res.element.pause();
            });
        }

        playElementMode(startTime, rate) {
            Object.entries(this.resources).forEach(([name, res]) => {
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
            this.activeSourceNodes.forEach(node => {
                try { node.source.stop(); } catch(e) {}
            });
            this.activeSourceNodes = [];

            Object.values(this.resources).forEach(res => {
                res.element.pause();
            });
        }

        updateLoop() {
            if (this.audioContext.state === 'closed') return;
            const v = this.videoElement;
            if (v) {
                this.onTimeUpdate(v.currentTime);
                
                if (this.mode === 'element' && !v.paused) {
                    Object.values(this.resources).forEach(res => {
                        if (Math.abs(res.element.currentTime - v.currentTime) > 0.3) {
                            res.element.currentTime = v.currentTime;
                        }
                    });
                }

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
            
            if (!this.container) {
                this.container = document.createElement('div');
                this.container.id = 'yt-custom-player-ui';
                this.container.innerHTML = window.YTSepUITemplates.customPlayerHTML(['vocal', 'bass', 'drum', 'other']);
                document.body.appendChild(this.container);
                
                if (document.fullscreenElement) {
                    this.container.classList.add('fs-mode');
                }
            }

            this.createMinimizedIcon();

            // 이벤트 바인딩
            document.getElementById('cp-close-btn').onclick = () => this.destroy();
            document.getElementById('cp-minimize-btn').onclick = () => this.toggleMinimize(true);
            document.getElementById('cp-play-btn').onclick = () => {
                const v = this.videoElement;
                if(v) v.paused ? v.play() : v.pause();
            };

            // [추가] UI 토글 버튼 이벤트
            const toggleBtn = document.getElementById('cp-toggle-ui-btn');
            if (toggleBtn) {
                toggleBtn.onclick = () => {
                    this.container.classList.toggle('hide-peripherals');
                    // 아이콘 변경 (선택 사항)
                    const isHidden = this.container.classList.contains('hide-peripherals');
                    toggleBtn.innerHTML = isHidden ? '🔳' : '👁️'; 
                    toggleBtn.style.opacity = isHidden ? '0.5' : '1.0';
                };
            }
            
            const progress = document.getElementById('cp-progress');
            progress.oninput = () => this.isDragging = true;
            progress.onchange = () => {
                this.isDragging = false;
                if(this.videoElement) this.videoElement.currentTime = (progress.value / 100) * this.videoElement.duration;
            };

            const opacitySlider = document.getElementById('cp-opacity-slider');
            if(opacitySlider) opacitySlider.oninput = (e) => this.container.style.opacity = e.target.value;

            this.container.querySelectorAll('input[data-track]').forEach(input => {
                input.oninput = (e) => {
                    const track = e.target.dataset.track;
                    const val = parseInt(e.target.value);
                    this.volumes[track] = val;
                    
                    this.activeSourceNodes.forEach(node => {
                        if (node.name === track) {
                            node.gain.gain.value = val / 100;
                        }
                    });

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
            document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);

            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.stopAll();
            
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