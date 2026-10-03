'use strict';
// Line-based diff + hunk selection. Lossless: splitLines/join('\n') round-trips
// any text exactly (including trailing newline and CRLF, which stays in-line).

const MAX_CELLS = 4e6; // LCS table budget; beyond this we fall back to one big hunk

function splitLines(text) {
  return text.split('\n');
}

function diffLines(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre &&
         a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length, m = B.length;
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push(['=', a[i]]);

  if (n * m > MAX_CELLS) {
    for (const l of A) ops.push(['-', l]);
    for (const l of B) ops.push(['+', l]);
  } else {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = A[i] === B[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push(['-', A[i++]]);
      else ops.push(['+', B[j++]]);
    }
    while (i < n) ops.push(['-', A[i++]]);
    while (j < m) ops.push(['+', B[j++]]);
  }

  for (let i = a.length - suf; i < a.length; i++) ops.push(['=', a[i]]);
  return ops;
}

// How alike two lines are (0..1): the pairs of characters they share.
function likeness(x, y) {
  if (x === y) return 1;
  const grams = (s) => { const m = new Map(); const t = s.replace(/\s+/g, ' ').trim(); for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) || 0) + 1); return m; };
  const a = grams(x);
  const b = grams(y);
  let both = 0;
  let all = 0;
  for (const [g, v] of a) { both += Math.min(v, b.get(g) || 0); all += v; }
  for (const v of b.values()) all += v;
  return all ? (2 * both) / all : 0;
}

// A run of changed lines as changes that can be taken one by one:
// [[removed lines, added lines]]. Lines changed one for one are a change
// each; when lines also went or came, the ones still alike are paired and
// what went or came between them is a change of its own.
function pairLines(R, A) {
  if (R.length === A.length) return R.length > 1 ? R.map((r, j) => [[r], [A[j]]]) : [[R, A]];
  if (!R.length || !A.length || R.length * A.length > 2500) return [[R, A]];
  const w = A.length + 1;
  const score = new Float64Array((R.length + 1) * w);
  const sim = (i, j) => { const s = likeness(R[i], A[j]); return s >= 0.4 ? s : -1; };
  for (let i = R.length - 1; i >= 0; i--) {
    for (let j = A.length - 1; j >= 0; j--) {
      const s = sim(i, j);
      score[i * w + j] = Math.max(score[(i + 1) * w + j], score[i * w + j + 1], s > 0 ? score[(i + 1) * w + j + 1] + s : 0);
    }
  }
  const out = [];
  let r = [];
  let a = [];
  const flush = () => { if (r.length || a.length) out.push([r, a]); r = []; a = []; };
  let i = 0;
  let j = 0;
  while (i < R.length && j < A.length) {
    const s = sim(i, j);
    if (s > 0 && score[i * w + j] === score[(i + 1) * w + j + 1] + s) { flush(); out.push([[R[i++]], [A[j++]]]); }
    else if (score[i * w + j] === score[(i + 1) * w + j]) r.push(R[i++]);
    else a.push(A[j++]);
  }
  while (i < R.length) r.push(R[i++]);
  while (j < A.length) a.push(A[j++]);
  flush();
  return out;
}

// Each hunk is one contiguous run of changes, independently accept-able.
function buildHunks(baseText, newText, context = 3) {
  const a = splitLines(baseText);
  const b = splitLines(newText);
  const ops = diffLines(a, b);
  const hunks = [];
  let ai = 0, bi = 0, k = 0;
  while (k < ops.length) {
    if (ops[k][0] === '=') { ai++; bi++; k++; continue; }
    const h = { baseStart: ai, newStart: bi, removed: [], added: [] };
    while (k < ops.length && ops[k][0] !== '=') {
      if (ops[k][0] === '-') { h.removed.push(ops[k][1]); ai++; }
      else { h.added.push(ops[k][1]); bi++; }
      k++;
    }
    h.baseEnd = ai;
    // Lines changed one for one (a proofread paragraph, a list) are a change
    // each, so each can be taken or left on its own (pairLines).
    const pieces = [];
    let pa = h.baseStart;
    let pb = h.newStart;
    for (const [removed, added] of pairLines(h.removed, h.added)) {
      pieces.push({ baseStart: pa, newStart: pb, removed, added, baseEnd: pa + removed.length });
      pa += removed.length;
      pb += added.length;
    }
    pieces.forEach((p, j) => {
      p.before = j ? [] : a.slice(Math.max(0, p.baseStart - context), p.baseStart);
      p.after = j < pieces.length - 1 ? [] : a.slice(p.baseEnd, Math.min(a.length, p.baseEnd + context));
      hunks.push(p);
    });
  }
  return hunks;
}

function applyHunks(baseText, hunks, selected) {
  const a = splitLines(baseText);
  const out = [];
  let pos = 0;
  hunks.forEach((h, i) => {
    out.push(...a.slice(pos, h.baseStart));
    out.push(...(selected.has(i) ? h.added : a.slice(h.baseStart, h.baseEnd)));
    pos = h.baseEnd;
  });
  out.push(...a.slice(pos));
  return out.join('\n');
}

// 3-way merge for when the user edited the file while the agent worked.
// Agent hunks that don't overlap (or touch) a user edit are re-positioned onto
// the current text; overlapping ones are reported as conflicts, never forced.
function mergeHunks(baseText, currentText, hunks, selected = new Set()) {
  const theirs = buildHunks(baseText, currentText, 0);
  const overlaps = (h, u) => h.baseStart <= u.baseEnd && u.baseStart <= h.baseEnd;
  const conflicts = new Set();
  hunks.forEach((h, i) => { if (theirs.some((u) => overlaps(h, u))) conflicts.add(i); });

  const edits = [];
  hunks.forEach((h, i) => {
    if (!selected.has(i) || conflicts.has(i)) return;
    let shift = 0;
    for (const u of theirs) if (u.baseEnd <= h.baseStart) shift += u.added.length - u.removed.length;
    edits.push({ start: h.baseStart + shift, end: h.baseEnd + shift, lines: h.added });
  });
  const cur = splitLines(currentText);
  const out = [];
  let pos = 0;
  for (const e of edits.sort((x, y) => x.start - y.start)) {
    out.push(...cur.slice(pos, e.start), ...e.lines);
    pos = e.end;
  }
  out.push(...cur.slice(pos));
  return { text: out.join('\n'), conflicts: [...conflicts], applied: edits.length };
}

module.exports = { splitLines, diffLines, pairLines, buildHunks, applyHunks, mergeHunks };
