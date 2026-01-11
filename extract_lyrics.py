import requests
from bs4 import BeautifulSoup
import time
import logging

logger = logging.getLogger(__name__)

class BugsLyricsCrawler:
    """벅스 뮤직 가사 자동 수집 크롤러"""
    
    def __init__(self):
        self.base_search_url = "https://music.bugs.co.kr/search/integrated"
        self.base_track_url = "https://music.bugs.co.kr/track/"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    
    def search_track(self, song_name, artist_name=None, album_name=None):
        """곡을 검색하고 trackid를 반환"""
        # [수정됨] 문제가 된 print 문법 수정
        logger.info(f"[Crawler] 검색 요청: {song_name}, 가수: {artist_name}, 앨범: {album_name}")
        
        try:
            search_params = {'q': song_name}
            response = requests.get(
                self.base_search_url,
                params=search_params,
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code != 200:
                logger.error(f"[Crawler] 검색 요청 실패: {response.status_code}")
                return None
            
            soup = BeautifulSoup(response.text, 'html.parser')
            track_table = soup.find('table', class_='list trackList')
            
            if not track_table:
                logger.warning("[Crawler] 곡 목록 테이블을 찾을 수 없습니다.")
                return None
            
            rows = track_table.find_all('tr', attrs={'rowtype': 'track'})
            if not rows:
                logger.warning("[Crawler] 검색 결과가 없습니다.")
                return None
            
            # 매칭 로직
            matched_track = self._match_track(rows, artist_name, album_name)
            
            if matched_track:
                logger.info(f"[Crawler] 매칭 성공: {matched_track['title']} - {matched_track['artist']}")
                return matched_track
            else:
                logger.info("[Crawler] 정확한 매칭 실패, 첫 번째 결과 반환")
                return self._extract_track_info(rows[0])
            
        except Exception as e:
            logger.error(f"[Crawler] 검색 중 오류: {e}")
            return None

    def _extract_track_info(self, row):
        try:
            trackid = row.get('trackid')
            title = row.find('p', class_='title').get_text(strip=True) if row.find('p', class_='title') else "Unknown"
            artist = row.find('p', class_='artist').get_text(strip=True) if row.find('p', class_='artist') else "Unknown"
            album = row.find('a', class_='album').get_text(strip=True) if row.find('a', class_='album') else "Unknown"
            
            return {
                'trackid': trackid,
                'title': title,
                'artist': artist,
                'album': album
            }
        except Exception:
            return None

    def _match_track(self, rows, artist_name=None, album_name=None):
        if artist_name:
            for row in rows:
                track_info = self._extract_track_info(row)
                if track_info and artist_name.replace(" ", "").lower() in track_info['artist'].replace(" ", "").lower():
                    return track_info
        return None

    def get_lyrics(self, trackid):
        try:
            url = f"{self.base_track_url}{trackid}"
            response = requests.get(url, headers=self.headers, timeout=10)
            
            if response.status_code != 200:
                return None
            
            soup = BeautifulSoup(response.text, 'html.parser')
            lyrics_container = soup.find('div', class_='lyricsContainer')
            
            if lyrics_container and lyrics_container.find('xmp'):
                return lyrics_container.find('xmp').get_text(strip=True)
            return None
            
        except Exception as e:
            logger.error(f"[Crawler] 가사 추출 실패: {e}")
            return None

    def fetch_lyrics(self, song_name, artist_name=None, album_name=None):
        """통합 실행 함수"""
        track_info = self.search_track(song_name, artist_name, album_name)
        if not track_info:
            return None
        
        time.sleep(0.5) # 서버 부하 방지
        lyrics = self.get_lyrics(track_info['trackid'])
        
        if lyrics:
            return {
                'title': track_info['title'],
                'artist': track_info['artist'],
                'lyrics': lyrics
            }
        return None