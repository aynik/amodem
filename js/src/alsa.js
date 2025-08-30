import cp from 'node:child_process';

export class Interface {
  static RECORDER = 'arecord';
  static PLAYER = 'aplay';

  constructor(config) {
    this.config = config;
    const rate = Math.round(config.Fs);
    const bits = config.bits_per_sample;
    if (bits !== 16) {
      throw new Error('bits_per_sample must be 16');
    }
    const args = `-f S${bits}_LE -c 1 -r ${rate} -T 100 -q -`.split(' ');
    this.recordCmd = [Interface.RECORDER, ...args];
    this.playCmd = [Interface.PLAYER, ...args];
    this.processes = [];
  }

  launch(opts) {
    const { args, stdout, stdin } = opts;
    const stdio = ['ignore', 'ignore', 'ignore'];
    if (stdout === 'pipe') stdio[1] = 'pipe';
    if (stdin === 'pipe') stdio[0] = 'pipe';
    const proc = cp.spawn(args[0], args.slice(1), { stdio });
    this.processes.push(proc);
    return proc;
  }

  recorder() {
    return new Recorder(this);
  }

  player() {
    return new Player(this);
  }

  close() {
    for (const p of this.processes) {
      try {
        if (typeof p.wait === 'function') {
          p.wait();
        }
      } catch (_err) {
        // ignore errors from wait
      }
    }
  }
}

class Recorder {
  constructor(lib) {
    this.proc = lib.launch({ args: lib.recordCmd, stdout: 'pipe' });
    this.read = size => this.proc.stdout.read(size);
    this.bufsize = 4096;
  }
  close() {
    this.proc.kill();
  }
}

class Player {
  constructor(lib) {
    this.proc = lib.launch({ args: lib.playCmd, stdin: 'pipe' });
  }
  write(data) {
    this.proc.stdin.write(data);
  }
  close() {
    this.proc.stdin.end();
    if (typeof this.proc.wait === 'function') {
      this.proc.wait();
    }
  }
}
