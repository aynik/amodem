export class AsyncReader {
  constructor(stream, bufsize) {
    this.stream = stream;
    this.bufsize = bufsize;
    this.queue = [];
    this.buf = Buffer.alloc(0);
    this.stopped = false;
    this._pending = null;
    this._error = null;
    this._loop();
  }

  async _loop() {
    try {
      while (!this.stopped) {
        const buf = await this.stream.read(this.bufsize);
        this.queue.push(Buffer.from(buf));
        this._notify();
      }
    } catch (err) {
      this._error = err;
      this.queue.push(null);
      this._notify();
    }
  }

  _notify() {
    if (this._pending) {
      this._pending();
      this._pending = null;
    }
  }

  async _wait() {
    if (this.queue.length === 0) {
      await new Promise(resolve => {
        this._pending = resolve;
      });
    }
  }

  async read(size) {
    while (this.buf.length < size) {
      while (this.queue.length === 0) {
        await this._wait();
      }
      const chunk = this.queue.shift();
      if (chunk === null) {
        throw this._error || new Error('cannot read from stream');
      }
      this.buf = Buffer.concat([this.buf, chunk]);
    }
    const result = this.buf.subarray(0, size);
    this.buf = this.buf.subarray(size);
    return result;
  }

  async close() {
    if (this.stream) {
      this.stopped = true;
      await this.stream.close?.();
      this.stream = null;
    }
  }
}

export default { AsyncReader };
