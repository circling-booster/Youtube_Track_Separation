/**
 * Track Player Engine
 * 역할: Web Audio API 관리, 비디오 싱크 동기화, 볼륨 믹싱
 * 의존성: 없음 (가사 로직과 완전 분리)
 */
(function(root) {
    class AudioPlayer {
        /**
         * @param {Object} tracks - { vocal: {path:..}, drum: {path:..}, ... }
         * @param {Function} onTimeUpdate - 매 프레임마다 호출될 콜백 (currentTime) => void
         */
        constructor(tracks, onTimeUpdate) {
            this.tracks = tracks;
            this.onTimeUpdate = onTimeUpdate || (() => {});
            
            // AudioContext 초기화
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            this.volumes = { vocal: 35, bass: 100, drum: 100, other: 100 };
            this.audioBuffers = {};
            this.activeSources = [];
            
            this._cachedVideo = null;
            this.rafId = null;
            this.isDragging = false;
            
            // UI 상태 관리
            this.container = null;
            this.minimizedIcon = null;

            // 바인딩
            this.updateLoop = this.updateLoop.bind(this);
            this.handleVideoEvent = this.handleVideoEvent.bind(this);
        }

        get videoElement() {
            if (this._cachedVideo && this._cachedVideo.isConnected) {
                return this._cachedVideo;
            }
            // YouTube 메인 비디오 요소 찾기
            const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
            if (v) {
                console.log('[Player] Binding to video element');
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
                    // ngrok 헤더 이슈 방지용 옵션
                    const res = await fetch(`http://localhost:5010${info.path}`, {
                        headers: { 'ngrok-skip-browser-warning': 'true' }
                    });
                    const buf = await res.arrayBuffer();
                    this.audioBuffers[name] = await this.audioContext.decodeAudioData(buf);
                } catch (e) {
                    console.error(`Failed to load track ${name}:`, e);
                }
            });

            await Promise.all(promises);
            
            if (statusEl) statusEl.textContent = 'Ready';
            console.log('[Player] All tracks loaded');

            // 이미 재생 중이면 싱크 맞춰 재생
            if (this.videoElement && !this.videoElement.paused) {
                this.playAudio(this.videoElement.currentTime);
            }
        }

        hijackAudio(videoEl) {
            if (!videoEl) return;
            try {
                if (!videoEl._isHijacked) {
                    // 원본 오디오를 Context로 가져오되 destination에 연결하지 않음 (Mute 효과)
                    const source = this.audioContext.createMediaElementSource(videoEl);
                    videoEl._isHijacked = true;
                    console.log('[Player] Original audio hijacked (muted)');
                }
            } catch (e) {
                console.warn('[Player] Hijack warning:', e.message);
            }
        }

        attachListeners(videoEl) {
            const events = ['play', 'pause', 'waiting', 'playing', 'seeked'];
            events.forEach(evt => videoEl.removeEventListener(evt, this.handleVideoEvent));
            events.forEach(evt => videoEl.addEventListener(evt, this.handleVideoEvent));
        }

        handleVideoEvent(e) {
            const v = e.target;
            if (!this.audioBuffers['vocal']) return;

            switch (e.type) {
                case 'pause':
                case 'waiting':
                    this.stopAudio();
                    break;
                case 'play':
                case 'playing':
                case 'seeked':
                    if (!v.paused && v.readyState >= 3) {
                        if (this.audioContext.state === 'suspended') this.audioContext.resume();
                        this.playAudio(v.currentTime);
                    }
                    break;
            }
            
            // UI Play 버튼 상태 업데이트
            const btn = document.getElementById('cp-play-btn');
            if (btn) btn.innerHTML = v.paused ? '▶' : '⏸';
        }

        playAudio(startTime) {
            this.stopAudio();

            Object.entries(this.audioBuffers).forEach(([name, buffer]) => {
                const source = this.audioContext.createBufferSource();
                source.buffer = buffer;
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
                try { s.source.stop(); } catch(e) {}
            });
            this.activeSources = [];
        }

        updateLoop() {
            const v = this.videoElement;
            if (v) {
                // 1. 외부 콜백 실행 (가사 싱크 등)
                this.onTimeUpdate(v.currentTime);

                // 2. UI 슬라이더 업데이트 (드래그 중 아닐 때만)
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
            
            // 메인 플레이어 컨테이너 생성
            this.container = document.createElement('div');
            this.container.id = 'yt-custom-player-ui';
            this.container.className = 'yt-sep-ui';
            this.container.style.cssText = `
                position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                width: 90%; max-width: 800px;
                background: rgba(15, 15, 15, 0.95);
                backdrop-filter: blur(10px);
                border: 1px solid #444; border-radius: 16px; padding: 20px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.6); z-index: 2147483647;
                display: flex; flex-direction: column; gap: 15px;
                transition: opacity 0.2s ease;
            `;
            
            this.container.innerHTML = window.YTSepUITemplates.customPlayerHTML([
                'vocal', 'bass', 'drum', 'other'
            ]);

            document.body.appendChild(this.container);

            // 최소화된 아이콘 생성 (숨김 상태로 시작)
            this.createMinimizedIcon();

            // --- 이벤트 바인딩 ---

            // 1. 닫기 버튼 (완전 종료)
            document.getElementById('cp-close-btn').onclick = () => this.destroy();

            // 2. 최소화 버튼
            document.getElementById('cp-minimize-btn').onclick = () => this.toggleMinimize(true);

            // 3. 투명도 슬라이더
            const opacitySlider = document.getElementById('cp-opacity-slider');
            opacitySlider.oninput = (e) => {
                this.container.style.opacity = e.target.value;
            };

            // 4. 재생/일시정지
            document.getElementById('cp-play-btn').onclick = () => {
                const v = this.videoElement;
                if(v) v.paused ? v.play() : v.pause();
            };

            // 5. 진행바 (Seek)
            const progress = document.getElementById('cp-progress');
            progress.oninput = () => this.isDragging = true;
            progress.onchange = () => {
                this.isDragging = false;
                if(this.videoElement) {
                    this.videoElement.currentTime = (progress.value / 100) * this.videoElement.duration;
                }
            };

            // 6. 볼륨 슬라이더
            this.container.querySelectorAll('input[data-track]').forEach(input => {
                input.oninput = (e) => {
                    const track = e.target.dataset.track;
                    const val = parseInt(e.target.value);
                    this.volumes[track] = val;
                    this.activeSources.forEach(s => {
                        if(s.name === track) s.gainNode.gain.value = val / 100;
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
            this.minimizedIcon.title = '플레이어 열기';
            
            this.minimizedIcon.onclick = () => this.toggleMinimize(false);
            this.minimizedIcon.onmouseover = () => this.minimizedIcon.style.transform = 'scale(1.1)';
            this.minimizedIcon.onmouseout = () => this.minimizedIcon.style.transform = 'scale(1.0)';
            
            document.body.appendChild(this.minimizedIcon);
        }

        toggleMinimize(minimize) {
            if (minimize) {
                this.container.style.display = 'none';
                this.minimizedIcon.style.display = 'flex';
            } else {
                this.container.style.display = 'flex';
                this.minimizedIcon.style.display = 'none';
            }
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
            if (this._cachedVideo && this._cachedVideo._isHijacked) {
                console.log('[Player] Destroyed. Reload to restore original audio context.');
            }
            
            // UI 요소 제거
            if (this.container) this.container.remove();
            if (this.minimizedIcon) this.minimizedIcon.remove();
            
            this._cachedVideo = null;
        }
    }

    // 전역 노출
    root.AiPlugsAudioPlayer = AudioPlayer;

})(typeof window !== 'undefined' ? window : globalThis);