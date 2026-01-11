/**
 * Lyrics Overlay Engine V2.1
 * 변경: 자막 병합(Merging) 기능 추가, 설정 UI 개선
 */
(function (root) {
    class LyricsEngine {
        constructor() {
            this.rawLyrics = []; // 병합 전 원본 데이터 보존
            this.lyrics = [];    // 렌더링용 데이터
            this.container = null;
            this.lyricsBox = null;
            this.domLines = [];

            // 기본 설정
            this.config = {
                fontFamily: "'Nanum Gothic', sans-serif",
                fontSize: 80,
                activeScale: 2.0, // 가독성을 위해 기본값 조정
                syncOffset: -0.5,
                gapThreshold: 2.0,     // 카운트다운 발동 기준
                anticipation: 3.0,
                mergeThreshold: 0.05    // [New] 자막 병합 기준 시간 (초)
            };

            this.fontList = [
                { name: 'Pretendard (기본)', value: "'Pretendard', sans-serif" },
                { name: 'Nanum Gothic (나눔고딕)', value: "'Nanum Gothic', sans-serif" },
                { name: 'Noto Sans KR (고딕)', value: "'Noto Sans KR', sans-serif" },
                { name: 'Jua (주아)', value: "'Jua', sans-serif" },
                { name: 'Do Hyeon (도현)', value: "'Do Hyeon', sans-serif" },
                { name: 'Black Han Sans (제목용)', value: "'Black Han Sans', sans-serif" },
                { name: 'Gothic A1 (가독성)', value: "'Gothic A1', sans-serif" },
                { name: 'Sunflower (해바라기)', value: "'Sunflower', sans-serif" },
                { name: 'Nanum Pen Script (손글씨)', value: "'Nanum Pen Script', cursive" }
            ];
        }

        init(overlayContainer) {
            this.container = overlayContainer;
            this.loadWebFonts();
            this.injectStyles();
            this.createDOM();
            this.createControlPanel();
        }

        loadWebFonts() {
            if (document.getElementById('ap-webfonts')) return;
            const link = document.createElement('link');
            link.id = 'ap-webfonts';
            link.rel = 'stylesheet';
            link.href = "https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Do+Hyeon&family=Gothic+A1&family=Jua&family=Nanum+Gothic&family=Nanum+Myeongjo&family=Nanum+Pen+Script&family=Noto+Sans+KR&family=Sunflower:wght@300&display=swap";
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
                    height: calc(var(--ap-font-size) * 1.8); /* 줄 간격 타이트하게 조정 */
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

                #ap-settings-btn {
                    position: absolute; top: 20px; left: 20px; z-index: 2147483647;
                    background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.3);
                    color: white; border-radius: 50%; width: 40px; height: 40px;
                    cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center;
                    transition: 0.2s; pointer-events: auto;
                }
                #ap-settings-btn:hover { background: rgba(0,0,0,0.8); transform: rotate(90deg); }
                
                #ap-settings-panel {
                    position: absolute; top: 70px; left: 20px; z-index: 2147483647;
                    background: rgba(20, 20, 20, 0.95); backdrop-filter: blur(10px);
                    border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
                    padding: 20px; width: 300px; color: white;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    display: none; pointer-events: auto;
                    font-family: 'Pretendard', sans-serif;
                }
                #ap-settings-panel.show { display: block; animation: fadeIn 0.2s; }
                
                .ap-setting-row { margin-bottom: 12px; }
                .ap-setting-label { font-size: 12px; color: #aaa; margin-bottom: 4px; display: block; font-weight: bold;}
                .ap-setting-val { font-size: 12px; color: #3ea6ff; float: right; }
                
                .ap-select { width: 100%; padding: 6px; background: #333; color: white; border: 1px solid #555; border-radius: 6px; cursor: pointer; }
                .ap-range { width: 100%; cursor: pointer; accent-color: #3ea6ff; margin: 5px 0; }
                .ap-num-input { width: 50px; background: #333; border: 1px solid #555; color: white; padding: 3px; border-radius: 4px; text-align: center;}
                
                .ap-btn-small { background: #333; border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
                .ap-btn-small:hover { background: #555; }

                @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            `;
            document.head.appendChild(style);
        }

        createDOM() {
            this.container.innerHTML = '';
            this.lyricsBox = document.createElement('div');
            this.lyricsBox.className = 'ap-lyrics-box';
            this.container.appendChild(this.lyricsBox);
        }

        createControlPanel() {
            const btn = document.createElement('button');
            btn.id = 'ap-settings-btn';
            btn.innerHTML = '⚙️';
            btn.title = "가사 설정";
            btn.onclick = () => {
                document.getElementById('ap-settings-panel').classList.toggle('show');
            };
            this.container.appendChild(btn);

            const panel = document.createElement('div');
            panel.id = 'ap-settings-panel';

            const fontOptions = this.fontList.map(f => `<option value="${f.value}">${f.name}</option>`).join('');

            panel.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:15px; border-bottom:1px solid #444; padding-bottom:10px;">
                    <span style="font-weight:bold;">자막 스타일 설정</span>
                    <span style="cursor:pointer; color:#aaa;" onclick="document.getElementById('ap-settings-panel').classList.remove('show')">✕</span>
                </div>

                <div class="ap-setting-row">
                    <label class="ap-setting-label">폰트 (Font)</label>
                    <select id="ap-cfg-font" class="ap-select">${fontOptions}</select>
                </div>

                <div class="ap-setting-row">
                    <label class="ap-setting-label">크기 (Size) <span id="val-size" class="ap-setting-val">${this.config.fontSize}px</span></label>
                    <input type="range" id="ap-cfg-size" class="ap-range" min="16" max="120" value="${this.config.fontSize}">
                </div>

                <div class="ap-setting-row">
                    <label class="ap-setting-label">강조 확대 (Scale) <span id="val-scale" class="ap-setting-val">x${this.config.activeScale}</span></label>
                    <input type="range" id="ap-cfg-scale" class="ap-range" min="1.0" max="2.0" step="0.1" value="${this.config.activeScale}">
                </div>

                <div class="ap-setting-row">
                    <label class="ap-setting-label">자막 병합 (Merge Gap) <span id="val-merge" class="ap-setting-val">${this.config.mergeThreshold}s</span></label>
                    <input type="range" id="ap-cfg-merge" class="ap-range" min="0.0" max="1.5" step="0.1" value="${this.config.mergeThreshold}">
                    <div style="font-size:10px; color:#888;">* ${this.config.mergeThreshold}초 이내 단어를 한 줄로 합침 (최대 3개)</div>
                </div>

                <div class="ap-setting-row">
                    <label class="ap-setting-label">싱크 조절 (Sync Offset) <span id="val-sync" class="ap-setting-val">${this.config.syncOffset.toFixed(1)}s</span></label>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="ap-btn-small" id="btn-sync-minus">-0.1s</button>
                        <input type="number" id="ap-cfg-sync" class="ap-num-input" value="${this.config.syncOffset}" step="0.1">
                        <button class="ap-btn-small" id="btn-sync-plus">+0.1s</button>
                    </div>
                </div>
            `;
            this.container.appendChild(panel);
            this.bindEvents();
        }

        bindEvents() {
            // 폰트
            document.getElementById('ap-cfg-font').onchange = (e) => {
                this.config.fontFamily = e.target.value;
                document.documentElement.style.setProperty('--ap-font-family', this.config.fontFamily);
            };

            // 크기
            document.getElementById('ap-cfg-size').oninput = (e) => {
                this.config.fontSize = e.target.value;
                document.getElementById('val-size').textContent = `${e.target.value}px`;
                document.documentElement.style.setProperty('--ap-font-size', `${e.target.value}px`);
                this.render(); 
            };

            // 확대
            document.getElementById('ap-cfg-scale').oninput = (e) => {
                this.config.activeScale = e.target.value;
                document.getElementById('val-scale').textContent = `x${e.target.value}`;
                document.documentElement.style.setProperty('--ap-active-scale', e.target.value);
            };

            // [New] 병합 설정
            document.getElementById('ap-cfg-merge').oninput = (e) => {
                this.config.mergeThreshold = parseFloat(e.target.value);
                document.getElementById('val-merge').textContent = `${this.config.mergeThreshold}s`;
                // 설정 변경 즉시 재처리 및 렌더링
                this.processLyrics();
            };

            // 싱크
            const syncInp = document.getElementById('ap-cfg-sync');
            const updateSync = (val) => {
                const newVal = parseFloat(val.toFixed(1));
                this.config.syncOffset = newVal;
                syncInp.value = newVal;
                document.getElementById('val-sync').textContent = `${newVal > 0 ? '+' : ''}${newVal}s`;
            };

            syncInp.onchange = (e) => updateSync(parseFloat(e.target.value));
            document.getElementById('btn-sync-minus').onclick = () => updateSync(this.config.syncOffset - 0.1);
            document.getElementById('btn-sync-plus').onclick = () => updateSync(this.config.syncOffset + 0.1);
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
                
                // 확장 포맷 (Word-level timestamps)
                let mFull = line.match(patternFull);
                if (mFull) {
                    startT = this.parseTime(mFull[1]);
                    endT = this.parseTime(mFull[2]);
                    text = mFull[3].trim();
                    matched = true;
                } else {
                    // 표준 LRC
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

            // endTime 보정 (빈 경우 다음 가사 시작 시간 or +3초)
            for (let i = 0; i < parsed.length; i++) {
                if (parsed[i].endTime === null) {
                    if (i < parsed.length - 1) parsed[i].endTime = parsed[i + 1].time;
                    else parsed[i].endTime = parsed[i].time + 3.0;
                }
            }

            // 원본 데이터 저장 (설정 변경 시 재사용)
            this.rawLyrics = parsed;
            
            // 병합 및 렌더링 실행
            this.processLyrics();
        }

        // [New] 자막 병합 로직 (핵심)
        processLyrics() {
            if (!this.rawLyrics.length) return;

            // 병합 임계값이 0이거나 데이터가 없으면 원본 그대로 사용
            if (this.config.mergeThreshold <= 0.05) {
                this.lyrics = JSON.parse(JSON.stringify(this.rawLyrics)); // Deep Copy
            } else {
                let merged = [];
                let i = 0;
                while (i < this.rawLyrics.length) {
                    let current = { ...this.rawLyrics[i] };
                    let j = 1;
                    
                    // 최대 3개까지 && 시간 간격이 임계값 이내인 경우 병합
                    // 조건: (다음 가사 시작 - 현재 가사 끝) <= Threshold
                    while (i + j < this.rawLyrics.length && j < 3) {
                        let nextItem = this.rawLyrics[i + j];
                        let gap = nextItem.time - current.endTime;
                        
                        // 간격이 너무 크면 병합 중단
                        if (gap > this.config.mergeThreshold) break;

                        // 텍스트 합치기
                        current.text += " " + nextItem.text;
                        // 끝나는 시간 연장
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
            // 렌더링 후 현재 위치 재계산을 위해 update 한 번 호출
            // (여기선 currentTime을 모르니 생략, 루프에서 자동 처리됨)
        }

        update(currentTime) {
            if (!this.lyrics.length) return;

            const time = currentTime - this.config.syncOffset;
            
            // 현재 인덱스 찾기
            let idx = -1;
            for (let i = 0; i < this.lyrics.length; i++) {
                if (time >= this.lyrics[i].time) idx = i;
                else break;
            }

            // CSS 높이 계산 (lineHeight = fontSize * 1.8)
            // 주의: settings의 lineHeight 계산식과 CSS가 일치해야 스크롤이 정확함
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