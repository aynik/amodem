import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { load, loads, dumps, iterate, split, icapture, take, Dummy } from '../src/common.js';
import { Configuration, fastest, slowest } from '../src/config.js';

function iterlist(data, size, opts = {}) {
  const res = [];
  for (const item of iterate(data, size, opts.func, opts.truncate, true)) {
    res.push(item);
  }
  return res;
}

test('iterate', () => {
  const N = 10;
  assert.deepStrictEqual(iterlist([...Array(N).keys()], 1), [...Array(N).keys()].map(i => [i, [i]]));
  assert.deepStrictEqual(iterlist([...Array(N).keys()], 2), [[0, [0,1]], [2, [2,3]], [4,[4,5]], [6,[6,7]], [8,[8,9]]]);
  assert.deepStrictEqual(iterlist([...Array(N).keys()], 3), [[0,[0,1,2]], [3,[3,4,5]], [6,[6,7,8]]]);
  assert.deepStrictEqual(iterlist([...Array(N).keys()], 1, { func: b => b.map(x => -x) }), [...Array(N).keys()].map(i => [i, [-i]]));
  // cover truncate=false path
  const res = [];
  for (const item of iterate([1,2,3,4,5], 2, null, false)) {
    res.push(item);
  }
  assert.deepStrictEqual(res, [[1,2],[3,4],[5]]);
});

test('split', () => {
  const L = Array.from({length:10}, (_, i) => [i*2, i*2+1]);
  const iters = split(L, 2);
  assert.deepStrictEqual(Array.from({length:10}, (_,i) => [iters[0].next().value, iters[1].next().value]), L);
});

test('icapture', () => {
  const x = Array.from({length:100}, (_, i) => i);
  const y = [];
  const z = [];
  for (const i of icapture(x, y)) {
    z.push(i);
  }
  assert.deepStrictEqual(y, x);
  assert.deepStrictEqual(z, x);
});

test('dumps, loads and load', () => {
  const x = [0.1, 0.4, 0.2, 0.6, 0.3, 0.5];
  const buf = dumps(x);
  const y = loads(buf);
  assert.deepStrictEqual(y, x);
  const arrView = new Uint8Array(buf);
  const y2 = loads(arrView);
  assert.deepStrictEqual(y2, x);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amodem-'));
  const fname = path.join(tmp, 'test.bin');
  fs.writeFileSync(fname, buf);
  const z = load(fname);
  assert.deepStrictEqual(z, x);
});

test('take', () => {
  const result = take([1,2,3,4,5], 3);
  assert.deepStrictEqual(result, [1,2,3]);
  const short = take([1,2], 5);
  assert.deepStrictEqual(short, [1,2]);
});

test('Dummy', () => {
  const d = Dummy();
  assert.strictEqual(d.foo, d);
  assert.strictEqual(d(), d);
});

test('config', () => {
  const defaultConf = new Configuration();
  const fastestConf = fastest();
  const slowestConf = slowest();
  assert.ok(slowestConf.modem_bps <= defaultConf.modem_bps);
  assert.ok(fastestConf.modem_bps >= defaultConf.modem_bps);
});

test('Configuration validation', () => {
  assert.throws(() => new Configuration({ bits_per_sample: 15 }));
  assert.throws(() => new Configuration({ Npoints: 3 }));
});
