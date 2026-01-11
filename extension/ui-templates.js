// extension/ui-templates.js

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

  function customPlayerHTML(tracks) {
    // [Modified] 드럼 싱크 설정 섹션 삭제됨
    const settingsHTML = `
        <div id="cp-settings-panel" class="sep-lyrics-settings" style="display:none;">
            <div class="sep-ls-header"><span>⚙️ 오디오/자막 설정</span><button id="cp-settings-close" style="background:none; border:none; color:#aaa; cursor:pointer;">✕</button></div>
            
            <div class="sep-ls-row"><label>자막 폰트</label><select id="ap-cfg-font" class="sep-ls-select"><option value="'Pretendard', sans-serif">Pretendard</option><option value="'Nanum Gothic', sans-serif">나눔고딕</option></select></div>
            <div class="sep-ls-row"><label>자막 크기</label><input type="range" id="ap-cfg-size" class="sep-ls-range" min="20" max="150" value="80"></div>
            <div class="sep-ls-row"><label>자막 싱크</label><input type="number" id="ap-cfg-sync" class="sep-ls-input" value="-0.5" step="0.1"></div>
        </div>`;

    return `
      <style>
        #yt-custom-player-ui {
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            width: 90%; max-width: 800px;
            background: rgba(15, 15, 15, 0.95); 
            border: 1px solid #444; border-radius: 16px; padding: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6); z-index: 2147483647;
            display: flex; flex-direction: column; gap: 15px;
            font-family: 'Pretendard', sans-serif;
            transition: opacity 0.3s ease;
        }
        #yt-custom-player-ui.ui-idle { opacity: 0 !important; pointer-events: none; }
        
        .sep-player-header { display: flex; justify-content: space-between; align-items: center; }
        
        .sep-main-controls {
            display: flex; align-items: center; gap: 10px;
            background: rgba(255,255,255,0.05); padding: 10px; border-radius: 12px;
            position: relative; flex-wrap: wrap;
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

        .yt-pitch-btn {
            width: 24px; height: 24px; border-radius: 4px; border: 1px solid #555;
            background: #333; color: white; cursor: pointer; font-weight: bold;
            display: flex; align-items: center; justify-content: center;
            transition: background 0.1s; font-size: 16px;
        }
        .yt-pitch-btn:hover { background: #444; border-color: #888; }
        .yt-pitch-btn:active { background: #222; }

        .sep-lyrics-settings {
            position: absolute; bottom: 100%; right: 0; width: 220px;
            background: rgba(30, 30, 30, 0.95); border: 1px solid #555;
            border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 10px;
            color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.5); font-size: 13px;
        }
        .sep-ls-header { display: flex; justify-content: space-between; margin-bottom: 5px; font-weight: bold; color: #ddd; }
        .sep-ls-row { display: flex; justify-content: space-between; align-items: center; }
        .sep-ls-range { width: 120px; accent-color: #3ea6ff; }
        .sep-ls-select, .sep-ls-input { background: #444; border: none; color: white; padding: 2px 5px; border-radius: 3px; width: 100px; text-align: right; }

        #yt-custom-player-ui.fs-mode { 
            bottom: 0; left: 0; transform: none; 
            width: 100%; height: 100%; max-width: none; 
            background: transparent; border: none; padding: 40px; 
            pointer-events: none;
            backdrop-filter: none !important;
        }

        #yt-custom-player-ui.fs-mode .sep-player-header { display: none; }
        
        #yt-custom-player-ui.fs-mode .sep-main-controls { 
            position: absolute; bottom: 10%; left: 50%; transform: translateX(-50%); 
            width: 60%; min-width: 600px; 
            background: rgba(0,0,0,0.8);
            pointer-events: auto; z-index: 100;
        }

        #yt-custom-player-ui.fs-mode .sep-tracks-container { 
            background: transparent; display: block; 
            width: 100%; height: 100%; padding: 0; 
            position: absolute; top: 0; left: 0;
            pointer-events: none;
        }

        #yt-custom-player-ui.fs-mode .sep-track-group { 
            position: absolute; width: 250px; 
            background: rgba(0,0,0,0.6); padding: 20px; border-radius: 16px; 
            pointer-events: auto;
            transition: all 0.3s ease;
        }
        
        #yt-custom-player-ui.fs-mode .sep-track-vocal { top: 15%; left: 10%; }
        #yt-custom-player-ui.fs-mode .sep-track-drum  { top: 15%; right: 10%; }
        #yt-custom-player-ui.fs-mode .sep-track-other { bottom: 25%; left: 10%; }
        #yt-custom-player-ui.fs-mode .sep-track-bass  { bottom: 25%; right: 10%; }

        #yt-custom-player-ui.fs-mode .sep-track-group:hover {
            background: rgba(0,0,0,0.8); transform: scale(1.05);
        }
      </style>

      <div class="sep-player-header">
        <div style="display:flex; align-items:center; gap:10px;">
            <span id="cp-status" style="font-size:12px; color:#3ea6ff; font-weight:bold;">준비 중...</span>
            <div style="display:flex; align-items:center; gap:5px; background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:12px;">
                <span style="font-size:10px; color:#aaa;">Op</span>
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

        <div style="display:flex; align-items:center; gap:5px; background:rgba(62, 166, 255, 0.15); padding:4px 8px; border-radius:8px; margin-left:10px; border: 1px solid rgba(62, 166, 255, 0.3);">
            <span style="font-size:11px; color:#3ea6ff; font-weight:bold; margin-right:2px;">KEY</span>
            <button id="cp-pitch-down" class="yt-pitch-btn" title="반키 내림">-</button>
            <span id="cp-pitch-val" style="font-size:14px; color:#fff; width:22px; text-align:center; font-family:monospace;">0</span>
            <button id="cp-pitch-up" class="yt-pitch-btn" title="반키 올림">+</button>
            <input type="range" id="cp-pitch-slider" min="-6" max="6" step="1" value="0" style="display:none;">
        </div>

        <button id="cp-toggle-ui-btn" style="background:transparent; border:1px solid #555; color:white; border-radius:4px; padding:4px 8px; cursor:pointer; margin-left:5px;" title="UI 숨기기">👁️</button>
        <button id="cp-settings-toggle-btn" style="background:transparent; border:1px solid #555; color:white; border-radius:4px; padding:4px 8px; cursor:pointer; margin-left:5px;" title="설정">⚙️</button>
        ${settingsHTML}
      </div>

      <div class="sep-tracks-container">
        ${volumeSlidersHTML(tracks)}
      </div>
    `;
  }

  root.YTSepUITemplates = { setupPanelHTML, customPlayerHTML };
})(typeof window !== "undefined" ? window : globalThis);