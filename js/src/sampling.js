import { take as takeArray, loads, dumps } from './common.js';

function sinc(x) {
  if (x === 0) return 1;
  const pix = Math.PI * x;
  return Math.sin(pix) / pix;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}

function takeFromIterator(iterator, n) {
  const res = [];
  for (let i = 0; i < n; i++) {
    const { value, done } = iterator.next();
    if (done) break;
    res.push(value);
  }
  return res;
}

export class Interpolator {
  constructor(resolution = 1024, width = 128) {
    this.width = width;
    this.resolution = resolution;
    const N = resolution * width;
    const h = [];
    for (let u = -N; u < N; u++) {
      const window = Math.cos(0.5 * Math.PI * u / N) ** 2;
      h.push(sinc(u / resolution) * window);
    }
    this.filt = [];
    for (let index = 0; index < resolution; index++) {
      const filt = [];
      for (let i = index; i < h.length; i += resolution) {
        filt.push(h[i]);
      }
      filt.reverse();
      this.filt.push(filt);
    }
    this.coeff_len = 2 * width;
    const lengths = this.filt.map(f => f.length);
    if (!lengths.every(len => len === this.coeff_len)) throw new Error('Mismatched filter lengths');
    if (this.filt.length !== resolution) throw new Error('Invalid number of filters');
  }
}

export const defaultInterpolator = new Interpolator();

export class Sampler {
  constructor(src, interp = null, freq = 1.0) {
    this.freq = freq;
    this.equalizer = x => x;
    if (interp) {
      this.interp = interp;
      this.resolution = interp.resolution;
      this.filt = interp.filt;
      this.width = interp.width;
      const padding = new Array(interp.width).fill(0);
      this.src = padding.concat(Array.from(src));
      this.srcIndex = 0;
      this.offset = interp.width + 1;
      this.buff = new Array(interp.coeff_len).fill(0);
      this.index = 0;
      this.take = size => this._take(size);
    } else {
      const iterator = src[Symbol.iterator]();
      this.take = size => takeFromIterator(iterator, size);
    }
  }

  _take(size) {
    const frame = new Array(size).fill(0);
    let count = 0;
    for (let frameIndex = 0; frameIndex < size; frameIndex++) {
      const offset = this.offset;
      const k = Math.floor(offset);
      const j = Math.floor((offset - k) * this.resolution);
      const coeffs = this.filt[j];
      const end = k + this.width;
      while (this.index < end) {
        if (this.srcIndex >= this.src.length) {
          return this.equalizer(frame.slice(0, count));
        }
        for (let m = 0; m < this.buff.length - 1; m++) {
          this.buff[m] = this.buff[m + 1];
        }
        this.buff[this.buff.length - 1] = this.src[this.srcIndex++];
        this.index += 1;
      }
      this.offset += this.freq;
      frame[frameIndex] = dot(coeffs, this.buff);
      count = frameIndex + 1;
    }
    return this.equalizer(frame.slice(0, count));
  }
}

export function resample(srcBuffer, df = 0.0) {
  const x = loads(srcBuffer);
  const sampler = new Sampler(x, defaultInterpolator);
  sampler.freq += df;
  const y = sampler.take(x.length);
  return dumps(y);
}

export default { Interpolator, Sampler, resample, defaultInterpolator };
