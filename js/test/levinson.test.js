import test from 'node:test';
import assert from 'node:assert';

import { solver } from '../src/levinson.js';

function toeplitz(t) {
  const N = t.length;
  return Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => t[Math.abs(i - j)])
  );
}

function multiply(M, x) {
  return M.map(row => row.reduce((sum, val, j) => sum + val * x[j], 0));
}

test('solver solves Toeplitz system', () => {
  const t = [4, 1, 0.5, 0.25];
  const x = [1, -0.5, 2, 0.3];
  const M = toeplitz(t);
  const y = multiply(M, x);
  const result = solver(t, y);
  for (let i = 0; i < x.length; i++) {
    assert.ok(Math.abs(result[i] - x[i]) < 1e-6);
  }
});

test('solver length mismatch', () => {
  assert.throws(() => solver([1, 2], [1]), /length mismatch/);
});
