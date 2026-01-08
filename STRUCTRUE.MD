
---

### 📝 수정된 STRUCTRUE.MD

기존 로직은 그대로 유지하되, **README 6.6항(SSL/Proxy 자동화)** 내용을 `python/utils` 및 `scripts` 영역에 구체적으로 반영했습니다.

```markdown
# 📂 AiPlugs Project Structure & Implementation Spec v1.2

이 문서는 **AiPlugs(AI플러그 플랫폼)**의 개선된 파일 구조와 각 모듈의 핵심 구현 로직을 정의합니다. 이전 버전 대비 **유지보수성(모듈 분리)**, **안정성(로그/예외처리)**, **보안(권한 관리)**이 강화되었으며, 특히 **Windows 개발 환경에서의 SSL/프록시 자동화 로직**이 구체화되었습니다.

## 1. 개선된 디렉토리 트리 (Enhanced Directory Tree)

```text
AiPlugs-Project/
├── .vscode/                     # VS Code 개발 환경 설정
│   ├── launch.json              # [F5] 디버깅 설정 (Electron + Python 동시 디버깅)
│   └── settings.json            # 프로젝트 전용 에디터 설정 (Linting 등)
├── config/                      # [Storage] 사용자 설정 저장소
│   └── settings.json            # SSL 예외 도메인, 추론 모드, 마지막 포트 정보 등
├── logs/                        # [System] 시스템 로그 저장소 (Git 제외 대상)
│   ├── app.log                  # Electron 및 일반 로그
│   └── mitmproxy.log            # 프록시 트래픽/에러 로그
├── electron/                    # [UI & Controller] Node.js 영역
│   ├── main/                    # 메인 프로세스 (백그라운드)
│   │   ├── main.js              # 앱 진입점 (Life Cycle)
│   │   ├── process-manager.js   # Python 프로세스 Spawn/Kill 및 포트 할당
│   │   ├── session-handler.js   # Electron 내부 브라우저용 CSP 우회 설정
│   │   └── ipc-handler.js       # UI 요청 처리 (설정 저장, 플러그인 상태 변경)
│   ├── preload/                 # 렌더러-메인 브리지
│   │   └── preload.js           # API_PORT 정보를 window 객체로 안전하게 전달
│   └── renderer/                # 사용자 UI (프론트엔드)
│       ├── assets/              # 이미지, 아이콘, 폰트 리소스
│       ├── index.html           # 메인 대시보드
│       ├── app.js               # UI 인터랙션 로직
│       └── style.css            # 스타일 시트
├── python/                      # [Logic & Engine] Python 영역
│   ├── core/                    # 핵심 엔진
│   │   ├── api_server.py        # FastAPI (CORS 설정, 플러그인 통신, Relay)
│   │   ├── proxy_server.py      # Mitmproxy 구동 및 애드온 로더
│   │   ├── injector.py          # HTML 파싱(BS4), 스크립트 및 Config 변수 주입
│   │   ├── plugin_loader.py     # 플러그인 동적 로드 (Importlib)
│   │   └── addons/              # [Mitmproxy] 기능 모듈화
│   │       ├── csp_remover.py   # CSP/X-Frame-Options 헤더 삭제 로직
│   │       └── flow_controller.py # SSL Passthrough 및 요청 필터링
│   ├── utils/                   # 유틸리티 (OS 제어 핵심)
│   │   ├── cert_manager.py      # [Updated] certutil 및 WinINet API 이용 인증서 자동 등록
│   │   ├── system_proxy.py      # [New] Windows 레지스트리/ctypes 이용 시스템 프록시 On/Off
│   │   ├── logger.py            # 로그 포맷팅 및 파일 저장 처리
│   │   └── admin_utils.py       # [New] 관리자 권한 획득 및 프로세스 권한 확인
│   ├── main.py                  # Python 진입점 (Arg Parsing & Multiprocessing)
│   └── requirements.txt         # Python 의존성 (mitmproxy, fastapi, uvicorn, bs4, pywin32 등)
├── plugins/                     # [User Data] 플러그인 패키지 폴더
│   └── youtube-summarizer/      # (예시)
│       ├── manifest.json        
│       ├── inject.js            
│       └── backend.py           
├── scripts/                     # [Tools] 윈도우용 배치 스크립트
│   ├── install_deps.bat         # npm install & pip install
│   ├── run_dev.bat              # 개발 모드 실행
│   └── register_cert.bat        # [Backup] 인증서 수동 등록 (파이썬 자동화 실패 시 예비용)
├── .gitignore                   # logs, node_modules, __pycache__ 제외
└── package.json                 # Node.js 설정

```

---

## 2. 모듈별 상세 구현 명세 (Implementation Details)

### 🟢 1. 루트 및 설정 (Root & Config)

* **`logs/`**: 개발 및 런타임 중 발생하는 오류를 추적합니다.
* **`config/settings.json`**:
* *핵심 키:* `passthrough_hosts` (은행 등 SSL 해제 제외 목록), `inference_mode` (Local/Web).



### 🔵 2. Electron (Process Manager & UI)

**역할:** 전체 애플리케이션의 **생명주기(Life Cycle)**와 **리소스(Port)**를 관리하는 사령관입니다.

* **`process-manager.js` (핵심 로직)**
1. 앱 시작 시 `get-port`로 `API_PORT`(FastAPI), `PROXY_PORT`(Mitmproxy) 확보.
2. `child_process.spawn`으로 Python 실행 (`python main.py --api-port 1234 --proxy-port 8080`).
3. **종료 처리:** 앱 종료 시 `tree-kill` 라이브러리 등을 사용해 Python 자식 프로세스를 확실히 사살(Kill)하여 포트 점유 방지.


* **`session-handler.js`**
* Electron **내장 브라우저** 사용 시 `onHeadersReceived`를 통해 CSP 헤더를 제거합니다.



### 🟠 3. Python (Proxy Core & Engine)

**역할:** 트래픽 제어, 스크립트 주입, 그리고 **Windows 시스템 설정(SSL, Proxy) 자동화**를 담당합니다.

* **`utils/cert_manager.py` (자동화 강화 - README 6.6 반영)**
* Mitmproxy가 생성한 `mitmproxy-ca-cert.cer`를 감지합니다.
* `subprocess`로 `certutil -addstore root ...` 명령어를 실행하거나, Python `ctypes` 라이브러리를 사용해 Windows 인증서 스토어에 **프로그래밍 방식**으로 접근하여 인증서를 등록합니다. (관리자 권한 필요 시 `admin_utils.py` 호출)


* **`utils/system_proxy.py` (신규 추가 - Global Proxy Mode 지원)**
* Windows 레지스트리(`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`)를 수정하거나 `WinINet` API(`InternetSetOptionW`)를 호출하여, **시스템 전체 프록시**를 켜고 끕니다.
* 앱 종료 시 반드시 프록시 설정을 원상복구(Off)하는 안전장치를 포함합니다.


* **`core/api_server.py`**
* **CORS 설정:** 브라우저(Injected JS)에서 로컬 서버로 요청 시 발생하는 CORS 문제를 해결하기 위해 `CORSMiddleware`를 `allow_origins=["*"]`로 설정합니다.
* **Relay:** Azure 클라우드로 요청을 토스할 때 API Key를 헤더에 은밀히 포함합니다.


* **`core/injector.py`**
* **BS4(BeautifulSoup4) 사용:** Regex 대신 HTML 파서로 안전하게 `<head>` 또는 `<body>`를 찾아 스크립트를 주입합니다.
* **Config Injection:** `<script>window.AiPlugsConfig = { apiPort: ... }</script>`를 최상단에 먼저 주입합니다.


* **`addons/flow_controller.py`**
* **SSL Pinning 우회:** `settings.json`의 `passthrough_hosts`에 있는 도메인(은행, 구글 등)은 `tls_clienthello` 단계에서 인터셉트를 포기하고 **TCP Passthrough** 처리합니다.



### 🟣 4. Plugins (확장성)

* **`manifest.json`**: 정규식(`url_regex`)으로 주입 대상을 지정.
* **`backend.py`**: FastAPI 라우터 모듈. 로컬 추론 시 무거운 연산 수행.

---

## 3. 핵심 동작 흐름 (Critical Workflows)

### 3.1 초기 구동 및 환경 설정 (Setup)

1. **[Electron]** 포트 확보 및 Python 실행.
2. **[Python]** `admin_utils.py`를 통해 관리자 권한 확인 (필요시 UAC 요청).
3. **[Python]** `cert_manager.py`가 루트 인증서 설치 여부 확인 -> 미설치 시 자동 등록 시도.
4. **[Python]** `system_proxy.py`가 Windows 시스템 프록시를 `127.0.0.1:PROXY_PORT`로 설정.

### 3.2 안전한 종료 (Teardown)

1. **[Electron]** 창 닫힘 감지 -> Python에 종료 시그널 전송.
2. **[Python]** `atexit` 또는 시그널 핸들러 작동 -> `system_proxy.py`가 **시스템 프록시 해제** (중요: 이거 안 하면 인터넷 먹통 됨).
3. **[Electron]** 프로세스 강제 종료 확인.

---

## 4. 개발 시 주의사항 (Developer Notes)

1. **관리자 권한과 UAC:**
* 인증서 등록과 시스템 프록시 변경은 권한이 필요합니다. 개발 시 VS Code를 **'관리자 권한으로 실행'**하는 것이 정신 건강에 이롭습니다. 배포 시에는 Electron의 `elevate` 관련 모듈을 고려해야 합니다.


2. **WinINet API vs Registry:**
* 레지스트리만 수정하면 브라우저가 즉시 인식하지 못할 수 있습니다. `ctypes`를 통해 `InternetSetOption` API를 호출하여 **"설정 변경됨"** 신호를 OS에 줘야 즉시 반영됩니다 (`utils/system_proxy.py` 구현 시 필수).


3. **인터넷 끊김 현상:**
* 개발 중 앱이 비정상 종료되어 프록시 설정이 안 풀리면 인터넷이 안 됩니다. 이때는 `Windows 설정 > 네트워크 > 프록시`에서 수동으로 끄거나, 복구용 배치 파일(`scripts/reset_proxy.bat` 등)을 만들어두는 것을 추천합니다.



```


