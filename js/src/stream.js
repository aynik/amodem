import { setTimeout as delay } from 'node:timers/promises';

export class Reader {
  constructor(fd, options = {}) {
    const {
      dataType = x => x,
      eof = false,
      wait = 0.2,
      timeout = 2.0,
      bufsize = (8 << 10),
    } = options;
    this.fd = fd;
    this.dataType = dataType;
    this.eof = eof;
    this.wait = wait * 1000; // milliseconds
    this.timeout = timeout * 1000; // milliseconds
    this.bufsize = bufsize;
    this.total = 0;
    this._done = false;
  }

  async next() {
    if (this._done) {
      throw new Error('StopIteration');
    }
    const blocks = [];
    if (this.eof) {
      const data = await this.fd.read(this.bufsize);
      if (data && data.length) {
        const buf = Buffer.from(data);
        this.total += buf.length;
        return buf;
      }
      this._done = true;
      throw new Error('StopIteration');
    }
    const finish = Date.now() + this.timeout;
    while (Date.now() <= finish) {
      const left = this.bufsize - blocks.reduce((a, b) => a + b.length, 0);
      const data = await this.fd.read(left);
      if (data && data.length) {
        const buf = Buffer.from(data);
        this.total += buf.length;
        blocks.push(buf);
      }
      if (blocks.reduce((a, b) => a + b.length, 0) === this.bufsize) {
        const block = Buffer.concat(blocks);
        return this.dataType(block);
      }
      await delay(this.wait);
    }
    throw new Error('timeout');
  }

  async _next() {
    return { value: await this.next(), done: false };
  }

  [Symbol.asyncIterator]() {
    return {
      next: async () => {
        try {
          return await this._next();
        } catch (err) {
          if (err instanceof Error && err.message === 'StopIteration') {
            return { value: undefined, done: true };
          }
          throw err;
        }
      }
    };
  }
}

export class Dumper {
  constructor(src, dst) {
    this.src = src;
    this.dst = dst;
  }

  async read(size) {
    const data = await this.src.read(size);
    if (data) {
      await this.dst.write(data);
    }
    return data;
  }
}

export default { Reader, Dumper };
