// Collects mic samples into ~100 ms blocks and hands them to the page.
class MicCollector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1600);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let i = 0;
    while (i < channel.length) {
      const take = Math.min(channel.length - i, this.block.length - this.filled);
      this.block.set(channel.subarray(i, i + take), this.filled);
      this.filled += take;
      i += take;
      if (this.filled === this.block.length) {
        this.port.postMessage(this.block);
        this.block = new Float32Array(1600);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('mic-collector', MicCollector);
