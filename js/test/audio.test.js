import test from 'node:test';
import assert from 'node:assert';
import { Interface } from '../src/audio.js';
import { fastest } from '../src/config.js';

function makeLib() {
  return {
    Pa_GetErrorText: code => (code ? 'Error' : 'Success'),
    Pa_GetVersionText: () => 'PortAudio',
    Pa_GetDefaultOutputDevice: () => 1,
    Pa_GetDefaultInputDevice: () => 2,
    Pa_OpenStream: () => 0,
    Pa_StartStream: () => 0,
    Pa_StopStream: () => 0,
    Pa_CloseStream: () => 0,
    Pa_WriteStream: () => 0,
    Pa_ReadStream: () => 0,
    Pa_Initialize: () => 0,
    Pa_Terminate: () => 0,
  };
}

test('audio interface read/write and errors', () => {
  const lib = makeLib();
  const iface = new Interface(fastest(), true);
  assert.strictEqual(iface.load(() => lib), iface);

  iface.open();
  const length = 1024;
  const data = Buffer.alloc(length * 2, 0x12);
  let s = iface.player();
  assert.strictEqual(s.params.device, 1);
  s.stream = 1; // simulate handle
  s.write(data);
  s.close();
  iface.close();

  iface.open();
  s = iface.recorder();
  assert.strictEqual(s.params.device, 2);
  s.stream = 2; // simulate handle
  const out = s.read(data.length);
  assert.strictEqual(out.length, data.length);
  s.close();
  iface.close();

  assert.throws(() => iface._error_check(1));
});

test('audio interface error branches', () => {
  const cfg = fastest();
  const iface = new Interface(cfg);
  assert.throws(() => iface.call('Foo'), /library not loaded/);
  assert.throws(() => iface.load(() => ({ Pa_GetErrorText: () => 'Fail' })), /load failed/);
  const lib = makeLib();
  iface.load(lib);
  assert.throws(() => iface.call('Missing'), /missing function/);
  const StreamClass = iface.player().constructor;
  iface.streams.pop().close();
  assert.throws(() => new StreamClass(iface, cfg, true, true));
  const badCfg = { sample_size: 1, latency: 0.1, Fs: 8e3, bits_per_sample: 8 };
  assert.throws(() => new StreamClass(iface, badCfg, true, false));
  iface.open();
  const s = iface.player();
  s.stream = 1;
  assert.throws(() => s.read(1));
  assert.throws(() => s.write(Buffer.alloc(1)));
  s.close();
  iface.close();
});
