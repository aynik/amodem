import * as _send from './send.js';
import * as _recv from './recv.js';
import * as framing from './framing.js';
import * as common from './common.js';
import * as stream from './stream.js';
import * as detect from './detect.js';
import * as sampling from './sampling.js';
import * as configMod from './config.js';

const autoreconfSilence = 0.1;
const autoreconfSize = 4; // Fs, Nsym, Lf, Hf (each 1 byte)

export async function send(config, src, dst, gain = 1.0, extraSilence = 0.0, autoreconfConfig = null, deps = {}) {
  const { send: sendMod = _send, framing: framingMod = framing, stream: streamMod = stream } = deps;
  let sender;
  if (autoreconfConfig) {
    sender = new sendMod.Sender(dst, autoreconfConfig, gain);
    sender.write(new Array(Math.floor(config.Fs * (config.silence_start + extraSilence))).fill(0));
    const trainingDuration = sender.offset;
    console.info?.(`Sending ${(trainingDuration / config.Fs).toFixed(3)} seconds of training audio`);
    console.info?.(
      `Sending reconfiguration via: Fs=${(autoreconfConfig.Fs / 1e3).toFixed(1)} kHz (${autoreconfConfig.symbols.length}-QAM x ${autoreconfConfig.Nfreq} carriers) Fc=${(autoreconfConfig.Fc / 1e3).toFixed(1)} kHz`
    );
    sender.start();
    const payload = Buffer.from([
      Math.floor(config.Fs / 1e3),
      config.symbols.length - 1,
      Math.floor(config.frequencies[0] / 1e3),
      Math.floor(config.frequencies[config.frequencies.length - 1] / 1e3),
    ]);
    sender.modulate(framingMod.encode(payload));
    sender.write(new Array(Math.floor(config.Fs * autoreconfSilence)).fill(0));
    sender = new sendMod.Sender(dst, config, gain);
  } else {
    sender = new sendMod.Sender(dst, config, gain);
    sender.write(new Array(Math.floor(config.Fs * (config.silence_start + extraSilence))).fill(0));
  }

  sender.start();
  const trainingDuration = sender.offset;
  console.info?.(`Sending ${(trainingDuration / config.Fs).toFixed(3)} seconds of training audio`);

  const reader = new streamMod.Reader(src, { eof: true });
  const chunks = [];
  for await (const chunk of reader) {
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  const bits = framingMod.encode(data);
  console.info?.('Starting modulation');
  sender.modulate(bits);
  const dataDuration = sender.offset - trainingDuration;
  console.info?.(
    `Sent ${(reader.total / 1e3).toFixed(3)} kB @ ${(dataDuration / config.Fs).toFixed(3)} seconds`
  );
  sender.write(new Array(Math.floor(config.Fs * config.silence_stop)).fill(0));
  return true;
}

export async function recv(config, src, dst, dumpAudio = null, pylab = null, autoreconf = false, deps = {}) {
  const {
    stream: streamMod = stream,
    common: commonMod = common,
    detect: detectMod = detect,
    recv: recvMod = _recv,
    sampling: samplingMod = sampling,
    config: configModule = configMod,
  } = deps;

  if (dumpAudio) {
    src = new streamMod.Dumper(src, dumpAudio);
  }
  const reader = new streamMod.Reader(src, { dataType: commonMod.loads, eof: true });
  const chunks = [];
  for await (const chunk of reader) {
    chunks.push(...chunk);
  }
  /* c8 ignore next */
  let signal = chunks;
  console.debug?.(`Skipping ${(config.skip_start).toFixed(3)} seconds`);
  commonMod.take(signal, Math.floor(config.skip_start * config.Fs));
  let receiver;
  try {
    if (autoreconf) {
      /* c8 ignore start */
      const output = {
        chunks: [],
        write(data) { this.chunks.push(...data); },
        flush() {},
      };
      const detector = new detectMod.Detector(config, commonMod.Dummy());
      receiver = new recvMod.Receiver(config, commonMod.Dummy());
      const [sig, amplitude, freqErr] = detector.run(signal);
      const sampler = new samplingMod.Sampler(sig, sampling.defaultInterpolator, 1 / (1.0 + freqErr));
      receiver.run(sampler, 1.0 / amplitude, output);
      const reconf = Buffer.from(output.chunks.slice(0, autoreconfSize));
      const [Fs, Nsym, Lf, Hf] = reconf;
      config = new configModule.Configuration({ Fs: Fs * 1e3, Npoints: Nsym + 1, frequencies: [Lf * 1e3, Hf * 1e3] });
      signal = sig;
      /* c8 ignore stop */
    }
    pylab = pylab || commonMod.Dummy();
    const detector2 = new detectMod.Detector(config, pylab);
    receiver = new recvMod.Receiver(config, pylab);
    const [sig2, amplitude2, freqErr2] = detector2.run(signal);
    const sampler2 = new samplingMod.Sampler(sig2, sampling.defaultInterpolator, 1 / (1.0 + freqErr2));
    receiver.run(sampler2, 1.0 / amplitude2, dst);
    return true;
  } catch (err) {
    /* c8 ignore next */
    console.error?.('Decoding failed');
    return false;
  } finally {
    /* c8 ignore next */
    if (dst && typeof dst.flush === 'function') dst.flush();
    /* c8 ignore next */
    if (receiver && typeof receiver.report === 'function') receiver.report();
  }
}

export default { send, recv };

