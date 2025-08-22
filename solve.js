#!/usr/bin/env node

function charToVal(ch) {
  const c = ch.toLowerCase();
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - '0'.charCodeAt(0);
  if (c >= 'a' && c <= 'z') return 10n + BigInt(c.charCodeAt(0) - 'a'.charCodeAt(0));
  throw new Error(`Invalid digit: ${ch}`);
}

function decodeBaseToBigInt(str, base) {
  const B = BigInt(base);
  let acc = 0n;
  for (const ch of str) {
    const v = BigInt(charToVal(ch));
    if (v >= B) throw new Error(`Digit '${ch}' >= base ${base}`);
    acc = acc * B + v;
  }
  return acc;
}


function absBig(n) { return n < 0n ? -n : n; }
function gcdBig(a, b) {
  a = absBig(a);
  b = absBig(b);
  while (b !== 0n) { const t = a % b; a = b; b = t; }
  return a;
}

function normalizeFrac(num, den) {
  if (den === 0n) throw new Error("Zero denominator in fraction");
  if (num === 0n) return [0n, 1n];
  // keep denominator positive
  if (den < 0n) { num = -num; den = -den; }
  const g = gcdBig(absBig(num), den);
  return [num / g, den / g];
}

function addFrac(a, b) {
  // a = [num, den], b = [num, den]
  const [an, ad] = a, [bn, bd] = b;
  // (an/ad) + (bn/bd) = (an*bd + bn*ad) / (ad*bd)
  return normalizeFrac(an * bd + bn * ad, ad * bd);
}

function mulFrac(a, b) {
  const [an, ad] = a, [bn, bd] = b;
  return normalizeFrac(an * bn, ad * bd);
}


function interpolateAtZero(points) {
  // points: Array<{x: BigInt, y: BigInt}>
  let sum = [0n, 1n]; // fraction accumulator
  const k = points.length;

  for (let i = 0; i < k; i++) {
    const xi = points[i].x;
    const yi = points[i].y;

    let li = [1n, 1n]; // start as 1
    for (let j = 0; j < k; j++) {
      if (i === j) continue;
      const xj = points[j].x;

      const num = -xj;               // (-x_j)
      const den = xi - xj;           // (x_i - x_j)
      li = mulFrac(li, normalizeFrac(num, den));
    }

    // yi * li
    const term = mulFrac([yi, 1n], li);
    sum = addFrac(sum, term);
  }

  const [num, den] = normalizeFrac(sum[0], sum[1]);
  if (num % den !== 0n) {
    throw new Error(`Interpolation didn't yield an integer at 0: ${num}/${den}`);
  }
  return num / den; // BigInt
}

// ---------- Combinations of indices [0..n-1] choose k ----------
function* combinations(n, k) {
  const idx = Array.from({ length: k }, (_, i) => i);
  const last = n - 1;
  yield idx.slice();

  while (true) {
    let i = k - 1;
    while (i >= 0 && idx[i] === last - (k - 1 - i)) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    yield idx.slice();
  }
}

// ---------- Main logic ----------
function main() {
  const fs = require('fs');

  if (process.argv.length < 3) {
    console.error("Usage: node solve.js path/to/testcase.json");
    process.exit(1);
  }

  const raw = fs.readFileSync(process.argv[2], 'utf8');
  const data = JSON.parse(raw);

  const n = Number(data.keys?.n);
  const k = Number(data.keys?.k);
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 2 || n < k) {
    throw new Error(`Invalid n/k values: n=${n}, k=${k}`);
  }

  // Collect and decode points
  const points = [];
  for (const key of Object.keys(data)) {
    if (key === 'keys') continue;
    const xNum = BigInt(key); // x is the object key
    const base = Number(data[key].base);
    const valStr = data[key].value;
    const yNum = decodeBaseToBigInt(valStr, base);
    points.push({ x: xNum, y: yNum, label: key });
  }

  if (points.length !== n) {
    console.warn(`Warning: expected n=${n} points but found ${points.length}. Proceeding with found points.`);
  }

  // Robust mode: compute c for every subset of size k, pick the most frequent c
  const subsetCount = [];
  const cFreq = new Map();        // BigInt -> count
  const cMembers = new Map();     // BigInt -> Set of point indices that appeared in a winning subset for that c

  const m = Math.min(points.length, n);

  for (const combo of combinations(m, k)) {
    const subset = combo.map(i => points[i]);
    let c;
    try {
      c = interpolateAtZero(subset); // BigInt
    } catch (e) {
      // skip degenerate subsets (shouldn't happen with distinct x)
      continue;
    }
    const key = c.toString();
    cFreq.set(key, (cFreq.get(key) || 0) + 1);

    if (!cMembers.has(key)) cMembers.set(key, new Set());
    const set = cMembers.get(key);
    combo.forEach(i => set.add(i));
  }

  if (cFreq.size === 0) throw new Error("Could not compute any c from subsets.");

  // Pick the c with the highest frequency
  let bestC = null;
  let bestCount = -1;
  for (const [key, count] of cFreq.entries()) {
    if (count > bestCount) { bestCount = count; bestC = key; }
  }
  const bestCBig = BigInt(bestC);

  // Identify potential outliers: points not present in any subset yielding bestC
  const okSet = cMembers.get(bestC) || new Set();
  const outliers = [];
  for (let i = 0; i < m; i++) {
    if (!okSet.has(i)) outliers.push(points[i]);
  }

  // Pretty print output
  console.log("Decoded points (x, y):");
  for (const p of points) {
    console.log(`  x=${p.x.toString()}  y=${p.y.toString()}`);
  }
  console.log(`\nGiven: n=${n}, k=${k}`);
  console.log(`Computed secret c = ${bestCBig.toString()}`);
  if (outliers.length > 0) {
    console.log("\nPotential outlier point(s):");
    for (const p of outliers) {
      console.log(`  x=${p.x.toString()}  y=${p.y.toString()}`);
    }
  } else {
    console.log("\nNo outliers detected among the provided points for the winning c.");
  }
}

if (require.main === module) {
  main();
}
