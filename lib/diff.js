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
    h.before = a.slice(Math.max(0, h.baseStart - context), h.baseStart);
    h.after = a.slice(h.baseEnd, Math.min(a.length, h.baseEnd + context));
    hunks.push(h);
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

module.exports = { splitLines, diffLines, buildHunks, applyHunks, mergeHunks };
