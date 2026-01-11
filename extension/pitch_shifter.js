/**
 * Jungle: Time Domain Pitch Shifter for Web Audio API
 * - Circular Buffer 기반 Delay Line 방식
 * - 수정사항: 버퍼 오버런(Overrun) 방지 로직 추가 (마이너스 피치 대응)
 */
(function(window) {
    class Jungle {
        constructor(context) {
            this.context = context;
            // 4096: 지연시간 약 92ms (x2 버퍼링 = 185ms 예상)
            this.bufferSize = 4096;
            this.fadeTime = 0.050; // 50ms
            this.bufferTime = 0.150; // 150ms
            
            this.input = context.createGain();
            this.output = context.createGain();
            
            this.modulator = context.createScriptProcessor(this.bufferSize, 1, 1);
            this.modulator.onaudioprocess = this.process.bind(this);
            
            this.input.connect(this.modulator);
            this.modulator.connect(this.output);
            
            this.fadeLength = this.fadeTime * context.sampleRate;
            this.bufferLength = this.bufferTime * context.sampleRate;
            this.pBuffer = new Float32Array(this.bufferLength);
            
            this.readIndex = 0;
            this.writeIndex = 0;
            this.pitch = 1.0;
        }

        setPitch(semitones) {
            this.pitch = Math.pow(2, semitones / 12);
            // 안전장치: 피치가 너무 0에 가까우면 정지하는 것과 같으므로 최소값 보정
            if (this.pitch < 0.1) this.pitch = 0.1;
        }

        process(e) {
            const inputData = e.inputBuffer.getChannelData(0);
            const outputData = e.outputBuffer.getChannelData(0);

            for (let i = 0; i < inputData.length; i++) {
                // 1. 쓰기
                this.pBuffer[this.writeIndex] = inputData[i];
                this.writeIndex = (this.writeIndex + 1) % this.bufferLength;

                // 2. 읽기 (선형 보간으로 음질 개선)
                const ri = Math.floor(this.readIndex);
                const next_ri = (ri + 1) % this.bufferLength;
                const frac = this.readIndex - ri;
                
                const sample1 = this.pBuffer[ri];
                const sample2 = this.pBuffer[next_ri];
                const sample = (1 - frac) * sample1 + frac * sample2;

                outputData[i] = sample;

                // 3. 인덱스 이동
                this.readIndex += this.pitch;
                if (this.readIndex >= this.bufferLength) {
                    this.readIndex -= this.bufferLength;
                }

                // 4. 포인터 거리 계산 (읽을 수 있는 데이터 양)
                const dist = (this.writeIndex - this.readIndex + this.bufferLength) % this.bufferLength;
                
                // [핵심 수정] Underrun(데이터 부족) 또는 Overrun(데이터 넘침) 모두 체크
                // 마이너스 피치일 때 dist가 계속 커져서 Overrun 발생 -> 이를 방지
                if (dist < this.fadeLength || dist > this.bufferLength - this.fadeLength) {
                    // 읽기 포인터를 쓰기 포인터 뒤쪽 안전지대(fadeLength * 2)로 점프
                    this.readIndex = (this.writeIndex - this.fadeLength * 2 + this.bufferLength) % this.bufferLength;
                }
            }
        }
        
        disconnect() {
            this.input.disconnect();
            this.output.disconnect();
            this.modulator.disconnect();
            this.modulator.onaudioprocess = null;
        }
    }

    window.PitchShifter = Jungle;

})(typeof window !== 'undefined' ? window : globalThis);