import { Buffer } from 'node:buffer';

export class Interface {
  constructor(config, debug = false) {
    this.debug = !!debug;
    this.config = config;
    this.streams = [];
    this.lib = null;
  }

  load(loader) {
    this.lib = typeof loader === 'function' ? loader() : loader;
    if (this._error_string(0) !== 'Success') {
      throw new Error('load failed');
    }
    const version = this.call('GetVersionText', { restype: true });
    console.info?.(`${version} loaded`);
    return this;
  }

  _error_string(code) {
    return this.call('GetErrorText', code, { restype: true });
  }

  call(name, ...args) {
    let restype = false;
    if (
      args.length &&
      typeof args[args.length - 1] === 'object' &&
      args[args.length - 1] !== null &&
      Object.prototype.hasOwnProperty.call(args[args.length - 1], 'restype')
    ) {
      restype = true;
      args = args.slice(0, -1);
    }
    if (!this.lib) {
      throw new Error('library not loaded');
    }
    const funcName = `Pa_${name}`;
    const func = this.lib[funcName];
    if (typeof func !== 'function') {
      throw new Error(`missing function ${funcName}`);
    }
    if (this.debug) {
      const preview = args.map(a =>
        Buffer.isBuffer(a) ? `[Buffer ${a.length}]` : JSON.stringify(a)
      );
      console.debug?.(`API: ${name}${preview}`);
    }
    const res = func(...args);
    return restype ? res : this._error_check(res);
  }

  _error_check(res) {
    if (res !== 0) {
      throw new Error(res);
    }
    return res;
  }

  open() {
    this.call('Initialize');
    return this;
  }

  close() {
    for (const s of this.streams) {
      s.close();
    }
    this.streams = [];
    this.call('Terminate');
  }

  recorder() {
    return new Stream(this, this.config, true, false);
  }

  player() {
    return new Stream(this, this.config, false, true);
  }
}

class Stream {
  constructor(interface_, config, read = false, write = false) {
    this.interface = interface_;
    this.stream = 0;
    this.user_data = null;
    this.stream_callback = null;
    this.bytes_per_sample = config.sample_size;
    this.latency = config.latency;
    this.bufsize = Math.floor(this.latency * config.Fs * this.bytes_per_sample);
    if (config.bits_per_sample !== 16) {
      throw new Error('bits_per_sample must be 16');
    }
    if (!!read === !!write) {
      throw new Error('read and write cannot be equal');
    }
    const direction = read ? 'Input' : 'Output';
    const api_name = `GetDefault${direction}Device`;
    const index = this.interface.call(api_name, { restype: true });
    this.params = {
      device: index,
      channelCount: 1,
      sampleFormat: 0x00000008,
      suggestedLatency: this.latency,
      hostApiSpecificStreamInfo: null,
    };
    this.interface.call(
      'OpenStream',
      read ? this.params : null,
      write ? this.params : null,
      config.Fs,
      0,
      0,
      this.stream_callback,
      this.user_data
    );
    this.interface.streams.push(this);
    this.interface.call('StartStream', this.stream);
    this.start_time = Date.now() / 1000;
    this.io_time = 0;
  }

  close() {
    if (this.stream) {
      this.interface.call('StopStream', this.stream);
      this.interface.call('CloseStream', this.stream);
      this.stream = null;
    }
  }

  read(size) {
    if (size % this.bytes_per_sample !== 0) {
      throw new Error('size must be multiple of bytes_per_sample');
    }
    const buf = Buffer.alloc(size);
    const frames = size / this.bytes_per_sample;
    const t0 = Date.now() / 1000;
    this.interface.call('ReadStream', this.stream, buf, frames);
    const t1 = Date.now() / 1000;
    this.io_time += t1 - t0;
    if (this.interface.debug) {
      const io_wait = this.io_time / (t1 - this.start_time);
      console.debug?.(`I/O wait: ${(io_wait * 100).toFixed(1)}%`);
    }
    return buf;
  }

  write(data) {
    const buf = Buffer.from(data);
    if (buf.length % this.bytes_per_sample !== 0) {
      throw new Error('size must be multiple of bytes_per_sample');
    }
    const frames = buf.length / this.bytes_per_sample;
    this.interface.call('WriteStream', this.stream, buf, frames);
  }
}

export default { Interface };
