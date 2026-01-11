/**
 * Lyrics Overlay Engine V3.0
 * 변경사항: 표시 모드(문장/단어/글자) 지원, Continuation Flag(^) 처리
 */
(function (root) {
    class LyricsEngine {
        constructor() {
            this.rawLyrics = [];
            this.lyrics = [];
            this.container = null;
            this.lyricsBox = null;
            this.domLines = [];

            this.dragState = { isDragging: false, startX: 0, currentTranslateX: 0, initialTranslateX: 0 };

            this.config = {
                fontFamily: "'Pretendard', sans-serif",
                fontSize: 80,
                activeScale: 2.0,
                syncOffset: -0.5,
                gapThreshold: 2.0,
                anticipation: 3.0,
                // [New] 표시 모드: 'sentence' | 'word' | 'char'
                viewMode: 'sentence' 
            };
        }

        init(overlayContainer) {
            this.container = overlayContainer;
            this.loadWebFonts();
            this.injectStyles();
            this.createDOM();
            this.enableHorizontalDrag();
        }

        loadWebFonts() {
            if (document.getElementById('ap-webfonts')) return;
            const link = document.createElement('link');
            link.id = 'ap-webfonts';
            link.rel = 'stylesheet';
            link.href = "https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Do+Hyeon&family=Gothic+A1&family=Jua&family=Nanum+Gothic&family=Nanum+Pen+Script&family=Noto+Sans+KR&family=Sunflower:wght@300&display=swap";
            document.head.appendChild(link);

            const pretendard = document.createElement('link');
            pretendard.rel = 'stylesheet';
            pretendard.href = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css";
            document.head.appendChild(pretendard);
        }

        injectStyles() {
            if (document.getElementById('aiplugs-lyrics-style')) return;
            const style = document.createElement('style');
            style.id = 'aiplugs-lyrics-style';
            style.innerHTML = `
                :root {
                    --ap-font-family: ${this.config.fontFamily};
                    --ap-font-size: ${this.config.fontSize}px;
                    --ap-active-scale: ${this.config.activeScale};
                }
                .ap-lyrics-box {
                    position: absolute; top: 50%; left: 0; width: 100%; text-align: center;
                    transition: transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94);
                    pointer-events: none; user-select: none;
                }
                .ap-line {
                    height: calc(var(--ap-font-size) * 1.8); min-height: 60px;
                    display: flex; align-items: center; justify-content: center;
                    white-space: nowrap; 
                    font-family: var(--ap-font-family); font-size: var(--ap-font-size); font-weight: 800;
                    color: rgba(255,255,255,0.35); transition: all 0.2s ease-out;
                    -webkit-text-stroke: 1px rgba(0,0,0,0.3); position: relative; pointer-events: none;
                }
                .ap-line span {
                    display: inline-block; padding: 5px 10px; border-radius: 4px; pointer-events: none;
                }
                .ap-line.active {
                    color: #ffffff !important; opacity: 1 !important; z-index: 10;
                    transform: scale(var(--ap-active-scale)) !important;
                    -webkit-text-stroke: 1.5px rgba(0,0,0,0.8);
                    text-shadow: 0 4px 10px rgba(0,0,0,0.5);
                    filter: drop-shadow(0 0 5px rgba(255,255,255,0.3));
                    pointer-events: none; 
                }
                .ap-line.active span {
                    pointer-events: auto; cursor: ew-resize; background: rgba(0, 0, 0, 0.01);
                }
                .ap-line.active span:active { cursor: grabbing; background: rgba(255, 255, 255, 0.1); }
                .ap-line.near { opacity: 0.6; color: #ddd; -webkit-text-stroke: 0.5px black; }
                .ap-dots {
                    position: absolute; top: 0%; left: 50%; transform: translateX(-50%);
                    display: flex; gap: 6px; opacity: 0; transition: opacity 0.2s;
                }
                .ap-dot { width: 6px; height: 6px; border-radius: 50%; background: #ff4444; box-shadow: 0 0 5px red; }
                .ap-line.show-cnt .ap-dots { opacity: 1; }
            `;
            document.head.appendChild(style);
        }

        createDOM() {
            this.container.innerHTML = '';
            this.container.style.transform = 'translateX(0px)';
            this.lyricsBox = document.createElement('div');
            this.lyricsBox.className = 'ap-lyrics-box';
            this.container.appendChild(this.lyricsBox);
        }

        enableHorizontalDrag() {
            if (!this.lyricsBox || !this.container) return;
            const onMouseDown = (e) => {
                if (e.button !== 0) return;
                if (!e.target.closest('.ap-line.active span')) return;
                this.dragState.isDragging = true;
                this.dragState.startX = e.clientX;
                this.dragState.initialTranslateX = this.dragState.currentTranslateX;
                document.body.addEventListener('mousemove', onMouseMove);
                document.body.addEventListener('mouseup', onMouseUp);
                e.preventDefault();
            };
            const onMouseMove = (e) => {
                if (!this.dragState.isDragging) return;
                e.preventDefault();
                const dx = e.clientX - this.dragState.startX;
                this.container.style.transform = `translateX(${this.dragState.initialTranslateX + dx}px)`;
            };
            const onMouseUp = (e) => {
                if (!this.dragState.isDragging) return;
                const dx = e.clientX - this.dragState.startX;
                this.dragState.currentTranslateX = this.dragState.initialTranslateX + dx;
                this.dragState.isDragging = false;
                document.body.removeEventListener('mousemove', onMouseMove);
                document.body.removeEventListener('mouseup', onMouseUp);
            };
            this.lyricsBox.addEventListener('mousedown', onMouseDown);
        }

        bindUI() {
            const fontSel = document.getElementById('ap-cfg-font');
            if (fontSel) {
                fontSel.value = this.config.fontFamily;
                fontSel.onchange = (e) => {
                    this.config.fontFamily = e.target.value;
                    document.documentElement.style.setProperty('--ap-font-family', this.config.fontFamily);
                };
            }
            // [New] 표시 모드 선택 바인딩
            const modeSel = document.getElementById('ap-cfg-mode');
            if (modeSel) {
                modeSel.value = this.config.viewMode;
                modeSel.onchange = (e) => {
                    this.config.viewMode = e.target.value;
                    this.processLyrics(); // 모드 변경 시 즉시 재처리
                };
            }
            const sizeRange = document.getElementById('ap-cfg-size');
            if (sizeRange) {
                sizeRange.value = this.config.fontSize;
                sizeRange.oninput = (e) => {
                    this.config.fontSize = e.target.value;
                    const valSize = document.getElementById('val-size');
                    if(valSize) valSize.textContent = `${e.target.value}px`;
                    document.documentElement.style.setProperty('--ap-font-size', `${e.target.value}px`);
                    this.render();
                };
            }
            const scaleRange = document.getElementById('ap-cfg-scale');
            if (scaleRange) {
                scaleRange.value = this.config.activeScale;
                scaleRange.oninput = (e) => {
                    this.config.activeScale = e.target.value;
                    const valScale = document.getElementById('val-scale');
                    if(valScale) valScale.textContent = `x${e.target.value}`;
                    document.documentElement.style.setProperty('--ap-active-scale', e.target.value);
                };
            }
            const syncInp = document.getElementById('ap-cfg-sync');
            const updateSync = (val) => {
                const newVal = parseFloat(val.toFixed(1));
                this.config.syncOffset = newVal;
                if(syncInp) syncInp.value = newVal;
                const valSync = document.getElementById('val-sync');
                if(valSync) valSync.textContent = `${newVal > 0 ? '+' : ''}${newVal}s`;
            };
            if(syncInp) {
                syncInp.value = this.config.syncOffset;
                syncInp.onchange = (e) => updateSync(parseFloat(e.target.value));
            }
            const btnMinus = document.getElementById('btn-sync-minus');
            if(btnMinus) btnMinus.onclick = () => updateSync(this.config.syncOffset - 0.1);
            const btnPlus = document.getElementById('btn-sync-plus');
            if(btnPlus) btnPlus.onclick = () => updateSync(this.config.syncOffset + 0.1);
        }

        parseTime(timeStr) {
            try {
                const parts = timeStr.split(':');
                return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
            } catch (e) { return 0.0; }
        }

        parseLrc(lrcContent) {
            if (!lrcContent) return;
            const lines = lrcContent.split('\n');
            const patternFull = /\[(\d+:\d+(?:\.\d+)?)\]\s*<(\d+:\d+(?:\.\d+)?)>\s*(.*)/;
            const patternStd = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;

            let parsed = [];
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
                        const mins = parseInt(mStd[1], 10);
                        const secs = parseInt(mStd[2], 10);
                        let ms = mStd[3] ? parseInt(mStd[3], 10) : 0;
                        if (String(mStd[3]).length === 2) ms *= 10;
                        startT = mins * 60 + secs + (ms / 1000.0);
                        text = mStd[4].trim();
                        matched = true;
                    }
                }

                if (matched && text) {
                    // [New] Continuation Marker(^) 처리
                    let isContinuation = false;
                    if (text.startsWith('^')) {
                        isContinuation = true;
                        text = text.substring(1);
                    }
                    parsed.push({ time: startT, endTime: endT, text: text, isContinuation: isContinuation });
                }
            });

            parsed.sort((a, b) => a.time - b.time);
            for (let i = 0; i < parsed.length; i++) {
                if (parsed[i].endTime === null) {
                    if (i < parsed.length - 1) parsed[i].endTime = parsed[i + 1].time;
                    else parsed[i].endTime = parsed[i].time + 3.0;
                }
            }
            this.rawLyrics = parsed;
            this.processLyrics();
        }

        processLyrics() {
            if (!this.rawLyrics.length) return;

            const mode = this.config.viewMode;
            let merged = [];
            let i = 0;

            // [New] 모드별 병합 로직
            while (i < this.rawLyrics.length) {
                let current = { ...this.rawLyrics[i] };
                let j = 1;
                
                while (i + j < this.rawLyrics.length && j < 50) { // 안전 장치 50
                    let nextItem = this.rawLyrics[i + j];
                    let shouldMerge = false;
                    let joinWithSpace = true;

                    // 1. 글자 모드 (Char): 절대 합치지 않음
                    if (mode === 'char') {
                        shouldMerge = false;
                    }
                    // 2. 단어 모드 (Word): 이어지는 글자(^)만 합침
                    else if (mode === 'word') {
                        if (nextItem.isContinuation) {
                            shouldMerge = true;
                            joinWithSpace = false; // 공백 없이 연결
                        }
                    }
                    // 3. 문장 모드 (Sentence - 기본): 이어지는 글자 OR 가까운 시간
                    else {
                        const gap = nextItem.time - current.endTime;
                        
                        // 이어지는 글자면 무조건 합침 (공백 없음)
                        if (nextItem.isContinuation) {
                            shouldMerge = true;
                            joinWithSpace = false;
                        } 
                        // 시간 차이가 작으면 합침 (공백 있음 - 문장 구성용)
                        else if (gap <= this.config.gapThreshold) {
                            shouldMerge = true;
                            joinWithSpace = true;
                        }
                    }

                    if (shouldMerge) {
                        current.text += (joinWithSpace ? " " : "") + nextItem.text;
                        current.endTime = nextItem.endTime;
                        j++;
                    } else {
                        break;
                    }
                }
                merged.push(current);
                i += j;
            }

            this.lyrics = merged;
            this.calculateGaps();
            this.render();
        }

        calculateGaps() {
            for (let i = 0; i < this.lyrics.length; i++) {
                this.lyrics[i].needsCountdown = false;
                let gap = (i === 0) ? this.lyrics[i].time : (this.lyrics[i].time - this.lyrics[i - 1].endTime);
                if (gap >= this.config.gapThreshold) this.lyrics[i].needsCountdown = true;
            }
        }

        render() {
            if (!this.lyricsBox) return;
            this.lyricsBox.innerHTML = '';
            this.domLines = [];
            this.lyrics.forEach(line => {
                const div = document.createElement('div');
                div.className = 'ap-line';
                div.innerHTML = `<span>${line.text}</span>`;
                if (line.needsCountdown) {
                    const dots = document.createElement('div');
                    dots.className = 'ap-dots';
                    dots.innerHTML = '<div class="ap-dot"></div><div class="ap-dot"></div><div class="ap-dot"></div>';
                    div.appendChild(dots);
                }
                this.lyricsBox.appendChild(div);
                this.domLines.push(div);
            });
        }

        update(currentTime) {
            if (!this.lyrics.length) return;
            const time = currentTime - this.config.syncOffset;
            
            let idx = -1;
            for (let i = 0; i < this.lyrics.length; i++) {
                if (time >= this.lyrics[i].time) idx = i;
                else break;
            }

            const lineHeight = this.config.fontSize * 1.8; 
            this.lyricsBox.style.transform = `translateY(${-idx * lineHeight}px)`;

            this.domLines.forEach((div, i) => {
                div.classList.remove('active', 'near', 'show-cnt');
                
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
                    div.style.opacity = Math.max(0.2, 1 - Math.abs(i - idx) * 0.3);
                } else {
                    div.style.transform = 'scale(0.8)';
                    div.style.opacity = 0.1;
                }
            });
        }
    }

    root.AiPlugsLyricsOverlay = LyricsEngine;
})(typeof window !== 'undefined' ? window : globalThis);