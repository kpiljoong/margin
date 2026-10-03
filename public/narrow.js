// What narrowing shows (editor.js narrow()): the section the caret is in, or
// the lines of a selection. Places in the note; plain logic, tested without a
// page (test/narrow.test.mjs).

// Each line's start, and its heading level (0: not a heading; fenced code
// is never one).
function scan(text) {
  const starts = [];
  const levels = [];
  let fence = null;
  let at = 0;
  for (const line of text.split('\n')) {
    starts.push(at);
    at += line.length + 1;
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; levels.push(0); continue; }
    if (f) { fence = f[1]; levels.push(0); continue; }
    const m = /^(#{1,6})\s/.exec(line);
    levels.push(m ? m[1].length : 0);
  }
  return { starts, levels };
}

const lineOf = (starts, pos) => { let i = 0; while (i + 1 < starts.length && starts[i + 1] <= pos) i++; return i; };

// The heading the caret is under, to the next heading as high or higher:
// [start, end] (without the line break before that heading), or null when
// no heading is above the caret.
export function sectionRange(text, pos) {
  const { starts, levels } = scan(text);
  let h = lineOf(starts, pos);
  while (h >= 0 && !levels[h]) h--;
  if (h < 0) return null;
  let next = h + 1;
  while (next < levels.length && !(levels[next] && levels[next] <= levels[h])) next++;
  return [starts[h], next < starts.length ? starts[next] - 1 : text.length];
}

// The whole lines a selection a..b is on (a line it only ends at the start
// of is left out).
export function linesRange(text, a, b) {
  if (b > a && text[b - 1] === '\n') b--;
  const start = text.lastIndexOf('\n', a - 1) + 1;
  const nl = text.indexOf('\n', b);
  return [start, nl === -1 ? text.length : nl];
}
