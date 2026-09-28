// AudioWorklet: batches ~100 ms of mono PCM and posts it straight to the
// dictation worker over the port it is handed; the page never touches audio.
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class DictationCapture extends AudioWorkletProcessor {
  private size = Math.round(sampleRate / 10);
  private buf = new Float32Array(this.size);
  private n = 0;
  private out: MessagePort | null = null;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ port: MessagePort }>) => {
      this.out = event.data.port;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!channels?.length || !this.out) return true;
    const frames = channels[0].length;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i];
      this.buf[this.n++] = sum / channels.length;
      if (this.n === this.size) {
        this.out.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("dictation-capture", DictationCapture);
