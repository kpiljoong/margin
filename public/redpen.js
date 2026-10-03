// Red pen: an agent's proposal drawn on the note itself, as an editor marks
// a proof — what goes struck through, what comes in written above a caret,
// the reasons in the margin with a line to their place. Only a way to look
// at the changes: each mark is one of the run's hunks, picked or not as in
// the diff, and applied the same way.
//
// penSource() writes the marks into the note's Markdown as private-use
// characters, so the note renders as it always does; decorate() turns them
// into elements afterwards. A start character and an id character open a
// mark, END closes it; marks never cross a line.

const DEL = '\uE000';
const END = '\uE001';
const INS = '\uE002';
const INSL = '\uE005';
const ANC = '\uE006';
const KINDS = { [DEL]: 'pen-del', [INS]: 'pen-ins', [INSL]: 'pen-insl', [ANC]: 'pen-anchor' };
const HUNK_ID = 0xE100;
const NOTE_ID = 0xE900;
const MARKS = /[\uE000-\uE00F\uE100-\uEFFF]/g;
const HAS_MARK = /[\uE000-\uE00F\uE100-\uEFFF]/;
const STARTS = /[\uE000-\uE00F]/;

const idChar = (key) => String.fromCharCode(key[0] === 'h' ? HUNK_ID + Number(key.slice(1)) : NOTE_ID + Number(key.slice(1)));
const keyOf = (ch) => { const n = ch.charCodeAt(0); return n >= NOTE_ID ? `n${n - NOTE_ID}` : `h${n - HUNK_ID}`; };

// What starts a line and has to stay first for Markdown to see it: list
// bullets, checkboxes, heading hashes, quote marks, a table's first pipe.
const PREFIX = /^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s?|\|\s*)*/;
// Lines a mark would break: blank, fences, rules and table/heading underlines.
const structural = (l) => !l.trim() || /^\s*(```|~~~)/.test(l) || /^\s*[-*_=|:\s]+$/.test(l);
const split = (l) => { const p = PREFIX.exec(l)[0]; return [p, l.slice(p.length)]; };
const TOKENS = /\s+|[\p{L}\p{N}_]+|./gu;

// The words of a and b: [[op, text]] with op '=', '-' or '+'.
export function wordOps(a, b) {
  const A = a.match(TOKENS) || [];
  const B = b.match(TOKENS) || [];
  if (A.length * B.length > 40000) return [['-', a], ['+', b]];
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

// The note with the marks of `hunks` (the run's, against `base`) and of
// `comments` (the agent's margin notes on this note: { quote, comment,
// suggest, made, n } — n their number in the run).
// → { text, marks: [{ key, kind: 'hunk' | 'note', i?, line, notes: [comment] }], general: [comment] }
// marks in the order of the note.
export function penSource(base, hunks = [], comments = []) {
  const lines = base.split('\n');
  const starts = [];
  let at = 0;
  for (const l of lines) { starts.push(at); at += l.length + 1; }
  const lineAt = (pos) => { let lo = 0; let hi = lines.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const hunkAt = (ln) => hunks.findIndex((hk) => ln >= hk.baseStart && ln < Math.max(hk.baseEnd, hk.baseStart + 1));

  // Each comment goes with the change it explains, or on the words it is about.
  const byHunk = new Map();
  const anchors = new Map();
  const notes = [];
  const general = [];
  for (const c of comments) {
    const pos = c.quote ? base.indexOf(c.quote) : -1;
    if (pos < 0) {
      const i = c.suggest ? hunks.findIndex((hk) => hk.added.join('\n').includes(c.suggest)) : -1;
      if (i >= 0) { if (!byHunk.has(i)) byHunk.set(i, []); byHunk.get(i).push(c); } else general.push(c);
      continue;
    }
    const ln = lineAt(pos);
    const i = hunkAt(ln);
    if (i >= 0) { if (!byHunk.has(i)) byHunk.set(i, []); byHunk.get(i).push(c); continue; }
    const line = lines[ln];
    let from = Math.max(pos - starts[ln], split(line)[0].length);
    let to = Math.min(pos - starts[ln] + c.quote.length, line.length);
    const list = anchors.get(ln) || [];
    if (structural(line) || to <= from) { general.push(c); continue; }
    // Words another note is on already: this one takes the rest of its
    // quote, or joins that note when nothing is left.
    let joined = null;
    for (const x of list.sort((p, q) => p.from - q.from)) {
      if (to <= x.from || x.to <= from) continue;
      if (from >= x.from && to <= x.to) { joined = x; break; }
      if (from < x.from) to = x.from; else from = x.to;
      if (to <= from || !/[\p{L}\p{N}]/u.test(line.slice(from, to))) { joined = x; break; }
    }
    if (joined) { joined.mark.notes.push(c); continue; }
    const mark = { key: `n${c.n}`, kind: 'note', line: ln, notes: [c] };
    mark.at = from;
    list.push({ from, to, key: mark.key, mark });
    anchors.set(ln, list);
    notes.push(mark);
  }

  const marks = [...notes];
  const out = [];
  let pos = 0;
  const plain = (ln) => {
    const list = anchors.get(ln);
    if (!list) return lines[ln];
    let l = lines[ln];
    for (const a of [...list].sort((x, y) => y.from - x.from)) l = l.slice(0, a.from) + ANC + idChar(a.key) + l.slice(a.from, a.to) + END + l.slice(a.to);
    return l;
  };
  hunks.forEach((hk, i) => {
    for (; pos < hk.baseStart; pos++) out.push(plain(pos));
    pos = hk.baseEnd;
    const key = `h${i}`;
    const id = idChar(key);
    let seen = false;
    const wrap = (kind, s) => { if (s.trim()) seen = true; return s ? kind + id + s + END : ''; };
    const del = (l) => { if (structural(l)) return l.trim() ? null : l; const [p, rest] = split(l); return p + wrap(DEL, rest); };
    const ins = (l) => { if (structural(l)) return l; const [p, rest] = split(l); return p + wrap(INSL, rest); };
    const R = hk.removed;
    const A = hk.added;
    const pair = R.length === A.length && R.length <= 20;
    const rows = [];
    if (pair) {
      R.forEach((r, k) => {
        const a = A[k];
        const [pr, rr] = split(r);
        const [pa, ra] = split(a);
        if (structural(r) || structural(a) || pr !== pa) { rows.push(del(r), ins(a)); return; }
        rows.push(pa + wordOps(rr, ra).map(([op, s]) => (op === '=' ? s : wrap(op === '-' ? DEL : INS, s))).join(''));
      });
    } else rows.push(...R.map(del), ...A.map(ins));
    // Only spaces or empty lines changed: a pilcrow to show where.
    if (!seen) rows.push((A.join('\n').length >= R.join('\n').length ? INSL : DEL) + id + '¶' + END);
    out.push(...rows.filter((r) => r != null));
    marks.push({ key, kind: 'hunk', i, line: hk.baseStart, notes: byHunk.get(i) || [] });
  });
  for (; pos < lines.length; pos++) out.push(plain(pos));
  marks.sort((a, b) => a.line - b.line || (a.at ?? -1) - (b.at ?? -1));
  return { text: out.join('\n'), marks, general };
}

// The rendered note: the marks as elements (span.pen-del / pen-ins /
// pen-insl / pen-anchor, data-mark = their key), none left in attributes.
export function decorate(root) {
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (HAS_MARK.test(a.value)) el.setAttribute(a.name, a.value.replace(MARKS, ''));
  }
  const doc = root.ownerDocument;
  const walk = doc.createTreeWalker(root, 4);
  const nodes = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (STARTS.test(n.data) || nodes.length) nodes.push(n);
  let open = null;
  for (const node of nodes) {
    const s = node.data;
    if (!open && !STARTS.test(s)) continue;
    const parts = [];
    let buf = '';
    const flush = () => {
      if (!buf) return;
      if (open) {
        const span = doc.createElement('span');
        span.className = open.cls;
        span.dataset.mark = open.key;
        span.textContent = buf;
        parts.push(span);
      } else parts.push(doc.createTextNode(buf));
      buf = '';
    };
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (KINDS[ch]) { flush(); open = { cls: KINDS[ch], key: keyOf(s[k + 1] || '\uE100') }; k++; }
      else if (ch === END) { flush(); open = null; }
      else buf += ch;
    }
    flush();
    node.replaceWith(...parts);
  }
  return root;
}

// The margin notes beside their marks: each at the height of its first
// mark, none over another, with a line from the mark to it. page holds
// .pen-doc, .pen-margin (the .pen-card[data-mark] in order) and svg.pen-lines.
export function layoutMargin(page) {
  const doc = page.querySelector('.pen-doc');
  const margin = page.querySelector('.pen-margin');
  const svg = page.querySelector('svg.pen-lines');
  if (!doc || !margin || !svg || !page.isConnected) return;
  const box = page.getBoundingClientRect();
  if (!box.width) return;
  const ns = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  svg.setAttribute('width', box.width);
  svg.setAttribute('height', page.scrollHeight);
  const mx = margin.getBoundingClientRect().left - box.left;
  // Lines start past the end of the text, so they never read as a strike.
  const dx = doc.getBoundingClientRect().right - box.left + 6;
  let next = 0;
  for (const card of margin.querySelectorAll('.pen-card')) {
    const mark = doc.querySelector(`[data-mark="${card.dataset.mark}"]`);
    const r = (mark?.getClientRects()[0]) || mark?.getBoundingClientRect();
    const y = r ? r.top - box.top : next;
    const top = Math.max(y - 6, next);
    card.style.top = `${top}px`;
    next = top + card.offsetHeight + 8;
    if (!r || !card.classList.contains('noted')) continue;
    const x1 = Math.min(dx, mx - 8);
    const y1 = r.top - box.top + r.height * 0.5;
    const y2 = top + 11;
    const line = doc.ownerDocument.createElementNS(ns, 'path');
    line.setAttribute('d', `M${x1},${y1} C${(x1 + mx) / 2},${y1} ${(x1 + mx) / 2},${y2} ${mx - 2},${y2}`);
    const dot = doc.ownerDocument.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x1);
    dot.setAttribute('cy', y1);
    dot.setAttribute('r', 2);
    svg.append(line, dot);
  }
  margin.style.minHeight = `${next}px`;
}

// Laid out again when the page or the note in it changes size (fonts and
// images arriving, the pane resized).
export function watchMargin(page) {
  const ro = new ResizeObserver(() => layoutMargin(page));
  ro.observe(page);
  ro.observe(page.querySelector('.pen-doc'));
  return ro;
}
