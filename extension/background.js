/**
 * Chrome 확장기능 백그라운드 서비스 워커 (MV3)
 * 수정사항:
 * - chrome.contextMenus 제거 (Service Worker 비호환)
 * - 메시지 리스너만 유지
 * - 비동기 작업 처리 개선
 */

// 설치 이벤트 리스너
chrome.runtime.onInstalled.addListener(() => {
  console.log('[YouTubeTrackSeparator] 확장기능 설치됨');

  chrome.storage.sync.set({
    serverUrl: 'http://localhost:5010/',
    model: 'htdemucs',
    autoSync: true
  });
});

// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkServer') {
    fetch(`${request.serverUrl}/api/health`)
      .then(response => {
        sendResponse({ status: response.ok ? 'online' : 'offline' });
      })
      .catch(error => {
        sendResponse({ status: 'offline', error: error.message });
      });
    return true;
  }

  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
  }
});

// 탭 업데이트 감시
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com')) {
    console.log('[YouTubeTrackSeparator] YouTube 페이지 로드됨:', tab.url);
  }
});
