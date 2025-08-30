import test from 'node:test';
import assert from 'node:assert/strict';
import { Framer, encode, decodeFrames } from '../src/framing.js';

function concat(iterable) {
  const parts = [];
  for (const part of iterable) {
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state;
  };
}

const rnd = lcg(0);
const blob = Buffer.alloc(64 * 1024);
for (let i = 0; i < blob.length; i++) {
  blob[i] = rnd() & 0xff;
}

const dataCases = [
  Buffer.from(''),
  Buffer.from('abc'),
  Buffer.from('1234567890'),
  blob,
  blob.slice(0, 12345),
];

test('framer encode/decode', () => {
  for (const data of dataCases) {
    const f = new Framer();
    const encoded = concat(f.encode(data));
    const decoded = concat(f.decode(encoded));
    assert.deepEqual(decoded, data);
  }
});

test('top-level encode/decodeFrames', () => {
  for (const data of dataCases) {
    const bits = Array.from(encode(data));
    const decoded = concat(decodeFrames(bits));
    assert.deepEqual(decoded, data);
  }
});

test('fail on corruption', () => {
  const bits = Array.from(encode(Buffer.from('')));
  bits[bits.length - 1] ^= 1;
  assert.throws(() => {
    concat(decodeFrames(bits));
  }, Error);
});

test('missing data handling', () => {
  const f = new Framer();
  assert.throws(() => concat(f.decode(Buffer.alloc(0))), /missing prefix data/);
  assert.throws(() => concat(f.decode(Buffer.from([1]))), /missing payload data/);
  assert.throws(() => concat(f.decode(Buffer.from([255]))), /missing payload data/);
});
