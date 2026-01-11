/**
 * YouTube 메타데이터 및 소스 유형 추출
 * - Official: '음악' 섹션이 있는 공식 음원 (가사 크롤링 시도)
 * - General: 일반 영상 (자막 다운로드 시도)
 */

function getMusicInfo() {
  // "음악" 선반(Shelf) 존재 여부 확인
  const shelves = Array.from(
    document.querySelectorAll('ytd-horizontal-card-list-renderer')
  );

  const musicShelf = shelves.find(shelf => {
    const titleEl = shelf.querySelector('ytd-rich-list-header-renderer #title');
    return titleEl && titleEl.textContent.trim() === '음악';
  });

  let sourceType = 'general';
  let artist = null;
  let title = null;
  let album = null;

  if (musicShelf) {
    // 공식 음원: 메타데이터 상세 추출
    sourceType = 'official';
    const card = musicShelf.querySelector('yt-video-attribute-view-model');

    if (card) {
      const titleEl = card.querySelector('.yt-video-attribute-view-model__title');
      const artistEl = card.querySelector('.yt-video-attribute-view-model__subtitle span');
      const albumEl = card.querySelector('.yt-video-attribute-view-model__secondary-subtitle a');

      title = titleEl ? titleEl.textContent.trim() : null;
      artist = artistEl ? artistEl.textContent.trim() : null;
      album = albumEl ? albumEl.textContent.trim() : null;
    }
  }

  // 일반 영상: 영상 제목을 title로 사용
  if (sourceType === 'general' || !title) {
    const titleElement = document.querySelector('h1.title yt-formatted-string');
    if (titleElement) {
      title = titleElement.textContent.trim();
    }
  }

  console.log(`[ExtractInfo] Source: ${sourceType}, Title: ${title}, Artist: ${artist}`);

  return {
    sourceType: sourceType,
    artist: artist,
    title: title,
    album: album
  };
}

// 모듈 내보내기 (확장 프로그램 환경 고려)
if (typeof module !== 'undefined') {
  module.exports = { getMusicInfo };
} else {
  // 전역 스코프에 주입
  window.YoutubeMetaExtractor = { getMusicInfo };
}
