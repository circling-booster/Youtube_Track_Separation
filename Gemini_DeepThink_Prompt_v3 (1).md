# **Role Definition**

당신은 Python/Flask 백엔드와 Chrome Extension 프론트엔드에 능통한 Senior Full-Stack AI Engineer입니다.  
특히 \*\*GPU 메모리 관리(VRAM Optimization)\*\*와 비동기 파이프라인 아키텍처 설계에 강점이 있습니다.

# **Context & Goal**

나는 현재 YouTube Track Separation & Lyrics Sync 프로젝트를 개발 중입니다. 이 프로젝트는 유튜브 영상에서 오디오를 추출하여 보컬/반주로 분리하고, 가사나 자막을 확보하여 싱크를 맞춘 뒤 웹 UI로 보여주는 시스템입니다.

현재 시스템은 기능별로 파편화되어 있습니다. 이를 \*\*'수집 \-\> 분리 \-\> 정렬 \-\> 시각화'\*\*가 원스톱으로 이어지는 **자동화된 파이프라인**으로 통합하고자 합니다.

**핵심 제약 사항:**

1. **Hardware:** Windows 11, GTX 1080 (8GB VRAM), 32GB RAM.  
2. **Robustness:** VRAM OOM(Out of Memory)이 절대 발생하면 안 되며, 가사 데이터가 없더라도 오디오 분리 기능은 작동해야 합니다.

# **Input Assets (Reference These Files)**

현재 업로드된 나의 코드베이스를 분석의 기준으로 삼으세요.

* **Architecture:** README.md (전체 구조 이해 필수)  
* **Frontend:** extension/extract\_info.js, extension/content.js, extension/manifest.json  
* **Backend:** services/workflow.py, demucs\_processor.py, extract\_lyrics.py, extensions.py  
* **AI Logic:** align\_force.py (Whisper 정렬 로직 참조용)

# **Task Description (Step-by-Step Implementation)**

다음의 \*\*\[요구사항 정의서\]\*\*를 바탕으로 코드를 리팩토링 및 구현하여 전체 파일 코드를 제공해주세요.

## **\[요구사항 정의서\]**

### **1\. VRAM 안전성 확보 (Critical) 🔥**

* **문제:** Demucs와 Whisper 모델 동시 로드 시 GTX 1080(8GB)에서 OOM 발생 위험.  
* **services/workflow.py 구현 전략:**  
  1. **Demucs 단계:** demucs.pretrained.get\_model()로 모델 로드 \-\> 분리 수행 \-\> del model \-\> gc.collect() \-\> torch.cuda.empty\_cache()  
  2. **Whisper 단계:** (메모리 완전 해제 후) stable\_whisper.load\_model() \-\> 정렬 \-\> 메모리 해제  
* **extensions.py 수정:** DemucsProcessor나 AudioSyncProcessor 초기화 시 **절대로 모델을 미리 로드(Pre-load)하지 않도록** 코드를 비워주세요. 전역 변수에는 빈 껍데기나 설정만 남겨야 합니다.

### **2\. Frontend: 메타데이터 및 소스 식별**

* **extension/extract\_info.js:** \- getMusicInfo() 함수가 정보를 담은 객체({ artist, title, album, sourceType })를 **return** 하도록 수정.  
  * 유튜브 UI에서 'Music Shelf' 존재 여부로 sourceType: 'official' 또는 'general' 판단.  
* **extension/content.js:**  
  * 위에서 받은 데이터를 socket.emit('process\_video', ...) 페이로드에 포함.

### **3\. Backend: 코드 리팩토링 및 모듈화 🔥**

#### **A. demucs\_processor.py 수정**

* 클래스 내부에서 모델을 로드하는 로직을 제거하고, process\_and\_stream 메서드가 **외부에서 로드된 model 객체를 인자(Argument)로 받도록** 변경하세요.  
* 이렇게 해야 workflow.py에서 모델 수명 주기를 완벽하게 제어할 수 있습니다.

#### **B. align\_force.py 모듈화 (Format Strictness) 🔥**

* 스크립트 형태를 함수 형태로 변경하세요.  
* **Function Signature:** def align\_lyrics(audio\_path: str, text: str, device: str) \-\> str:  
* **Output Format (Crucial):** 프론트엔드 시각화 로직을 위해 **반드시** 종료 시간이 포함된 확장 형식을 유지해야 합니다. 표준 LRC 포맷으로 변경하지 마십시오.  
  * **형식:** \[mm:ss.xx\] \<mm:ss.xx\> 단어 (Word-level timestamps with duration)  
  * **예시:** \[00:05.29\] \<00:05.43\> This  
* **Internal:** stable-ts의 결과를 위 포맷으로 변환하는 기존 로직(save\_lrc\_with\_duration 등)을 유지 및 통합하세요.

#### **C. services/workflow.py 오케스트레이션**

* sourceType에 따른 분기 처리 구현:  
  * **Official:** BugsLyricsCrawler 사용 \-\> 실패 시 General 로직으로 Fallback.  
  * **General:** yt-dlp로 자막 다운로드 (--write-auto-sub, \--write-sub, \--sub-lang ko,en).  
* **자막 처리 로직:**  
  * 다운로드된 자막 파일(vtt 등)이 있다면, 이를 파싱하여 **순수 텍스트**를 추출한 뒤 align\_force.align\_lyrics()에 전달하여 정밀 싱크를 맞추거나,  
  * (옵션) 자막 파일 자체를 LRC로 변환하여 사용. (이번 구현에서는 **Whisper를 이용한 정밀 재정렬**을 기본으로 함).

# **Output Requirements**

1. **Reasoning First:** GTX 1080 환경에서 OOM을 방지하기 위한 메모리 관리 전략을 먼저 요약하세요.  
2. **Implementation:** 다음 파일들의 \*\*전체 코드(Full Code)\*\*를 제공하세요.  
   * extension/extract\_info.js  
   * extension/content.js  
   * extensions.py (전역 모델 로드 제거됨)  
   * demucs\_processor.py (외부 모델 주입 방식)  
   * align\_force.py (모듈화됨 \+ 포맷 유지)  
   * services/workflow.py (전체 로직 통합)  
   * requirements.txt  
3. **Completeness:** 주석으로 생략하지 말고, 복사-붙여넣기 시 바로 동작하도록 작성하세요.