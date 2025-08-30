import { iterate } from './common.js';
import { coherence, exp_iwt, norm, linear_regression } from './dsp.js';
import { prefix } from './equalizer.js';

function cDot(a, b) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.length; i++) {
    re += a[i].re * b[i];
    im += a[i].im * b[i];
  }
  return { re, im };
}

export class Detector {
  static COHERENCE_THRESHOLD = 0.9;
  static CARRIER_DURATION = prefix.reduce((a, b) => a + b, 0);
  static CARRIER_THRESHOLD = Math.floor(0.9 * Detector.CARRIER_DURATION);
  static SEARCH_WINDOW = Math.floor(0.1 * Detector.CARRIER_DURATION);
  static START_PATTERN_LENGTH = Math.floor(Detector.SEARCH_WINDOW / 4);

  constructor(config, pylab) {
    this.freq = config.Fc;
    this.omega = 2 * Math.PI * this.freq / config.Fs;
    this.Nsym = config.Nsym;
    this.Tsym = config.Tsym;
    this.maxlen = config.baud;
    this.max_offset = config.timeout * config.Fs;
    this.plt = pylab;
  }

  _wait(samples) {
    let counter = 0;
    const bufs = [];
    const Nsym = this.Nsym;
    let offset = 0;
    while (offset + Nsym <= samples.length) {
      if (offset > this.max_offset) {
        throw new Error('Timeout waiting for carrier');
      }
      const buf = samples.slice(offset, offset + Nsym);
      if (bufs.length >= this.maxlen) bufs.shift();
      bufs.push(buf);
      const complexBuf = buf.map(v => ({ re: v, im: 0 }));
      const coeff = coherence(complexBuf, this.omega);
      const mag = Math.hypot(coeff.re, coeff.im);
      if (mag > Detector.COHERENCE_THRESHOLD) {
        counter += 1;
      } else {
        counter = 0;
      }
      if (counter === Detector.CARRIER_THRESHOLD) {
        return [offset, bufs, offset + Nsym];
      }
      offset += Nsym;
    }
    throw new Error('No carrier detected');
  }

  run(samples) {
    const [offset, bufs, consumed] = this._wait(samples);
    const length = (Detector.CARRIER_THRESHOLD - 1) * this.Nsym;
    const begin = offset - length;
    let start_time = begin * this.Tsym / this.Nsym;

    bufs.splice(0, bufs.length - (Detector.CARRIER_THRESHOLD + Detector.SEARCH_WINDOW));
    const n = Detector.SEARCH_WINDOW + Detector.CARRIER_DURATION - Detector.CARRIER_THRESHOLD;
    const trailing = samples.slice(consumed, consumed + n * this.Nsym);
    bufs.push(trailing);

    let buf = bufs.flat();
    const found = this.find_start(buf);
    start_time += (found / this.Nsym - Detector.SEARCH_WINDOW) * this.Tsym;
    buf = buf.slice(found);

    const prefix_length = Detector.CARRIER_DURATION * this.Nsym;
    const [amplitude, freq_err] = this.estimate(buf.slice(0, prefix_length));
    const remaining = samples.slice(consumed + n * this.Nsym);
    return [buf.concat(remaining), amplitude, freq_err];
  }

  find_start(buf) {
    const patternLen = Detector.START_PATTERN_LENGTH * this.Nsym;
    const base = exp_iwt(this.omega, this.Nsym);
    const carrier = [];
    for (let i = 0; i < Detector.START_PATTERN_LENGTH; i++) {
      carrier.push(...base);
    }

    const zeros = new Array(patternLen).fill({ re: 0, im: 0 });
    const signal = zeros.concat(carrier);

    const signalNorm = norm(signal);
    const normSignal = signal.map(z => ({
      re: (z.re * Math.SQRT2) / signalNorm,
      im: (z.im * Math.SQRT2) / signalNorm,
    }));

    const m = normSignal.length;
    const bufC = buf.map(v => ({ re: v, im: 0 }));
    const corr = new Array(buf.length - m + 1).fill(0);
    const normB = new Array(corr.length).fill(0);

    let acc = 0;
    for (let i = 0; i < m; i++) {
      acc += buf[i] * buf[i];
    }
    normB[0] = Math.sqrt(acc);
    for (let i = 0; i < corr.length; i++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let j = 0; j < m; j++) {
        const a = bufC[i + j];
        const b = normSignal[j];
        sumRe += a.re * b.re - a.im * b.im;
        sumIm += a.re * b.im + a.im * b.re;
      }
      corr[i] = Math.hypot(sumRe, sumIm);
      if (i < corr.length - 1) {
        acc += buf[i + m] * buf[i + m] - buf[i] * buf[i];
        normB[i + 1] = Math.sqrt(Math.max(acc, 0));
      }
    }

    const coeffs = corr.map((c, i) => (normB[i] > 0 ? c / normB[i] : 0));
    const maxVal = Math.max(...coeffs);
    const index = coeffs.findIndex(c => Math.abs(c - maxVal) < 1e-12);
    return index + zeros.length;
  }

  estimate(buf, skip = 5) {
    const filt = exp_iwt(-this.omega, this.Nsym).map(v => ({
      re: v.re / (0.5 * this.Nsym),
      im: v.im / (0.5 * this.Nsym),
    }));
    const frames = Array.from(iterate(buf, this.Nsym, x => x));
    const symbols = frames.map(frame => cDot(filt, frame)).slice(skip, -skip);
    const amplitude = symbols.reduce((a, b) => a + Math.hypot(b.re, b.im), 0) / symbols.length;
    const phase = symbols.map(s => Math.atan2(s.im, s.re));
    const unwrapped = [];
    let prev = phase[0];
    let offset = 0;
    for (const p of phase) {
      while (p + offset - prev > Math.PI) offset -= 2 * Math.PI;
      while (p + offset - prev < -Math.PI) offset += 2 * Math.PI;
      const val = p + offset;
      unwrapped.push(val);
      prev = val;
    }
    const indices = Array.from({ length: unwrapped.length }, (_, i) => i);
    const [a, b] = linear_regression(indices, unwrapped.map(v => v / (2 * Math.PI)));
    this.plt.figure();
    this.plt.plot(indices, unwrapped.map(v => v / (2 * Math.PI)), ':');
    this.plt.plot(indices, indices.map(i => a * i + b));
    const freq_err = a / (this.Tsym * this.freq);
    this.plt.title(`Frequency drift: ${(freq_err * 1e6).toFixed(3)} ppm`);
    return [amplitude, freq_err];
  }
}

export default { Detector };

