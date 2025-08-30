import test from 'node:test';
import assert from 'node:assert';
import * as main from '../src/main.js';
import { Configuration } from '../src/config.js';

class BufferStream {
  constructor(buf) { this.buf = Buffer.from(buf); this.pos = 0; }
  read(size) {
    if (this.pos >= this.buf.length) return Buffer.alloc(0);
    const chunk = this.buf.slice(this.pos, this.pos + size);
    this.pos += chunk.length;
    return chunk;
  }
}

class Sink {
  constructor() { this.written = []; this.flushed = false; }
  write(data) { this.written.push(Buffer.from(data)); }
  flush() { this.flushed = true; }
}

test('send covers branches', async () => {
  const cfg = new Configuration({ Fs: 8e3, Npoints: 2, frequencies: [2e3] });
  const src1 = new BufferStream('hi');
  const dst1 = new Sink();
  const stubSend = { Sender: class {
    constructor(fd) { this.fd = fd; this.offset = 0; }
    write(sym) { this.fd.write(sym); this.offset += sym.length; }
    start() { this.write([0]); }
    modulate(bits) { for (const b of bits) this.write([b]); }
  }};
  await main.send(cfg, src1, dst1, 1.0, 0.0, null, { send: stubSend });
  assert.ok(dst1.written.length > 0);
  const src2 = new BufferStream('hi');
  const dst2 = new Sink();
  await main.send(cfg, src2, dst2, 1.0, 0.0, cfg, { send: stubSend });
  assert.ok(dst2.written.length > 0);
});

test('recv success with autoreconf and dump', async () => {
  const cfg = new Configuration();
  const src = new BufferStream(Buffer.alloc(8192));
  const dst = new Sink();
  const dump = new Sink();
  const stubDetect = { Detector: class { constructor(){} run(signal){ return [signal, 2.0, 0.0]; } } };
  const stubSampler = { Sampler: class { constructor(){} } };
  const stubRecv = { Receiver: class {
    constructor(){ this.reported=false; }
    run(sampler, gain, output){ output.write(Buffer.from([8,1,2,2])); }
    report(){ this.reported=true; }
  }};
  const ok = await main.recv(cfg, src, dst, dump, null, true, { detect: stubDetect, sampling: stubSampler, recv: stubRecv });
  assert.strictEqual(ok, true);
  assert.ok(dst.flushed);
  assert.ok(dump.written.length > 0);
});

test('recv failure path', async () => {
  const cfg = new Configuration();
  const src = new BufferStream(Buffer.alloc(8192));
  const dst = new Sink();
  const stubDetect = { Detector: class { constructor(){} run(signal){ return [signal, 1.0, 0.0]; } } };
  const stubSampler = { Sampler: class { constructor(){} } };
  let reported = false;
  const stubRecv = { Receiver: class {
    constructor(){}
    run(){ throw new Error('boom'); }
    report(){ reported = true; }
  }};
  const ok = await main.recv(cfg, src, dst, null, null, false, { detect: stubDetect, sampling: stubSampler, recv: stubRecv });
  assert.strictEqual(ok, false);
  assert.ok(dst.flushed);
  assert.ok(reported);
});
