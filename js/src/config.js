import { complex, cAbs } from './dsp.js';

export class Configuration {
  constructor(options = {}) {
    Object.assign(this, {
      Fs: 32000.0,
      Tsym: 0.001,
      Npoints: 64,
      frequencies: [1e3, 8e3],
      bits_per_sample: 16,
      latency: 0.1,
      silence_start: 0.5,
      silence_stop: 0.5,
      skip_start: 0.1,
      timeout: 60.0,
    }, options);

    this.sample_size = Math.floor(this.bits_per_sample / 8);
    if (this.sample_size * 8 !== this.bits_per_sample) {
      throw new Error('bits_per_sample must be multiple of 8');
    }

    this.Ts = 1.0 / this.Fs;
    this.Fsym = 1 / this.Tsym;
    this.Nsym = Math.floor(this.Tsym / this.Ts);
    this.baud = Math.floor(1.0 / this.Tsym);

    if (this.frequencies.length !== 1) {
      const [first, last] = this.frequencies;
      this.frequencies = [];
      for (let f = first; f <= last; f += this.baud) {
        this.frequencies.push(f);
      }
    }

    this.Nfreq = this.frequencies.length;
    this.carrier_index = 0;
    this.Fc = this.frequencies[this.carrier_index];
    const bits_per_symbol = Math.floor(Math.log2(this.Npoints));
    if (2 ** bits_per_symbol !== this.Npoints) {
      throw new Error('Npoints must be a power of 2');
    }
    this.bits_per_baud = bits_per_symbol * this.Nfreq;
    this.modem_bps = this.baud * this.bits_per_baud;

    this.carriers = this.frequencies.map(f => {
      const arr = [];
      for (let k = 0; k < this.Nsym; k++) {
        const theta = 2 * Math.PI * f * k * this.Ts;
        arr.push(complex(Math.cos(theta), Math.sin(theta)));
      }
      return arr;
    });

    const Nx = 2 ** Math.ceil(bits_per_symbol / 2);
    const Ny = this.Npoints / Nx;
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
    this.symbols = shifted.map(s => complex(s.re / maxAbs, s.im / maxAbs));
  }
}

export const bitrates = {
  1: new Configuration({ Fs: 8e3, Npoints: 2, frequencies: [2e3] }),
  2: new Configuration({ Fs: 8e3, Npoints: 4, frequencies: [2e3] }),
  4: new Configuration({ Fs: 8e3, Npoints: 16, frequencies: [2e3] }),
  8: new Configuration({ Fs: 8e3, Npoints: 16, frequencies: [1e3, 2e3] }),
 12: new Configuration({ Fs: 16e3, Npoints: 16, frequencies: [3e3, 5e3] }),
 16: new Configuration({ Fs: 16e3, Npoints: 16, frequencies: [2e3, 5e3] }),
 20: new Configuration({ Fs: 16e3, Npoints: 16, frequencies: [2e3, 6e3] }),
 24: new Configuration({ Fs: 16e3, Npoints: 16, frequencies: [1e3, 6e3] }),
 28: new Configuration({ Fs: 32e3, Npoints: 16, frequencies: [3e3, 9e3] }),
 32: new Configuration({ Fs: 32e3, Npoints: 16, frequencies: [2e3, 9e3] }),
 36: new Configuration({ Fs: 32e3, Npoints: 64, frequencies: [4e3, 9e3] }),
 42: new Configuration({ Fs: 32e3, Npoints: 64, frequencies: [4e3, 10e3] }),
 48: new Configuration({ Fs: 32e3, Npoints: 64, frequencies: [3e3, 10e3] }),
 54: new Configuration({ Fs: 32e3, Npoints: 64, frequencies: [2e3, 10e3] }),
 60: new Configuration({ Fs: 32e3, Npoints: 64, frequencies: [2e3, 11e3] }),
 64: new Configuration({ Fs: 32e3, Npoints: 256, frequencies: [3e3, 10e3] }),
 72: new Configuration({ Fs: 32e3, Npoints: 256, frequencies: [2e3, 10e3] }),
 80: new Configuration({ Fs: 32e3, Npoints: 256, frequencies: [2e3, 11e3] }),
};

export function fastest() {
  const keys = Object.keys(bitrates).map(Number);
  const max = Math.max(...keys);
  return bitrates[max];
}

export function slowest() {
  const keys = Object.keys(bitrates).map(Number);
  const min = Math.min(...keys);
  return bitrates[min];
}
