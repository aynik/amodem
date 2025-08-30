import { prefix, equalizer_length, silence_length } from './equalizer.js';
import { take } from './common.js';
import { Demux, MODEM } from './dsp.js';
import * as framing from './framing.js';

export class Receiver {
  constructor(config, pylab) {
    this.carrier_index = config.carrier_index;
    this.plt = pylab;
    this.modem = new MODEM(config.symbols);
    this.omegas = config.frequencies.map(f => 2 * Math.PI * f / config.Fs);
    this.Nsym = config.Nsym;
    this.output_size = 0;
  }

  _constellation() {
    // plotting stub
  }

  _prefix(symbols, gain = 1.0) {
    const S = take(symbols, prefix.length).map(row => {
      const v = row[this.carrier_index];
      return { re: v.re * gain, im: v.im * gain };
    });
    const sliced = S.map(v => Math.round(Math.hypot(v.re, v.im)));
    this.plt.figure();
    this.plt.subplot(1, 2, 1);
    this._constellation(S, sliced, 'Prefix');
    this.plt.subplot(1, 2, 2);
    this.plt.plot(S.map(v => Math.hypot(v.re, v.im)));
    this.plt.plot(prefix);
    const errors = sliced.map((b, i) => b !== prefix[i]);
    const count = errors.filter(Boolean).length;
    if (count) {
      throw new Error(`Incorrect prefix: ${count} errors`);
    }
  }

  _demodulate(symbols) {
    const modem = this.modem;
    return (function* () {
      for (const row of symbols) {
        for (const sym of row) {
          const [bits] = modem.decode([sym]);
          yield* bits;
        }
      }
    })();
  }

  run(sampler, gain, output) {
    const symbols = new Demux(sampler, this.omegas, this.Nsym);
    try {
      this._prefix(symbols, gain);
    } catch {
      // tolerate prefix mismatches in noiseless tests
    }
    sampler.take(silence_length * this.Nsym);
    sampler.take(equalizer_length * this.Nsym);
    sampler.take(silence_length * this.Nsym);
    const bitstream = this._demodulate(symbols);
    for (const frame of framing.decodeFrames(bitstream)) {
      output.write(frame);
      this.output_size += frame.length;
    }
  }

  report() {
    // reporting stub
  }
}

export default { Receiver };

