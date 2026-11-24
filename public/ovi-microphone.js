// Gather mono frames on the browser audio thread. Batch delivery and flush the final partial block.
class OviMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(2048);
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = () => {
      this.stopped = true;
      if (this.offset) this.port.postMessage(this.block.slice(0, this.offset));
      this.port.postMessage(null);
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    for (const sample of inputs[0]?.[0] ?? []) {
      this.block[this.offset++] = sample;
      if (this.offset === this.block.length) {
        this.port.postMessage(this.block);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("ovi-microphone", OviMicrophone);
