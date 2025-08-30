import { prbs, cAdd, cMul, complex, Demux } from './dsp.js';
import { Sampler } from './sampling.js';
import { solver } from './levinson.js';

export class Equalizer {
  constructor(config) {
    this.carriers = config.carriers;
    this.omegas = config.frequencies.map(f => 2 * Math.PI * f / config.Fs);
    this.Nfreq = config.Nfreq;
    this.Nsym = config.Nsym;
  }

  trainSymbols(length, constant_prefix = 16) {
    const r = prbs(1, 0x1100b, 2);
    const constellation = [
      complex(1, 0),
      complex(0, 1),
      complex(-1, 0),
      complex(0, -1),
    ];
    const symbols = [];
    for (let i = 0; i < length; i++) {
      const row = [];
      for (let j = 0; j < this.Nfreq; j++) {
        row.push(constellation[r.next().value]);
      }
      symbols.push(row);
    }
    const prefixLen = Math.min(constant_prefix, symbols.length);
    for (let i = 0; i < prefixLen; i++) {
      for (let j = 0; j < this.Nfreq; j++) {
        symbols[i][j] = complex(1, 0);
      }
    }
    return symbols;
  }

  modulator(symbols) {
    const gain = 1.0 / this.carriers.length;
    const out = [];
    for (const s of symbols) {
      for (let k = 0; k < this.Nsym; k++) {
        let sum = complex(0, 0);
        for (let j = 0; j < this.Nfreq; j++) {
          sum = cAdd(sum, cMul(s[j], this.carriers[j][k]));
        }
        out.push(sum.re);
      }
    }
    return out.map(v => v * gain);
  }

  demodulator(signal, size) {
    function* pad(sig) {
      for (const v of sig) yield v;
      while (true) yield 0;
    }
    const sampler = new Sampler(pad(signal));
    const demux = new Demux(sampler, this.omegas, this.Nsym);
    const res = [];
    for (let i = 0; i < size; i++) {
      const { value, done } = demux.next();
      if (done) break;
      res.push(value);
    }
    return res;
  }
}

export const equalizer_length = 200;
export const silence_length = 50;
export const prefix = new Array(equalizer_length).fill(1).concat(new Array(silence_length).fill(0));

export function train({ signal, expected, order, lookahead = 0 }) {
  if (signal.length !== expected.length) {
    throw new Error('length mismatch');
  }
  const padding = new Array(lookahead).fill(0);
  const x = signal.concat(padding);
  const y = padding.concat(expected);
  const N = order + lookahead;
  const Rxx = new Array(N).fill(0);
  const Rxy = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < x.length - i; j++) {
      Rxx[i] += x[i + j] * x[j];
      Rxy[i] += y[i + j] * x[j];
    }
  }
  return solver(Rxx, Rxy);
}
