import test from 'node:test';
import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import { send, detector, recv, volumeController, recvIter } from '../src/calib.js';
import { fastest } from '../src/config.js';
import { dumps } from '../src/common.js';

const config = fastest();

class ProcessMock {
  constructor() {
    this.buf = Buffer.alloc(0);
    this.pos = 0;
    this.bytes_per_sample = 2;
  }
  write(data) {
    const buf = Buffer.from(data);
    if (this.buf.length + buf.length > 10e6) throw new Error('overflow');
    this.buf = Buffer.concat([this.buf, buf]);
  }
  read(n) {
    const end = Math.min(this.pos + n, this.buf.length);
    const out = this.buf.slice(this.pos, end);
    this.pos = end;
    return out;
  }
  reset() { this.pos = 0; }
  get length() { return this.buf.length; }
}

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

test('success', () => {
  const p = new ProcessMock();
  send(config, p, { gain: 0.5, limit: 32 });
  p.reset();
  recv(config, p);
});

test('too strong signal', () => {
  const p = new ProcessMock();
  send(config, p, { gain: 1.001, limit: 32 });
  p.reset();
  for (const r of detector(config, p)) {
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.msg, 'too strong signal');
  }
});

test('too weak signal', () => {
  const p = new ProcessMock();
  send(config, p, { gain: 0.01, limit: 32 });
  p.reset();
  for (const r of detector(config, p)) {
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.msg, 'too weak signal');
  }
});

test('too noisy signal', () => {
  const rand = rng(1);
  const signal = [];
  for (let i = 0; i < config.Fs; i++) {
    signal.push(rand() < 0.5 ? -1 : 1);
  }
  const src = new ProcessMock();
  src.write(dumps(signal.map(x => x * 0.5)));
  src.reset();
  for (const r of detector(config, src)) {
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.msg, 'too noisy signal');
  }
});

test('errors propagate', () => {
  class WriteError extends ProcessMock { write() { throw new Error('fail'); } }
  const p1 = new WriteError();
  assert.throws(() => send(config, p1, { limit: 32 }), /fail/);
  assert.strictEqual(p1.length, 0);

  class ReadError extends ProcessMock { read() { throw new Error('fail'); } }
  const p2 = new ReadError();
  assert.throws(() => recv(config, p2, { verbose: true }), /fail/);
  assert.strictEqual(p2.length, 0);
});

const freqErrs = [0].concat([0.1, 1, 10, 100, 1e3, 2e3].flatMap(m => [m, -m])).map(v => v * 1e-6);

test('drift detection', () => {
  const frame_length = 100;
  const rms = 0.5;
  for (const freq_err of freqErrs) {
    const freq = config.Fc * (1 + freq_err / 1e6);
    const t = Array.from({ length: Math.floor(1.0 * config.Fs) }, (_, i) => i * config.Ts);
    const signal = t.map(tt => rms * Math.cos(2 * Math.PI * freq * tt));
    const src = new ProcessMock();
    src.write(dumps(signal));
    src.reset();
    let iters = 0;
    for (const r of detector(config, src, frame_length)) {
      assert.strictEqual(r.success, true);
      assert.ok(Math.abs(r.rms - rms) < 1e-3);
      assert.ok(Math.abs(r.total - rms) < 1e-3);
      iters += 1;
    }
    assert.ok(iters > 0);
    assert.strictEqual(iters, config.baud / frame_length);
  }
});

test('volume controller', () => {
  const original = child_process.execSync;
  const calls = [];
  child_process.execSync = (args, opts) => { calls.push({ args, opts }); };
  try {
    const ctl = volumeController('volume-control');
    ctl(0.01);
    ctl(0.421);
    ctl(0.369);
    ctl(1);
    assert.deepStrictEqual(calls, [
      { args: 'volume-control 1%', opts: { shell: true } },
      { args: 'volume-control 42%', opts: { shell: true } },
      { args: 'volume-control 37%', opts: { shell: true } },
      { args: 'volume-control 100%', opts: { shell: true } },
    ]);
    assert.throws(() => ctl(0));
    assert.throws(() => ctl(-0.5));
    assert.throws(() => ctl(12.3));
  } finally {
    child_process.execSync = original;
  }
});

test('send sets max volume', () => {
  const original = child_process.execSync;
  const calls = [];
  child_process.execSync = (args, opts) => { calls.push({ args, opts }); };
  try {
    send(config, new ProcessMock(), { volume_cmd: 'ctl', limit: 1 });
  } finally {
    child_process.execSync = original;
  }
  assert.deepStrictEqual(calls, [{ args: 'ctl 100%', opts: { shell: true } }]);
});

test('recv binary search adjusts volume', () => {
  const buf = new ProcessMock();
  const gains = [0.5, 0.25, 0.38, 0.44, 0.41, 0.39, 0.40, 0.40];
  for (const gain of gains) {
    send(config, buf, { gain, limit: 2 });
  }
  const originalData = Buffer.from(buf.buf);
  buf.reset();
  const dump = new ProcessMock();
  const original = child_process.execSync;
  const calls = [];
  child_process.execSync = (args, opts) => { calls.push({ args, opts }); };
  try {
    recv(config, buf, { volume_cmd: 'ctl', dump_audio: dump });
  } finally {
    child_process.execSync = original;
  }
  assert.deepStrictEqual(dump.buf, originalData);
  assert.strictEqual(calls.length, gains.length + 1);
  const levels = calls.map(c => parseInt(c.args.split(' ')[1], 10));
  for (let i = 0; i < gains.length - 1; i++) {
    assert.strictEqual(levels[i], Math.round(gains[i] * 100));
  }
  assert.strictEqual(levels[calls.length - 1], levels[calls.length - 2]);
});

test('recv freq change detection', () => {
  const p = new ProcessMock();
  send(config, p, { gain: 0.5, limit: 2 });
  const offset = Math.floor(p.buf.length / 16);
  p.pos = offset;
  const messages = [];
  for (const state of recvIter(config, p)) {
    messages.push(state.msg);
  }
  assert.deepStrictEqual(messages, [
    'good signal', 'good signal', 'good signal',
    'frequency change',
    'good signal', 'good signal', 'good signal'
  ]);
});

