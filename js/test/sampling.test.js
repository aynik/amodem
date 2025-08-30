import test from 'node:test';
import assert from 'node:assert';

import { Interpolator, Sampler, resample } from '../src/sampling.js';
import { dumps, loads } from '../src/common.js';

function linspace(start, stop, num) {
  const res = [];
  const step = (stop - start) / (num - 1);
  for (let i = 0; i < num; i++) {
    res.push(start + step * i);
  }
  return res;
}

test('resample', () => {
  const t = linspace(0, 1, 1001);
  const x = t.map(v => Math.sin(2 * Math.PI * 10 * v));
  const src = dumps(x);
  const dst = resample(src, 0.0);
  const y = loads(dst);
  const err = y.map((v, i) => x[i] - v);
  const maxErr = Math.max(...err.map(Math.abs));
  assert.ok(maxErr < 1e-4);
  const empty = resample(Buffer.from([0, 0]));
  assert.strictEqual(empty.length, 0);
});

test('coeffs', () => {
  const interp = new Interpolator(16, 4);
  const expected = [0, 0, 0, 1, 0, 0, 0, 0];
  const filt0 = interp.filt[0];
  const err = filt0.map((v, i) => v - expected[i]);
  const maxErr = Math.max(...err.map(Math.abs));
  assert.ok(maxErr < 1e-10);
});

test('sampler without interpolation', () => {
  const src = [1, 2, 3, 4];
  const sampler = new Sampler(src);
  assert.deepStrictEqual(sampler.take(2), [1, 2]);
  assert.deepStrictEqual(sampler.take(3), [3, 4]);
});

test('sampler with interpolation', () => {
  const src = Array.from({ length: 50 }, (_, i) => Math.sin(i));
  const interp = new Interpolator(16, 4);
  const sampler = new Sampler(src, interp);
  const res = sampler.take(10);
  assert.strictEqual(res.length, 10);
});
