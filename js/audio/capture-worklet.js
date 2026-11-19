// AudioWorklet that forwards mono input to the main thread in 512-sample chunks.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 512;
    this.buf = new Float32Array(this.size);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const chans = input.length;
    const len = input[0].length;
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (let c = 0; c < chans; c++) v += input[c][i];
      this.buf[this.fill++] = v / chans;
      if (this.fill === this.size) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
