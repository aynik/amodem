import test from 'node:test';
import assert from 'node:assert';
import { Reader, Dumper } from '../src/stream.js';

class PartialStream {
  constructor(chunks, piece = 4, bufsize = 16) {
    this.chunks = chunks;
    this.piece = piece;
    this.bufsize = bufsize;
    this.current = 0;
    this.offset = 0;
  }
  read(size) {
    if (this.current >= this.chunks) {
      return Buffer.alloc(0);
    }
    const remaining = this.bufsize - this.offset;
    const n = Math.min(size, remaining, this.piece);
    const buf = Buffer.alloc(n, this.current);
    this.offset += n;
    if (this.offset >= this.bufsize) {
      this.current += 1;
      this.offset = 0;
    }
    return buf;
  }
}

class StringStream {
  constructor(data) {
    this.data = Buffer.from(data);
    this.pos = 0;
  }
  read(size) {
    if (this.pos >= this.data.length) return Buffer.alloc(0);
    const buf = this.data.slice(this.pos, this.pos + size);
    this.pos += buf.length;
    return buf;
  }
}

class Sink {
  constructor() {
    this.buffers = [];
  }
  write(data) {
    this.buffers.push(Buffer.from(data));
  }
}

test('Reader reads chunks and times out', async () => {
  const src = new PartialStream(10);
  const r = new Reader(src, { wait: 0, timeout: 0.02, bufsize: 16 });
  for (let i = 0; i < 10; i++) {
    const buf = await r.next();
    assert.strictEqual(buf.length, 16);
    assert.strictEqual(buf[0], i);
  }
  await assert.rejects(() => r.next(), { message: 'timeout' });
  const it = r[Symbol.asyncIterator]();
  await assert.rejects(() => it.next(), { message: 'timeout' });
  const rCustom = new Reader(new PartialStream(1), { wait: 0, timeout: 0.02, bufsize: 16, dataType: b => b[0] });
  const val = await rCustom.next();
  assert.strictEqual(val, 0);
});

test('Reader eof behavior and async iteration', async () => {
  const src = new StringStream('hello');
  const r = new Reader(src, { eof: true, bufsize: 8 });
  const first = await r.next();
  assert.strictEqual(first.toString(), 'hello');
  await assert.rejects(() => r.next(), { message: 'StopIteration' });
  await assert.rejects(() => r.next(), { message: 'StopIteration' });
  const src2 = new StringStream('world');
  const r2 = new Reader(src2, { eof: true, bufsize: 5 });
  const chunks = [];
  for await (const chunk of r2) {
    chunks.push(chunk.toString());
  }
  assert.deepStrictEqual(chunks, ['world']);
});

test('Dumper copies data', async () => {
  const src = { read: size => Promise.resolve(Buffer.from([1,2,3,4].slice(0, size))) };
  const dst = new Sink();
  const d = new Dumper(src, dst);
  const data = await d.read(3);
  assert.deepStrictEqual([...data], [1,2,3]);
  assert.deepStrictEqual(dst.buffers.map(b => [...b]), [[1,2,3]]);
});
