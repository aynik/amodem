import fs from 'node:fs';

export const scaling = 32000.0;

export function load(path) {
  const data = fs.readFileSync(path);
  return loads(data);
}

export function loads(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const arr = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(arr[i] / scaling);
  }
  return result;
}

export function dumps(sym) {
  const values = [];
  for (const x of sym) {
    values.push(Math.round(x * scaling));
  }
  const arr = Int16Array.from(values);
  return Buffer.from(arr.buffer);
}

export function* iterate(data, size, func = null, truncate = true, index = false) {
  let offset = 0;
  const iterator = data[Symbol.iterator]();
  let done = false;
  while (!done) {
    const buf = [];
    for (let i = 0; i < size; i++) {
      const { value, done: innerDone } = iterator.next();
      if (innerDone) {
        if (truncate || buf.length === 0) {
          return;
        }
        done = true;
        break;
      }
      buf.push(value);
    }
    const result = func ? func(buf) : Array.from(buf);
    yield index ? [offset, result] : result;
    offset += size;
  }
}

export function split(iterable, n) {
  const cache = Array.from({ length: n }, () => []);
  for (const item of iterable) {
    for (let i = 0; i < n; i++) {
      cache[i].push(item[i]);
    }
  }
  return cache.map(arr => arr.values());
}

export function* icapture(iterable, result) {
  for (const item of iterable) {
    result.push(item);
    yield item;
  }
}

export function take(iterable, n) {
  const res = [];
  const iterator = iterable[Symbol.iterator]();
  for (let i = 0; i < n; i++) {
    const { value, done } = iterator.next();
    if (done) break;
    res.push(value);
  }
  return res;
}

export function Dummy() {
  const target = function () {};
  const proxy = new Proxy(target, {
    get: () => proxy,
    apply: () => proxy,
  });
  target();
  return proxy;
}
