/**
 * Lyrics Overlay Engine V3.8 (Hybrid Mid-point Logic)
 * 변경사항: 하이브리드 모드에서 한국어 첫 글자의 판정 기준을 '시작과 종료의 중간'으로 변경
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
                fontFamily: "'Nanum Gothic', sans-serif",
                fontSize: 70,
                activeScale: 2.0,
                syncOffset: -0.5,
                gapThreshold: 2.0,
                anticipation: 3.0,
                viewMode: 'word' // 'sentence' | 'word' | 'char' | 'hybrid'
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
                .ap-line > span {
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
                .ap-line.active > span {
                    pointer-events: auto; cursor: ew-resize; background: rgba(0, 0, 0, 0.01);
                }
                .ap-line.active > span:active { cursor: grabbing; background: rgba(255, 255, 255, 0.1); }
                .ap-line.near { opacity: 0.6; color: #ddd; -webkit-text-stroke: 0.5px black; }
                
                .ap-dots {
                    position: absolute; top: 0%; left: 50%; transform: translateX(-50%);
                    display: flex; gap: 6px; opacity: 0; transition: opacity 0.2s;
                }
                .ap-dot { width: 6px; height: 6px; border-radius: 50%; background: #ff4444; box-shadow: 0 0 5px red; }
                .ap-line.show-cnt .ap-dots { opacity: 1; }

                /* 하이브리드 모드 애니메이션 */
                @keyframes ap-shake {
                    0% { transform: scale(1); }
                    25% { transform: scale(1.15) rotate(-5deg); }
                    50% { transform: scale(1.15) rotate(5deg); }
                    75% { transform: scale(1.15) rotate(-5deg); }
                    100% { transform: scale(1) rotate(0deg); }
                }

                .ap-char {
                    position: relative;
                    display: inline-block;
                    transition: color 0.1s, text-shadow 0.1s;
                    transform-origin: center bottom;
                }

                .ap-char.played {
                    color: #3ea6ff;
                    text-shadow: 0 0 15px rgba(62, 166, 255, 0.8);
                    animation: ap-shake 0.3s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
                }
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
                if (!e.target.closest('.ap-line.active > span')) return;
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
            const modeSel = document.getElementById('ap-cfg-mode');
            if (modeSel) {
                modeSel.value = this.config.viewMode;
                modeSel.onchange = (e) => {
                    this.config.viewMode = e.target.value;
                    this.processLyrics();
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

            while (i < this.rawLyrics.length) {
                let current = JSON.parse(JSON.stringify(this.rawLyrics[i]));
                
                // [Modified] 하이브리드 모드: 첫 글자 정보(endTime) 저장
                if (mode === 'hybrid') {
                    current.subTimings = [{ 
                        text: current.text, 
                        time: current.time, 
                        endTime: current.endTime, // 첫 글자의 끝나는 시간 저장
                        isFirst: true             // 첫 글자 플래그
                    }];
                }

                let j = 1;
                while (i + j < this.rawLyrics.length && j < 50) { 
                    let nextItem = this.rawLyrics[i + j];
                    let shouldMerge = false;
                    let joinWithSpace = true;

                    if (mode === 'char') {
                        shouldMerge = false;
                    } else if (mode === 'word' || mode === 'hybrid') {
                        if (nextItem.isContinuation) {
                            shouldMerge = true;
                            joinWithSpace = false;
                        }
                    } else {
                        const gap = nextItem.time - current.endTime;
                        if (nextItem.isContinuation) {
                            shouldMerge = true;
                            joinWithSpace = false;
                        } else if (gap <= this.config.gapThreshold) {
                            shouldMerge = true;
                            joinWithSpace = true;
                        }
                    }

                    if (shouldMerge) {
                        current.text += (joinWithSpace ? " " : "") + nextItem.text;
                        current.endTime = nextItem.endTime;
                        
                        if (mode === 'hybrid') {
                            current.subTimings.push({ 
                                text: nextItem.text, 
                                time: nextItem.time,
                                isFirst: false 
                            });
                        }

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
                
                if (this.config.viewMode === 'hybrid' && line.subTimings && line.subTimings.length > 0) {
                    const spanWrapper = document.createElement('span');
                    let htmlContent = '';
                    line.subTimings.forEach(sub => {
                        const isKorean = /[가-힣]/.test(sub.text);
                        const firstAttr = sub.isFirst ? ' data-first="true"' : '';
                        const koreanAttr = isKorean ? ' data-korean="true"' : '';
                        const endAttr = sub.endTime ? ` data-end="${sub.endTime}"` : '';

                        htmlContent += `<span class="ap-char" data-start="${sub.time}"${endAttr}${firstAttr}${koreanAttr}>${sub.text}</span>`;
                    });
                    spanWrapper.innerHTML = htmlContent;
                    div.appendChild(spanWrapper);
                } else {
                    div.innerHTML = `<span>${line.text}</span>`;
                }

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
                    
                    if (this.config.viewMode === 'hybrid') {
                        const chars = div.querySelectorAll('.ap-char');
                        chars.forEach(char => {
                            const startTime = parseFloat(char.dataset.start);
                            const endTime = parseFloat(char.dataset.end);
                            const isFirst = char.dataset.first === 'true';
                            const isKorean = char.dataset.korean === 'true';

                            // [Modified] 판정 로직: 첫 글자(한국어)는 중간 지점, 그 외는 시작 시간 기준
                            let triggerTime = startTime;
                            if (isFirst && isKorean && !isNaN(endTime)) {
                                triggerTime = (startTime + endTime) / 2;
                            }

                            if (time >= triggerTime) {
                                char.classList.add('played');
                            } else {
                                char.classList.remove('played');
                            }
                        });
                    }

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