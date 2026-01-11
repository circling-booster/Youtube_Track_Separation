/**
 * Lyrics Overlay Engine V2
 * 기능: 가사 렌더링, 싱크 조절, 폰트/크기/확대비율 커스터마이징 UI 포함
 */
(function (root) {
    class LyricsEngine {
        constructor() {
            this.lyrics = [];
            this.container = null;
            this.lyricsBox = null;
            this.domLines = [];

            // 기본 설정 (localStorage 저장 기능 포함 예정)
            this.config = {
                fontFamily: "'Nanum Gothic', sans-serif",
                fontSize: 80,
                activeScale: 2.0,
                syncOffset: -0.7,
                gapThreshold: 2.0,
                anticipation: 1.5
            };

            // 한국어 추천 폰트 10선 (Google Fonts + Pretendard)
            this.fontList = [
                { name: 'Nanum Gothic (나눔고딕)', value: "'Nanum Gothic', sans-serif" },
                { name: 'Pretendard (기본)', value: "'Pretendard', sans-serif" },
                { name: 'Noto Sans KR (고딕)', value: "'Noto Sans KR', sans-serif" },
                { name: 'Nanum Myeongjo (나눔명조)', value: "'Nanum Myeongjo', serif" },
                { name: 'Jua (주아)', value: "'Jua', sans-serif" },
                { name: 'Do Hyeon (도현)', value: "'Do Hyeon', sans-serif" },
                { name: 'Black Han Sans (제목용)', value: "'Black Han Sans', sans-serif" },
                { name: 'Gothic A1 (가독성)', value: "'Gothic A1', sans-serif" },
                { name: 'Sunflower (해바라기)', value: "'Sunflower', sans-serif" },
                { name: 'Nanum Pen Script (손글씨)', value: "'Nanum Pen Script', cursive" }
            ];
        }

        // ==========================================
        // 1. 초기화 및 스타일/UI 주입
        // ==========================================
        init(overlayContainer) {
            this.container = overlayContainer;
            this.loadWebFonts(); // 폰트 리소스 로드
            this.injectStyles();
            this.createDOM();
            this.createControlPanel(); // 설정 패널 생성
        }

        loadWebFonts() {
            if (document.getElementById('ap-webfonts')) return;

            // Google Fonts
            const link = document.createElement('link');
            link.id = 'ap-webfonts';
            link.rel = 'stylesheet';
            link.href = "https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Do+Hyeon&family=Gothic+A1&family=Jua&family=Nanum+Gothic&family=Nanum+Myeongjo&family=Nanum+Pen+Script&family=Noto+Sans+KR&family=Sunflower:wght@300&display=swap";
            document.head.appendChild(link);

            // Pretendard CDN
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
                    height: calc(var(--ap-font-size) * 3); /* 줄 간격 여유 */
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
                /* 활성 라인 (확대 + 선명함) */
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
                
                /* 카운트다운 점 */
                .ap-dots {
                    position: absolute; top: 15%; left: 50%; transform: translateX(-50%);
                    display: flex; gap: 6px; opacity: 0; transition: opacity 0.2s;
                }
                .ap-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff4444; box-shadow: 0 0 5px red; }
                .ap-line.show-cnt .ap-dots { opacity: 1; }

                /* 설정 패널 UI */
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
                    padding: 20px; width: 280px; color: white;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    display: none; pointer-events: auto;
                    font-family: 'Pretendard', sans-serif;
                }
                #ap-settings-panel.show { display: block; animation: fadeIn 0.2s; }
                
                .ap-setting-row { margin-bottom: 15px; }
                .ap-setting-label { font-size: 12px; color: #aaa; margin-bottom: 5px; display: block; font-weight: bold;}
                .ap-setting-val { font-size: 12px; color: #3ea6ff; float: right; }
                
                .ap-select { width: 100%; padding: 8px; background: #333; color: white; border: 1px solid #555; border-radius: 6px; cursor: pointer; }
                .ap-range { width: 100%; cursor: pointer; accent-color: #3ea6ff; }
                .ap-num-input { width: 60px; background: #333; border: 1px solid #555; color: white; padding: 4px; border-radius: 4px; text-align: center;}
                
                .ap-btn-group { display: flex; gap: 5px; }
                .ap-btn-small { flex: 1; background: #333; border: none; color: white; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 11px; }
                .ap-btn-small:hover { background: #555; }

                @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            `;
            document.head.appendChild(style);
        }

        createDOM() {
            this.container.innerHTML = '';

            // 가사 박스
            this.lyricsBox = document.createElement('div');
            this.lyricsBox.className = 'ap-lyrics-box';
            this.container.appendChild(this.lyricsBox);
        }

        createControlPanel() {
            // 1. 설정 버튼
            const btn = document.createElement('button');
            btn.id = 'ap-settings-btn';
            btn.innerHTML = '⚙️';
            btn.title = "가사 설정";
            btn.onclick = () => {
                const panel = document.getElementById('ap-settings-panel');
                panel.classList.toggle('show');
            };
            this.container.appendChild(btn);

            // 2. 설정 패널
            const panel = document.createElement('div');
            panel.id = 'ap-settings-panel';

            // 폰트 옵션 생성
            const fontOptions = this.fontList.map(f => `<option value="${f.value}">${f.name}</option>`).join('');

            panel.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
                    <span style="font-weight:bold;">자막 스타일 설정</span>
                    <span style="cursor:pointer; color:#aaa;" onclick="document.getElementById('ap-settings-panel').classList.remove('show')">✕</span>
                </div>

                <div class="ap-setting-row">
                    <label class="ap-setting-label">폰트 (Font)</label>
                    <select id="ap-cfg-font" class="ap-select">
                        ${fontOptions}
                    </select>
                </div>

                <div class="ap-setting-row">
                    <label class="ap-setting-label">크기 (Size) <span id="val-size" class="ap-setting-val">${this.config.fontSize}px</span></label>
                    <input type="range" id="ap-cfg-size" class="ap-range" min="16" max="80" value="${this.config.fontSize}">
                </div>

                <div class="ap-setting-row">
                    <label class="ap-setting-label">강조 확대 (Scale) <span id="val-scale" class="ap-setting-val">x${this.config.activeScale}</span></label>
                    <input type="range" id="ap-cfg-scale" class="ap-range" min="1.0" max="2.0" step="0.05" value="${this.config.activeScale}">
                </div>

                <div class="ap-setting-row">
                    <label class="ap-setting-label">싱크 조절 (Sync Offset) <span id="val-sync" class="ap-setting-val">${this.config.syncOffset.toFixed(1)}s</span></label>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="ap-btn-small" id="btn-sync-minus">-0.1s</button>
                        <input type="number" id="ap-cfg-sync" class="ap-num-input" value="${this.config.syncOffset}" step="0.1">
                        <button class="ap-btn-small" id="btn-sync-plus">+0.1s</button>
                    </div>
                    <div style="font-size:10px; color:#666; margin-top:4px;">* 양수(+)는 가사를 늦게, 음수(-)는 가사를 빠르게</div>
                </div>
            `;
            this.container.appendChild(panel);

            this.bindEvents();
        }

        bindEvents() {
            // 폰트 변경
            document.getElementById('ap-cfg-font').onchange = (e) => {
                this.config.fontFamily = e.target.value;
                document.documentElement.style.setProperty('--ap-font-family', this.config.fontFamily);
            };

            // 크기 변경
            const sizeInp = document.getElementById('ap-cfg-size');
            sizeInp.oninput = (e) => {
                this.config.fontSize = e.target.value;
                document.getElementById('val-size').textContent = `${e.target.value}px`;
                document.documentElement.style.setProperty('--ap-font-size', `${e.target.value}px`);
                this.render(); // 높이 재계산을 위해 리렌더링
            };

            // 확대 비율 변경
            const scaleInp = document.getElementById('ap-cfg-scale');
            scaleInp.oninput = (e) => {
                this.config.activeScale = e.target.value;
                document.getElementById('val-scale').textContent = `x${e.target.value}`;
                document.documentElement.style.setProperty('--ap-active-scale', e.target.value);
            };

            // 싱크 조절
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

            this.lyrics = rawLyrics;
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

        // ==========================================
        // 3. 업데이트 루프 (애니메이션)
        // ==========================================
        update(currentTime) {
            if (!this.lyrics.length) return;

            // 싱크 오프셋 적용 (마이너스일 경우 가사를 일찍 보여줘야 하므로 currentTime에 더하는 것이 아니라 time check에서 뺌)
            // 여기서는 직관적으로: Target Time = Current Time - Offset
            // 예: 오프셋이 +1.0이면 가사가 1초 늦게 나옴 (Video Time 5초일 때 가사 Time 4초 부분 표시)
            // 반대로 오프셋이 -1.0이면 가사가 1초 빨리 나옴 (Video Time 5초일 때 가사 Time 6초 부분 표시)
            // 즉, Logic Time = currentTime - syncOffset
            const time = currentTime - this.config.syncOffset;

            // 현재 인덱스 탐색
            let idx = -1;
            for (let i = 0; i < this.lyrics.length; i++) {
                if (time >= this.lyrics[i].time) idx = i;
                else break;
            }

            // 스크롤 (폰트크기 * 3 = 줄높이)
            // 설정된 폰트 크기를 가져와서 계산
            const lineHeight = this.config.fontSize * 3;
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

    // 전역 노출
    root.AiPlugsLyricsOverlay = LyricsEngine;

})(typeof window !== 'undefined' ? window : globalThis);