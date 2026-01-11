/**
 * YouTube 메타데이터 및 소스 식별자 추출
 */
function getMusicInfo() {
  // Music Shelf 존재 여부로 공식 음원 판별
  const shelves = Array.from(document.querySelectorAll('ytd-horizontal-card-list-renderer'));
  const musicShelf = shelves.find(shelf => {
    const title = shelf.querySelector('#title');
    return title && (title.textContent.trim() === '음악' || title.textContent.trim() === 'Music');
  });

  let info = {
    sourceType: 'general', // 기본값: 일반 영상
    title: null,
    artist: null,
    album: null
  };

  // 공식 음원 섹션 확인
  if (musicShelf) {
    info.sourceType = 'official';
    const card = musicShelf.querySelector('yt-video-attribute-view-model');
    if (card) {
       const titleEl = card.querySelector('.yt-video-attribute-view-model__title');
       const artistEl = card.querySelector('.yt-video-attribute-view-model__subtitle span');
       const albumEl = card.querySelector('.yt-video-attribute-view-model__secondary-subtitle a');
       
       if (titleEl) info.title = titleEl.textContent.trim();
       if (artistEl) info.artist = artistEl.textContent.trim();
       if (albumEl) info.album = albumEl.textContent.trim();
    }
  }

  // 일반 영상 타이틀 백업 (Fallback)
  if (!info.title) {
    const titleEl = document.querySelector('h1.title yt-formatted-string');
    if (titleEl) info.title = titleEl.textContent.trim();
  }

  console.log('[ExtractInfo] Meta:', info);
  return info;
}

if (typeof module !== 'undefined') module.exports = { getMusicInfo };
else window.YoutubeMetaExtractor = { getMusicInfo };