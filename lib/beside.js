'use strict';
// What is kept beside a note, never in it (experimental): the paragraphs
// you locked, the drawer of scraps you set aside for it, and where its
// paragraphs came from. Pure functions; server.js stores and serves them.
const { splitLines } = require('./diff');

// Where locked paragraphs are in a text: each quote (a paragraph exactly as
// written) found → its lines, first and last; one not found → line -1.
function lockRanges(text, quotes) {
  const lines = splitLines(text);
  const starts = [];
  let at = 0;
  for (const l of lines) { starts.push(at); at += l.length + 1; }
  const lineAt = (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  };
  return quotes.map((quote) => {
    const i = quote ? text.indexOf(quote) : -1;
    if (i < 0) return { quote, from: -1, to: -1 };
    return { quote, from: lineAt(i), to: lineAt(i + quote.length - 1) };
  });
}

// The changes that would touch a locked paragraph: lines of it taken out or
// changed, or lines put in between its own. Lines put in before or after it
// leave it as it is.
function lockedHunks(hunks, ranges) {
  const found = ranges.filter((r) => r.from >= 0);
  const out = [];
  hunks.forEach((h, i) => {
    const hit = found.some((r) => (h.baseEnd > h.baseStart
      ? h.baseStart <= r.to && h.baseEnd - 1 >= r.from
      : h.baseStart > r.from && h.baseStart <= r.to));
    if (hit) out.push(i);
  });
  return out;
}

// The drawer of a note, as Markdown: each scrap as it was set aside, after
// a comment line saying where it came from (if from a note).
const SCRAP = /^<!-- scrap(?: from="([^"]*)")?(?: line="(\d+)")?(?: at="([^"]*)")? -->$/;
function drawerText(scraps) {
  return scraps.map((s) => {
    const attrs = [s.from && ` from="${s.from.replace(/"/g, '')}"`, Number.isInteger(s.line) && ` line="${s.line}"`, s.at && ` at="${s.at.replace(/"/g, '')}"`].filter(Boolean).join('');
    return `<!-- scrap${attrs} -->\n${s.text.replace(/\s+$/, '')}\n`;
  }).join('\n');
}
function drawerScraps(text) {
  const out = [];
  let cur = null;
  for (const l of splitLines(text || '')) {
    const m = SCRAP.exec(l.trim());
    if (m) {
      if (cur) out.push(cur);
      cur = { text: '', from: m[1] || undefined, line: m[2] != null ? Number(m[2]) : undefined, at: m[3] || undefined, lines: [] };
      continue;
    }
    if (!cur) cur = { text: '', lines: [] };
    cur.lines.push(l);
  }
  if (cur) out.push(cur);
  return out.map(({ lines, ...s }) => ({ ...s, text: lines.join('\n').replace(/^\n+|\s+$/g, '') })).filter((s) => s.text);
}

// The lines a run put in a note, of the changes applied.
function addedLines(hunks, applied) {
  const out = [];
  for (const i of applied) for (const l of hunks[i]?.added || []) if (l.trim()) out.push(l);
  return out;
}

module.exports = { lockRanges, lockedHunks, drawerText, drawerScraps, addedLines };
