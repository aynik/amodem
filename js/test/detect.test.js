import test from 'node:test';
import assert from 'node:assert/strict';
import { Detector } from '../src/detect.js';
import { fastest } from '../src/config.js';
import { prefix } from '../src/equalizer.js';
import { Demux } from '../src/dsp.js';
import { Sampler } from '../src/sampling.js';
import { Receiver } from '../src/recv.js';
import { Dummy } from '../src/common.js';

const config = fastest();

function cosine(freq, length, Ts) {
  return Array.from({ length }, (_, i) => Math.cos(2 * Math.PI * freq * i * Ts));
}

test('detect run', () => {
  const P = prefix.reduce((a, b) => a + b, 0);
  const tLen = P * config.Nsym;
  const x = cosine(config.Fc, tLen, config.Ts);
  const d = new Detector(config, Dummy());
  const [samples, amp, freqErr] = d.run(x);
  assert.ok(Math.abs(1 - amp) < 1e-12);
  assert.ok(Math.abs(freqErr) < 1e-12);

  const x2 = cosine(2 * config.Fc, tLen, config.Ts);
  assert.throws(() => d.run(x2));
  d.max_offset = 0;
  assert.throws(() => d.run(x2));
});

test('prefix detection', () => {
  const omega = 2 * Math.PI * config.Fc / config.Fs;
  const symbol = cosine(config.Fc, config.Nsym, config.Ts);
  const signal = prefix.flatMap(c => symbol.map(v => c * v));

  function symbolsStream(sig) {
    const sampler = new Sampler(sig);
    return new Demux(sampler, [omega], config.Nsym);
  }

  const r = new Receiver(config, Dummy());
  r._prefix(symbolsStream(signal));

  const silence = signal.map(() => 0);
  assert.throws(() => r._prefix(symbolsStream(silence)));
});

test('find start', () => {
  const sym = cosine(config.Fc, config.Nsym, config.Ts);
  const d = new Detector(config, Dummy());
  const length = 200;
  const prefixArr = Array(50 * sym.length).fill(0);
  const postfix = Array.from(prefixArr);
  const carrier = Array.from({ length: length * sym.length }, (_, i) => sym[i % sym.length]);
  for (let offset = 0; offset < 32; offset++) {
    const noise = Array.from({ length: offset }, () => 0.1 * (Math.random() - 0.5));
    const buf = prefixArr.concat(noise, carrier, postfix);
    const start = d.find_start(buf);
    const expected = offset + prefixArr.length;
    assert.strictEqual(expected, start);
  }
  const zeros = Array(1000).fill(0);
  assert.strictEqual(d.find_start(zeros), Detector.START_PATTERN_LENGTH * config.Nsym);
});

