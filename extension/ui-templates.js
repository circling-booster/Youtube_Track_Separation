// yt-sep-ui-templates.js
// 역할: UI에 들어가는 "HTML 문자열"만 관리 (로직/이벤트 바인딩 없음)

(function (root) {
  function setupPanelHTML() {
    return `
      <h3 style="margin:0 0 15px 0;">트랙 분리 스튜디오</h3>

      <select
        id="sep-model"
        style="width:100%; padding:10px; background:#333; color:white; border:none; margin-bottom:15px; border-radius:4px;"
      >
        <option value="htdemucs">htdemucs (빠름/권장)</option>
        <option value="htdemucs_ft">htdemucs_ft (고품질/느림)</option>
      </select>

      <div id="sep-progress-area" style="display:none; margin-bottom:15px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#aaa; margin-bottom:5px;">
          <span id="sep-status-text">처리 중...</span>
          <span id="sep-percent">0%</span>
        </div>
        <div style="height:4px; background:#333; border-radius:2px;">
          <div
            id="sep-progress-bar"
            style="width:0%; height:100%; background:#3ea6ff; transition:width 0.3s;"
          ></div>
        </div>
      </div>

      <div style="display:flex; gap:10px;">
        <button
          id="sep-start-btn"
          class="yt-sep-btn"
          style="flex:1; padding:10px; background:#3ea6ff; color:black; border-radius:4px; font-weight:bold;"
        >시작</button>

        <button
          id="sep-close-btn"
          class="yt-sep-btn"
          style="flex:1; padding:10px; background:#444; color:white; border-radius:4px;"
        >취소</button>
      </div>
    `;
  }

  function volumeSlidersHTML(tracks) {
    return tracks
      .map(
        (track) => `
        <div style="display:flex; flex-direction:column; align-items:center; flex:1;">
          <label style="font-size:11px; color:#aaa; margin-bottom:8px; text-transform:uppercase; font-weight:bold;">
            ${track}
          </label>
          <input
            type="range"
            class="yt-sep-slider"
            data-track="${track}"
            min="0"
            max="100"
            value="100"
            style="width:100%; cursor:pointer;"
          >
        </div>
      `
      )
      .join("");
  }

  function customPlayerHTML(tracks) {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
            <span id="cp-status" style="font-size:12px; color:#3ea6ff; font-weight:bold;">초기화 중...</span>
            
            <div style="display:flex; align-items:center; gap:5px; background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:12px;">
                <span style="font-size:10px; color:#aaa;">👁️</span>
                <input 
                    type="range" 
                    id="cp-opacity-slider" 
                    min="0.2" 
                    max="1.0" 
                    step="0.05" 
                    value="0.95" 
                    style="width:60px; height:4px; accent-color:#aaa; cursor:pointer;"
                    title="플레이어 투명도 조절"
                >
            </div>
        </div>

        <div style="display:flex; gap:10px;">
            <button id="cp-minimize-btn" title="최소화" style="background:none; border:none; color:#ccc; cursor:pointer; font-size:16px; font-weight:bold;">_</button>
            <button id="cp-close-btn" title="종료" style="background:none; border:none; color:#ccc; cursor:pointer; font-size:16px;">✕</button>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:15px;">
        <button
          id="cp-play-btn"
          class="yt-sep-btn"
          style="
            width:45px; height:45px; border-radius:50%; background:#fff; color:#000;
            font-size:20px; display:flex; align-items:center; justify-content:center;
            border:none; cursor:pointer;
          "
        >▶</button>

        <span id="cp-curr-time" style="font-size:12px; min-width:40px; text-align:right;">0:00</span>

        <div style="flex:1; position:relative; height:20px; display:flex; align-items:center;">
          <input
            type="range"
            id="cp-progress"
            class="yt-sep-slider"
            min="0"
            max="100"
            step="0.1"
            value="0"
            style="width:100%; height:6px;"
          >
        </div>

        <span id="cp-total-time" style="font-size:12px; min-width:40px;">0:00</span>
      </div>

      <div style="display:flex; gap:15px; background:#222; padding:15px; border-radius:10px;">
        ${volumeSlidersHTML(tracks)}
      </div>
    `;
  }

  // 전역으로 노출
  root.YTSepUITemplates = {
    setupPanelHTML,
    customPlayerHTML,
  };
})(typeof window !== "undefined" ? window : globalThis);