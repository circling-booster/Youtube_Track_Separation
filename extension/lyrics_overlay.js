/**
 * Lyrics Overlay Engine
 * content_old.js의 스타일과 로직을 기반으로 모듈화
 */
(function(root) {
    class LyricsEngine {
        constructor() {
            this.lyrics = [];
            this.mergeThreshold = 0.1;
            this.container = null;
            this.lyricsBox = null;
            this.domLines = [];
            
            // UI 설정 (content_old.js 스타일 유지)
            this.config = {
                baseFontSize: 34,      
                activeScale: 1.2,      
                syncOffset: 0.0,       
                gapThreshold: 2.0,     
                anticipation: 1.5      
            };
        }

        // ==========================================
        // 1. 초기화 및 스타일 주입
        // ==========================================
        init(overlayContainer) {
            this.container = overlayContainer;
            this.injectStyles();
            this.createDOM();
        }

        injectStyles() {
            if (document.getElementById('aiplugs-lyrics-style')) return;
            const style = document.createElement('style');
            style.id = 'aiplugs-lyrics-style';
            style.innerHTML = `
                :root {
                    --ap-font-size: ${this.config.baseFontSize}px;
                    --ap-active-scale: ${this.config.activeScale};
                }
                .ap-lyrics-box {
                    position: absolute; top: 50%; left: 0; width: 100%; text-align: center;
                    transition: transform 0.1s linear; /* 부드러운 스크롤 */
                    pointer-events: none;
                }
                .ap-line {
                    height: calc(var(--ap-font-size) * 3);
                    display: flex; align-items: center; justify-content: center;
                    white-space: nowrap; 
                    font-size: var(--ap-font-size);
                    font-weight: 900;
                    color: rgba(255,255,255,0.4);
                    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    -webkit-text-stroke: 1px rgba(0,0,0,0.5);
                    position: relative;
                }
                /* 활성 라인 스타일 (선명도 + 확대) */
                .ap-line.active {
                    color: #ffffff !important;
                    opacity: 1 !important;
                    z-index: 10;
                    transform: scale(var(--ap-active-scale)) !important;
                    -webkit-text-stroke: 2px black;
                    text-shadow: 
                        3px 3px 0px #000000, 
                        0 0 10px rgba(0, 255, 255, 0.7);
                }
                .ap-line.near { opacity: 0.7; color: #ddd; -webkit-text-stroke: 1px black; }
                
                /* 카운트다운 점 */
                .ap-dots {
                    position: absolute; top: 15%; left: 50%; transform: translateX(-50%);
                    display: flex; gap: 6px; opacity: 0; transition: opacity 0.2s;
                }
                .ap-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff3333; box-shadow: 0 0 5px red; }
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

        // ==========================================
        // 2. 파싱 로직 (LRC)
        // ==========================================
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

            let rawLyrics = [];
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

                if (matched && text) rawLyrics.push({ time: startT, endTime: endT, text: text });
            });

            rawLyrics.sort((a, b) => a.time - b.time);

            // 종료 시간 자동 계산
            for (let i = 0; i < rawLyrics.length; i++) {
                if (rawLyrics[i].endTime === null) {
                    if (i < rawLyrics.length - 1) rawLyrics[i].endTime = rawLyrics[i + 1].time;
                    else rawLyrics[i].endTime = rawLyrics[i].time + 5.0;
                }
            }

            this.lyrics = rawLyrics; // 필요시 병합 로직 추가 가능
            this.calculateGaps();
            this.render();
        }

        calculateGaps() {
            for (let i = 0; i < this.lyrics.length; i++) {
                this.lyrics[i].needsCountdown = false;
                let gap = (i === 0) ? this.lyrics[i].time : (this.lyrics[i].time - this.lyrics[i-1].endTime);
                if (gap >= this.config.gapThreshold) this.lyrics[i].needsCountdown = true;
            }
        }

        render() {
            this.lyricsBox.innerHTML = '';
            this.domLines = [];
            this.lyrics.forEach(line => {
                const div = document.createElement('div');
                div.className = 'ap-line';
                div.innerHTML = `<span>${line.text}</span>`;
                
                if(line.needsCountdown) {
                    const dots = document.createElement('div');
                    dots.className = 'ap-dots';
                    dots.innerHTML = '<div class="ap-dot"></div><div class="ap-dot"></div><div class="ap-dot"></div>';
                    div.appendChild(dots);
                }
                this.lyricsBox.appendChild(div);
                this.domLines.push(div);
            });
        }

        // ==========================================
        // 3. 업데이트 루프 (애니메이션)
        // ==========================================
        update(currentTime) {
            if(!this.lyrics.length) return;
            const time = currentTime + this.config.syncOffset;
            
            // 현재 인덱스 탐색
            let idx = -1;
            for (let i = 0; i < this.lyrics.length; i++) {
                if (time >= this.lyrics[i].time) idx = i;
                else break;
            }
            
            // 스크롤 (폰트크기 * 3 = 줄높이)
            const lineHeight = this.config.baseFontSize * 3;
            this.lyricsBox.style.transform = `translateY(${-idx * lineHeight}px)`;

            this.domLines.forEach((div, i) => {
                div.classList.remove('active', 'near', 'show-cnt');
                
                // 카운트다운 로직
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

                // 활성/비활성 스타일
                if(i === idx) {
                    div.classList.add('active'); 
                } else if (Math.abs(i - idx) <= 2) {
                    div.classList.add('near');
                    div.style.transform = 'scale(0.9)';
                    div.style.opacity = Math.max(0.2, 1 - Math.abs(i - idx)*0.3);
                } else {
                    div.style.transform = 'scale(0.8)';
                    div.style.opacity = 0.1;
                }
            });
        }
    }

    // 전역 노출
    root.AiPlugsLyricsOverlay = LyricsEngine;

})(typeof window !== 'undefined' ? window : globalThis);