import crypto from 'node:crypto';
import { iterate } from './common.js';

export class RSCodec {
  constructor(nsym) {
    this.nsym = nsym;
  }

  encode(block) {
    const buffer = Buffer.from(block);
    const ecc = crypto.createHash('sha256').update(buffer).digest().slice(0, this.nsym);
    return Buffer.concat([buffer, ecc]);
  }

  decode(frame) {
    const buffer = Buffer.from(frame);
    const block = buffer.slice(0, buffer.length - this.nsym);
    const ecc = buffer.slice(buffer.length - this.nsym);
    const expected = crypto.createHash('sha256').update(block).digest().slice(0, this.nsym);
    if (!ecc.equals(expected)) {
      throw new Error('checksum mismatch');
    }
    return { block, ecc, errata_pos: [] };
  }
}

export class Framer {
  constructor() {
    this.block_size = 255;
    this.ecc_symbols = 6;
    this.ecc_max_errors = 0;
    this.ecc = new RSCodec(this.ecc_symbols);
    this.EOF = Buffer.alloc(0);
  }

  _pack(block) {
    const frame = this.ecc.encode(block);
    return Buffer.concat([Buffer.from([frame.length]), frame]);
  }

  *encode(data) {
    const maxPayload = this.block_size - this.ecc_symbols;
    for (const block of iterate(data, maxPayload, buf => Buffer.from(buf), false)) {
      yield this._pack(block);
    }
    yield this._pack(this.EOF);
  }

  *decode(data) {
    const iterator = data[Symbol.iterator]();
    while (true) {
      const [length] = _take_fmt(iterator, 1);
      const frame = _take_len(iterator, length);
      const { block, errata_pos } = this.ecc.decode(frame);
      this.ecc_max_errors = Math.max(this.ecc_max_errors, errata_pos.length);
      if (block.length === 0) {
        return;
      }
      yield block;
    }
  }
}

function _take_fmt(iterator, length) {
  const chunk = [];
  for (let i = 0; i < length; i++) {
    const { value, done } = iterator.next();
    if (done) {
      throw new Error('missing prefix data');
    }
    chunk.push(value);
  }
  return chunk;
}

function _take_len(iterator, length) {
  const chunk = [];
  for (let i = 0; i < length; i++) {
    const { value, done } = iterator.next();
    if (done) {
      throw new Error('missing payload data');
    }
    chunk.push(value);
  }
  return Buffer.from(chunk);
}

function chainWrapper(func) {
  return function* (...args) {
    for (const iterable of func(...args)) {
      yield* iterable;
    }
  };
}

class BitPacker {
  constructor() {
    this.byte_size = 8;
  }

  toBits(byte) {
    const bits = [];
    for (let i = 0; i < this.byte_size; i++) {
      bits.push((byte >> i) & 1);
    }
    return bits;
  }

  toByte(bits) {
    let value = 0;
    for (let i = 0; i < bits.length; i++) {
      value |= (bits[i] & 1) << i;
    }
    return value;
  }
}

function* _encode(data, framer = new Framer()) {
  const converter = new BitPacker();
  for (const frame of framer.encode(data)) {
    for (const byte of frame) {
      yield converter.toBits(byte);
    }
  }
}

export const encode = chainWrapper(_encode);

function* _toBytes(bits) {
  const converter = new BitPacker();
  for (const chunk of iterate(bits, 8, arr => arr, true)) {
    yield [converter.toByte(chunk)];
  }
}

const toBytes = chainWrapper(_toBytes);

export function* decodeFrames(bits, framer = new Framer()) {
  for (const frame of framer.decode(toBytes(bits))) {
    yield Buffer.from(frame);
  }
}

export { _take_fmt, _take_len, BitPacker, chainWrapper, _encode, _toBytes, toBytes };
