// Expand the selection to the next larger piece of the note (Emacs
// expand-region, Vim text objects, Sublime's "expand selection"): word →
// what is inside the brackets, quotes or **marks** around it → with them →
// sentence → the line's text → the line → the list item or paragraph → the
// section under its heading → the larger section → the whole note.
//
// expandRange(text, start, end) → [start, end] of the smallest piece that
// holds the selection and is larger than it, or null.

const WORD = /[\p{L}\p{N}_]/u;
const PAIRS = { '(': ')', '[': ']', '{': '}', '“': '”', '‘': '’', '「': '」', '『': '』', '<': '>' };
const CLOSERS = new Set(Object.values(PAIRS));
const MARKS = ['**', '~~', '==', '`', '*', '"'];
const PREFIX = /^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|>\s?|#{1,6}\s+)*/;
const HEADING = /^(#{1,6})\s/;
const FENCE = /^\s*(```|~~~)/;
const SENTENCE_END = /[.!?。！？]/;

export function expandRange(text, start, end) {
  let best = null;
  for (const [s, e] of candidates(text, start, end)) {
    if (s > start || e < end || e - s <= end - start) continue;
    if (!best || e - s < best[1] - best[0]) best = [s, e];
  }
  return best;
}

function candidates(text, a, b) {
  const out = [];
  const len = text.length;
  const ls = text.lastIndexOf('\n', a - 1) + 1;
  let le = text.indexOf('\n', b);
  if (le < 0) le = len;
  // A selection that ends at a line start stays on the lines before it.
  if (b > a && b === text.lastIndexOf('\n', b - 1) + 1 && b - 1 >= ls) le = b - 1;
  const oneLine = !text.slice(a, b).includes('\n');

  if (oneLine) {
    const line = text.slice(ls, le);
    const at = a - ls;
    const to = b - ls;
    // Word, and the run of characters without spaces (a URL, a path).
    let s = at; let e = to;
    while (s > 0 && WORD.test(line[s - 1])) s--;
    while (e < line.length && WORD.test(line[e])) e++;
    out.push([ls + s, ls + e]);
    s = at; e = to;
    while (s > 0 && !/\s/.test(line[s - 1])) s--;
    while (e < line.length && !/\s/.test(line[e])) e++;
    out.push([ls + s, ls + e]);
    // Inside and with the brackets, quotes and marks around it.
    for (const [o, c] of pairsIn(line)) {
      out.push([ls + o.inner, ls + c.inner], [ls + o.outer, ls + c.outer]);
    }
    // The text of the line, without its list or quote or heading marks.
    const pre = PREFIX.exec(line)[0].length;
    out.push([ls + pre, ls + line.trimEnd().length]);
  }
  out.push([ls, le]);

  // Lines around: the list item (with what is under it), the paragraph, the
  // code block, the sections.
  const lines = text.split('\n');
  const starts = [];
  for (let i = 0, p = 0; i < lines.length; i++) { starts.push(p); p += lines[i].length + 1; }
  const lineAt = (pos) => { let lo = 0; let hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const endOf = (i) => starts[i] + lines[i].length;
  const la = lineAt(a);
  const lb = lineAt(Math.max(a, le));
  const blank = (i) => !lines[i].trim();

  if (oneLine) {
    // Sentence, inside the paragraph.
    let ps = la; while (ps > 0 && !blank(ps - 1) && !HEADING.test(lines[ps])) ps--;
    let pe = la; while (pe < lines.length - 1 && !blank(pe + 1) && !HEADING.test(lines[pe + 1])) pe++;
    const para = text.slice(starts[ps], endOf(pe));
    const base = starts[ps];
    let s = a - base; let e = b - base;
    while (s > 0 && !(SENTENCE_END.test(para[s - 2] || '') && /\s/.test(para[s - 1]))) s--;
    while (s < a - base && /\s/.test(para[s])) s++;
    const pre = PREFIX.exec(para.slice(s))[0].length;
    if (s === 0 || para[s - 1] === '\n') s += pre;
    while (e < para.length && !SENTENCE_END.test(para[e - 1] || '')) e++;
    if (s <= a - base) out.push([base + s, base + e]);
  }

  // The list item and what is indented under it.
  const indent = (i) => /^\s*/.exec(lines[i])[0].length;
  const item = (i) => /^\s*(?:[-*+]|\d+[.)])\s/.test(lines[i]);
  for (let i = la, under = indent(la) + 1; i >= 0 && under > 0; i--) {
    if (blank(i)) break;
    if (!item(i)) { if (i < la && indent(i) === 0) break; continue; }
    if (indent(i) >= under) continue;
    under = indent(i);
    let j = i;
    while (j + 1 < lines.length && !blank(j + 1) && indent(j + 1) > indent(i)) j++;
    if (j >= lb) out.push([starts[i], endOf(j)]);
  }

  // The paragraph (or the whole list).
  let ps = la; while (ps > 0 && !blank(ps - 1) && !HEADING.test(lines[ps])) ps--;
  let pe = lb; while (pe < lines.length - 1 && !blank(pe + 1) && !HEADING.test(lines[pe + 1])) pe++;
  if (!blank(la)) out.push([starts[ps], endOf(pe)]);

  // A fenced code block: its code, then with the fences.
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE.test(lines[i])) continue;
    if (open < 0) { open = i; continue; }
    if (open <= la && i >= lb) {
      if (i > open + 1) out.push([starts[open + 1], endOf(i - 1)]);
      out.push([starts[open], endOf(i)]);
    }
    open = -1;
  }

  // Sections: the text under the heading, then with the heading; then the
  // section around that.
  let fenced = false;
  const heads = [];
  lines.forEach((l, i) => { if (FENCE.test(l)) fenced = !fenced; else if (!fenced) { const m = HEADING.exec(l); if (m) heads.push({ i, level: m[1].length }); } });
  for (let k = 0; k < heads.length; k++) {
    const { i, level } = heads[k];
    if (i > la) break;
    const next = heads.slice(k + 1).find((x) => x.level <= level);
    let last = (next ? next.i : lines.length) - 1;
    while (last > i && blank(last)) last--;
    if (last < lb && i !== la) continue;
    if (last > i && la > i) {
      let first = i + 1;
      while (first < last && blank(first)) first++;
      if (first <= la) out.push([starts[first], endOf(last)]);
    }
    out.push([starts[i], endOf(last)]);
  }

  out.push([0, len]);
  return out;
}

// Pairs in a line: brackets by nesting, marks (** ` " …) one after another.
// → [{ inner, outer } of the opening, { inner, outer } of the closing].
function pairsIn(line) {
  const out = [];
  const stack = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (PAIRS[ch]) stack.push(i);
    else if (CLOSERS.has(ch)) {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (PAIRS[line[stack[k]]] === ch) {
          const o = stack[k];
          stack.length = k;
          out.push([{ inner: o + 1, outer: o }, { inner: i, outer: i + 1 }]);
          break;
        }
      }
    }
  }
  const taken = new Set();
  for (const m of MARKS) {
    const at = [];
    for (let i = line.indexOf(m); i >= 0; i = line.indexOf(m, i + m.length)) {
      if ([...Array(m.length).keys()].some((d) => taken.has(i + d))) continue;
      // A lone * is not part of ** (already paired above).
      at.push(i);
    }
    for (let k = 0; k + 1 < at.length; k += 2) {
      const o = at[k]; const c = at[k + 1];
      out.push([{ inner: o + m.length, outer: o }, { inner: c, outer: c + m.length }]);
      for (let d = 0; d < m.length; d++) { taken.add(o + d); taken.add(c + d); }
    }
  }
  return out;
}
