AiPlugs-Project/
├── .vscode/                 
│   ├── launch.json          
│   └── settings.json        
├── config/                      # [New] 설정 파일 관리 폴더
│   └── config.json              # SSL 예외 도메인, 로컬/웹 모드 저장
├── electron/
│   ├── main/
│   │   ├── main.js              
│   │   ├── process-manager.js   
│   │   ├── session-handler.js   
│   │   └── ipc-handler.js       # [New] 렌더러와 메인 간 통신(설정 저장 등) 처리 분리
│   ├── preload/
│   │   └── preload.js           
│   └── renderer/                
│       ├── index.html
│       ├── app.js
│       └── style.css
├── python/
│   ├── core/
│   │   ├── proxy_server.py      # Mitmproxy 애드온 클래스 정의
│   │   ├── api_server.py        # FastAPI 앱 정의
│   │   ├── injector.py          # [New] BS4를 이용한 HTML 스크립트 주입 로직
│   │   └── plugin_loader.py     # [New] 플러그인 폴더 스캔 및 모듈 동적 로드
│   ├── utils/
│   │   └── cert_manager.py      
│   ├── main.py                  # 멀티프로세싱으로 Proxy와 API 서버 동시 실행
│   └── requirements.txt         # beautifulsoup4 추가 필수
├── plugins/                     
│   └── youtube-summarizer/      
│       ├── manifest.json
│       ├── inject.js
│       └── backend.py
├── scripts/                     # [New] 개발 환경 세팅 스크립트
│   ├── install_deps.bat         # Python venv 생성 및 pip install 자동화
│   └── run_dev.bat              # 개발 모드 실행 도우미
├── resources/                   
├── .gitignore                   
└── package.json