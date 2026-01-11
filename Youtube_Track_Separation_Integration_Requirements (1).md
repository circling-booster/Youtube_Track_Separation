# **YouTube Track Separation & Lyrics Sync: 시스템 통합 요구사항 정의서**

## **1\. 프로젝트 개요 (Overview)**

본 프로젝트의 목표는 현재 분절되어 있는 **'데이터 수집(Client) → 음원 분리(Server) → 가사 확보 및 정렬(Server/AI) → 시각화(Client)'** 단계를 하나의 자동화된 파이프라인으로 연결하는 것입니다.

특히 **GTX 1080 (8GB VRAM)** 환경에서의 안정적인 구동을 최우선 목표로 하며, 가사 데이터 부재 시에도 서비스가 중단되지 않는 **강건한(Robust) 아키텍처**를 구현합니다.

## **2\. 핵심 아키텍처 및 데이터 흐름 (System Flow)**

### **2.1. 전체 워크플로우 (Pipeline)**

1. **Trigger (Client):** 사용자가 YouTube UI 내 '트랙 분리' 버튼 클릭.  
2. **Collection (Client):** 현재 재생 중인 영상의 메타데이터(곡명, 가수, 앨범) 및 **음원 유형(공식/일반)** 식별.  
3. **Request (Socket):** 서버로 video\_id와 metadata 전송.  
4. **Process (Server \- Async/Parallel):**  
   * **Task A (Audio):** yt-dlp로 오디오 다운로드.  
   * **Task B (Text Resource):**  
     * **Case 1 (공식 음원):** BugsLyricsCrawler로 가사 텍스트 크롤링.  
     * **Case 2 (일반 영상):** yt-dlp를 통해 YouTube 자막(Script) 다운로드 시도.  
5. **AI Separation (Server \- GPU Serial 1):** Demucs 모델 로드 → 분리 수행 → 모델 메모리 해제.  
6. **AI Alignment (Server \- GPU Serial 2):**  
   * *조건:* 텍스트 리소스(가사) 확보 성공 시에만 수행.  
   * *일반 영상(자막)의 경우:* 자막 파일에 타임스탬프가 이미 존재한다면 정렬 단계를 건너뛰고 변환만 수행할 수 있음 (선택 사항). 본 요구사항에서는 **Whisper를 통한 정밀 정렬**을 기본으로 하되, 자막 파일 활용 시 유연하게 대처.  
7. **Response (Server):** 분리된 트랙 경로 \+ (성공 시) LRC 데이터 전송.  
8. **Visualization (Client):** 오디오 플레이어 로드 및 가사 오버레이 자동 동기화.

## **3\. 하드웨어 제약 및 리소스 관리 전략 (Critical Constraints)**

**타겟 환경:** Windows 11 / GTX 1080 (8GB VRAM) / 32GB RAM

### **3.1. On-Demand Loading (메모리 충돌 방지)**

* **금지 사항:** extensions.py 등에서 Demucs와 Whisper 모델을 전역 변수로 미리 로드(Pre-load)하는 행위 금지.  
* **요구 사항:**  
  1. **Demucs 단계:** workflow.py 내에서 모델 로드 \-\> 처리 \-\> del model \-\> gc.collect() \-\> torch.cuda.empty\_cache() 수행.  
  2. **Whisper 단계:** Demucs 메모리가 완전히 비워진 후 모델 로드 \-\> 정렬 \-\> 메모리 해제 수행.  
  * *옵션:* VRAM 부족 빈발 시 Whisper는 device='cpu'로 설정하는 옵션 고려.

## **4\. 모듈별 상세 수정 요구사항 (Module Requirements)**

### **4.1. Client Side (Frontend)**

#### **A. 메타데이터 추출 및 소스 식별 (extension/extract\_info.js)**

* **소스 유형 식별 (Source Identification):**  
  * window.YoutubeMetaExtractor.getMusicInfo() 실행 시, 단순 메타데이터뿐만 아니라 \*\*소스 유형(sourceType)\*\*을 반환해야 함.  
  * **'Music Shelf' 발견 시:** { sourceType: 'official', artist: '...', title: '...' } 반환.  
  * **'Music Shelf' 미발견 시:** { sourceType: 'general', title: '...' } 반환. (가수 정보 등은 비워둠)  
* **동작 방식 변경:**  
  * **Official 모드:** 기존대로 가수/곡명/앨범명을 추출하여 서버로 전송 (가사 크롤링용).  
  * **General 모드:** 제목만 추출하여 전송하며, 서버에 \*\*"자막 기반 처리"\*\*를 요청하는 신호로 사용됨.

#### **B. 확장 프로그램 설정 (extension/manifest.json)**

* **스크립트 로드 추가:** extract\_info.js가 content.js보다 먼저 로드되도록 content\_scripts 섹션을 수정해야 함.  
  * **수정 후:** \["socket.io.js", "ui-templates.js", "extract\_info.js", "content.js"\]

#### **C. 소켓 통신 및 자동화 (extension/content.js)**

* **요청 페이로드 확장:**  
  * 변경: socket.emit('process\_video', { video\_id: ..., metadata: { ..., sourceType: 'official' | 'general' } })  
* **응답 처리:**  
  * 서버로부터 LRC 데이터를 수신하면 즉시 렌더링.  
  * 데이터가 없으면 플레이어만 실행 (Toast 메시지: "가사/자막 없음").

### **4.2. Server Side (Backend Logic)**

#### **A. 의존성 및 설정 (extensions.py, requirements.txt)**

* **라이브러리 추가:** stable-ts (Stable Whisper), beautifulsoup4, requests, lxml.

#### **B. 워크플로우 오케스트레이션 (services/workflow.py)**

이 파일은 \*\*대수술(Major Refactoring)\*\*이 필요합니다.

1. **텍스트 리소스 확보 분기 (Branching):**  
   * 클라이언트에서 받은 metadata\['sourceType'\]에 따라 로직 분기.  
   * **If sourceType \== 'official':**  
     * BugsLyricsCrawler 실행.  
     * 실패 시: 자막 다운로드 시도(Fallback) 또는 실패 처리.  
   * **If sourceType \== 'general':**  
     * **yt-dlp 자막 다운로드 실행.**  
     * 옵션: \--write-sub \--write-auto-sub \--sub-lang ko,en \--convert-subs lrc (또는 vtt).  
     * 자막 파일 확보 시: 해당 내용을 텍스트로 파싱.  
2. **경로 탐색 및 모델 실행:**  
   * demucs\_processor.get\_separated\_tracks로 vocals.wav 경로 확보.  
   * **정렬(Alignment) 로직 유연화:**  
     * 크롤링된 가사(Text only)인 경우: align\_force.py (Whisper) 실행 필수.  
     * 다운로드된 자막(Timed Text)인 경우:  
       * 방법 A (간편): 다운로드된 자막 파일(LRC/VTT)을 그대로 클라이언트로 전송. (Whisper 생략, VRAM 절약).  
       * 방법 B (고품질): 자막의 '텍스트'만 추출하여 vocals.wav와 Whisper로 재정렬.  
       * *권장:* **방법 A**를 우선 적용하여 일반 영상 처리 속도 및 안정성 확보.  
3. **예외 처리 (Exception Handling \- Text Resource):**  
   * **자막 다운로드 실패 시:**  
     * 일반 영상인데 자막(자동 생성 포함)이 없는 경우, **"자막을 찾을 수 없습니다"** 로그 기록.  
     * 정렬 단계를 건너뛰고, **오디오 분리 결과만** 클라이언트에 전송 (Happy Path 유지).  
     * 에러를 발생시켜 프로세스를 죽이지 말 것.  
4. **최종 응답:**  
   * lyrics 필드에 LRC 포맷의 텍스트를 담아 전송.

## **5\. 예외 처리 전략 (Exception Handling)**

1. **텍스트 리소스 부재 (No Lyrics/Script):**  
   * 서버: 정렬 단계 건너뜀 \-\> 오디오 트랙 정보만 반환.  
   * 클라이언트: 오버레이 없이 커스텀 플레이어 실행.  
2. **VRAM OOM 방지:**  
   * Demucs 완료 후 반드시 torch.cuda.empty\_cache() 호출 및 time.sleep(1) 대기 후 후속 작업 진행.

## **6\. 구현 우선순위 (Implementation Roadmap)**

1. **\[Backend\]** requirements.txt 업데이트.  
2. **\[Frontend\]** manifest.json 수정 및 extract\_info.js에 소스 유형 식별 로직 추가.  
3. **\[Frontend\]** content.js 요청 페이로드 수정.  
4. **\[Backend\]** workflow.py에 **'공식(크롤링) vs 일반(자막)'** 분기 로직 및 자막 다운로드/변환 구현.  
5. **\[Backend\]** 자막/가사 부재 시의 Fallback(오디오만 전송) 처리 검증.