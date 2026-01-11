// 유튜브 "음악" 선반에서 가수, 곡명, 앨범명을 찾아 콘솔에 출력
(function () {
  function extractMusicInfo() {
    // "음악" 헤더가 붙은 horizontal-card-list-renderer 찾기
    const shelves = Array.from(
      document.querySelectorAll('ytd-horizontal-card-list-renderer')
    );

    const musicShelf = shelves.find(shelf => {
      const titleEl = shelf.querySelector(
        'ytd-rich-list-header-renderer #title'
      );
      return titleEl && titleEl.textContent.trim() === '음악';
    });

    if (!musicShelf) {
      console.log('[music] 음악 선반을 찾지 못했습니다.');
      return;
    }

    // 실제 음악 카드(ytd-video-attribute-view-model) 찾기
    const card = musicShelf.querySelector('yt-video-attribute-view-model');
    if (!card) {
      console.log('[music] 음악 카드를 찾지 못했습니다.');
      return;
    }

    // 곡명
    const titleEl = card.querySelector(
      '.yt-video-attribute-view-model__title'
    );
    // 가수명 (예: NCT WISH)
    const artistEl = card.querySelector(
      '.yt-video-attribute-view-model__subtitle span'
    );
    // 앨범명 (예: COLOR - The 3rd Mini Album)
    const albumEl = card.querySelector(
      '.yt-video-attribute-view-model__secondary-subtitle a'
    );

    const songTitle = titleEl ? titleEl.textContent.trim() : null;
    const artistName = artistEl ? artistEl.textContent.trim() : null;
    const albumName = albumEl ? albumEl.textContent.trim() : null;

    if (!songTitle && !artistName && !albumName) {
      console.log('[music] 음악 메타데이터를 추출하지 못했습니다.');
      return;
    }

    console.log('가수       :', artistName || '(알 수 없음)');
    console.log('노래 제목  :', songTitle || '(알 수 없음)');
    console.log('앨범 이름  :', albumName || '(알 수 없음)');
  }

  // SPA 구조 대비 약간 지연 후 실행, 그리고 MutationObserver로 동적 로딩 대응
  function runWithObserver() {
    extractMusicInfo();

    const observer = new MutationObserver(() => {
      // 레이아웃이 바뀌면 다시 한 번 시도
      extractMusicInfo();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 너무 오래 관찰하지 않도록 일정 시간 후 해제 (예: 10초)
    setTimeout(() => observer.disconnect(), 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runWithObserver);
  } else {
    runWithObserver();
  }
})();
