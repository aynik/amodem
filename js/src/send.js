import { dumps, iterate } from './common.js';
import { Equalizer, prefix, equalizer_length, silence_length } from './equalizer.js';
import { MODEM } from './dsp.js';

export class Sender {
  constructor(fd, config, gain = 1.0) {
    this.gain = gain;
    this.offset = 0;
    this.fd = fd;
    this.modem = new MODEM(config.symbols);
    this.Nfreq = config.Nfreq;
    this.Nsym = config.Nsym;
    this.pilot = config.carriers[config.carrier_index].map(c => c.re);
    this.silence = new Array(silence_length * this.Nsym).fill(0);
    this.iters_per_report = config.baud;
    this.padding = new Array(config.bits_per_baud).fill(0);
    this.equalizer = new Equalizer(config);
  }

  write(sym) {
    const scaled = sym.map(x => x * this.gain);
    const data = dumps(scaled);
    this.fd.write(data);
    this.offset += sym.length;
  }

  start() {
    for (const value of prefix) {
      const pilot = this.pilot.map(v => v * value);
      this.write(pilot);
    }
    const symbols = this.equalizer.trainSymbols(equalizer_length);
    const signal = this.equalizer.modulator(symbols);
    this.write(this.silence);
    this.write(signal);
    this.write(this.silence);
  }

  modulate(bits) {
    function* chain(seq, pad) {
      yield* seq;
      yield* pad;
    }
    const enc = this.modem.encode(chain(bits, this.padding));
    let i = 0;
    for (const symbols of iterate(enc, this.Nfreq, arr => arr)) {
      const signal = this.equalizer.modulator([symbols]);
      this.write(signal);
      i += 1;
      if (i % this.iters_per_report === 0) {
        const totalBits = i * this.Nfreq * this.modem.bitsPerSymbol;
        console.debug?.(`Sent ${(totalBits / 8e3).toFixed(3)} kB`);
      }
    }
  }
}
