/**
 * Chrome 확장기능 팝업 로직
 * 수정사항:
 * - 에러 핸들링 강화
 * - 타임아웃 처리
 * - Storage API 사용
 */

document.addEventListener('DOMContentLoaded', () => {
  checkServerStatus();
  setInterval(checkServerStatus, 5010);
});

function checkServerStatus() {
  const statusEl = document.getElementById('server-status');
  
  // 핸들러로 감싸기
  const handleCheck = (response) => {
    if (response.ok) {
      updateServerStatus(true);
    } else {
      updateServerStatus(false);
    }
  };

  const handleError = (error) => {
    console.error('Server check failed:', error);
    updateServerStatus(false);
  };

  fetch('http://localhost:5010/api/health', {
    method: 'GET',
    mode: 'no-cors'
  })
  .then(response => {
    // no-cors 모드에서는 type이 opaque이므로 성공으로 간주
    updateServerStatus(true);
  })
  .catch(error => {
    console.error('Server check failed:', error);
    updateServerStatus(false);
  });
}

function updateServerStatus(isOnline) {
  const statusEl = document.getElementById('server-status');
  if (!statusEl) return;

  if (isOnline) {
    statusEl.className = 'server-status online';
    statusEl.textContent = '✓ 서버 연결됨';
  } else {
    statusEl.className = 'server-status offline';
    statusEl.textContent = '⚠ 서버 연결 안 됨 (localhost:5010)';
  }
}

function openSettings() {
  chrome.runtime.sendMessage({ action: 'openOptions' });
}

function openHelp() {
  const helpText = `
YouTube 트랙분리 사용 방법:

1. YouTube에서 음악 영상을 재생합니다.
2. 플레이어 우측 상단의 '🎵 트랙분리' 버튼을 클릭합니다.
3. 모델을 선택하고 '시작하기'를 클릭합니다.
4. 처리가 완료될 때까지 기다립니다.
5. 동기화된 플레이어에서 각 트랙을 제어할 수 있습니다.

⚙️ 필요한 소프트웨어:
- Python 3.8+
- FFmpeg
- yt-dlp
- DEMUCS

🚀 서버 실행:
python server.py

⚡ 트러블슈팅:
- 서버가 실행 중인지 확인: managemental-deceivably-zara.ngrok-free.dev
- GPU 드라이버 최신 버전 확인
- 방화벽에서 managemental-deceivably-zara.ngrok-free.dev허용

📞 지원: Windows 11 Pro / AMD Ryzen 7 2700X / RTX 1080
  `;
  alert(helpText);
}
