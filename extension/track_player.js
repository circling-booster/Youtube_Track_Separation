/**
 * Hybrid Track Player Engine V2.3 (Format Fixed)
 * - Fixed: Message format for Rubberband AudioWorklet (Object -> Array)
 * - Rubberband JS를 이용한 고품질 피치 시프팅
 * - 드럼 트랙 바이패스 및 지연 보상(Latency Compensation) 포함
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

            // UI 상태
            this.hideTimer = null;
            this.isHoveringUI = false;
            this.isDragging = false; 
            this.resetAutoHide = this.resetAutoHide.bind(this);

            // 피치 & 싱크 관련
            this.pitch = 1.0; 
            this.pitchNode = null;        // Rubberband AudioWorkletNode
            this.pitchGroupInput = null;  // 피치 적용 그룹 (Vocal+Bass+Other)
            this.drumDelayNode = null;    // 드럼 싱크 보정용
            this.isRubberbandReady = false;
            
            // Rubberband Latency 보정값 (초 단위, 약 50~100ms)
            this.baseLatency = 0.05; 

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
            this.setupAutoHide();
            this.attachFullscreenListener();
            
            // 1. Rubberband Worklet 로드
            await this.initPitchShifter();
            
            // 2. 오디오 트랙 다운로드 및 디코딩
            await this.loadAllTracks();
            
            // 3. 루프 시작
            this.updateLoop();
        }

        async initPitchShifter() {
            try {
                // manifest.json에 등록된 경로 사용
                const workletUrl = chrome.runtime.getURL('rubberband-processor.js');
                
                // AudioWorklet 모듈 추가
                await this.audioContext.audioWorklet.addModule(workletUrl);
                
                // 노드 생성 ('rubberband-processor'는 라이브러리 내부 등록 이름)
                this.pitchNode = new AudioWorkletNode(this.audioContext, 'rubberband-processor');
                
                // 에러 핸들링
                this.pitchNode.onprocessorerror = (err) => {
                    console.error('[Player] Rubberband Worklet Error:', err);
                };

                // 피치 그룹 (Vocal, Bass, Other가 여기로 모임 -> 피치 변경됨)
                this.pitchGroupInput = this.audioContext.createGain();
                this.pitchGroupInput.connect(this.pitchNode);
                this.pitchNode.connect(this.audioContext.destination);

                // 드럼 싱크용 딜레이 (최대 1초 버퍼)
                this.drumDelayNode = this.audioContext.createDelay(1.0);
                this.drumDelayNode.delayTime.value = 0; // 초기값 (피치 1.0일 때 0)
                this.drumDelayNode.connect(this.audioContext.destination);

                this.isRubberbandReady = true;
                console.log('[Player] Rubberband AudioWorklet loaded successfully');

                // 초기 설정 (피치 1.0)
                this.updatePitch(0);

            } catch (e) {
                console.warn('[Player] Rubberband load failed. Pitch shifting will be disabled.', e);
                this.isRubberbandReady = false;
            }
        }

        // 피치 업데이트 (semitones: -5 ~ 5)
        updatePitch(semitones) {
            if (!this.isRubberbandReady || !this.pitchNode) return;

            // 1. 피치 비율 계산 (2^(n/12))
            const ratio = Math.pow(2, semitones / 12.0);
            this.pitch = ratio;

            // 2. 메시지 전송 (★수정됨: 배열 포맷 ["pitch", value] 사용★)
            // rubberband-processor.js 내부: var g=JSON.parse(I.data), C=g[0], Q=g[1];
            const payload = ["pitch", ratio];
            
            try {
                this.pitchNode.port.postMessage(JSON.stringify(payload));
            } catch (e) {
                console.error('[Player] Failed to send pitch command:', e);
            }

            // 3. 드럼 딜레이 보정 (Latency Compensation)
            // 피치 변환이 켜지면(0이 아니면) Rubberband 내부 버퍼링으로 인한 지연이 발생하므로
            // 바이패스되는 드럼 트랙에도 동일한 지연을 줍니다.
            if (semitones !== 0) {
                this.drumDelayNode.delayTime.value = this.baseLatency; 
            } else {
                this.drumDelayNode.delayTime.value = 0; 
            }
        }

        setupAutoHide() {
            if (this.container) {
                this.container.addEventListener('mouseenter', () => { this.isHoveringUI = true; this.resetAutoHide(); });
                this.container.addEventListener('mouseleave', () => { this.isHoveringUI = false; this.resetAutoHide(); });
            }
            document.addEventListener('mousemove', this.resetAutoHide);
            document.addEventListener('click', this.resetAutoHide);
            document.addEventListener('keydown', this.resetAutoHide);
            this.resetAutoHide();
        }

        resetAutoHide() {
            if (!this.container) return;
            this.container.classList.remove('ui-idle');
            if (this.hideTimer) clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
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
            if (statusEl) statusEl.textContent = '트랙 로딩 중...';
            
            const promises = Object.entries(this.tracks).map(async ([name, info]) => {
                try {
                    const res = await fetch(`http://localhost:5010${info.path}`, {
                        headers: { 'ngrok-skip-browser-warning': 'true' }
                    });
                    const blob = await res.blob();
                    const arrayBuffer = await blob.arrayBuffer();
                    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

                    // HTMLAudioElement 생성 (1.0배속 아닐 때 및 폴백용)
                    const blobUrl = URL.createObjectURL(blob);
                    const audioEl = new Audio(blobUrl);
                    audioEl.preservesPitch = true; 
                    audioEl.crossOrigin = "anonymous";
                    
                    const elSource = this.audioContext.createMediaElementSource(audioEl);
                    const elGain = this.audioContext.createGain();
                    elSource.connect(elGain);
                    // Element 모드는 기본적으로 Destination으로 바로 연결 (피치 조절 불가)
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
            // 1.0배속일 때만 Buffer 모드(피치 조절 가능) 사용
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
                // 배속 재생 시에는 피치 조절 기능을 끕니다 (Element 모드 사용)
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

                // *** 오디오 라우팅 핵심 ***
                if (this.isRubberbandReady) {
                    if (name === 'drum') {
                        // 드럼: Rubberband 우회 -> DelayNode (싱크 보정)
                        gain.connect(this.drumDelayNode); 
                    } else {
                        // 보컬, 베이스, 기타: Pitch Group -> Rubberband Worklet
                        gain.connect(this.pitchGroupInput);
                    }
                } else {
                    // Rubberband 실패 시 직결
                    gain.connect(this.audioContext.destination);
                }
                
                source.start(0, startTime);
                
                this.activeSourceNodes.push({ source, gain, name });
                
                res.element.pause(); // HTML5 오디오는 중지
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
                if (document.fullscreenElement) this.container.classList.add('fs-mode');
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
            
            // [NEW] Pitch Slider Binding
            const pitchSlider = document.getElementById('cp-pitch-slider');
            const pitchVal = document.getElementById('cp-pitch-val');
            if (pitchSlider) {
                pitchSlider.oninput = (e) => {
                    this.resetAutoHide();
                    const semitones = parseInt(e.target.value);
                    pitchVal.textContent = semitones > 0 ? `+${semitones}` : semitones;
                    this.updatePitch(semitones);
                };
            }

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

            // Volume Binding
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
            
            // ScriptProcessor 해제
            if (this.pitchNode) {
                this.pitchNode.disconnect();
                // AudioWorkletNode는 명시적 destroy 없음, 연결 해제로 충분
            }
            
            this._cachedVideo = null;
        }
    }
    root.AiPlugsAudioPlayer = AudioPlayer;
})(typeof window !== 'undefined' ? window : globalThis);