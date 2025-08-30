export function solver(t, y) {
  const N = t.length;
  if (y.length !== N) {
    throw new Error('length mismatch');
  }
  const t0 = [1.0 / t[0]];
  const f = [t0.slice()];
  const b = [t0.slice()];
  for (let n = 1; n < N; n++) {
    const prev_f = f[n - 1];
    const prev_b = b[n - 1];
    let ef = 0;
    let eb = 0;
    for (let i = 0; i < n; i++) {
      ef += t[n - i] * prev_f[i];
      eb += t[i + 1] * prev_b[i];
    }
    const f_ = prev_f.concat([0]);
    const b_ = [0].concat(prev_b);
    const det = 1.0 - ef * eb;
    const new_f = f_.map((val, i) => (val - ef * b_[i]) / det);
    const new_b = b_.map((val, i) => (val - eb * f_[i]) / det);
    f.push(new_f);
    b.push(new_b);
  }
  let x = [];
  for (let n = 0; n < N; n++) {
    x = x.concat([0]);
    let ef = 0;
    for (let i = 0; i < n; i++) {
      ef += t[n - i] * x[i];
    }
    const gain = y[n] - ef;
    const bn = b[n];
    x = x.map((xi, i) => xi + gain * bn[i]);
  }
  return x;
}
