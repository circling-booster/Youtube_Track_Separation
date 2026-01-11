// yt-sep-ui-templates.js
// 역할: UI HTML 및 반응형 CSS (전체화면 모드 지원)

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

  // 개별 트랙 슬라이더 HTML 생성 (클래스 식별자 추가)
  function volumeSlidersHTML(tracks) {
    const trackLabels = {
        'vocal': '🎤 Vocal',
        'drum': '🥁 Drum',
        'bass': '🎸 Bass',
        'other': '🎹 Other'
    };

    return tracks
      .map(track => `
        <div class="sep-track-group sep-track-${track}">
          <label class="sep-track-label">
            ${trackLabels[track] || track}
          </label>
          <input
            type="range"
            class="yt-sep-slider"
            data-track="${track}"
            min="0"
            max="100"
            value="100"
          >
        </div>
      `)
      .join("");
  }

  function customPlayerHTML(tracks) {
    return `
      <style>
        /* =========================================
           1. 기본 모드 (Window Mode) 스타일
           ========================================= */
        #yt-custom-player-ui {
            position: fixed; 
            bottom: 20px; 
            left: 50%; 
            transform: translateX(-50%);
            width: 90%; 
            max-width: 800px;
            background: rgba(15, 15, 15, 0.95); 
            backdrop-filter: blur(10px); /* 이 속성이 전체화면에서 제거되어야 함 */
            border: 1px solid #444; 
            border-radius: 16px; 
            padding: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6); 
            z-index: 2147483647;
            display: flex; 
            flex-direction: column; 
            gap: 15px;
            transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        }

        /* 상단 헤더 (타이틀, 최소화 버튼) */
        .sep-player-header {
            display: flex; justify-content: space-between; align-items: center;
        }

        /* 메인 컨트롤 (재생바, 시간) */
        .sep-main-controls {
            display: flex; align-items: center; gap: 15px;
            background: rgba(255,255,255,0.05);
            padding: 10px; border-radius: 12px;
        }

        /* 볼륨 슬라이더 컨테이너 (기본: 가로 정렬) */
        .sep-tracks-container {
            display: flex; gap: 15px; 
            background: #222; padding: 15px; border-radius: 10px;
        }
        .sep-track-group {
            display: flex; flex-direction: column; align-items: center; flex: 1;
        }
        .sep-track-label {
            font-size: 11px; color: #aaa; margin-bottom: 8px; 
            text-transform: uppercase; font-weight: bold;
        }
        .yt-sep-slider {
            width: 100%; cursor: pointer; height: 4px;
            -webkit-appearance: none; background: #444; border-radius: 2px;
        }
        .yt-sep-slider::-webkit-slider-thumb {
            -webkit-appearance: none; width: 12px; height: 12px; 
            background: #3ea6ff; border-radius: 50%;
        }

        /* =========================================
           2. 전체화면 모드 (Fullscreen HUD) 스타일
           ========================================= */
        #yt-custom-player-ui.fs-mode {
            bottom: 0; left: 0; transform: none;
            width: 100%; height: 100%; max-width: none;
            background: rgba(0, 0, 0, 0.0); /* 배경 투명 */
            backdrop-filter: none; /* [수정됨] 전체 블러 효과 제거 */
            border: none; border-radius: 0;
            padding: 40px;
            pointer-events: none; /* 배경 클릭 통과 */
        }
        
        /* 전체화면에서 헤더 숨김 (최소화 버튼 등) */
        #yt-custom-player-ui.fs-mode .sep-player-header {
            display: none;
        }

        /* 전체화면: 재생바 중앙 하단 배치 */
        #yt-custom-player-ui.fs-mode .sep-main-controls {
            position: absolute; 
            bottom: 10%; left: 50%; transform: translateX(-50%);
            width: 60%; min-width: 600px;
            background: rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(255,255,255,0.2);
            pointer-events: auto;
            z-index: 100;
        }

        /* 전체화면: 트랙 컨테이너 (레이아웃 해제) */
        #yt-custom-player-ui.fs-mode .sep-tracks-container {
            background: transparent; padding: 0;
            display: block; width: 100%; height: 100%;
        }

        /* 전체화면: 개별 트랙 코너 배치 */
        #yt-custom-player-ui.fs-mode .sep-track-group {
            position: absolute;
            width: 250px;
            background: rgba(0, 0, 0, 0.7);
            padding: 20px;
            border-radius: 16px;
            backdrop-filter: blur(4px); /* 개별 박스만 블러 처리 */
            border: 1px solid rgba(255,255,255,0.1);
            pointer-events: auto; /* 슬라이더 조작 가능 */
            transition: transform 0.2s;
        }
        #yt-custom-player-ui.fs-mode .sep-track-group:hover {
            transform: scale(1.05); border-color: rgba(255,255,255,0.4);
        }

        /* 트랙별 위치 지정 */
        #yt-custom-player-ui.fs-mode .sep-track-vocal { top: 10%; left: 5%; }    /* 좌상단 */
        #yt-custom-player-ui.fs-mode .sep-track-drum  { top: 10%; right: 5%; }   /* 우상단 */
        #yt-custom-player-ui.fs-mode .sep-track-other { bottom: 20%; left: 5%; } /* 좌하단 */
        #yt-custom-player-ui.fs-mode .sep-track-bass  { bottom: 20%; right: 5%; }/* 우하단 */

        /* 전체화면: 라벨 및 슬라이더 크기 키움 */
        #yt-custom-player-ui.fs-mode .sep-track-label {
            font-size: 18px; color: #fff; margin-bottom: 15px;
        }
        #yt-custom-player-ui.fs-mode .yt-sep-slider {
            height: 8px;
        }
        #yt-custom-player-ui.fs-mode .yt-sep-slider::-webkit-slider-thumb {
            width: 20px; height: 20px;
        }

      </style>

      <div class="sep-player-header">
        <div style="display:flex; align-items:center; gap:10px;">
            <span id="cp-status" style="font-size:12px; color:#3ea6ff; font-weight:bold;">초기화 중...</span>
            <div style="display:flex; align-items:center; gap:5px; background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:12px;">
                <span style="font-size:10px; color:#aaa;">👁️</span>
                <input 
                    type="range" 
                    id="cp-opacity-slider" 
                    min="0.2" max="1.0" step="0.05" value="0.95" 
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

      <div class="sep-main-controls">
        <button
          id="cp-play-btn"
          class="yt-sep-btn"
          style="
            width:40px; height:40px; border-radius:50%; background:#fff; color:#000;
            font-size:18px; display:flex; align-items:center; justify-content:center;
            border:none; cursor:pointer; flex-shrink:0;
          "
        >▶</button>

        <span id="cp-curr-time" style="font-size:12px; color:white; min-width:40px; text-align:right;">0:00</span>

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

        <span id="cp-total-time" style="font-size:12px; color:white; min-width:40px;">0:00</span>
      </div>

      <div class="sep-tracks-container">
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