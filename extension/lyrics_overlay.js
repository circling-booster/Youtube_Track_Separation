/**
 * Lyrics Overlay Engine V2.5
 * 변경: 드래그 영역을 '활성 라인의 텍스트(Span)'로 좁혀 유튜브 플레이어 간섭 최소화
 */
(function (root) {
    class LyricsEngine {
        constructor() {
            this.rawLyrics = [];
            this.lyrics = [];
            this.container = null;
            this.lyricsBox = null;
            this.domLines = [];

            // 드래그 관련 상태
            this.dragState = {
                isDragging: false,
                startX: 0,
                currentTranslateX: 0,
                initialTranslateX: 0
            };

            // 설정
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
                    pointer-events: none; /* 박스 전체 클릭 투과 */
                    user-select: none;
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
                    pointer-events: none; /* 라인 전체 클릭 투과 */
                }
                
                /* [핵심 변경] Span 스타일 정의 */
                .ap-line span {
                    display: inline-block;
                    padding: 5px 10px; /* 클릭 편의성을 위한 최소한의 패딩 */
                    border-radius: 4px;
                    pointer-events: none; /* 기본 상태: 클릭 불가 */
                }

                .ap-line.active {
                    color: #ffffff !important;
                    opacity: 1 !important;
                    z-index: 10;
                    transform: scale(var(--ap-active-scale)) !important;
                    -webkit-text-stroke: 1.5px rgba(0,0,0,0.8);
                    text-shadow: 0 4px 10px rgba(0,0,0,0.5);
                    filter: drop-shadow(0 0 5px rgba(255,255,255,0.3));
                    
                    /* [핵심] 활성 라인 자체는 여전히 클릭 투과 */
                    pointer-events: none; 
                }

                /* [핵심] 오직 활성 라인의 '텍스트(Span)'만 클릭 가능 */
                .ap-line.active span {
                    pointer-events: auto; 
                    cursor: ew-resize;
                    background: rgba(0, 0, 0, 0.01); /* 투명 배경(이벤트 감지용) */
                }
                
                .ap-line.active span:active {
                    cursor: grabbing;
                    background: rgba(255, 255, 255, 0.1); /* 드래그 중 시각적 피드백(선택 사항) */
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
            this.container.style.transform = 'translateX(0px)';
            
            this.lyricsBox = document.createElement('div');
            this.lyricsBox.className = 'ap-lyrics-box';
            this.container.appendChild(this.lyricsBox);
        }

        enableHorizontalDrag() {
            if (!this.lyricsBox || !this.container) return;

            const onMouseDown = (e) => {
                if (e.button !== 0) return;

                // [중요] 클릭된 타겟이 활성 라인의 'span'인지 확인
                // .ap-line.active 자체를 클릭하면 동작하지 않음 (span만 허용)
                if (!e.target.closest('.ap-line.active span')) return;

                this.dragState.isDragging = true;
                this.dragState.startX = e.clientX;
                this.dragState.initialTranslateX = this.dragState.currentTranslateX;

                document.body.addEventListener('mousemove', onMouseMove);
                document.body.addEventListener('mouseup', onMouseUp);
                
                e.preventDefault(); // 텍스트 선택 방지
            };

            const onMouseMove = (e) => {
                if (!this.dragState.isDragging) return;

                e.preventDefault();
                const dx = e.clientX - this.dragState.startX;
                const newTranslateX = this.dragState.initialTranslateX + dx;
                
                this.container.style.transform = `translateX(${newTranslateX}px)`;
            };

            const onMouseUp = (e) => {
                if (!this.dragState.isDragging) return;

                const dx = e.clientX - this.dragState.startX;
                this.dragState.currentTranslateX = this.dragState.initialTranslateX + dx;
                
                this.dragState.isDragging = false;
                
                document.body.removeEventListener('mousemove', onMouseMove);
                document.body.removeEventListener('mouseup', onMouseUp);
            };

            // 이벤트 리스너 등록
            this.lyricsBox.addEventListener('mousedown', onMouseDown);
        }

        bindUI() {
            // (이전 코드와 동일 - 폰트, 크기, 싱크 설정 등)
            const fontSel = document.getElementById('ap-cfg-font');
            if (fontSel) {
                fontSel.value = this.config.fontFamily;
                fontSel.onchange = (e) => {
                    this.config.fontFamily = e.target.value;
                    document.documentElement.style.setProperty('--ap-font-family', this.config.fontFamily);
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
            const mergeRange = document.getElementById('ap-cfg-merge');
            if (mergeRange) {
                mergeRange.value = this.config.mergeThreshold;
                mergeRange.oninput = (e) => {
                    this.config.mergeThreshold = parseFloat(e.target.value);
                    this.processLyrics();
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
                
                // [확인] 텍스트를 span으로 감싸서 생성
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