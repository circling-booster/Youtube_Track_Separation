/**
 * Lyrics Overlay Engine V2.2
 * 변경: 자체 UI 제거, 외부(Player UI) 바인딩 지원
 */
(function (root) {
    class LyricsEngine {
        constructor() {
            this.rawLyrics = [];
            this.lyrics = [];
            this.container = null;
            this.lyricsBox = null;
            this.domLines = [];

            // 기본 설정 (폰트 등)
            this.config = {
                fontFamily: "'Pretendard', sans-serif",
                fontSize: 80,
                activeScale: 2.0,
                syncOffset: -0.5,
                gapThreshold: 2.0,
                anticipation: 3.0,
                mergeThreshold: 0.05
            };
        }

        init(overlayContainer) {
            this.container = overlayContainer;
            this.loadWebFonts();
            this.injectStyles();
            this.createDOM();
            // createControlPanel() 제거됨 - Player UI에서 제어
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
                    pointer-events: none;
                }
                .ap-line {
                    height: calc(var(--ap-font-size) * 1.8);
                    min-height: 60px;
                    display: flex; align-items: center; justify-content: center;
                    white-space: nowrap; 
                    font-family: var(--ap-font-family);
                    font-size: var(--ap-font-size);
                    font-weight: 800;
                    color: rgba(255,255,255,0.35);
                    transition: all 0.2s ease-out;
                    -webkit-text-stroke: 1px rgba(0,0,0,0.3);
                    position: relative;
                }
                .ap-line.active {
                    color: #ffffff !important;
                    opacity: 1 !important;
                    z-index: 10;
                    transform: scale(var(--ap-active-scale)) !important;
                    -webkit-text-stroke: 1.5px rgba(0,0,0,0.8);
                    text-shadow: 0 4px 10px rgba(0,0,0,0.5);
                    filter: drop-shadow(0 0 5px rgba(255,255,255,0.3));
                }
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
            this.lyricsBox = document.createElement('div');
            this.lyricsBox.className = 'ap-lyrics-box';
            this.container.appendChild(this.lyricsBox);
        }

        // [New] 외부 UI(Player)의 컨트롤 요소와 연결
        bindUI() {
            // 폰트
            const fontSel = document.getElementById('ap-cfg-font');
            if (fontSel) {
                fontSel.value = this.config.fontFamily; // 초기값 동기화
                fontSel.onchange = (e) => {
                    this.config.fontFamily = e.target.value;
                    document.documentElement.style.setProperty('--ap-font-family', this.config.fontFamily);
                };
            }

            // 크기
            const sizeRange = document.getElementById('ap-cfg-size');
            if (sizeRange) {
                sizeRange.value = this.config.fontSize;
                sizeRange.oninput = (e) => {
                    this.config.fontSize = e.target.value;
                    const valSize = document.getElementById('val-size');
                    if(valSize) valSize.textContent = `${e.target.value}px`;
                    document.documentElement.style.setProperty('--ap-font-size', `${e.target.value}px`);
                    this.render(); // 사이즈 변경 시 재렌더링 (높이 계산)
                };
            }

            // 확대
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

            // 병합
            const mergeRange = document.getElementById('ap-cfg-merge');
            if (mergeRange) {
                mergeRange.value = this.config.mergeThreshold;
                mergeRange.oninput = (e) => {
                    this.config.mergeThreshold = parseFloat(e.target.value);
                    const valMerge = document.getElementById('val-merge');
                    if(valMerge) valMerge.textContent = `${this.config.mergeThreshold}s`;
                    this.processLyrics(); // 재처리
                };
            }

            // 싱크
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

                if (matched && text) parsed.push({ time: startT, endTime: endT, text: text });
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

            if (this.config.mergeThreshold <= 0.05) {
                this.lyrics = JSON.parse(JSON.stringify(this.rawLyrics));
            } else {
                let merged = [];
                let i = 0;
                while (i < this.rawLyrics.length) {
                    let current = { ...this.rawLyrics[i] };
                    let j = 1;
                    while (i + j < this.rawLyrics.length && j < 3) {
                        let nextItem = this.rawLyrics[i + j];
                        let gap = nextItem.time - current.endTime;
                        if (gap > this.config.mergeThreshold) break;

                        current.text += " " + nextItem.text;
                        current.endTime = nextItem.endTime;
                        j++;
                    }
                    merged.push(current);
                    i += j;
                }
                this.lyrics = merged;
            }

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