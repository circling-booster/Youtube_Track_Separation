

***

# AiPlugs (AI플러그 플랫폼) 기술 명세서 정리

## 1. 프로젝트 개요 (Overview)

**AiPlugs (AI플러그 플랫폼)**는 개발자가 만든 AI 플러그인을 사용자가 네이티브 브라우저(Chrome, Edge, Firefox) 또는 내장 브라우저에서 사용할 수 있도록 **스크립트 주입(Injection) 기능**을 제공하는 플랫폼입니다.

| 항목 | 내용 |
|------|------|
| **프로젝트 명** | AiPlugs (AI플러그 플랫폼) |
| **목적** | AI 플러그인의 브라우저 통합 및 실행 |
| **대상 플랫폼** | Windows (.exe) ,macOS 지원  |
| **핵심 기술** | Electron (UI), Python (로직/서버), Mitmproxy (네트워크 트래픽 제어) |

***

## 2. 시스템 아키텍처 (System Architecture)

시스템은 크게 **3가지 핵심 요소**로 구성됩니다:

| 구성 요소 | 역할 | 기술 스택 |
|----------|------|----------|
| **User Interface** | 플러그인 관리, 설정(로컬/웹 추론 선택), 프로세스 제어 | Electron (Node.js) |
| **Proxy Core** | 네트워크 트래픽 감시, SSL 복호화, 스크립트 주입(Injection) 수행 | Python (Mitmproxy) |
| **Plugin Engine** | 로컬 AI 모델 구동 및 요청 처리 (로컬 추론 시) | Python (FastAPI) |

***

## 3. 작동 모드 및 흐름 (Operation Modes)

사용자는 **브라우저 모드**와 **추론 위치**를 조합하여 플랫폼을 사용합니다.

### 3.1 브라우저 모드 (어디서 실행되는가?)

#### 1) 내장 브라우저 모드 (Built-in Browser)
- AiPlugs 프로그램 내부의 **Electron 브라우저**를 사용합니다.
- 애플리케이션 자체에 통합된 브라우저 환경에서 플러그인이 작동합니다.

#### 2) 프록시 서버 모드 (Proxy Server - Global)
- Chrome, Edge, Firefox **외부 브라우저**의 트래픽을 **Mitmproxy**가 감시(Intercept)하여 플러그인을 작동시킵니다.
- **SSL 인증서**: HTTPS 검사를 위해 Mitmproxy 인증서 등록이 필요합니다.
  - 미등록 시 자동(관리자 권한) 또는 수동 등록 가이드를 제공합니다.

### 3.2 추론 위치 (AI를 어디서 돌리는가?)

플러그인별로 설정이 가능하며, 두 가지 모드가 있습니다:

| 추론 위치 | 작동 방식 | 장점 |
|----------|----------|------|
| **로컬 추론 (Local)** | 내 PC의 파이썬 서버(localhost)와 통신하여 AI 모델 구동 | 데이터 보안, 무료 사용 |
| **웹 추론 (Web)** | 클라우드(AiPlugs Azure 서버)와 통신하여 AI 모델 구동 | 저사양 PC에서도 고성능 모델 사용 가능 |

***

## 4. 상세 기술 구현 (Technical Implementation)

### 4.1 플러그인 표준 규격 (File Structure)

플러그인은 `plugins/` 폴더 내에 **고유 ID**를 가진 폴더로 관리됩니다.

#### 폴더 구조 예시:
```
AiPlugs/
  └── plugins/
       └── youtube-summarizer/  # [플러그인 ID]
            ├── manifest.json   # 설정 파일
            ├── inject.js       # 웹페이지에 주입될 자바스크립트
            └── backend.py      # 로컬 추론용 파이썬 모듈
```

#### Manifest 명세 (manifest.json):
- **injection_targets**: 어떤 URL(url_regex)에서, 어디에(inject_location: "head" 또는 "body_end") 스크립트를 넣을지 정의합니다.
- **permissions**: 로컬 파일 접근 권한 등을 제어합니다. (기본값: false)

### 4.2 실행 및 연결 로직 (IPC & Ports)

포트 충돌(EADDRINUSE)을 방지하기 위해 다음과 같은 로직을 사용합니다:

1. **Electron(Node.js)**: 비어 있는 랜덤 포트를 찾습니다.
2. **Python 실행**: 찾은 포트 번호를 인자(Argument)로 전달하며 파이썬 서버를 실행합니다.
3. **통신**: Electron과 Python은 해당 포트의 **WebSocket**을 통해 상태를 동기화합니다.

### 4.3 스크립트 주입 (Injection Mechanism)

Mitmproxy가 네트워크 응답을 가로채서 HTML을 수정합니다:

- **head 주입**: `</head>` 태그를 찾아 `<script>...</script></head>`로 교체
- **body_end 주입**: `</body>` 태그를 찾아 `<script>...</script></body>`로 교체

***

## 5. 통신 프로토콜 (Communication Protocol)

주입된 JS(프론트엔드)와 Python/Web(백엔드) 간의 통신 규격입니다.

### 5.1 WebSocket 메시지 규격 (JSON)

#### 요청 (JS → Backend):
```json
{
  "message_id": "unique-uuid-v4",
  "plugin_id": "youtube-summarizer",
  "function_name": "summarize_text",
  "payload": { ... }
}
```

#### 응답 (Backend → JS):
```json
{
  "message_id": "unique-uuid-v4",
  "status": "success",
  "data": { "summary": "..." }
}
```

### 5.2 웹 추론 API (Azure Cloud)

웹 추론 모드일 경우 로컬 서버 대신 아래 주소로 직접 요청을 보냅니다:

```
https://booster-app-gpa3bggkaxh3dhbg.koreacentral-01.azurewebsites.net/api/{plugin_id}/{function_name}
```

***

## 6. 고급 구현 로직 (Advanced Implementation)

요구사항(CSP 우회, 안전한 파싱, 릴레이 통신, 의존성 단순화)을 모두 반영한 상세 로직입니다.

### 6.1 포트 관리 및 프로세스 구조 (Port Management)

#### 방식: Electron 주도적 동적 할당 (Electron-Driven Dynamic Allocation)

가장 안정적이고 표준적인 방식으로, **UI(Electron)가 대장(Parent)**이 되어 리소스를 관리하고, **Python(Child)**은 시키는 대로 작동하는 구조입니다.

**동작 원리:**

1. **Electron 시작**: 앱 실행 시 `get-port` 같은 라이브러리를 사용해 사용 가능한 포트 2개를 찾습니다.
   - `API_PORT`: 로컬 파이썬 서버(FastAPI)용 (예: 54321)
   - `PROXY_PORT`: Mitmproxy용 (예: 8080 또는 동적 할당)

2. **Python 실행**: 찾은 포트 번호를 인자(Argument)로 넘겨주며 파이썬 서브프로세스를 실행합니다.
   ```
   python main.py --api-port 54321 --proxy-port 8081
   ```

3. **연결**: Electron은 해당 포트로 웹소켓 연결 및 프록시 설정을 수행합니다.

### 6.3 주입된 스크립트의 포트 번호 인지 방법(Port Management)

#### A. Electron 내장 브라우저
preload 스크립트를 사용한다. Electron 메인에서는 앱 시작 시 찾은 API_PORT를 환경 변수나 전역 변수에 저장하고, Preload 스크립트는 웹페이지가 로드되기 직전에 실행되어, window.AiPlugsConfig 등에 객체를 미리 생성해두고, 웹페이지에서 주입된 스크립트(inject.js)는 이미 준비된 window.AiPlugsConfig를 참조해 통신합니다.

#### B. 외부 브라우저 트래픽 (Mitmproxy 레벨)
단순히 스크립트 태그 하나만 넣는 것이 아니라, 메인 스크립트 실행 전 포트 정보를 담은 작은 스크립트 조각을 먼저 주입하는 방식입니다. Mitmproxy가 HTML을 수정할 때, 포트 번호를 하드코딩한 JS 변수를 선언합니다.

### 6.2 CSP (Content Security Policy) 우회 로직

보안 정책 때문에 스크립트 실행이 막히는 것을 방지하기 위해 **이중(Dual) 제거 로직**을 적용합니다.

#### A. Electron 내장 브라우저 (Node.js 레벨)

Electron의 `session` 모듈을 사용하여 내장 브라우저의 트래픽을 제어합니다.

```javascript
// [Electron] main.js 예시 로직
const { session } = require('electron');

function setupCSPBypass() {
  const filter = { urls: ['*://*/*'] }; // 모든 URL 대상

  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    // 1. 응답 헤더 복사
    const newHeaders = { ...details.responseHeaders };

    // 2. CSP 관련 헤더 삭제 (대소문자 구분 없이 처리 필요)
    Object.keys(newHeaders).forEach((header) => {
      if (header.toLowerCase() === 'content-security-policy' ||
          header.toLowerCase() === 'x-frame-options') { // iframe 제한도 해제
        delete newHeaders[header];
      }
    });

    // 3. 수정된 헤더 반환
    callback({ responseHeaders: newHeaders });
  });
}
```

#### B. 외부 브라우저 트래픽 (Mitmproxy 레벨)

Chrome/Edge 등 외부 브라우저를 위한 프록시 서버 내부 로직입니다.

```python
# [Python] mitmproxy_addon.py 예시
from mitmproxy import http

class CSPRemover:
    def response(self, flow: http.HTTPFlow):
        # 응답 헤더에서 CSP 관련 키를 찾아 무조건 삭제
        # pop(key, default) : 키가 없어도 에러 안 나게 처리
        flow.response.headers.pop("Content-Security-Policy", None)
        flow.response.headers.pop("Content-Security-Policy-Report-Only", None)
        flow.response.headers.pop("X-Frame-Options", None)  # iframe 허용

addons = [CSPRemover()]
```

### 6.3 안전한 HTML 주입 (Safe Injection with BeautifulSoup4)

**Regex(정규식) 대신 BeautifulSoup4**를 사용하여 HTML 구조를 깨뜨리지 않고 스크립트를 삽입합니다.

**로직:**
1. Mitmproxy가 응답(HTML)을 가로챔
2. HTML을 BeautifulSoup 객체로 파싱
3. `<head>` 태그가 있으면 그 안의 맨 끝에, 없으면 `<body>` 등 대체 위치에 `<script>` 태그 생성 및 삽입
4. 다시 문자열로 변환하여 브라우저로 전송

```python
# [Python] injection_logic.py
from bs4 import BeautifulSoup

def inject_script(html_content: bytes, script_url: str) -> bytes:
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # 주입할 스크립트 태그 생성
    # src 방식 또는 inline 방식 선택 가능
    new_script = soup.new_tag("script", src=script_url)
    # 또는 new_script.string = "console.log('Hacked!');"
    
    if soup.head:
        soup.head.append(new_script)  # head 태그 닫히기 직전에 추가
    elif soup.body:
        soup.body.append(new_script)  # body에 추가 (fallback)
    else:
        # html 구조가 엉망인 경우 그냥 맨 뒤에 붙임
        soup.append(new_script)
    
    return soup.encode("utf-8")  # 인코딩 유지 중요
```

### 6.4 웹 추론 중계 로직 (Web Inference Relay)

**[JS → Local Python → Azure]** 구조로 보안과 CORS를 해결합니다.

**단계별 흐름:**

1. **1단계 (JS)**: 웹페이지 내 주입된 스크립트는 로컬호스트(Local FastAPI)로만 요청을 보냅니다.
   ```
   POST http://localhost:54321/api/relay/plugin-id/func-name
   ```

2. **2단계 (Local Python)**: FastAPI가 이 요청을 받아 Azure로 Proxy Pass 합니다. 이때 API Key를 헤더에 붙입니다.

3. **3단계 (Azure)**: 처리 후 결과 반환.

```python
# [Python] backend.py (FastAPI)
from fastapi import FastAPI, Request
import httpx  # 비동기 HTTP 클라이언트

app = FastAPI()
AZURE_BASE_URL = "https://booster-app-xxxx.azurewebsites.net"

@app.post("/api/relay/{plugin_id}/{func_name}")
async def relay_request(plugin_id: str, func_name: str, request: Request):
    # 1. JS에서 보낸 JSON 데이터 받기
    client_data = await request.json()
    
    # 2. Azure로 요청 전달 (여기서 API KEY 등을 비밀스럽게 추가 가능)
    async with httpx.AsyncClient() as client:
        azure_response = await client.post(
            f"{AZURE_BASE_URL}/api/{plugin_id}/{func_name}",
            json=client_data,
            headers={"X-API-KEY": "MY_SECRET_KEY"}  # 브라우저엔 노출 안 됨
        )
    
    # 3. Azure 응답을 그대로 JS에게 반환
    return azure_response.json()
```

### 6.5 SSL/TLS Pinning 처리 (불가능한 사이트 조치)

은행, 구글 등 **Certificate Pinning**이 걸린 사이트는 복호화 시도 시 연결이 끊깁니다. 이를 **"우아하게(Gracefully)" 처리**하는 방법은 **Passthrough(통과)**입니다.

**전략:**
- Mitmproxy의 `ignore_hosts` 옵션을 사용합니다.

**로직:**

1. 사용자가 설정 파일(`config.json`)에 **"작동 안 함(Passthrough) 도메인 리스트"**를 관리하도록 합니다.
   - 예: `*.google.com`, `*.bank.co.kr`

2. Mitmproxy 실행 시 이 리스트에 포함된 도메인은 **SSL 복호화를 시도하지 않고 TCP 패킷을 그대로 통과**시킵니다.

3. **결과**: 플러그인은 작동하지 않지만, 사이트 접속은 정상적으로 됩니다. (접속 불가 오류 방지)


### 6.6 개발 단계에서의 SSL 처리

개발 초기에서는, Windows 레지스트리 직접 수정하고,ctypes를 사용하여 Windows의 WinINet API(InternetSetOptionW)를 직접 호출, certutil 명령어를 사용해 Windows 인증서 저장소에 자동으로 등록 하도록 구현한다.


***


## 요약

AiPlugs는 **Electron(UI) + Python(Backend) + Mitmproxy(Proxy)**의 삼각 구조로, 사용자가 브라우저에서 AI 플러그인을 자유롭게 사용할 수 있게 하는 플랫폼입니다. CSP 우회, 안전한 HTML 주입, 웹 추론 중계 등의 고급 기술을 통해 **보안**과 **호환성**을 동시에 확보합니다.

