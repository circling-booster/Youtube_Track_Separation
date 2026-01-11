/**
 * Track Player Engine V3.4 (3-Way Separation Logic)
 * - Vocal: Pitch Shift + Formant Preservation (사람 목소리 보호)
 * - Inst (Bass/Other): Pitch Shift Only (악기 질감 유지 - 업계 표준)
 * - Drum: No Shift (Dummy Processor for Latency Sync)
 */
(function (root) {
    class AudioPlayer {
        constructor(tracks, onTimeUpdate) {
            this.tracks = tracks;
            this.onTimeUpdate = onTimeUpdate || (() => { });

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext({ latencyHint: 'playback' });

            this.volumes = { vocal: 35, bass: 100, drum: 100, other: 100 };

            this.resources = {};
            this.activeSourceNodes = [];

            this.mode = 'buffer';
            this._cachedVideo = null;
            this.rafId = null;
            this.container = null;
            this.minimizedIcon = null;

            this.isDragging = false;

            // --- Pitch & Sync Core ---
            this.pitch = 1.0;
            this.currentSemitones = 0;

            // Engine 1: Vocal (피치 + 포먼트 보정)
            this.vocalNode = null;
            this.vocalInput = null;

            // Engine 2: Instrument (피치만 변경, 베이스/기타용)
            this.instNode = null;
            this.instInput = null;

            // Engine 3: Drum (레이턴시 매칭용 더미)
            this.drumNode = null;
            this.drumInput = null;

            this.isRubberbandReady = false;
            this.isSyncing = false;

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
            await this.initPitchShifter();
            await this.loadAllTracks();
            this.updateLoop();
        }

        async initPitchShifter() {
            try {
                const workletUrl = chrome.runtime.getURL('rubberband-processor.js');
                await this.audioContext.audioWorklet.addModule(workletUrl);

                const createEngine = (name) => {
                    const node = new AudioWorkletNode(this.audioContext, 'rubberband-processor', {
                        processorOptions: {
                            highQuality: true,
                            channels: 2
                        }
                    });
                    node.onprocessorerror = (err) => console.error(`[Player] ${name} Worklet Error:`, err);
                    const input = this.audioContext.createGain();
                    input.connect(node);
                    node.connect(this.audioContext.destination);
                    
                    // 초기화 메시지 (피치 1.0, 포먼트 1.0)
                    node.port.postMessage({ type: 'pitch', value: 1.0 });
                    node.port.postMessage({ type: 'formant', value: 1.0 });
                    
                    return { node, input };
                };

                // 1. 보컬 엔진
                const vocal = createEngine('Vocal');
                this.vocalNode = vocal.node;
                this.vocalInput = vocal.input;

                // 2. 악기 엔진 (베이스, Other)
                const inst = createEngine('Inst');
                this.instNode = inst.node;
                this.instInput = inst.input;

                // 3. 드럼 엔진 (더미)
                const drum = createEngine('Drum');
                this.drumNode = drum.node;
                this.drumInput = drum.input;

                this.isRubberbandReady = true;
                console.log("[Player] Triple Engine Ready (Vocal/Inst/Drum Separated)");

            } catch (e) {
                console.warn('[Player] Rubberband failed:', e);
                this.isRubberbandReady = false;
            }
        }

        // --- Smart Sync Logic (Modified for 3-Way) ---
        performSmartSync(semitones) {
            if (!this.isRubberbandReady || this.isSyncing) return;

            this.isSyncing = true;
            this.currentSemitones = semitones;

            this.updateStatusText(`Key Changing... ${semitones > 0 ? '+' : ''}${semitones}`);
            this.setGlobalVolume(0, 0.1); // Fade Out

            setTimeout(() => {
                const ratio = Math.pow(2, semitones / 12.0);
                this.pitch = ratio;

                // 1. Vocal: 피치 변경 + 포먼트 보존 (목소리 변조 방지)
                // Formant Scale = 1.0 / ratio
                const formantScale = 1.0 / ratio;
                try {
                    this.vocalNode.port.postMessage({ type: 'pitch', value: ratio });
                    this.vocalNode.port.postMessage({ type: 'formant', value: formantScale });
                } catch (e) { }

                // 2. Inst: 피치 변경 + 포먼트 유지 (자연스러운 악기 소리)
                // Formant Scale = 1.0 (그대로)
                try {
                    this.instNode.port.postMessage({ type: 'pitch', value: ratio });
                    this.instNode.port.postMessage({ type: 'formant', value: 1.0 });
                } catch (e) { }

                // 3. Drum: 변경 없음 (피치 1.0, 포먼트 1.0) - 레이턴시만 맞춤

                // 강제 Seek (버퍼 플러시 및 동기화)
                if (this.videoElement) {
                    this.checkModeAndPlay(this.videoElement, true);
                }

                setTimeout(() => {
                    this.setGlobalVolume(1, 0.2); // Fade In
                    this.updateStatusText("Ready");
                    this.isSyncing = false;
                }, 150);

            }, 50);
        }

        setGlobalVolume(targetGain, rampTime) {
            const now = this.audioContext.currentTime;
            this.activeSourceNodes.forEach(node => {
                const originalVol = this.volumes[node.name] / 100;
                try {
                    node.gainNode.gain.cancelScheduledValues(now);
                    node.gainNode.gain.linearRampToValueAtTime(originalVol * targetGain, now + rampTime);
                } catch (e) { }
            });
        }

        updateStatusText(text) {
            const statusEl = document.getElementById('cp-status');
            if (statusEl) statusEl.textContent = text;
        }

        attachFullscreenListener() {
            document.addEventListener('fullscreenchange', this.handleFullscreenChange);
        }

        handleFullscreenChange() {
            if (!this.container) return;
            const isFullscreen = !!document.fullscreenElement;
            if (isFullscreen) {
                this.container.classList.add('fs-mode');
            } else {
                this.container.classList.remove('fs-mode');
                this.container.classList.remove('hide-peripherals');
            }
        }

        async loadAllTracks() {
            this.updateStatusText('트랙 로딩 중...');
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
            this.updateStatusText('Ready');

            if (this.videoElement && !this.videoElement.paused) {
                this.checkModeAndPlay(this.videoElement);
            }
        }

        hijackAudio(videoEl) {
            if (!videoEl || videoEl._isHijacked) return;
            try {
                const source = this.audioContext.createMediaElementSource(videoEl);
                videoEl._isHijacked = true;
            } catch (e) { }
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
            if (this.isSyncing) return;

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
            const isNormalSpeed = (rate === 1.0);
            const newMode = isNormalSpeed ? 'buffer' : 'element';
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

                const gainNode = this.audioContext.createGain();
                gainNode.gain.value = this.volumes[name] / 100;
                source.connect(gainNode);

                // [3-Way Routing Logic]
                if (this.isRubberbandReady) {
                    if (name === 'vocal') {
                        // 1. 보컬 -> Vocal Engine (피치 + 포먼트)
                        gainNode.connect(this.vocalInput);
                    } else if (name === 'drum') {
                        // 2. 드럼 -> Drum Engine (Bypass)
                        gainNode.connect(this.drumInput);
                    } else {
                        // 3. 베이스/기타 등 -> Inst Engine (피치만, 포먼트 X)
                        gainNode.connect(this.instInput);
                    }
                } else {
                    gainNode.connect(this.audioContext.destination);
                }

                source.start(0, startTime);
                this.activeSourceNodes.push({ source, gainNode, name });
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
                if (p !== undefined) p.catch(() => { });
            });
        }

        stopAll() {
            this.activeSourceNodes.forEach(node => {
                try { node.source.stop(); } catch (e) { }
            });
            this.activeSourceNodes = [];
            Object.values(this.resources).forEach(res => res.element.pause());
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
                    if (currText) currText.textContent = this.formatTime(v.currentTime);
                    const totalText = document.getElementById('cp-total-time');
                    if (totalText) totalText.textContent = this.formatTime(total);
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
                if (document.fullscreenElement) this.container.classList.add('fs-mode');
            }

            this.createMinimizedIcon();

            document.getElementById('cp-close-btn').onclick = () => this.destroy();
            document.getElementById('cp-minimize-btn').onclick = () => this.toggleMinimize(true);
            document.getElementById('cp-play-btn').onclick = () => {
                const v = this.videoElement;
                if (v) v.paused ? v.play() : v.pause();
            };

            const settingsBtn = document.getElementById('cp-settings-toggle-btn');
            const settingsPanel = document.getElementById('cp-settings-panel');
            const settingsClose = document.getElementById('cp-settings-close');

            if (settingsBtn && settingsPanel) {
                settingsBtn.onclick = () => {
                    const isVisible = settingsPanel.style.display !== 'none';
                    settingsPanel.style.display = isVisible ? 'none' : 'flex';
                };
                if (settingsClose) settingsClose.onclick = () => settingsPanel.style.display = 'none';
            }

            // Pitch Control (UI)
            const pitchSlider = document.getElementById('cp-pitch-slider');
            const pitchVal = document.getElementById('cp-pitch-val');
            const btnDown = document.getElementById('cp-pitch-down');
            const btnUp = document.getElementById('cp-pitch-up');

            const updatePitchUI = (val) => {
                if (val < -6) val = -6;
                if (val > 6) val = 6;
                pitchSlider.value = val;
                pitchVal.textContent = val > 0 ? `+${val}` : val;
                pitchVal.style.color = val === 0 ? '#fff' : '#3ea6ff';
                this.performSmartSync(val);
            };

            if (btnDown && btnUp) {
                btnDown.onclick = (e) => { e.stopPropagation(); updatePitchUI(parseInt(pitchSlider.value) - 1); };
                btnUp.onclick = (e) => { e.stopPropagation(); updatePitchUI(parseInt(pitchSlider.value) + 1); };
            }

            const opacitySlider = document.getElementById('cp-opacity-slider');
            if (opacitySlider) opacitySlider.oninput = (e) => this.container.style.opacity = e.target.value;

            const progress = document.getElementById('cp-progress');
            progress.onmousedown = () => { this.isDragging = true; };
            progress.onmouseup = () => { this.isDragging = false; };
            progress.oninput = () => { this.isDragging = true; };
            progress.onchange = () => {
                this.isDragging = false;
                if (this.videoElement) this.videoElement.currentTime = (progress.value / 100) * this.videoElement.duration;
            };

            const toggleBtn = document.getElementById('cp-toggle-ui-btn');
            if (toggleBtn) {
                toggleBtn.onclick = () => {
                    this.container.classList.toggle('hide-peripherals');
                    toggleBtn.style.opacity = this.container.classList.contains('hide-peripherals') ? '0.5' : '1.0';
                };
            }

            this.container.querySelectorAll('input[data-track]').forEach(input => {
                input.oninput = (e) => {
                    const track = e.target.dataset.track;
                    const val = parseInt(e.target.value);
                    this.volumes[track] = val;
                    this.activeSourceNodes.forEach(s => {
                        if (s.name === track) s.gainNode.gain.value = val / 100;
                    });
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
                transition: transform 0.2s;
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
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.stopAll();
            Object.values(this.resources).forEach(res => URL.revokeObjectURL(res.blobUrl));
            if (this.audioContext) this.audioContext.close();
            if (this.container) this.container.remove();
            if (this.minimizedIcon) this.minimizedIcon.remove();
            
            // 연결 해제
            if (this.vocalNode) this.vocalNode.disconnect();
            if (this.instNode) this.instNode.disconnect();
            if (this.drumNode) this.drumNode.disconnect();
            
            this._cachedVideo = null;
        }
    }
    root.AiPlugsAudioPlayer = AudioPlayer;
})(typeof window !== 'undefined' ? window : globalThis);