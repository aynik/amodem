import test from 'node:test';
import assert from 'node:assert/strict';
import { Configuration } from '../src/config.js';
import { encode, decodeFrames } from '../src/framing.js';
import { MODEM } from '../src/dsp.js';
import { Equalizer } from '../src/equalizer.js';
import { iterate } from '../src/common.js';

test('modulate and demodulate round trip', () => {
  const cfg = new Configuration({ Fs: 8e3, Npoints: 2, frequencies: [2e3] });
  const modem = new MODEM(cfg.symbols);
  const eq = new Equalizer(cfg);
  const data = Buffer.from('hello world');
  const bits = Array.from(encode(data));
  const symbols = modem.encode(bits);
  const grouped = Array.from(iterate(symbols, cfg.Nfreq, arr => arr));
  const signal = eq.modulator(grouped);
  const demod = eq.demodulator(signal, grouped.length);
  const decodedBits = [];
  for (const row of demod) {
    for (const sym of row) {
      const [b] = modem.decode([sym]);
      decodedBits.push(...b);
    }
  }
  const frames = Array.from(decodeFrames(decodedBits));
  const received = Buffer.concat(frames);
  assert.deepStrictEqual(received, data);
});
