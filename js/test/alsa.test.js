import test from 'node:test';
import assert from 'node:assert';
import cp from 'node:child_process';

import { Interface } from '../src/alsa.js';
import { Configuration, fastest } from '../src/config.js';

test('alsa recorder and player', () => {
  const iface = new Interface(fastest());
  // verify commands
  const expected = 'arecord -f S16_LE -c 1 -r 32000 -T 100 -q -'.split(' ');
  assert.deepStrictEqual(iface.recordCmd, expected);
  assert.deepStrictEqual(iface.playCmd, ['aplay', ...expected.slice(1)]);

  const calls = [];
  const recProc = {
    stdout: { read: size => { calls.push(['read', size]); } },
    kill: () => { calls.push('kill'); },
  };
  iface.launch = opts => { calls.push(['launchR', opts]); return recProc; };
  const r = iface.recorder();
  assert.deepStrictEqual(calls.shift(), ['launchR', { args: expected, stdout: 'pipe' }]);
  r.read(2);
  r.close();
  assert.deepStrictEqual(calls, [['read', 2], 'kill']);
  calls.length = 0;

  const writeProc = {
    stdin: {
      write: data => { calls.push(['write', data]); },
      end: () => { calls.push('end'); },
    },
    wait: () => { calls.push('wait'); },
  };
  iface.launch = opts => { calls.push(['launchP', opts]); return writeProc; };
  const p = iface.player();
  assert.deepStrictEqual(calls.shift(), ['launchP', { args: ['aplay', ...expected.slice(1)], stdin: 'pipe' }]);
  const buf = Buffer.from([0, 0]);
  p.write(buf);
  p.close();
  assert.ok(calls.some(c => c[0] === 'write' && Buffer.compare(c[1], buf) === 0));
  assert.ok(calls.includes('end'));
  assert.ok(calls.includes('wait'));

  // player without wait handler
  iface.launch = () => ({ stdin: { write() {}, end() {} } });
  const p2 = iface.player();
  p2.write(Buffer.alloc(0));
  p2.close();

  iface.close();
});

test('alsa launch uses child_process.spawn and close handles errors', () => {
  const iface = new Interface(fastest());
  const orig = cp.spawn;
  const calls = [];
  const proc = { wait: () => { throw new Error('bad'); } };
  cp.spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return proc; };
  const p = iface.launch({ args: ['foobar'] });
  assert.strictEqual(p, proc);
  assert.deepStrictEqual(calls, [{ cmd: 'foobar', args: [], opts: { stdio: ['ignore', 'ignore', 'ignore'] } }]);
  assert.deepStrictEqual(iface.processes, [proc]);
  assert.doesNotThrow(() => iface.close());
  cp.spawn = orig;
});

test('alsa only supports 16-bit samples', () => {
  const cfg = new Configuration({ bits_per_sample: 8 });
  assert.throws(() => new Interface(cfg));
});
