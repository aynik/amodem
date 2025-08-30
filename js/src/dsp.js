import { iterate } from './common.js';

export function complex(re, im = 0) {
  return { re, im };
}

export function cAdd(a, b) {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function cSub(a, b) {
  return { re: a.re - b.re, im: a.im - b.im };
}

export function cMul(a, b) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function cScale(a, k) {
  return { re: a.re * k, im: a.im * k };
}

export function cAbs(a) {
  return Math.hypot(a.re, a.im);
}

export function cConj(a) {
  return { re: a.re, im: -a.im };
}

function cDot(a, b) {
  let sum = complex(0, 0);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    const term = typeof bi === 'number' ? cScale(ai, bi) : cMul(ai, bi);
    sum = cAdd(sum, term);
  }
  return sum;
}

export function exp_iwt(omega, n) {
  const res = [];
  for (let k = 0; k < n; k++) {
    res.push(complex(Math.cos(omega * k), Math.sin(omega * k)));
  }
  return res;
}

export function norm(x) {
  let s = 0;
  for (const v of x) {
    s += v.re * v.re + v.im * v.im;
  }
  return Math.sqrt(s);
}

export function rms(x) {
  if (x.length === 0) return 0;
  let s = 0;
  for (const v of x) {
    s += v.re * v.re + v.im * v.im;
  }
  return Math.sqrt(s / x.length);
}

export function coherence(x, omega) {
  const n = x.length;
  const scale = 1 / Math.sqrt(0.5 * n);
  const Hc = exp_iwt(-omega, n).map(z => cScale(z, scale));
  const normX = norm(x);
  if (!normX) return 0;
  const dot = cDot(Hc, x);
  return cScale(dot, 1 / normX);
}

export function linearRegression(x, y) {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  const x_ = x.map(v => v - meanX);
  const y_ = y.map(v => v - meanY);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += y_[i] * x_[i];
    den += x_[i] * x_[i];
  }
  const a = num / den;
  const b = meanY - a * meanX;
  return [a, b];
}

export { linearRegression as linear_regression };

export class FIR {
  constructor(h) {
    this.h = Array.from(h);
    this.xState = new Array(this.h.length).fill(0);
  }

  process(x) {
    const out = [];
    for (const v of x) {
      this.xState = [v].concat(this.xState.slice(0, -1));
      let sum = 0;
      for (let i = 0; i < this.h.length; i++) {
        sum += this.xState[i] * this.h[i];
      }
      out.push(sum);
    }
    return out;
  }

  call(x) {
    return this.process(x);
  }
}

export class Demux {
  constructor(sampler, omegas, Nsym) {
    this.Nsym = Nsym;
    this.filters = omegas.map(w => {
      const scale = 1 / (0.5 * Nsym);
      return exp_iwt(-w, Nsym).map(z => cScale(z, scale));
    });
    this.sampler = sampler;
  }

  [Symbol.iterator]() {
    return this;
  }

  next() {
    const frame = this.sampler.take(this.Nsym);
    if (frame.length === this.Nsym) {
      const value = this.filters.map(f => cDot(f, frame));
      return { value, done: false };
    }
    return { value: undefined, done: true };
  }
}

export class MODEM {
  constructor(symbols) {
    this.encodeMap = new Map();
    const symArr = Array.from(symbols);
    let bitsPerSymbol = Math.log2(symArr.length);
    bitsPerSymbol = Math.round(bitsPerSymbol);
    const N = 2 ** bitsPerSymbol;
    if (N !== symArr.length) {
      throw new Error('symbols length must be power of 2');
    }
    this.bitsPerSymbol = bitsPerSymbol;
    symArr.forEach((sym, i) => {
      const bits = [];
      for (let j = 0; j < bitsPerSymbol; j++) {
        bits.push(i & (1 << j) ? 1 : 0);
      }
      this.encodeMap.set(bits.join(','), sym);
    });
    this.symbols = symArr;
    this.decodeList = symArr.map((sym, i) => {
      const bits = [];
      for (let j = 0; j < bitsPerSymbol; j++) {
        bits.push(i & (1 << j) ? 1 : 0);
      }
      return { symbol: sym, bits };
    });
  }

  encode(bits) {
    const res = [];
    for (const group of iterate(bits, this.bitsPerSymbol, arr => arr)) {
      res.push(this.encodeMap.get(group.join(',')));
    }
    return res;
  }

  decode(symbols, errorHandler = null) {
    const res = [];
    for (const received of symbols) {
      let best = this.decodeList[0];
      let minErr = cAbs(cSub(received, best.symbol));
      for (const item of this.decodeList.slice(1)) {
        const err = cAbs(cSub(received, item.symbol));
        if (err < minErr) {
          minErr = err;
          best = item;
        }
      }
      if (errorHandler) {
        errorHandler({ received, decoded: best.symbol });
      }
      res.push(best.bits);
    }
    return res;
  }
}

export function* prbs(reg, poly, bits) {
  const mask = (1 << bits) - 1;
  let size = 0;
  while ((poly >> size) > 1) {
    size += 1;
  }
  while (true) {
    yield reg & mask;
    reg <<= 1;
    if (reg >> size) {
      reg ^= poly;
    }
  }
}

export default {
  complex,
  cAdd,
  cSub,
  cMul,
  cScale,
  cAbs,
  cConj,
  exp_iwt,
  norm,
  rms,
  coherence,
  linearRegression,
  linear_regression: linearRegression,
  FIR,
  Demux,
  MODEM,
  prbs,
};

