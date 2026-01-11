import requests
from bs4 import BeautifulSoup
import time
from urllib.parse import quote



class BugsLyricsCrawler:
    """벅스 뮤직 가사 자동 수집 크롤러"""
    
    def __init__(self):
        self.base_search_url = "https://music.bugs.co.kr/search/integrated"
        self.base_track_url = "https://music.bugs.co.kr/track/"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    
    def search_track(self, song_name, artist_name=None, album_name=None):
        print(self, song_name, artist_name=None, album_name=None)
        """
        곡을 검색하고 trackid를 반환
        
        Args:
            song_name (str): 노래 제목 (필수)
            artist_name (str): 가수 이름 (선택)
            album_name (str): 앨범 이름 (선택)
            
        Returns:
            dict: {'trackid': str, 'artist': str, 'album': str} 또는 None
        """
        try:
            # 1. 검색 URL 요청
            search_params = {'q': song_name}
            response = requests.get(
                self.base_search_url,
                params=search_params,
                headers=self.headers,
                timeout=10
            )
            response.encoding = 'utf-8'
            
            if response.status_code != 200:
                print(f"[ERROR] 검색 요청 실패: {response.status_code}")
                return None
            
            # 2. HTML 파싱
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # 곡 목록 테이블 찾기
            track_table = soup.find('table', class_='list trackList')
            if not track_table:
                print("[ERROR] 곡 목록 테이블을 찾을 수 없습니다.")
                return None
            
            # 3. 테이블의 모든 행(tr) 파싱
            rows = track_table.find_all('tr', attrs={'rowtype': 'track'})
            if not rows:
                print("[ERROR] 검색 결과가 없습니다.")
                return None
            
            print(f"[INFO] 검색 결과: {len(rows)}개 곡 발견")
            
            # 4. 가수명/앨범명으로 매칭
            matched_track = self._match_track(rows, artist_name, album_name)
            
            if matched_track:
                print(f"[SUCCESS] 매칭된 곡: {matched_track['title']} - {matched_track['artist']}")
                return matched_track
            else:
                print("[WARNING] 일치하는 곡이 없습니다. 첫 번째 결과 반환")
                return self._extract_track_info(rows[0])
            
        except requests.exceptions.RequestException as e:
            print(f"[ERROR] 요청 실패: {e}")
            return None
        except Exception as e:
            print(f"[ERROR] 파싱 실패: {e}")
            return None
    
    def _extract_track_info(self, row):
        """
        테이블 행에서 trackid, artist, album 추출
        
        Args:
            row: BeautifulSoup tr 요소
            
        Returns:
            dict: {'trackid': str, 'title': str, 'artist': str, 'album': str}
        """
        try:
            # tr 속성에서 trackid 추출
            trackid = row.get('trackid')
            
            # 곡 제목 추출
            title_elem = row.find('p', class_='title')
            title = title_elem.get_text(strip=True) if title_elem else "Unknown"
            
            # 가수명 추출
            artist_elem = row.find('p', class_='artist')
            artist = artist_elem.get_text(strip=True) if artist_elem else "Unknown"
            
            # 앨범명 추출
            album_elem = row.find('a', class_='album')
            album = album_elem.get_text(strip=True) if album_elem else "Unknown"
            
            return {
                'trackid': trackid,
                'title': title,
                'artist': artist,
                'album': album
            }
        except Exception as e:
            print(f"[ERROR] 트랙 정보 추출 실패: {e}")
            return None
    
    def _match_track(self, rows, artist_name=None, album_name=None):
        """
        가수명/앨범명으로 트랙 매칭 (부분 일치)
        
        Args:
            rows: BeautifulSoup tr 요소 리스트
            artist_name (str): 가수 이름
            album_name (str): 앨범 이름
            
        Returns:
            dict: 매칭된 트랙 정보 또는 None
        """
        # 1순위: 가수명 부분 일치
        if artist_name:
            for row in rows:
                track_info = self._extract_track_info(row)
                if track_info and artist_name.lower() in track_info['artist'].lower():
                    print(f"[INFO] 가수명으로 매칭됨: {track_info['artist']}")
                    return track_info
        
        # 2순위: 앨범명 부분 일치
        if album_name:
            for row in rows:
                track_info = self._extract_track_info(row)
                if track_info and album_name.lower() in track_info['album'].lower():
                    print(f"[INFO] 앨범명으로 매칭됨: {track_info['album']}")
                    return track_info
        
        # 매칭 실패
        return None
    
    def get_lyrics(self, trackid):
        """
        trackid로 가사 수집
        
        Args:
            trackid (str): 곡 ID
            
        Returns:
            str: 가사 텍스트 또는 None
        """
        try:
            # 곡 페이지 접속
            track_url = f"{self.base_track_url}{trackid}"
            response = requests.get(
                track_url,
                headers=self.headers,
                timeout=10
            )
            response.encoding = 'utf-8'
            
            if response.status_code != 200:
                print(f"[ERROR] 곡 페이지 요청 실패: {response.status_code}")
                return None
            
            # HTML 파싱
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # 가사 컨테이너 찾기
            lyrics_container = soup.find('div', class_='lyricsContainer')
            if not lyrics_container:
                print("[ERROR] 가사 컨테이너를 찾을 수 없습니다.")
                return None
            
            # xmp 태그에서 가사 추출
            xmp_tag = lyrics_container.find('xmp')
            if xmp_tag:
                lyrics = xmp_tag.get_text(strip=True)
                print("[SUCCESS] 가사 수집 완료")
                return lyrics
            else:
                print("[WARNING] xmp 태그를 찾을 수 없습니다.")
                return None
            
        except requests.exceptions.RequestException as e:
            print(f"[ERROR] 곡 페이지 요청 실패: {e}")
            return None
        except Exception as e:
            print(f"[ERROR] 가사 추출 실패: {e}")
            return None
    
    def fetch_lyrics(self, song_name, artist_name=None, album_name=None):
        """
        통합 함수: 검색 → 매칭 → 가사 수집
        
        Args:
            song_name (str): 노래 제목 (필수)
            artist_name (str): 가수 이름 (선택)
            album_name (str): 앨범 이름 (선택)
            
        Returns:
            dict: {
                'title': str,
                'artist': str,
                'album': str,
                'trackid': str,
                'lyrics': str
            } 또는 None
        """
        print(f"\n[START] 노래 검색: {song_name}")
        if artist_name:
            print(f"         가수: {artist_name}")
        if album_name:
            print(f"         앨범: {album_name}")
        
        # 1. 곡 검색 및 매칭
        track_info = self.search_track(song_name, artist_name, album_name)
        if not track_info:
            print("[FAILED] 곡을 찾을 수 없습니다.")
            return None
        
        # 요청 간격 (서버 부하 방지)
        time.sleep(1)
        
        # 2. 가사 수집
        lyrics = self.get_lyrics(track_info['trackid'])
        if not lyrics:
            print("[WARNING] 가사를 수집할 수 없습니다.")
            return track_info
        
        # 3. 결과 반환
        result = {
            'title': track_info['title'],
            'artist': track_info['artist'],
            'album': track_info['album'],
            'trackid': track_info['trackid'],
            'lyrics': lyrics
        }
        
        return result


# ============================================================================
# 사용 예제
# ============================================================================

if __name__ == "__main__":
    crawler = BugsLyricsCrawler()
    
    # 예제 1: 노래 제목만 사용
   # print("=" * 80)
   # print("예제 1: 노래 제목만 사용")
    #print("=" * 80)
   # result1 = crawler.fetch_lyrics("사건의 지평선")
   # if result1:
   #     print(f"\n곡: {result1['title']}")
   #     print(f"가수: {result1['artist']}")
   #     print(f"앨범: {result1['album']}")
   #     print(f"TrackID: {result1['trackid']}")
   #     print(f"\n가사:\n{result1['lyrics']}\n")
    
    # 예제 2: 가수명 지정
    #print("\n" + "=" * 80)
    #print("예제 2: 가수명 지정")
    #print("=" * 80)
    #result2 = crawler.fetch_lyrics("사건의 지평선", artist_name="윤하")
    #if result2:
        #print(f"\n곡: {result2['title']}")
        #print(f"가수: {result2['artist']}")
        #print(f"앨범: {result2['album']}")
        #print(f"TrackID: {result2['trackid']}")
        #print(f"\n가사:\n{result2['lyrics']}\n")
    
    # 예제 3: 가수명 + 앨범명 지정
    print("\n" + "=" * 80)
    print("예제 3: 가수명 + 앨범명 지정")
    print("=" * 80)
    result3 = crawler.fetch_lyrics(
        "사건의 지평선",
        artist_name="윤하",
        album_name="END THEORY"
    )
    if result3:
        print(f"\n곡: {result3['title']}")
        print(f"가수: {result3['artist']}")
        print(f"앨범: {result3['album']}")
        print(f"TrackID: {result3['trackid']}")
        print(f"\n가사:\n{result3['lyrics']}\n")
