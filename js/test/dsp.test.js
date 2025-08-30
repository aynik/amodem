import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linearRegression,
  cMul,
  FIR,
  Demux,
  MODEM,
  prbs,
  exp_iwt,
  norm,
  rms,
  coherence,
  complex,
  cAdd,
  cSub,
  cAbs,
  cConj,
} from '../src/dsp.js';
import { Sampler } from '../src/sampling.js';
import { fastest } from '../src/config.js';

function rng(seed) {
  let s = seed;
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

function generateSymbols(Npoints) {
  const bits = Math.round(Math.log2(Npoints));
  const Nx = 2 ** Math.ceil(bits / 2);
  const Ny = Npoints / Nx;
  const syms = [];
  for (let x = 0; x < Nx; x++) {
    for (let y = 0; y < Ny; y++) {
      syms.push(complex(x, y));
    }
  }
  const last = syms[syms.length - 1];
  const shift = complex(last.re / 2, last.im / 2);
  const shifted = syms.map(s => complex(s.re - shift.re, s.im - shift.im));
  const maxAbs = Math.max(...shifted.map(cAbs));
  return shifted.map(s => complex(s.re / maxAbs, s.im / maxAbs));
}

function seq(gen, n) {
  const res = [];
  for (let i = 0; i < n; i++) res.push(gen.next().value);
  return res;
}

test('linear regression', () => {
  const x = [1, 3, 2, 8, 4, 6, 9, 7, 0, 5];
  const a = 12.3;
  const b = 4.56;
  const y = x.map(v => a * v + b);
  const [a2, b2] = linearRegression(x, y);
  assert.ok(Math.abs(a - a2) < 1e-10);
  assert.ok(Math.abs(b - b2) < 1e-10);
});

test('FIR filter', () => {
  const fir = new FIR([1, 1]);
  const y = fir.process([1, 2, 3]);
  assert.deepStrictEqual(y, [1, 3, 5]);
  assert.deepStrictEqual(fir.call([4]), [7]);
});

test('exp_iwt, norm and rms', () => {
  const arr = exp_iwt(Math.PI, 2);
  assert.ok(Math.abs(arr[0].re - 1) < 1e-12);
  assert.ok(Math.abs(arr[0].im) < 1e-12);
  assert.ok(Math.abs(arr[1].re + 1) < 1e-12);
  assert.ok(Math.abs(arr[1].im) < 1e-12);
  assert.ok(Math.abs(norm(arr) - Math.sqrt(2)) < 1e-12);
  assert.ok(Math.abs(rms(arr) - 1) < 1e-12);
  assert.strictEqual(rms([]), 0);
  const conj = cConj(complex(1, -2));
  assert.deepStrictEqual(conj, complex(1, 2));
});

test('coherence', () => {
  const x = exp_iwt(0.1, 8);
  const c = coherence(x, 0.1);
  assert.ok(cAbs(c) > 0.99);
  const zero = coherence([complex(0, 0)], 0.1);
  assert.strictEqual(zero, 0);
});

test('Demux', () => {
  const cfg = fastest();
  const freqs = [1e3, 2e3];
  const omegas = freqs.map(f => 2 * Math.PI * f / cfg.Fs);
  const carriers = freqs.map(f => exp_iwt(2 * Math.PI * f / cfg.Fs, cfg.Nsym));
  const syms = [complex(3, 0), complex(0, 2)];
  const sig = [];
  for (let i = 0; i < cfg.Nsym; i++) {
    let sum = complex(0, 0);
    for (let j = 0; j < syms.length; j++) {
      sum = cAdd(sum, cMul(syms[j], carriers[j][i]));
    }
    sig.push(sum.re);
  }
  const demux = new Demux(new Sampler(sig), omegas, cfg.Nsym);
  const [res] = Array.from(demux);
  assert.ok(cAbs(cSub(res[0], syms[0])) < 1e-12);
  assert.ok(cAbs(cSub(res[1], syms[1])) < 1e-12);
});

test('QAM encode/decode with noise', () => {
  const cfg = fastest();
  cfg.symbols = generateSymbols(cfg.Npoints);
  const q = new MODEM(cfg.symbols);
  const rand = rng(0);
  const bits = [];
  for (let i = 0; i < 1024; i++) {
    const tuple = [];
    for (let j = 0; j < q.bitsPerSymbol; j++) {
      tuple.push(rand() < 0.5 ? 1 : 0);
    }
    bits.push(tuple);
  }
  const stream = bits.flat();
  const symbols = q.encode(stream);
  let count = 0;
  const decoded = q.decode(symbols, () => { count += 1; });
  assert.strictEqual(count, symbols.length);
  assert.deepStrictEqual(decoded, bits);
  const noised = symbols.map(s =>
    cAdd(s, complex((rand() * 2 - 1) * 1e-3, (rand() * 2 - 1) * 1e-3))
  );
  const decoded2 = q.decode(noised);
  assert.deepStrictEqual(decoded2, bits);
});

function quantize(q, s) {
  const [bits] = q.decode([s]);
  const [r] = q.encode(bits);
  let index = 0;
  let min = cAbs(cSub(s, q.symbols[0]));
  for (let i = 1; i < q.symbols.length; i++) {
    const d = cAbs(cSub(s, q.symbols[i]));
    if (d < min) {
      min = d;
      index = i;
    }
  }
  const expected = q.symbols[index];
  assert.deepStrictEqual(r, expected);
}

test('overflow quantization', () => {
  const cfg = fastest();
  cfg.symbols = generateSymbols(cfg.Npoints);
  const q = new MODEM(cfg.symbols);
  const rand = rng(0);
  for (let i = 0; i < 1000; i++) {
    const s = complex(10 * normal(rand), 10 * normal(rand));
    quantize(q, s);
  }
  quantize(q, q.symbols[1]);
});

test('MODEM symbol length validation', () => {
  assert.throws(() => new MODEM([complex(0,0), complex(1,0), complex(0,1)]));
});

test('prbs sequences', () => {
  let g = prbs(1, 0x7, 2);
  assert.deepStrictEqual(seq(g, 4), [1, 2, 3, 1]);
  g = prbs(1, 0x7, 1);
  assert.deepStrictEqual(seq(g, 4), [1, 0, 1, 1]);
  g = prbs(1, 0xd, 3);
  assert.deepStrictEqual(seq(g, 8), [1, 2, 4, 5, 7, 3, 6, 1]);
  g = prbs(1, 0xd, 2);
  assert.deepStrictEqual(seq(g, 8), [1, 2, 0, 1, 3, 3, 2, 1]);
  const period = 2 ** 16 - 1;
  g = prbs(1, 0x1100b, 16);
  const arr = seq(g, period);
  arr.sort((a, b) => a - b);
  assert.deepStrictEqual(arr, Array.from({ length: period }, (_, i) => i + 1));
});

