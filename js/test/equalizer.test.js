import test from 'node:test';
import assert from 'node:assert/strict';
import { Equalizer, train } from '../src/equalizer.js';
import { fastest } from '../src/config.js';
import { cAdd, cMul, cSub, cScale, norm, complex } from '../src/dsp.js';

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function normal(rand) {
  const u1 = rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function toComplex(v) {
  return typeof v === 'number' ? complex(v, 0) : v;
}

function IIR(b, a) {
  const a0 = a[0];
  const bCoef = b.map(coef => cScale(toComplex(coef), 1 / a0));
  const aCoef = a.slice(1).map(coef => cScale(toComplex(coef), 1 / a0));
  let xState = new Array(bCoef.length).fill(complex(0, 0));
  let yState = new Array(aCoef.length + 1).fill(complex(0, 0));
  return x => {
    const out = [];
    for (const xv of x) {
      const xC = toComplex(xv);
      xState = [xC].concat(xState.slice(0, -1));
      yState = yState.slice(0, -1);
      let num = complex(0, 0);
      for (let i = 0; i < bCoef.length; i++) {
        num = cAdd(num, cMul(xState[i], bCoef[i]));
      }
      let den = complex(0, 0);
      for (let i = 0; i < aCoef.length; i++) {
        den = cAdd(den, cMul(yState[i], aCoef[i]));
      }
      const y = cSub(num, den);
      yState = [y].concat(yState);
      out.push(y);
    }
    return out;
  };
}

function lfilter(b, a, x) {
  const f = IIR(b, a);
  return f(x);
}

function assertApprox(x, y, e = 1e-12) {
  const xc = x.map(toComplex);
  const yc = y.map(toComplex);
  const diff = xc.map((v, i) => cSub(v, yc[i]));
  assert.ok(norm(diff) < e * norm(xc));
}

test('training', () => {
  const cfg = fastest();
  const e = new Equalizer(cfg);
  const L = 1000;
  const t1 = e.trainSymbols(L);
  const t2 = e.trainSymbols(L);
  assert.deepStrictEqual(t1, t2);
});

test('commutation', () => {
  const rand = rng(0);
  const x = Array.from({ length: 1000 }, () => normal(rand));
  const b = [1, complex(0, 1), -1, complex(0, -1)];
  const a = [1, 0.1];
  const y = lfilter(b, a, x);
  const y1 = lfilter([1], a, lfilter(b, [1], x));
  const y2 = lfilter(b, [1], lfilter([1], a, x));
  assertApprox(y, y1, 1e-9);
  assertApprox(y, y2, 1e-9);
  const z = lfilter(a, [1], y);
  const z_ = lfilter(b, [1], x);
  assertApprox(z, z_, 1e-9);
});

test('modem', () => {
  const cfg = fastest();
  const e = new Equalizer(cfg);
  const L = 1000;
  const sent = e.trainSymbols(L);
  const gain = cfg.Nfreq;
  const x = e.modulator(sent).map(v => v * gain);
  const received = e.demodulator(x, L);
  assertApprox(sent.flat(), received.flat());
});

test('signal', () => {
  const length = 120;
  const rand = rng(0);
  const x = Array.from({ length }, () => Math.sign(normal(rand)));
  for (let i = length - 20; i < length; i++) x[i] = 0;
  const den = [1, -0.6, 0.1];
  const num = [0.5];
  const y = lfilter(num, den, x).map(v => v.re);
  const lookahead = 2;
  const h = train({ signal: y, expected: x, order: den.length, lookahead });
  assert.ok(norm(h.slice(0, lookahead).map(v => complex(v, 0))) < 1e-12);
  const h_ = h.slice(lookahead);
  const denScaled = den.map(v => v / num[0]);
  assertApprox(h_, denScaled, 1e-9);
  const x_ = lfilter(h, [1], y).map(v => v.re);
  assertApprox(x_.slice(lookahead), x.slice(0, x.length - lookahead), 1e-9);
  assert.ok(norm(x_.slice(0, lookahead).map(v => complex(v, 0))) < 1e-12);
});

test('demodulator padding', () => {
  const cfg = fastest();
  const e = new Equalizer(cfg);
  const res = e.demodulator([], 1);
  assert.equal(res.length, 1);
});

test('train length mismatch', () => {
  assert.throws(() => train({ signal: [1], expected: [1, 2], order: 1 }));
});
