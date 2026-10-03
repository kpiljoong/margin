// Suggesting (tracked changes, as in a word processor): the editor holds the
// note as it was and as it would be, in one text — what goes struck through,
// what comes in in pen — with a mark for each character: 'b' the note's own,
// 'd' the note's but struck, 'i' written in. The note itself is never touched;
// what is proposed (the text without the struck) goes to a staged copy and
// is taken or left change by change in the red pen review.
//
// Plain logic (test/track.test.mjs); editor.js draws the marks and redpen.js
// shares the word diff.

const TOKENS = /\s+|[\p{L}\p{N}_]+|./gu;

// The words of a and b: [[op, text]] with op '=', '-' or '+'.
export function wordOps(a, b) {
  const A = a.match(TOKENS) || [];
  const B = b.match(TOKENS) || [];
  if (A.length * B.length > 40000) return [a && ['-', a], b && ['+', b]].filter(Boolean);
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  const push = (op, s) => { const last = ops.at(-1); if (last?.[0] === op) last[1] += s; else ops.push([op, s]); };
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { push('=', A[i]); i++; j++; }
    else if (j >= B.length || (i < A.length && dp[i + 1][j] >= dp[i][j + 1])) push('-', A[i++]);
    else push('+', B[j++]);
  }
  // A lone space kept between two changes reads better inside them.
  for (let k = 1; k < ops.length - 1; k++) {
    if (ops[k][0] === '=' && !ops[k][1].trim() && ops[k - 1][0] !== '=' && ops[k + 1][0] !== '=') {
      ops.splice(k, 1, ['-', ops[k][1]], ['+', ops[k][1]]);
    }
  }
  // Deletions first, then insertions, within each run of changes.
  const out = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === '=') { out.push(ops[k++]); continue; }
    let del = '';
    let ins = '';
    for (; k < ops.length && ops[k][0] !== '='; k++) ops[k][0] === '-' ? (del += ops[k][1]) : (ins += ops[k][1]);
    if (del) out.push(['-', del]);
    if (ins) out.push(['+', ins]);
  }
  return out;
}

// Lines of a and b: [[op, line]] (as lib/diff.js, for the page).
export function lineOps(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const ops = a.slice(0, pre).map((l) => ['=', l]);
  if (A.length * B.length > 4e6) ops.push(...A.map((l) => ['-', l]), ...B.map((l) => ['+', l]));
  else {
    const w = B.length + 1;
    const dp = new Uint32Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push(['-', A[i++]]);
      else ops.push(['+', B[j++]]);
    }
    while (i < A.length) ops.push(['-', A[i++]]);
    while (j < B.length) ops.push(['+', B[j++]]);
  }
  for (let i = a.length - suf; i < a.length; i++) ops.push(['=', a[i]]);
  return ops;
}

// The hunks from base to work, shaped as the server's (lib/diff.js buildHunks,
// lines changed one for one a hunk each): for drawing them (redpen.js).
export function hunksOf(base, work) {
  const ops = lineOps(base.split('\n'), work.split('\n'));
  const hunks = [];
  let ai = 0;
  let bi = 0;
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === '=') { ai++; bi++; k++; continue; }
    const hk = { baseStart: ai, newStart: bi, removed: [], added: [] };
    for (; k < ops.length && ops[k][0] !== '='; k++) {
      if (ops[k][0] === '-') { hk.removed.push(ops[k][1]); ai++; } else { hk.added.push(ops[k][1]); bi++; }
    }
    hk.baseEnd = ai;
    if (hk.removed.length > 1 && hk.removed.length === hk.added.length) {
      hk.removed.forEach((l, j) => hunks.push({ baseStart: hk.baseStart + j, newStart: hk.newStart + j, removed: [l], added: [hk.added[j]], baseEnd: hk.baseStart + j + 1 }));
    } else hunks.push(hk);
  }
  return hunks;
}

// base and work as one text with its marks: what work struck from base, and
// what it wrote in, each where it belongs.
export function combine(base, work) {
  if (base === work) return { text: base, marks: 'b'.repeat(base.length) };
  // Every line ends in a newline here (the last one too, for a moment).
  const ops = lineOps(`${base}\n`.split('\n').slice(0, -1), `${work}\n`.split('\n').slice(0, -1));
  let text = '';
  let marks = '';
  const put = (s, m) => { text += s; marks += m.repeat(s.length); };
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === '=') { put(`${ops[k++][1]}\n`, 'b'); continue; }
    const R = [];
    const A = [];
    for (; k < ops.length && ops[k][0] !== '='; k++) (ops[k][0] === '-' ? R : A).push(ops[k][1]);
    if (R.length === A.length) {
      R.forEach((r, j) => {
        for (const [op, s] of wordOps(r, A[j])) put(s, op === '=' ? 'b' : op === '-' ? 'd' : 'i');
        put('\n', 'b');
      });
    } else {
      for (const r of R) put(`${r}\n`, 'd');
      for (const a of A) put(`${a}\n`, 'i');
    }
  }
  // Take the added last newline off again: from each side.
  const lastOf = (keep) => { for (let i = marks.length - 1; i >= 0; i--) if (marks[i] !== keep) return i; return -1; };
  const b = lastOf('i');
  const w = lastOf('d');
  const cut = (i) => { text = text.slice(0, i) + text.slice(i + 1); marks = marks.slice(0, i) + marks.slice(i + 1); };
  const set = (i, m) => { marks = marks.slice(0, i) + m + marks.slice(i + 1); };
  if (b === w) cut(b);
  else {
    // Different newlines end the two: each leaves the side it ended.
    const [first, second] = b < w ? [b, w] : [w, b];
    for (const i of [second, first]) {
      const fromBase = i === b;
      if (marks[i] === 'b') set(i, fromBase ? 'i' : 'd');
      else cut(i);
    }
  }
  return { text, marks };
}

const keep = (text, marks, drop) => { let s = ''; for (let i = 0; i < text.length; i++) if (marks[i] !== drop) s += text[i]; return s; };
export const original = (text, marks) => keep(text, marks, 'i');
export const proposed = (text, marks) => keep(text, marks, 'd');

// After an edit in the textarea (prev → next, the selection before it and
// the caret after it): what was written in is pen, and the note's own text
// that went comes back struck through.
// → { text, marks, caret, restored } (restored: the text had to change back)
export function reconcile(prev, next, before = null, after = null) {
  const { text, marks } = prev;
  if (text === next) return { text, marks, caret: after, restored: false };
  let p = 0;
  const max = Math.min(text.length, next.length);
  while (p < max && text[p] === next[p]) p++;
  if (before) p = Math.min(p, before[0]);
  if (after != null) p = Math.min(p, after);
  let s = 0;
  const maxS = Math.min(text.length, next.length) - p;
  while (s < maxS && text[text.length - 1 - s] === next[next.length - 1 - s]) s++;
  const gone = text.slice(p, text.length - s);
  const goneMarks = marks.slice(p, marks.length - s);
  const ins = next.slice(p, next.length - s);
  let back = '';
  for (let i = 0; i < gone.length; i++) if (goneMarks[i] !== 'i') back += gone[i];
  const out = {
    text: next.slice(0, p) + back + ins + next.slice(next.length - s),
    marks: marks.slice(0, p) + 'd'.repeat(back.length) + 'i'.repeat(ins.length) + marks.slice(marks.length - s),
    restored: back.length > 0,
    at: p,
    back,
  };
  // ⌫ goes on to the left of what it struck; ⌦ and typing on to the right.
  const backspace = !ins && before && before[0] === before[1] && before[0] === p + gone.length;
  out.caret = !back ? (after ?? p + ins.length) : backspace || (before && before[0] !== before[1] && !ins) ? p : p + back.length + ins.length;
  return out;
}

// The same edit while an input method is still composing: shown as written
// in, nothing put back yet.
export function provisional(prev, next) {
  const { text, marks } = prev;
  let p = 0;
  const max = Math.min(text.length, next.length);
  while (p < max && text[p] === next[p]) p++;
  let s = 0;
  while (s < max - p && text[text.length - 1 - s] === next[next.length - 1 - s]) s++;
  return marks.slice(0, p) + 'i'.repeat(next.length - s - p) + marks.slice(marks.length - s);
}

// Strike a..b: the note's own text is struck, what was written in goes.
// Struck already (all of it): unstruck instead. → { text, marks, struck }
export function strike({ text, marks }, a, b) {
  let struck = false;
  let other = false;
  for (let i = a; i < b; i++) if (text[i] !== '\n') { if (marks[i] === 'd') struck = true; else other = true; }
  if (struck && !other) return { text, marks: marks.slice(0, a) + marks.slice(a, b).replace(/d/g, 'b') + marks.slice(b), struck: false, end: b };
  let t = '';
  let m = '';
  for (let i = a; i < b; i++) {
    if (marks[i] === 'i') continue;
    t += text[i];
    m += 'd';
  }
  return { text: text.slice(0, a) + t + text.slice(b), marks: marks.slice(0, a) + m + marks.slice(b), struck: true, end: a + t.length };
}

// Runs of struck and written-in text: [[from, to, 'd' | 'i']].
export function runs(marks) {
  const out = [];
  for (let i = 0; i < marks.length;) {
    const m = marks[i];
    let j = i + 1;
    while (j < marks.length && marks[j] === m) j++;
    if (m !== 'b') out.push([i, j, m]);
    i = j;
  }
  return out;
}

// Highlighted HTML (one text character per character of the text, &<> as
// entities) with the marks wrapped around the text in it, never across a tag.
const ENTITY = /^&(?:amp|lt|gt|quot|#\d+);/;
export function overlay(html, marks) {
  if (!/[di]/.test(marks)) return html;
  let out = '';
  let idx = 0;
  let open = null;
  const close = () => { if (open) { out += '</span>'; open = null; } };
  for (let k = 0; k < html.length;) {
    const c = html[k];
    if (c === '<') {
      close();
      const e = html.indexOf('>', k);
      out += html.slice(k, e + 1);
      k = e + 1;
      continue;
    }
    let ch = c;
    if (c === '&') { const m = ENTITY.exec(html.slice(k, k + 8)); if (m) ch = m[0]; }
    const m = marks[idx] || 'b';
    if (m !== open && open) close();
    if (ch === '\n') {
      close();
      out += m === 'd' ? '<span class="tr-nl tr-d"></span>\n' : m === 'i' ? '<span class="tr-nl tr-i"></span>\n' : '\n';
    } else {
      if (m !== 'b' && m !== open) { out += `<span class="tr-${m}">`; open = m; }
      out += ch;
    }
    idx++;
    k += ch.length;
  }
  close();
  return out;
}
