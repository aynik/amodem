import child_process from 'node:child_process';
import { loads, dumps } from './common.js';
import { Demux, cAbs } from './dsp.js';
import { Sampler } from './sampling.js';

export function volumeController(cmd) {
  if (!cmd) {
    return () => {};
  }
  return level => {
    if (!(level > 0 && level <= 1)) {
      throw new Error('invalid level');
    }
    const percent = Math.round(level * 100);
    child_process.execSync(`${cmd} ${percent}%`, { shell: true });
  };
}

export function send(config, dst, { volume_cmd = null, gain = 1.0, limit = null } = {}) {
  const volumeCtl = volumeController(volume_cmd);
  volumeCtl(1.0);
  const calibrationSymbols = Math.floor(1.0 * config.Fs);
  const t = Array.from({ length: calibrationSymbols }, (_, i) => i * config.Ts);
  const signals = config.frequencies.map(f => {
    const signal = t.map(tt => gain * Math.sin(2 * Math.PI * f * tt));
    return dumps(signal);
    });
  const total = limit ?? Infinity;
  for (let i = 0; i < total; i++) {
    const buf = signals[i % signals.length];
    dst.write(buf);
  }
}

export function* frameIter(config, src, frameLength) {
  const frameSize = frameLength * config.Nsym * config.sample_size;
  const omegas = config.frequencies.map(f => 2 * Math.PI * f / config.Fs);
  while (true) {
    const data = src.read(frameSize);
    if (!data || data.length < frameSize) return;
    let frame = loads(data);
    const mean = frame.reduce((a, b) => a + b, 0) / frame.length;
    frame = frame.map(v => v - mean);
    const sampler = new Sampler(frame);
    const symbols = Array.from(new Demux(sampler, omegas, config.Nsym));
    const coeffs = omegas.map((_, i) => {
      let s = 0;
      for (const sym of symbols) {
        s += cAbs(sym[i]) ** 2;
      }
      return Math.sqrt(s / symbols.length);
    });
    const peak = Math.max(...frame.map(Math.abs));
    const total = Math.sqrt(frame.reduce((s, x) => s + x * x, 0) / (0.5 * frame.length));
    yield [coeffs, peak, total];
  }
}

export function* detector(config, src, frameLength = 200) {
  const errors = ['weak', 'strong', 'noisy'];
  for (const [coeffs, peak, total] of frameIter(config, src, frameLength)) {
    const maxIndex = coeffs.reduce((best, val, i) => (val > coeffs[best] ? i : best), 0);
    const freq = config.frequencies[maxIndex];
    const rms = Math.abs(coeffs[maxIndex]);
    const coherency = rms / total;
    const flags = [total > 0.1, peak < 1.0, coherency > 0.99];
    const success = flags.every(Boolean);
    const idx = flags.indexOf(false);
    const msg = success ? 'good signal' : `too ${errors[idx]} signal`;
    yield { freq, rms, peak, coherency, total, success, msg };
  }
}

export function* volumeCalibration(resultIterator, volumeCtl) {
  const minLevel = 0.01;
  const maxLevel = 1.0;
  let level = 0.5;
  let step = 0.25;
  const targetLevel = 0.4;
  const itersPerUpdate = 10;
  const chain = (function* () { yield null; yield* resultIterator; })();
  let index = 0;
  for (const result of chain) {
    if (index % itersPerUpdate === 0) {
      if (index > 0) {
        const sign = result.total < targetLevel ? 1 : -1;
        level = level + step * sign;
        level = Math.min(Math.max(level, minLevel), maxLevel);
        step *= 0.5;
      }
      volumeCtl(level);
    }
    if (index > 0) {
      yield result;
    }
    index += 1;
  }
}

export function* iterWindow(iterable, size) {
  const it = iterable[Symbol.iterator]();
  const block = [];
  while (true) {
    const { value, done } = it.next();
    if (done) return;
    block.push(value);
    if (block.length > size) block.splice(0, block.length - size);
    if (block.length === size) {
      yield Array.from(block);
    }
  }
}

export function* recvIter(config, src, volumeCmd = null, dumpAudio = null) {
  const volumeCtl = volumeController(volumeCmd);
  if (dumpAudio) {
    const original = src;
    src = {
      read(n) {
        const data = original.read(n);
        if (data && data.length) {
          dumpAudio.write(data);
        }
        return data;
      }
    };
  }
  let iterator = detector(config, src);
  iterator = volumeCalibration(iterator, volumeCtl);
  for (const [prev, curr, next] of iterWindow(iterator, 3)) {
    if (prev.success && next.success) {
      if (prev.freq !== next.freq && !curr.success) {
        curr.msg = 'frequency change';
      }
    }
    yield curr;
  }
}

export function recv(config, src, opts = {}) {
  const { volume_cmd = null, dump_audio = null } = opts;
  for (const _ of recvIter(config, src, volume_cmd, dump_audio)) {
    // consume iterator
  }
}

export default {
  volumeController,
  send,
  frameIter,
  detector,
  volumeCalibration,
  iterWindow,
  recvIter,
  recv,
};
