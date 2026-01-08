# **🎯 AiPlugs "One-Shot" Implementation Prompt**

Context:  
I am a developer with experience in Python, JavaScript, and Web Security, but not an expert major. I am developing on Windows 11 with VS Code.  
I have provided two documents: README.MD (Technical Spec) and STRUCTRUE.MD (File Structure & Logic).  
Goal:  
You are an Expert System Architect and Full-stack Developer. Your task is to generate ALL the code files required for the AiPlugs project based on the attached documents in a single, continuous response.  
**Core Requirements:**

1. **Platform:** Windows 11 (Critical for Proxy/Cert logic, Registry manipulation).  
2. **Tech Stack:** Electron (Node.js), Python (FastAPI, Mitmproxy), HTML/JS (Frontend).  
3. **Completeness:** DO NOT use placeholders like \# ... rest of code. Implement full logic.  
4. **Security:** Implement CSP bypassing and SSL pinning evasion (ignore\_hosts) as specified.

## **🛠️ Implementation Instructions by Module**

Please generate the files in the following order and specifications.

### **1\. Root & Configuration (Environment & Tools)**

* **.vscode/launch.json**:  
  * Config for debugging Electron Main, Renderer, and Python simultaneously.  
* **.vscode/settings.json**:  
  * Project specific settings (e.g., exclude logs/ from search).  
* **package.json**:  
  * Include electron, electron-builder, tree-kill, get-port.  
* **python/requirements.txt**:  
  * Include fastapi, uvicorn, mitmproxy, beautifulsoup4, pywin32, requests, httpx, websockets.  
* **config/settings.json**:  
  * passthrough\_hosts: Default to \["\*.google.com", "\*.bank.co.kr"\].  
  * inference\_mode: "local" or "web".  
* **scripts/install\_deps.bat**: Script to run npm install and pip install.  
* **scripts/run\_dev.bat**: Script to launch Electron in dev mode.  
* **scripts/register\_cert.bat**: Fallback script to add certificate to Windows Root Store manually.  
* **scripts/reset\_proxy.bat**: Fallback script to disable Windows Proxy settings manually (Registry cleanup).

### **2\. Python Backend (Logic & Engine)**

* **python/main.py**:  
  * Use argparse for ports.  
  * **WebSocket Protocol:** Establish a WebSocket server.  
    * Format: {"type": "heartbeat"} or {"type": "log", "data": "..."}.  
  * Use multiprocessing for API and Proxy.  
  * **CRITICAL:** Register atexit handlers to ensure system\_proxy.disable\_windows\_proxy() is called on shutdown.  
* **python/utils/admin\_utils.py**:  
  * Check Admin privileges using ctypes.  
* **python/utils/cert\_manager.py**:  
  * Path: Check \~/.mitmproxy/mitmproxy-ca-cert.cer (Standard location).  
  * Logic: If not in Windows Root Store, use subprocess (certutil \-addstore "Root" ...) or ctypes to register it.  
* **python/utils/system\_proxy.py**:  
  * **Registry Path:** HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings.  
  * **Values:** ProxyEnable=1, ProxyServer="127.0.0.1:{port}".  
  * **API Call:** Use ctypes.windll.wininet.InternetSetOptionW.  
    * **Constants:** INTERNET\_OPTION\_SETTINGS\_CHANGED \= 39, INTERNET\_OPTION\_REFRESH \= 37\.  
    * Call this to force system refresh immediately.  
* **python/utils/logger.py**:  
  * Setup logging to write to logs/app.log and logs/mitmproxy.log.  
* **python/core/api\_server.py**:  
  * FastAPI with CORSMiddleware allowing \["\*"\].  
  * **Plugin Registration:** Allow dynamic router inclusion (e.g., app.include\_router(plugin\_router)).  
  * **Web Inference:** Implement /api/relay/{plugin\_id}/{func\_name}.  
  * **Target URL:** Use https://booster-app-gpa3bggkaxh3dhbg.koreacentral-01.azurewebsites.net.  
* **python/core/plugin\_loader.py**:  
  * Use importlib to dynamically load plugins from plugins/ directory.  
  * Return a list of loaded modules/routers to api\_server.py.  
* **python/core/injector.py**:  
  * Use BeautifulSoup for HTML parsing.  
  * **Logic:** Inject \<script\> with window.AiPlugsConfig \= { apiPort: ... } **BEFORE** the actual plugin script.  
  * Target head first, fallback to body.  
* **python/core/proxy\_server.py**:  
  * Mitmproxy entry point loading addons.  
* **python/core/addons/csp\_remover.py**:  
  * Strip Content-Security-Policy & X-Frame-Options.  
* **python/core/addons/flow\_controller.py**:  
  * **SSL Pinning:** Implement tls\_clienthello hook. Check settings.json for passthrough\_hosts.  
  * If host matches, set flow.server\_conn.ignore \= True (TCP Passthrough).

### **3\. Electron Frontend (UI & Controller)**

* **electron/main/process-manager.js**:  
  * Use get-port for dynamic allocation.  
  * Spawn Python.  
  * **CRITICAL:** Connect to Python via **WebSocket** to verify startup readiness.  
  * On app.quit, use tree-kill.  
* **electron/main/session-handler.js**:  
  * onHeadersReceived to remove CSP for internal BrowserWindow.  
* **electron/main/ipc-handler.js**:  
  * IPC for Renderer \<-\> Main communication.  
* **electron/main/main.js**:  
  * Lifecycle management. Pass API\_PORT to preload.js.  
* **electron/preload/preload.js**:  
  * **Internal Browser:** Inject window.AiPlugsConfig.  
  * **Context Bridge:** Expose window.electronAPI:  
    * onStatusUpdate(callback)  
    * onLogEntry(callback)  
    * saveSettings(config)  
    * getSettings()  
* **electron/renderer/assets/**:  
  * (No code needed, just assume existence).  
* **electron/renderer/index.html**:  
  * Dashboard UI showing: Service Status (Green/Red dots), Logs (tail), Settings toggle.  
* **electron/renderer/app.js**:  
  * Dashboard logic using window.electronAPI.

### **4\. Plugins (Example Structure)**

* **plugins/youtube-summarizer/manifest.json**:  
  * **Schema:**  
    {  
      "id": "youtube-summarizer",  
      "name": "YouTube Summarizer",  
      "description": "Summarizes videos",  
      "injection\_targets": \[  
        { "url\_regex": "youtube\\\\.com/watch", "location": "body\_end" }  
      \],  
      "permissions": \[\]  
    }  
