// A theme note (Themes, Labs: lib/themes.js themeNote), read back: its
// claim, the reading of it, the paragraphs it came up in, the ones that
// don't fit it (yet) and what isn't checked — and the edits that grow it:
// a paragraph added where it came up or where it doesn't fit, the reading
// put in other words. Plain Markdown, the person's to change: what isn't
// found is left alone.
//
// Plain logic (test/brief.test.mjs).

const READING = /^>\s*\[!note\][+-]?\s*Margin's reading/i;
const BEFORE = /^>\s*Before\b/i;
const FRONT = /^---\n([\s\S]*?)\n---\n?/;
const WHERE = /^##\s+Where it came up\s*$/i;
const UNFIT = /^##\s+Doesn't fit(?: \(yet\))?\s*$/i;
const OPEN = /^##\s+Not checked yet\s*$/i;
// "- the words — [[Note]] (2026-10-01)", and where else the same was
// written (one case): " · also [[Todo]], [[Log]]".
const SCENE = /^\s*[-*]\s+(.*?)\s+—\s+\[\[([^\]|#]+)[^\]]*\]\](?:\s*\((\d{4}-\d{2}-\d{2})\))?(?:\s+·\s+also\s+((?:\[\[[^\]]+\]\](?:,\s*)?)+))?\s*$/;

// Its section: the lines under a heading, to the next heading.
function section(lines, head) {
  const at = lines.findIndex((l) => head.test(l));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
  return { at, end };
}
const scenesIn = (lines, s) => (s ? lines.slice(s.at + 1, s.end).map((l, i) => { const m = SCENE.exec(l); return m && { text: m[1], name: m[2].trim(), date: m[3] || '', also: [...(m[4] || '').matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)].map((x) => x[1].trim()), line: s.at + 1 + i }; }).filter(Boolean) : []);

// → { title, made, reading, readingLine, readingEnd, scenes, unfit, open,
// whereLine, unfitLine } or null (not a theme note).
export function themeOf(text, path = '') {
  const lines = String(text).split('\n');
  const r = lines.findIndex((l) => READING.test(l));
  const front = (FRONT.exec(text) || [])[1] || '';
  const madeLine = /^theme:\s*(\d{4}-\d{2}-\d{2})/m.exec(front);
  if (r < 0 && !madeLine) return null;
  if (r < 0 && !/^themes\//i.test(path)) return null;
  let e = r + 1;
  while (r >= 0 && e < lines.length && /^>/.test(lines[e])) e++;
  const where = section(lines, WHERE);
  const unfit = section(lines, UNFIT);
  const open = section(lines, OPEN);
  return {
    title: (/^#\s+(.+)$/m.exec(text) || [])[1]?.trim() || '',
    made: madeLine?.[1] || '',
    // The reading held now; "> Before (date): …" lines are the ones held before.
    reading: r < 0 ? '' : lines.slice(r + 1, e).filter((l) => !BEFORE.test(l)).map((l) => l.replace(/^>\s?/, '')).join(' ').replace(/\s+/g, ' ').trim(),
    readingLine: r,
    readingEnd: r < 0 ? -1 : e - 1,
    scenes: scenesIn(lines, where),
    unfit: scenesIn(lines, unfit),
    open: open ? lines.slice(open.at + 1, open.end).map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean) : [],
    whereLine: where ? where.at : -1,
    unfitLine: unfit ? unfit.at : -1,
  };
}

const sceneLine = (s) => `- ${String(s.text).replace(/\s+/g, ' ').trim()} — [[${s.name}]]${s.date && !s.name.includes(s.date) ? ` (${s.date})` : ''}${s.also?.length ? ` · also ${[...new Set(s.also)].filter((x) => x !== s.name).map((x) => `[[${x}]]`).join(', ')}` : ''}`.replace(/ · also $/, '');

// The note with a paragraph added at the end of a section (made, before
// "Not checked yet" or at the end, when it isn't there yet).
function addTo(text, head, title, s) {
  const lines = text.split('\n');
  const sec = section(lines, head);
  if (sec) {
    let j = sec.end;
    while (j > sec.at + 1 && !lines[j - 1].trim()) j--;
    lines.splice(j, 0, sceneLine(s));
    return lines.join('\n');
  }
  const open = section(lines, OPEN);
  const block = [title, '', sceneLine(s), ''];
  if (open) { lines.splice(open.at, 0, ...block); return lines.join('\n'); }
  return `${text.replace(/\s*$/, '')}\n\n${block.join('\n')}`;
}
export const addScene = (text, s) => addTo(text, WHERE, '## Where it came up', s);
export const addUnfit = (text, s) => addTo(text, UNFIT, '## Doesn\'t fit (yet)', s);

// The reading in other words, if it is still the one it was (expected:
// the reading as checked; another since — null, nothing changed). The one
// it replaces stays under it, "> Before (day): …"; what would tell whether
// the new one holds goes under "Not checked yet".
export function withReading(text, reading, { expected = null, check = '', day = '' } = {}) {
  const t = themeOf(text);
  if (!t || t.readingLine < 0) return null;
  if (expected != null && norm(t.reading) !== norm(expected)) return null;
  const lines = text.split('\n');
  const kept = lines.slice(t.readingLine + 1, t.readingEnd + 1).filter((l) => BEFORE.test(l));
  const before = t.reading ? [`> Before${day ? ` (${day})` : ''}: ${t.reading}`] : [];
  lines.splice(t.readingLine + 1, t.readingEnd - t.readingLine, `> ${reading.replace(/\s+/g, ' ').trim()}`, ...before, ...kept);
  const out = lines.join('\n');
  return check ? addOpen(out, check) : out;
}
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// A line under "Not checked yet" (made at the end when it isn't there).
export function addOpen(text, what) {
  const lines = text.split('\n');
  const sec = section(lines, OPEN);
  const item = `- ${norm(what)}`;
  if (!sec) return `${text.replace(/\s*$/, '')}\n\n## Not checked yet\n\n${item}\n`;
  let j = sec.end;
  while (j > sec.at + 1 && !lines[j - 1].trim()) j--;
  lines.splice(j, 0, item);
  return lines.join('\n');
}

// What a check was of: the title and the reading as they were (a reading
// changed since makes what it said of them out of date).
export const themeSig = (t) => `${norm(t.title)}\n${norm(t.reading)}`;

// Is this paragraph one of the note's already (where it came up, or not)?
export function inTheme(t, text) {
  const k = (x) => String(x).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 120);
  const mine = k(text);
  return [...t.scenes, ...t.unfit].some((s) => k(s.text) === mine);
}
