
---

## 1. README_NEW.MD

```markdown
***

# AiPlugs (AI플러그 플랫폼) 기술 명세서 v2.0 (Dev-Unrestricted)

## 1. 프로젝트 개요 (Overview)

**AiPlugs (AI플러그 플랫폼)**는 개발자가 만든 AI 플러그인을 사용자가 네이티브 브라우저(Chrome, Edge, Firefox) 또는 내장 브라우저에서 즉시 사용할 수 있도록 **스크립트 주입(Injection) 및 트래픽 제어**를 수행하는 플랫폼입니다.

본 명세서는 초기 개발 단계의 **유연성과 자동화**에 초점을 맞추어, Windows 환경에서의 시스템 프록시 자동 설정 및 인증서 자동 등록 기능을 포함한 **완전 제어형 아키텍처**를 기술합니다.

| 항목 | 내용 |
|------|------|
| **프로젝트 명** | AiPlugs (AI플러그 플랫폼) |
| **목적** | AI 플러그인의 브라우저 통합 및 실행 (전역 트래픽 제어) |
| **대상 플랫폼** | **Windows 10/11 전용** (초기 개발 집중) |
| **핵심 기술** | Electron (UI/Process Manager), Python (System Control/Proxy Core), Mitmproxy |
| **개발 단계 특징** | SSL Pinning 우회(Passthrough) 제거 (모든 트래픽 감시), 시스템 설정 완전 자동화 |

***

## 2. 시스템 아키텍처 (System Architecture)

시스템은 UI 제어, 시스템 제어, 네트워크 코어의 유기적인 결합으로 구성됩니다.

| 구성 요소 | 역할 | 기술 스택 | 비고 |
|----------|------|----------|------|
| **User Interface** | 프로세스 관리, 플러그인 설정 UI 제공 | Electron (Node.js) | Main Process가 Python 생명주기 관리 |
| **System Controller** | **(New)** 윈도우 레지스트리 수정, 프록시 강제 적용, 인증서 등록 | Python (`winreg`, `ctypes`) | 관리자 권한 필요 없이 사용자 레벨 제어 |
| **Proxy Core** | 모든 HTTP/HTTPS 트래픽 감시, HTML 파싱 및 스크립트 주입 | Python (Mitmproxy) | Passthrough 로직 제거됨 |
| **Plugin Engine** | 로컬 AI 모델 구동 및 웹 요청 Relay | Python (FastAPI) | WebSocket 통신 |

***

## 3. 작동 모드 및 흐름 (Operation Modes)

사용자는 AiPlugs 실행 시, 별도의 브라우저 설정 없이 즉시 플러그인 기능을 사용할 수 있습니다.

### 3.1 네트워크 제어 모드 (Global Proxy Injection)
초기 개발 버전은 **전역 프록시 모드(Global System Proxy)**를 기본으로 작동합니다.

1. **자동화된 프록시 설정**: 앱 실행 시 Windows 시스템 프록시를 `127.0.0.1:{PROXY_PORT}`로 강제 변경합니다.
2. **즉시 반영 (No Restart)**: 브라우저를 재시작하지 않아도 트래픽이 AiPlugs를 통과하도록 WinINet API를 호출하여 설정을 갱신합니다.
3. **모든 트래픽 감시**: `ignore_hosts` 설정 없이 모든 도메인의 트래픽을 복호화 시도하여 개발 편의성을 높입니다. (단, SSL Pinning 사이트는 접속 불가할 수 있음)

### 3.2 추론 위치 (Inference Modes)

| 추론 위치 | 작동 방식 | 특징 |
|----------|----------|------|
| **로컬 추론 (Local)** | localhost의 FastAPI 서버와 통신 | 데이터 프라이버시, 로컬 리소스(GPU) 활용 |
| **웹 추론 (Web)** | Azure 클라우드 서버로 요청 Relay | 저사양 PC 지원, 고성능 LLM 활용 가능 |

***

## 4. 상세 기술 구현: Windows 시스템 자동화 (New Core Features)

이 프로젝트의 핵심 변경 사항인 **Windows 시스템 제어 자동화**에 대한 상세 구현 로직입니다. 이 기능들은 Python 백엔드(`windows_sys_manager.py`)에서 수행됩니다.

### 4.1 시스템 프록시 자동 설정 (Registry & WinINet)

Mitmproxy 구동 후, 사용자가 수동으로 프록시를 잡는 불편함을 없애기 위해 레지스트리를 직접 수정합니다.

#### A. 레지스트리 수정 (`winreg`)
- **타겟 키**: `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`
- **수정 값**:
  - `ProxyEnable`: 1 (활성화)
  - `ProxyServer`: `127.0.0.1:{ASSIGNED_PORT}`
  - `ProxyOverride`: `<local>;` (로컬 트래픽 제외)

#### B. 설정 즉시 반영 (`ctypes` & `WinINet`)
레지스트리만 수정하면 브라우저가 즉시 인식하지 못하므로, Windows API를 호출하여 설정을 브로드캐스트합니다.

```python
import ctypes
from ctypes import wintypes

# WinINet 상수 정의
INTERNET_OPTION_SETTINGS_CHANGED = 39
INTERNET_OPTION_REFRESH = 37

def refresh_system_settings():
    internet_set_option = ctypes.windll.Wininet.InternetSetOptionW
    # 변경 사항 알림 및 강제 새로고침
    internet_set_option(0, INTERNET_OPTION_SETTINGS_CHANGED, 0, 0)
    internet_set_option(0, INTERNET_OPTION_REFRESH, 0, 0)

```

### 4.2 루트 인증서 자동 등록 (Auto-Cert Installation)

HTTPS 복호화를 위해 Mitmproxy의 CA 인증서를 Windows의 '신뢰할 수 있는 루트 인증 기관'에 등록해야 합니다.

* **방식**: `subprocess`를 사용하여 Windows 내장 도구인 `certutil.exe`를 호출합니다.
* **명령어**:
```bash
certutil.exe -user -addstore "Root" "{Mitmproxy_Cert_Path}"

```


* **시점**: Python 백엔드 초기화 시 인증서 파일 존재 여부와 등록 여부를 체크하여 실행합니다. 이는 개발자가 매번 인증서를 설치하는 번거로움을 제거합니다.

### 4.3 안전한 종료 처리 (Cleanup Safety)

앱이 비정상 종료(Crash)되더라도 사용자의 인터넷이 끊기지 않도록 복구 로직이 필수적입니다.

* **Python `atexit` 활용**: 프로세스 종료 시그널을 감지하여 `ProxyEnable`을 0으로 되돌리고 `refresh_system_settings()`를 호출합니다.
* **Electron 감시**: Electron은 Python 자식 프로세스가 죽으면 즉시 이를 감지하고 재실행하거나 사용자에게 알립니다.

---

## 5. 상세 기술 구현: 스크립트 주입 및 통신

### 5.1 스크립트 주입 (Injection Mechanism)

**BeautifulSoup4**를 사용하여 HTML 구조를 파싱하고 스크립트를 삽입합니다. 개발 초기에는 예외 도메인 없이 HTML 응답(Content-Type: text/html)인 경우 무조건 주입을 시도합니다.

1. **Config 객체 선 주입**: 포트 번호 등 동적 환경변수를 `window.AiPlugsConfig`에 할당하는 스크립트를 최상단에 주입합니다.
2. **Main Script 주입**: 플러그인별 로직(`inject.js`)을 `head` 또는 `body` 태그 끝에 주입합니다.

### 5.2 통신 프로토콜 (IPC & WebSocket)

* **Electron ↔ Python**: 표준 입출력(Stdio)이 아닌, 실행 시 인자로 전달된 포트를 이용한 HTTP/WebSocket 통신을 지향하여 디버깅을 용이하게 합니다.
* **Frontend(Injected JS) ↔ Backend(Python)**:
* 모든 통신은 `ws://localhost:{API_PORT}/ws/{plugin_id}` 웹소켓 채널을 통해 실시간으로 이루어집니다.
* 보안 정책(CSP)은 Mitmproxy Addon에서 응답 헤더를 삭제(`CSPRemover`)하여 해결합니다.



---

# 📂 AiPlugs Project Structure & Implementation Spec v2.0

이 문서는 **Windows 시스템 제어 자동화**와 **전역 트래픽 감시**를 중심으로 재설계된 AiPlugs의 파일 구조 및 구현 상세를 정의합니다. 이전 버전 대비 **시스템 제어 모듈(Windows System Manager)**이 추가되었으며, 복잡한 예외 처리 로직(Passthrough)을 제거하여 코어 엔진을 경량화했습니다.

## 1. 디렉토리 트리 구조 (New Directory Tree)

```text
AiPlugs-Project/
├── .vscode/                     # VS Code 개발 환경 설정
│   ├── launch.json              # Electron과 Python 동시 디버깅 구성
│   └── settings.json            
├── config/                      # 사용자 및 시스템 설정
│   └── settings.json            # (간소화됨) 추론 모드, 마지막 윈도우 위치 등 저장
├── logs/                        # 시스템 로그 (GitIgnore)
│   ├── electron.log             # UI/메인 프로세스 로그
│   └── python_core.log          # Python 로직 및 프록시 로그 통합
├── electron/                    # [UI & Supervisor]
│   ├── main/                    
│   │   ├── main.js              # 앱 진입점, Python 프로세스 실행 요청
│   │   ├── process-manager.js   # [중요] Python Spawn/Kill 및 종료 시그널 처리 강화
│   │   └── ipc-handler.js       # 렌더러와 메인 간 통신
│   ├── preload/                 
│   │   └── preload.js           # 보안 컨텍스트 브리지
│   └── renderer/                
│       ├── assets/              
│       ├── index.html           
│       └── app.js               
├── python/                      # [Core Engine & System Control]
│   ├── core/                    
│   │   ├── api_server.py        # FastAPI (웹소켓, 플러그인 라우팅)
│   │   ├── proxy_launcher.py    # Mitmproxy 인스턴스 구동 (DumpMaster 활용)
│   │   ├── injector.py          # HTML 파싱 및 JS 주입 (BS4)
│   │   └── plugin_loader.py     # 플러그인 로드
│   ├── addons/                  # [Mitmproxy Addons]
│   │   ├── csp_remover.py       # CSP, X-Frame-Options 헤더 무조건 삭제
│   │   └── script_injector.py   # mitmproxy 이벤트 훅 -> injector.py 호출
│   ├── utils/                   # [System Utilities] - 기능 대폭 강화
│   │   ├── windows_sys_manager.py # [New] 레지스트리 수정, WinINet API 호출, 복구 로직
│   │   ├── cert_installer.py    # [New] certutil 자동화 (인증서 자동 등록)
│   │   └── logger.py            
│   ├── main.py                  # [Entry] 설정 초기화 -> 프록시 시작 -> API 서버 시작
│   └── requirements.txt         # pywin32, mitmproxy, fastapi, uvicorn, beautifulsoup4
├── plugins/                     # 플러그인 저장소
│   └── youtube-summarizer/      
├── scripts/                     # 개발 및 빌드 스크립트
│   ├── install_deps.bat         
│   └── reset_proxy.bat          # [비상용] 개발 중 강제 종료 시 프록시 초기화용 스크립트
├── .gitignore                   
└── package.json                 

```

---

## 2. 모듈별 상세 구현 명세 (Implementation Details)

### 🔵 Electron (Supervisor)

**역할:** UI 제공 및 Python 엔진의 생명주기 관리. 시스템 프록시를 건드리는 Python 프로세스가 비정상 종료되지 않도록 감시합니다.

* **`electron/main/process-manager.js`**
* **Startup:** `get-port`로 포트 확보 후 Python 실행 시 인자로 전달 (`--proxy-port`, `--api-port`).
* **Graceful Shutdown (필수):** 앱 종료 시 `SIGINT` 또는 `SIGTERM`을 Python에 보내, Python이 **`atexit` 훅을 실행할 시간을 반드시 보장**해야 합니다. 즉시 `SIGKILL`하지 않도록 타이머를 둡니다.



### 🟠 Python (System Controller & Core)

**역할:** 윈도우 시스템 설정을 장악하고 트래픽을 처리합니다.

#### 1. System Control (`python/utils/`)

* **`windows_sys_manager.py` (핵심 신규 모듈)**
* **Registry Control:** `winreg` 모듈을 사용해 프록시 서버 주소를 `127.0.0.1:{PROXY_PORT}`로 설정하고 `ProxyEnable`을 1로 변경합니다.
* **WinINet Refresh:** 레지스트리 변경 후 `ctypes.windll.Wininet.InternetSetOptionW`를 호출하여 OS가 변경된 설정을 즉시 다시 읽도록 강제합니다. (브라우저 재시작 불필요)
* **Cleanup:** `disable_proxy()` 함수를 제공하여 앱 종료 시 설정을 원상복구합니다.


* **`cert_installer.py`**
* Mitmproxy가 처음 실행될 때 생성하는 `~/.mitmproxy/mitmproxy-ca-cert.cer` 경로를 찾습니다.
* `subprocess.run(["certutil", "-user", "-addstore", "Root", cert_path])` 명령을 실행하여 사용자 개입 없이 인증서를 신뢰할 수 있는 루트 기관에 등록합니다.
* 등록 여부를 레지스트리나 파일로 플래그 처리하여 매번 실행되지 않도록 최적화합니다.



#### 2. Core Engine (`python/core/` & `python/addons/`)

* **`main.py`**
* **Lifecycle:**
1. `cert_installer.py` 실행 (인증서 확보).
2. `proxy_launcher.py` (Mitmproxy)를 별도 스레드/프로세스로 시작.
3. `windows_sys_manager.py`를 호출하여 시스템 프록시 활성화.
4. `api_server.py` (FastAPI) 시작.
5. `atexit.register(cleanup)`을 통해 종료 시 프록시 설정 해제 보장.




* **`addons/script_injector.py` & `core/injector.py**`
* **Passthrough 제거:** 이전의 복잡한 도메인 필터링 로직(`flow_controller.py`)을 제거했습니다.
* **Logic:** 요청 흐름(`response`)을 가로채 `Content-Type`이 `text/html`인 경우 무조건 `injector.py`를 호출합니다.
* **Injection:** BS4를 이용해 `<head>`에 `window.AiPlugsConfig = { ... }`를, `<body>` 끝에 플러그인 스크립트를 주입합니다.


* **`addons/csp_remover.py`**
* 모든 응답 헤더에서 `Content-Security-Policy`, `X-Frame-Options`를 제거하여 주입된 스크립트가 차단되는 것을 방지합니다.



---

## 3. 핵심 동작 시나리오 (Critical Workflows)

### 3.1 완전 자동화된 시작 (Automated Startup)

1. **[Electron]** 앱 실행 -> 가용 포트 탐색 (API: 5500, Proxy: 8800).
2. **[Electron]** Python 프로세스 실행 (`--proxy-port 8800`).
3. **[Python]** `certutil`로 인증서 자동 등록 (최초 1회).
4. **[Python]** Mitmproxy 서버를 8800 포트에서 백그라운드 시작.
5. **[Python]** **`windows_sys_manager` 작동**:
* 레지스트리에 프록시(`127.0.0.1:8800`) 입력.
* `WinINet` API 호출 -> **시스템 전체 프록시 즉시 적용**.


6. **[User]** Chrome/Edge를 켜면 트래픽이 AiPlugs를 경유함.

### 3.2 안전한 종료 및 복구 (Fail-Safe Shutdown)

1. **[User]** AiPlugs 앱 종료 (X 버튼).
2. **[Electron]** `BeforeQuit` 이벤트 발생 -> Python 프로세스에 종료 신호 전송.
3. **[Python]** 종료 신호 수신 -> `atexit` 핸들러 트리거.
4. **[Python]** `windows_sys_manager.disable_proxy()` 실행.
* 레지스트리 `ProxyEnable = 0` 복구.
* `WinINet` API 호출 -> **시스템 프록시 해제 즉시 적용**.


5. **[Python]** 프로세스 종료.

**※ 비상 상황 대비:**
개발 중 IDE 강제 종료 등으로 Python이 `atexit`를 못 타고 죽을 경우를 대비해, `scripts/reset_proxy.bat` 파일을 제공하여 사용자가 더블 클릭 한 번으로 인터넷 연결을 복구할 수 있도록 합니다.



```
