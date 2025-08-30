import test from 'node:test';
import assert from 'node:assert';
import { AsyncReader } from '../src/async_reader.js';

// helper to create delay
function delayedRead(n) {
  return new Promise(resolve => setTimeout(() => resolve(Buffer.alloc(n)), n * 50));
}

test('async reader reads and closes', async () => {
  let closed = false;
  const stream = {
    read: delayedRead,
    close: () => { closed = true; return Promise.resolve(); }
  };
  const r = new AsyncReader(stream, 1);
  const n = 5;
  const result = await r.read(n);
  assert.strictEqual(result.length, n);
  assert(result.equals(Buffer.alloc(n)));
  await r.close();
  assert.strictEqual(r.stream, null);
  assert.strictEqual(closed, true);
  await r.close(); // second close should be a no-op
});

test('async reader error', async () => {
  const stream = {
    read: () => Promise.reject(new Error('fail'))
  };
  const r = new AsyncReader(stream, 1);
  await assert.rejects(() => r.read(3));
  await r.close();
});

test('internal wait resolves immediately when data available', async () => {
  const stream = { read: n => new Promise(resolve => setTimeout(() => resolve(Buffer.alloc(n)), 5)) };
  const r = new AsyncReader(stream, 1);
  // Allow background loop to enqueue data
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(r.queue.length > 0);
  await r._wait();
  await r.close();
});

test('reading zero bytes', async () => {
  const stream = { read: n => new Promise(resolve => setTimeout(() => resolve(Buffer.alloc(n)), 5)) };
  const r = new AsyncReader(stream, 1);
  const buf = await r.read(0);
  assert.strictEqual(buf.length, 0);
  await r.close();
});
