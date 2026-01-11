/**
 * Hybrid Track Player Engine
 * - 기본 (1.0배속): AudioBuffer 모드
 * - 배속 (변속): HTMLAudioElement 모드
 * - [New] 자동 숨김(Auto-Hide) 기능 추가
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

            // Auto-Hide 관련
            this.hideTimer = null;
            this.isHoveringUI = false;
            this.isDragging = false; // 슬라이더 조작 상태
            this.resetAutoHide = this.resetAutoHide.bind(this);

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
            this.setupAutoHide(); // 자동 숨김 로직 초기화
            this.attachFullscreenListener();
            await this.loadAllTracks();
            this.updateLoop();
        }

        // [New] 자동 숨김 설정
        setupAutoHide() {
            // UI 영역 호버 감지
            if (this.container) {
                this.container.addEventListener('mouseenter', () => { this.isHoveringUI = true; this.resetAutoHide(); });
                this.container.addEventListener('mouseleave', () => { this.isHoveringUI = false; this.resetAutoHide(); });
            }

            // 전역 활동 감지
            document.addEventListener('mousemove', this.resetAutoHide);
            document.addEventListener('click', this.resetAutoHide);
            document.addEventListener('keydown', this.resetAutoHide);

            this.resetAutoHide();
        }

        // [New] 타이머 리셋
        resetAutoHide() {
            if (!this.container) return;

            // UI 표시 (idle 클래스 제거)
            this.container.classList.remove('ui-idle');

            if (this.hideTimer) clearTimeout(this.hideTimer);

            // 3초 후 숨김 시도
            this.hideTimer = setTimeout(() => {
                // 마우스가 UI 위에 있거나 슬라이더 드래그 중이면 숨기지 않음
                if (!this.isHoveringUI && !this.isDragging) {
                    this.container.classList.add('ui-idle');
                }
            }, 3000);
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
            
            if (!this.container) {
                this.container = document.createElement('div');
                this.container.id = 'yt-custom-player-ui';
                this.container.className = 'yt-sep-ui';
                this.container.innerHTML = window.YTSepUITemplates.customPlayerHTML(['vocal', 'bass', 'drum', 'other']);
                document.body.appendChild(this.container);
                
                if (document.fullscreenElement) {
                    this.container.classList.add('fs-mode');
                }
            }

            this.createMinimizedIcon();

            // === Event Bindings ===
            document.getElementById('cp-close-btn').onclick = () => this.destroy();
            document.getElementById('cp-minimize-btn').onclick = () => this.toggleMinimize(true);
            document.getElementById('cp-play-btn').onclick = () => {
                const v = this.videoElement;
                if(v) v.paused ? v.play() : v.pause();
            };

            const opacitySlider = document.getElementById('cp-opacity-slider');
            if(opacitySlider) opacitySlider.oninput = (e) => this.container.style.opacity = e.target.value;
            
            const progress = document.getElementById('cp-progress');
            progress.onmousedown = () => { this.isDragging = true; this.resetAutoHide(); };
            progress.onmouseup = () => { this.isDragging = false; this.resetAutoHide(); };
            progress.oninput = () => { this.isDragging = true; this.resetAutoHide(); };
            progress.onchange = () => {
                this.isDragging = false;
                if(this.videoElement) this.videoElement.currentTime = (progress.value / 100) * this.videoElement.duration;
            };

            const toggleBtn = document.getElementById('cp-toggle-ui-btn');
            if (toggleBtn) {
                toggleBtn.onclick = () => {
                    this.container.classList.toggle('hide-peripherals');
                    const isHidden = this.container.classList.contains('hide-peripherals');
                    toggleBtn.innerHTML = isHidden ? '🔳' : '👁️'; 
                    toggleBtn.style.opacity = isHidden ? '0.5' : '1.0';
                };
            }

            const lyricsBtn = document.getElementById('cp-lyrics-toggle-btn');
            const lyricsPanel = document.getElementById('cp-lyrics-panel');
            const lyricsClose = document.getElementById('cp-lyrics-close');

            if (lyricsBtn && lyricsPanel) {
                lyricsBtn.onclick = () => {
                    const isHidden = lyricsPanel.style.display === 'none';
                    lyricsPanel.style.display = isHidden ? 'block' : 'none';
                    lyricsBtn.style.background = isHidden ? '#3ea6ff' : 'transparent';
                    lyricsBtn.style.color = isHidden ? 'black' : 'white';
                    this.resetAutoHide();
                };
                if (lyricsClose) {
                    lyricsClose.onclick = () => {
                        lyricsPanel.style.display = 'none';
                        lyricsBtn.style.background = 'transparent';
                        lyricsBtn.style.color = 'white';
                    };
                }
            }

            this.container.querySelectorAll('input[data-track]').forEach(input => {
                input.onmousedown = () => { this.isDragging = true; };
                input.onmouseup = () => { this.isDragging = false; };
                input.oninput = (e) => {
                    this.resetAutoHide();
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
            // 이벤트 제거
            document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);
            document.removeEventListener('mousemove', this.resetAutoHide);
            document.removeEventListener('click', this.resetAutoHide);
            document.removeEventListener('keydown', this.resetAutoHide);
            if (this.hideTimer) clearTimeout(this.hideTimer);

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