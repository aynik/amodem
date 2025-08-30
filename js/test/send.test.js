import test from 'node:test';
import assert from 'node:assert/strict';
import { Sender } from '../src/send.js';
import { Configuration } from '../src/config.js';
import { equalizer_length, silence_length } from '../src/equalizer.js';

class Sink {
  constructor() { this.chunks = []; }
  write(buf) { this.chunks.push(buf); }
}

test('sender start sequence', () => {
  const cfg = new Configuration({ Fs: 4, Tsym: 0.5, frequencies: [1], Npoints: 2 });
  const sink = new Sink();
  const s = new Sender(sink, cfg);
  s.start();
  const totalSamples = sink.chunks.reduce((sum, b) => sum + b.length / 2, 0);
  const expected = cfg.Nsym * (2 * equalizer_length + 3 * silence_length);
  assert.strictEqual(totalSamples, expected);
  assert.strictEqual(s.offset, expected);
});

test('sender modulate writes and logs', () => {
  const cfg = new Configuration({ Fs: 4, Tsym: 0.5, frequencies: [1], Npoints: 2 });
  const sink = new Sink();
  const s = new Sender(sink, cfg);
  const logs = [];
  const orig = console.debug;
  console.debug = msg => logs.push(msg);
  s.modulate([1, 0]);
  console.debug = orig;
  const iterations = Math.ceil((2 + s.padding.length) / (s.modem.bitsPerSymbol * s.Nfreq));
  const expected = iterations * cfg.Nsym;
  assert.strictEqual(sink.chunks.length, iterations);
  assert.strictEqual(s.offset, expected);
  assert.ok(logs.length > 0);
});
