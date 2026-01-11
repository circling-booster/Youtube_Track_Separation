// yt-sep-ui-templates.js
(function (root) {
  function setupPanelHTML() {
    return `
      <h3 style="margin:0 0 15px 0;">트랙 분리 스튜디오</h3>
      <select id="sep-model" style="width:100%; padding:10px; background:#333; color:white; border:none; margin-bottom:15px; border-radius:4px;">
        <option value="htdemucs">htdemucs (빠름/권장)</option>
        <option value="htdemucs_ft">htdemucs_ft (고품질/느림)</option>
      </select>
      <div id="sep-progress-area" style="display:none; margin-bottom:15px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#aaa; margin-bottom:5px;">
          <span id="sep-status-text">처리 중...</span>
          <span id="sep-percent">0%</span>
        </div>
        <div style="height:4px; background:#333; border-radius:2px;">
          <div id="sep-progress-bar" style="width:0%; height:100%; background:#3ea6ff; transition:width 0.3s;"></div>
        </div>
      </div>
      <div style="display:flex; gap:10px;">
        <button id="sep-start-btn" class="yt-sep-btn" style="flex:1; padding:10px; background:#3ea6ff; color:black; border-radius:4px; font-weight:bold;">시작</button>
        <button id="sep-close-btn" class="yt-sep-btn" style="flex:1; padding:10px; background:#444; color:white; border-radius:4px;">취소</button>
      </div>
    `;
  }

  function volumeSlidersHTML(tracks) {
    const trackLabels = { 'vocal': '🎤 Vocal', 'drum': '🥁 Drum', 'bass': '🎸 Bass', 'other': '🎹 Other' };
    return tracks.map(track => `
        <div class="sep-track-group sep-track-${track}">
          <label class="sep-track-label">${trackLabels[track] || track}</label>
          <input type="range" class="yt-sep-slider" data-track="${track}" min="0" max="100" value="100">
        </div>
      `).join("");
  }

  function lyricsSettingsHTML() {
      const fonts = [
          { name: 'Pretendard (기본)', value: "'Pretendard', sans-serif" },
          { name: '나눔고딕', value: "'Nanum Gothic', sans-serif" },
          { name: '주아체', value: "'Jua', sans-serif" },
          { name: '도현체', value: "'Do Hyeon', sans-serif" },
          { name: '제목용(Black Han)', value: "'Black Han Sans', sans-serif" },
          { name: '손글씨(Pen)', value: "'Nanum Pen Script', cursive" }
      ];
      const fontOptions = fonts.map(f => `<option value="${f.value}">${f.name}</option>`).join('');

      return `
        <div id="cp-lyrics-panel" class="sep-lyrics-settings" style="display:none;">
            <div class="sep-ls-header">
                <span>자막 설정</span>
                <button id="cp-lyrics-close" style="background:none; border:none; color:#aaa; cursor:pointer;">✕</button>
            </div>
            
            <div class="sep-ls-row">
                <label>표시 모드</label>
                <select id="ap-cfg-mode" class="sep-ls-select">
                    <option value="sentence">문장 단위 (기본)</option>
                    <option value="word">단어 단위</option>
                    <option value="char">글자 단위</option>
                    <option value="hybrid">하이브리드 (노래방)</option> </select>
            </div>

            <div class="sep-ls-row">
                <label>폰트</label>
                <select id="ap-cfg-font" class="sep-ls-select">${fontOptions}</select>
            </div>

            <div class="sep-ls-row">
                <label>크기 <span id="val-size" style="float:right; color:#3ea6ff;">80px</span></label>
                <input type="range" id="ap-cfg-size" class="sep-ls-range" min="20" max="150" value="80">
            </div>

            <div class="sep-ls-row">
                <label>확대 <span id="val-scale" style="float:right; color:#3ea6ff;">x2.0</span></label>
                <input type="range" id="ap-cfg-scale" class="sep-ls-range" min="1.0" max="3.0" step="0.1" value="2.0">
            </div>

            <div class="sep-ls-row">
                <label>싱크 <span id="val-sync" style="float:right; color:#3ea6ff;">-0.5s</span></label>
                <div style="display:flex; gap:5px; align-items:center;">
                    <button class="sep-ls-btn" id="btn-sync-minus">-0.1</button>
                    <input type="number" id="ap-cfg-sync" class="sep-ls-input" value="-0.5" step="0.1">
                    <button class="sep-ls-btn" id="btn-sync-plus">+0.1</button>
                </div>
            </div>
        </div>
      `;
  }

  function customPlayerHTML(tracks) {
    return `
      <style>
        #yt-custom-player-ui {
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            width: 90%; max-width: 800px;
            background: rgba(15, 15, 15, 0.95); 
            backdrop-filter: none;
            border: 1px solid #444; border-radius: 16px; padding: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6); z-index: 2147483647;
            display: flex; flex-direction: column; gap: 15px;
            font-family: 'Nanum Gothic', sans-serif;
            transition: opacity 0.3s ease;
        }
        #yt-custom-player-ui.ui-idle { opacity: 0 !important; pointer-events: none; }
        .sep-player-header { display: flex; justify-content: space-between; align-items: center; }
        .sep-main-controls {
            display: flex; align-items: center; gap: 15px;
            background: rgba(255,255,255,0.05); padding: 10px; border-radius: 12px;
            position: relative; 
        }
        .sep-tracks-container {
            display: flex; gap: 15px; background: #222; padding: 15px; border-radius: 10px;
            transition: opacity 0.3s ease, visibility 0.3s;
        }
        #yt-custom-player-ui.hide-peripherals .sep-tracks-container { opacity: 0; visibility: hidden; pointer-events: none; }
        .sep-track-group { display: flex; flex-direction: column; align-items: center; flex: 1; }
        .sep-track-label { font-size: 11px; color: #aaa; margin-bottom: 8px; text-transform: uppercase; font-weight: bold; }
        .yt-sep-slider { width: 100%; cursor: pointer; height: 4px; -webkit-appearance: none; background: #444; border-radius: 2px; }
        .yt-sep-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: #3ea6ff; border-radius: 50%; }

        /* 자막 설정 패널 */
        .sep-lyrics-settings {
            position: absolute; bottom: 110%; right: 0;
            width: 260px; background: #222; border: 1px solid #444;
            border-radius: 8px; padding: 15px; box-shadow: 0 5px 20px rgba(0,0,0,0.5);
            z-index: 1000; animation: fadeIn 0.2s;
        }
        .sep-ls-header { display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid #333; padding-bottom: 5px; font-size: 13px; font-weight: bold; color: #fff; }
        .sep-ls-row { margin-bottom: 12px; font-size: 12px; color: #ccc; }
        .sep-ls-row label { display: block; margin-bottom: 4px; }
        .sep-ls-select { width: 100%; padding: 4px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; }
        .sep-ls-range { width: 100%; cursor: pointer; accent-color: #3ea6ff; margin-top: 5px; }
        .sep-ls-input { width: 50px; background: #333; border: 1px solid #555; color: white; text-align: center; border-radius: 4px; padding: 2px; }
        .sep-ls-btn { background: #444; border: none; color: white; border-radius: 4px; cursor: pointer; padding: 2px 6px; font-size: 11px; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

        /* Fullscreen Mode */
        #yt-custom-player-ui.fs-mode {
            bottom: 0; left: 0; transform: none; width: 100%; height: 100%; max-width: none;
            background: transparent; border: none; padding: 40px; pointer-events: none;
            backdrop-filter: none;
        }
        #yt-custom-player-ui.fs-mode .sep-player-header { display: none; }
        #yt-custom-player-ui.fs-mode .sep-main-controls {
            position: absolute; bottom: 10%; left: 50%; transform: translateX(-50%);
            width: 60%; min-width: 600px; background: rgba(0,0,0,0.7); pointer-events: auto;
        }
        #yt-custom-player-ui.fs-mode .sep-tracks-container {
            background: transparent; display: block; width: 100%; height: 100%; padding: 0;
        }
        #yt-custom-player-ui.fs-mode .sep-track-group {
            position: absolute; width: 250px; background: rgba(0,0,0,0.6); padding: 20px;
            border-radius: 16px; backdrop-filter: none; pointer-events: auto;
            border: 1px solid rgba(255,255,255,0.1); transition: transform 0.2s;
        }
        #yt-custom-player-ui.fs-mode .sep-track-group:hover { transform: scale(1.05); }
        #yt-custom-player-ui.fs-mode .sep-track-vocal { top: 15%; left: 10%; }
        #yt-custom-player-ui.fs-mode .sep-track-drum  { top: 15%; right: 10%; }
        #yt-custom-player-ui.fs-mode .sep-track-other { bottom: 25%; left: 10%; }
        #yt-custom-player-ui.fs-mode .sep-track-bass  { bottom: 25%; right: 10%; }
      </style>

      <div class="sep-player-header">
        <div style="display:flex; align-items:center; gap:10px;">
            <span id="cp-status" style="font-size:12px; color:#3ea6ff; font-weight:bold;">준비 중...</span>
            <div style="display:flex; align-items:center; gap:5px; background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:12px;">
                <span style="font-size:10px; color:#aaa;">👁️</span>
                <input type="range" id="cp-opacity-slider" min="0.2" max="1.0" step="0.05" value="0.95" style="width:60px; height:4px; accent-color:#aaa;">
            </div>
        </div>
        <div style="display:flex; gap:10px;">
            <button id="cp-minimize-btn" style="background:none; border:none; color:#ccc; cursor:pointer;">_</button>
            <button id="cp-close-btn" style="background:none; border:none; color:#ccc; cursor:pointer;">✕</button>
        </div>
      </div>

      <div class="sep-main-controls">
        <button id="cp-play-btn" class="yt-sep-btn" style="width:40px; height:40px; border-radius:50%; background:#fff; color:#000; font-size:18px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center;">▶</button>
        <span id="cp-curr-time" style="font-size:12px; color:white; min-width:40px; text-align:right;">0:00</span>
        <div style="flex:1; position:relative; height:20px; display:flex; align-items:center;">
          <input type="range" id="cp-progress" class="yt-sep-slider" min="0" max="100" step="0.1" value="0" style="width:100%; height:6px;">
        </div>
        <span id="cp-total-time" style="font-size:12px; color:white; min-width:40px;">0:00</span>
        <button id="cp-toggle-ui-btn" style="background:transparent; border:1px solid #555; color:white; border-radius:4px; padding:4px 8px; cursor:pointer; margin-left:10px;" title="UI 숨기기">👁️</button>
        <button id="cp-lyrics-toggle-btn" style="background:transparent; border:1px solid #555; color:white; border-radius:4px; padding:4px 8px; cursor:pointer; margin-left:5px;" title="자막 설정">Aa</button>
        ${lyricsSettingsHTML()}
      </div>

      <div class="sep-tracks-container">
        ${volumeSlidersHTML(tracks)}
      </div>
    `;
  }

  root.YTSepUITemplates = { setupPanelHTML, customPlayerHTML };
})(typeof window !== "undefined" ? window : globalThis);