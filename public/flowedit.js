// Drawing on a ```flow picture writes its text: each change made on the
// canvas (connect two boxes, add one, colour, delete, turn) is a change to
// the block's source, the smallest that does it, so the text stays the
// source and stays yours to read and edit. New lines go after the steps
// already written, before the colour lines at the end. Plain logic, tested
// without a page (test/flowedit.test.mjs).

import { parseFlow, parseStep, noteOf, ARROWS, ARROW_RE, COLOR_LINE, DIRECTION_LINE, DIRECTIONS, colorKey, colorNames } from './flow.js';

const linesOf = (src) => String(src).replace(/\r\n?/g, '\n').split('\n');
const tryParse = (src) => { try { return parseFlow(src); } catch { return null; } };
// A written step's name, without its shape, problem mark or note.
const nameOf = (piece) => parseStep(noteOf(piece).name).text;
const isColorLine = (body) => { const m = COLOR_LINE.exec(body); return !!(m && colorKey(m[2])); };

// A step's name as it can be written first on a line: one that would read
// as a comment, a colour or a direction line goes in a [box].
const written = (name) => (/^(#|\/\/)/.test(name) || isColorLine(`${name}`) || DIRECTION_LINE.test(name) ? `[${name}]` : name);

// Where a line is added: after the last step line, before the colour
// lines (and blank lines) that end the block.
function endOfSteps(ls) {
  let at = ls.length;
  while (at > 0 && (!ls[at - 1].trim() || isColorLine(ls[at - 1].trim()))) at--;
  return at;
}

function insertLine(src, line) {
  const ls = linesOf(src);
  if (ls.every((l) => !l.trim())) return line;
  ls.splice(endOfSteps(ls), 0, line);
  return ls.join('\n');
}

// Does the last step line end with this step? Then an arrow from it goes on
// that line: "A -> B" and B -> C is "A -> B -> C" ("A -> B: note -> C").
function endsWith(ls, at, name) {
  const body = ls[at]?.trim();
  if (!body || body.startsWith('#') || body.startsWith('//') || DIRECTION_LINE.test(body) || /:$/.test(body)) return false;
  const pieces = body.split(ARROW_RE);
  return nameOf(pieces[pieces.length - 1]) === name;
}

// "New step", else "New step 2", … — a name no step has.
export function freshName(src, base = 'New step') {
  const names = new Set((tryParse(src)?.nodes || []).map((n) => n.text));
  if (!names.has(base)) return base;
  let k = 2;
  while (names.has(`${base} ${k}`)) k++;
  return `${base} ${k}`;
}

// An arrow from one step to another (a step not there yet is made). Nothing
// changes when that arrow is there already, or both are the same step.
export function connect(src, from, to, label = '') {
  const text = clean(label);
  return addArrow(src, from, to, text ? `-(${text})->` : '->');
}

const clean = (label) => String(label).replace(/[()]/g, '').trim();
const BOTH = new Set(['<-->', '---']);

function addArrow(src, from, to, arrow) {
  if (from === to) return src;
  const f = tryParse(src);
  const id = (t) => f?.nodes.find((n) => n.text === t)?.id;
  const a = id(from);
  const b = id(to);
  if (a && b && f.edges.some((e) => (e.from === a && e.to === b) || (BOTH.has(e.kind) && e.from === b && e.to === a))) return src;
  const ls = linesOf(src);
  const last = endOfSteps(ls) - 1;
  if (endsWith(ls, last, from)) {
    ls[last] = `${ls[last].trimEnd()} ${arrow} ${to}`;
    return ls.join('\n');
  }
  return insertLine(src, `${written(from)} ${arrow} ${to}`);
}

// The answer an arrow out of a question gets when it is drawn: yes, then
// no, then none.
export function nextAnswer(src, from) {
  const f = tryParse(src);
  const n = f?.nodes.find((x) => x.text === from);
  if (n?.shape !== 'decision') return '';
  const out = f.edges.filter((e) => e.from === n.id).map((e) => e.label.split(':')[0].trim().toLowerCase());
  return ['yes', 'no'].find((a) => !out.includes(a)) || '';
}

// A step on its own line, joined to nothing yet.
export function addBox(src, name) {
  return insertLine(src, written(name));
}

// Colour steps (null: no colour). One "color …:" line per colour; a step
// named on another colour's line is taken off it, and a line left empty goes.
export function setColor(src, names, color) {
  const key = color ? colorKey(color) : null;
  if (color && !key) throw new Error(`“${color}” is not a colour`);
  const f = tryParse(src);
  if (!f) return src;
  const known = f.nodes.map((n) => n.text);
  const targets = new Set(names);
  const ls = linesOf(src);
  const out = [];
  let mine = -1; // the line of that colour, in out
  for (const line of ls) {
    const m = COLOR_LINE.exec(line.trim());
    if (!m || !colorKey(m[2])) { out.push(line); continue; }
    const listed = colorNames(m[3], known);
    const left = listed.filter((n) => !targets.has(n));
    if (left.length === listed.length && colorKey(m[2]) !== key) { out.push(line); continue; }
    if (!left.length && colorKey(m[2]) !== key) continue;
    const lead = line.slice(0, line.length - line.trimStart().length);
    out.push(`${lead}${m[1]} ${m[2]}: ${left.join(', ')}`);
    if (colorKey(m[2]) === key) mine = out.length - 1;
  }
  if (key) {
    const add = names.filter((n) => known.includes(n));
    if (mine >= 0) {
      const m = COLOR_LINE.exec(out[mine].trim());
      const lead = out[mine].slice(0, out[mine].length - out[mine].trimStart().length);
      const all = [...colorNames(m[3], known), ...add];
      out[mine] = `${lead}${m[1]} ${m[2]}: ${all.join(', ')}`;
    } else if (add.length) {
      while (out.length && !out[out.length - 1].trim()) out.pop();
      out.push(`color ${key}: ${add.join(', ')}`);
    }
  }
  // A colour line left with no names goes.
  return out.filter((l) => { const m = COLOR_LINE.exec(l.trim()); return !(m && colorKey(m[2]) && !m[3].trim()); }).join('\n');
}

// The way the picture runs: down, right, left or up.
export function setDirection(src, dir) {
  if (!DIRECTIONS[dir]) throw new Error(`“${dir}” is not a direction`);
  const ls = linesOf(src);
  const at = ls.findIndex((l) => { const m = DIRECTION_LINE.exec(l.trim()); return m && DIRECTIONS[m[2].toLowerCase()]; });
  if (at >= 0) {
    const m = DIRECTION_LINE.exec(ls[at].trim());
    const lead = ls[at].slice(0, ls[at].length - ls[at].trimStart().length);
    ls[at] = `${lead}${m[1]}: ${dir}`;
    return ls.join('\n');
  }
  if (dir === 'down') return src;
  return [`direction: ${dir}`, ...ls].join('\n');
}

// Take a step out: from every line it is written on, and the colour lines.
// In a line of steps the ones on either side of it join up
// ("A -> B -> C" without B is "A -> C"); a line left with no step goes
// (an answer under a question with it). Its note ("B: note") goes with it.
export function removeBox(src, name) {
  const f = tryParse(src);
  if (!f?.nodes.some((n) => n.text === name)) return src;
  const shapes = new Map(f.nodes.map((n) => [n.text, n.shape]));
  const linesOfName = new Map(f.nodes.map((n) => [n.text, n.lines]));
  const ls = linesOf(src);
  const indentOf = (l) => l.replace(/\t/g, '  ').length - l.replace(/\t/g, '  ').trimStart().length;
  // Lines indented under line i (they go on from its last step).
  const hasChildren = (i) => {
    for (let j = i + 1; j < ls.length; j++) {
      const b = ls[j].trim();
      if (!b || b.startsWith('#') || b.startsWith('//')) continue;
      return indentOf(ls[j]) > indentOf(ls[i]);
    }
    return false;
  };
  const out = [];
  const stack = []; // { indent, last } as parseFlow keeps it
  for (const [lineNo, raw] of ls.entries()) {
    const line = raw.replace(/\t/g, '  ');
    const body = line.trim();
    if (!body || body.startsWith('#') || body.startsWith('//')) { out.push(raw); continue; }
    const indent = line.length - line.trimStart().length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1] || null;
    if (DIRECTION_LINE.test(body) && DIRECTIONS[DIRECTION_LINE.exec(body)[2].toLowerCase()]) { out.push(raw); continue; }
    if (isColorLine(body)) {
      const m = COLOR_LINE.exec(body);
      const left = colorNames(m[3], shapes.keys()).filter((n) => n !== name);
      if (left.length) out.push(`${raw.slice(0, raw.length - raw.trimStart().length)}${m[1]} ${m[2]}: ${left.join(', ')}`);
      continue;
    }
    const header = /^([^:]+?)\s*:$/.exec(body);
    if (header && !ARROW_RE.test(header[1])) { stack.push({ indent, last: null }); out.push(raw); continue; }
    const pieces = body.split(ARROW_RE);
    let steps = pieces.filter((_, i) => i % 2 === 0);
    let arrows = pieces.filter((_, i) => i % 2 === 1).map((a) => a.trim());
    const answerOf = parent?.last && shapes.get(parent.last) === 'decision' && steps.length > 1;
    let answer = null;
    if (answerOf) { answer = `${steps[0].trim()} ${arrows[0]} `; steps = steps.slice(1); arrows = arrows.slice(1); }
    const names = steps.map(nameOf);
    const last = [...names].reverse().find(Boolean) || parent?.last || null;
    stack.push({ indent, last });
    if (!names.includes(name)) { out.push(raw); continue; }
    // The steps left, each after the arrow into the first of those taken
    // out before it (or its own).
    const kept = [];
    let into = null;
    names.forEach((n, i) => {
      const before = i > 0 ? arrows[i - 1] : null;
      if (n === name) { into ??= before; return; }
      kept.push({ piece: steps[i].trim(), arrow: into ?? before });
      into = null;
    });
    if (!kept.length) continue;
    // One step left, written as it is on another line too: the line said
    // nothing else.
    const lone = kept.length === 1 && !answer && !hasChildren(lineNo);
    if (lone && kept[0].piece === parseStep(kept[0].piece).text && linesOfName.get(kept[0].piece)?.some((l) => l !== lineNo)) continue;
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const chain = kept.map((k, i) => (i && k.arrow ? `${k.arrow} ${k.piece}` : k.piece)).join(' ');
    out.push(`${lead}${answer || ''}${chain}`);
  }
  return out.join('\n');
}

// ---- arrows

// How an arrow is written, for each kind (parseFlow's Mermaid kinds).
const WRITTEN = { '-->': '->', '<-->': '<->', '-.->': '..>', '---': '--' };
// What a written arrow is (null: none written, a line going on from the
// one above it).
function arrowOf(token) {
  if (token == null) return { kind: '-->', label: '' };
  const m = /^-\(([^()]*)\)->$/.exec(token);
  return m ? { kind: '-->', label: m[1].trim() } : { kind: ARROWS[token], label: '' };
}
const tokenOf = (kind, label = '') => (kind === '-->' && clean(label) ? `-(${clean(label)})->` : WRITTEN[kind]);

const widthOf = (l) => l.replace(/\t/g, '  ').length - l.replace(/\t/g, '  ').trimStart().length;

// The step lines as parseFlow reads them: { lineNo, lead, indent, from (the
// step the line goes on from), answer, answerArrow, steps (as written),
// names, arrows (written between steps) } — a step's note is in what is
// written of it.
function stepLines(src) {
  const f = tryParse(src);
  const shapes = new Map((f?.nodes || []).map((n) => [n.text, n.shape]));
  const out = [];
  const stack = [];
  for (const [lineNo, raw] of linesOf(src).entries()) {
    const body = raw.trim();
    if (!body || body.startsWith('#') || body.startsWith('//')) continue;
    const indent = widthOf(raw);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const from = stack[stack.length - 1]?.last || null;
    const dir = DIRECTION_LINE.exec(body);
    if ((dir && DIRECTIONS[dir[2].toLowerCase()]) || isColorLine(body)) continue;
    const header = /^([^:]+?)\s*:$/.exec(body);
    if (header && !ARROW_RE.test(header[1])) { stack.push({ indent, last: null }); continue; }
    const pieces = body.split(ARROW_RE);
    let steps = pieces.filter((_, i) => i % 2 === 0).map((p) => p.trim());
    let arrows = pieces.filter((_, i) => i % 2 === 1).map((a) => a.trim());
    let answer = null;
    let answerArrow = null;
    if (from && shapes.get(from) === 'decision' && steps.length > 1) {
      [answer, answerArrow] = [steps[0], arrows[0]];
      steps = steps.slice(1);
      arrows = arrows.slice(1);
    }
    const names = steps.map(nameOf);
    stack.push({ indent, last: [...names].reverse().find(Boolean) || from });
    out.push({ lineNo, lead: raw.slice(0, raw.length - raw.trimStart().length), indent, from, answer, answerArrow, steps, names, arrows });
  }
  return out;
}

// The arrows a line draws: { from, to, at } — `at` the step it goes into
// (0: from the line above).
function arrowsOn(L) {
  const out = [];
  let prev = L.from;
  L.names.forEach((n, i) => {
    if (!n) return;
    if (prev && prev !== n) out.push({ from: prev, to: n, at: i, token: i === 0 ? L.answerArrow : L.arrows[i - 1] });
    prev = n;
  });
  return out;
}

const writeLine = (L, { lead = L.lead, answer = L.answer, answerArrow = L.answerArrow, steps = L.steps, arrows = L.arrows } = {}) =>
  `${lead}${answer != null ? `${answer} ${answerArrow} ` : ''}${steps.map((p, i) => (i ? `${arrows[i - 1]} ${p}` : p)).join(' ')}`;

// Where the lines going on from line i end.
function subtreeEnd(ls, i) {
  let end = i + 1;
  for (let j = i + 1; j < ls.length; j++) {
    const b = ls[j].trim();
    if (!b || b.startsWith('#') || b.startsWith('//')) continue;
    if (widthOf(ls[j]) <= widthOf(ls[i])) break;
    end = j + 1;
  }
  return end;
}

function dedent(l, n) {
  let cols = 0;
  let i = 0;
  while (i < l.length && cols < n && (l[i] === ' ' || l[i] === '\t')) { cols += l[i] === '\t' ? 2 : 1; i++; }
  return l.slice(i);
}

// Lines [start, end) out of their place, `block` at the end of the steps
// instead: a line there goes on from nothing.
function relocate(ls, start, end, block) {
  const rest = [...ls.slice(0, start), ...ls.slice(end)];
  rest.splice(endOfSteps(rest), 0, ...block);
  return rest.join('\n');
}

const matches = (e, from, to, kind) => (e.from === from && e.to === to) || (BOTH.has(kind) && e.from === to && e.to === from);

// Where an arrow is written: [{ L, e }].
function whereWritten(src, from, to) {
  const out = [];
  for (const L of stepLines(src)) for (const e of arrowsOn(L)) if (matches(e, from, to, arrowOf(e.token).kind)) out.push({ L, e });
  return out;
}

// Take out the first place an arrow is written; null when it isn't.
function removeOnce(src, from, to) {
  const [hit] = whereWritten(src, from, to);
  if (!hit) return null;
  const { L, e } = hit;
  const f = tryParse(src);
  const elsewhere = (name) => f.nodes.find((n) => n.text === name)?.lines.some((l) => l !== L.lineNo);
  // A step alone on a line, written as it is somewhere else: the line said nothing more.
  const bare = (i) => L.steps[i] === L.names[i] && elsewhere(L.names[i]);
  const ls = linesOf(src);
  const end = subtreeEnd(ls, L.lineNo);
  const children = ls.slice(L.lineNo + 1, end).map((l) => dedent(l, L.indent));
  if (e.at === 0) {
    // The arrow from the line above: the line goes on from nothing.
    if (L.steps.length === 1 && !children.length && bare(0)) { ls.splice(L.lineNo, 1); return ls.join('\n'); }
    return relocate(ls, L.lineNo, end, [writeLine(L, { lead: '', answer: null }), ...children]);
  }
  // Within the line: it is two, the steps before the arrow and the ones after
  // (with the lines going on from it).
  const i = e.at;
  const left = writeLine(L, { steps: L.steps.slice(0, i), arrows: L.arrows.slice(0, i - 1) });
  const rightOf = (lead) => writeLine(L, { lead, answer: null, steps: L.steps.slice(i), arrows: L.arrows.slice(i) });
  // (Or written in the other half: "A -> B -> A" without B -> A is "A -> B".)
  const dropLeft = i === 1 && !L.from && L.answer == null && L.steps[0] === L.names[0] && (bare(0) || L.names.slice(i).includes(L.names[0]));
  const dropRight = L.steps.length - i === 1 && !children.length && L.steps[i] === L.names[i] && (bare(i) || L.names.slice(0, i).includes(L.names[i]));
  if (!L.from) {
    // Nothing above it: the two lines stay where it was.
    ls.splice(L.lineNo, 1, ...(dropLeft ? [] : [left]), ...(dropRight ? [] : [rightOf(L.lead)]));
    return ls.join('\n');
  }
  ls[L.lineNo] = left;
  if (dropRight) return ls.join('\n');
  // Under a line, the second would go on from it: to the end, on its own.
  return relocate(ls, L.lineNo + 1, end, [rightOf(''), ...children]);
}

// An arrow written again on a line of its own: a line left with only one of
// its steps (going on from nothing) says nothing more.
function rewritten(src, from, to, token) {
  let out = addArrow(removeArrow(src, from, to), from, to, token);
  for (const name of [from, to]) {
    const f = tryParse(out);
    const lines = f?.nodes.find((n) => n.text === name)?.lines || [];
    const ls = linesOf(out);
    const lone = stepLines(out).find((L) => !L.from && L.answer == null && L.steps.length === 1 && L.steps[0] === name && subtreeEnd(ls, L.lineNo) === L.lineNo + 1);
    if (lone && lines.some((l) => l !== lone.lineNo)) { ls.splice(lone.lineNo, 1); out = ls.join('\n'); }
  }
  return out;
}

// Take an arrow out, wherever it is written. Its steps stay.
export function removeArrow(src, from, to) {
  for (let n = 0; n < 50; n++) {
    const next = removeOnce(src, from, to);
    if (next == null) break;
    src = next;
  }
  return src;
}

// Rewrite the arrow where it is written; an arrow that isn't written (a line
// going on from the one above it) is taken out and written on a line.
function rewrite(src, from, to, change) {
  const found = whereWritten(src, from, to);
  if (!found.length) return src;
  const ls = linesOf(src);
  for (const { L, e } of found) {
    const now = arrowOf(e.token);
    if (e.token == null) {
      const token = change(now, null);
      if (token == null) continue;
      return rewritten(src, from, to, token);
    }
    const token = change(now, L.answer);
    if (token == null) continue;
    const parts = { answerArrow: L.answerArrow, arrows: [...L.arrows] };
    if (e.at === 0) parts.answerArrow = token; else parts.arrows[e.at - 1] = token;
    ls[L.lineNo] = writeLine(L, parts);
  }
  return ls.join('\n');
}

// One way (->), both ways (<->), dotted (..>) or a plain line (--): kinds as
// parseFlow gives them. A label stays on a one-way arrow only.
export function setArrowKind(src, from, to, kind) {
  if (!WRITTEN[kind]) throw new Error(`“${kind}” is not an arrow`);
  return rewrite(src, from, to, (now) => tokenOf(kind, now.label));
}

// The words on an arrow ('' none). Out of a question it is the answer.
export function setArrowLabel(src, from, to, label) {
  const text = clean(label);
  const found = whereWritten(src, from, to);
  if (!found.length) return src;
  const ls = linesOf(src);
  const f = tryParse(src);
  const decision = f?.nodes.find((n) => n.text === from)?.shape === 'decision';
  for (const { L, e } of found) {
    const now = arrowOf(e.token);
    if (e.at === 0 && (L.answer != null || decision)) {
      // An answer: "yes -> …" under the question.
      if (L.answer != null && !text && L.steps.length > 1) return rewritten(src, from, to, '->');
      ls[L.lineNo] = text ? writeLine(L, { answer: text, answerArrow: L.answerArrow ?? '->' }) : writeLine(L, { answer: null });
      continue;
    }
    if (text && now.kind !== '-->') throw new Error('Only a one-way arrow has words on it (for now).');
    if (e.token == null) return rewritten(src, from, to, tokenOf('-->', text));
    const arrows = [...L.arrows];
    arrows[e.at - 1] = tokenOf(now.kind, text);
    ls[L.lineNo] = writeLine(L, { arrows });
  }
  return ls.join('\n');
}

// The other way round (a two-way arrow or a line has no way).
export function reverseArrow(src, from, to) {
  const [hit] = whereWritten(src, from, to);
  if (!hit) return src;
  const now = arrowOf(hit.e.token);
  if (BOTH.has(now.kind)) return src;
  const label = hit.e.at === 0 && hit.L.answer != null ? hit.L.answer : now.label;
  return rewritten(removeArrow(src, from, to), to, from, tokenOf(now.kind, label));
}

// ---- shapes

export const SHAPES = ['box', 'round', 'circle', 'db', 'decision'];
const WRAPS = { round: ['(', ')'], circle: ['((', '))'], db: ['[(', ')]'] };

// A step's shape: the marks on the first place it is written, none on the
// others (a plain name doesn't change a shape). A question is a name ending
// in "?": a box of one is written [name?].
export function setShape(src, name, shape) {
  if (!SHAPES.includes(shape)) throw new Error(`“${shape}” is not a shape`);
  if (shape === 'decision' && !name.endsWith('?')) throw new Error('A question is a name ending in “?”.');
  const lines = stepLines(src);
  if (shape !== 'decision' && lines.some((L) => L.from === name && L.answer != null)) throw new Error(`“${name}” has answers under it (yes -> …): it stays a question.`);
  const ls = linesOf(src);
  let first = true;
  let changed = false;
  for (const L of lines) {
    let touched = false;
    const steps = L.steps.map((piece, i) => {
      if (L.names[i] !== name) return piece;
      const own = noteOf(piece).name;
      const note = piece.slice(own.length);
      const flag = parseStep(own).flag ? ' !' : '';
      const lead = i === 0 && L.answer == null;
      let out;
      if (first && WRAPS[shape]) out = `${WRAPS[shape][0]}${name}${WRAPS[shape][1]}`;
      else if (first && shape === 'box' && name.endsWith('?')) out = `[${name}]`;
      else out = lead ? written(name) : name;
      first = false;
      if (`${out}${flag}${note}` === piece) return piece;
      touched = true;
      return `${out}${flag}${note}`;
    });
    if (touched) { ls[L.lineNo] = writeLine(L, { steps }); changed = true; }
  }
  return changed ? ls.join('\n') : src;
}

// Where an arrow is written: { line, start, end } in the block (the arrow's
// marks; where its step starts when none are written), or null.
export function arrowSpot(src, from, to) {
  const [hit] = whereWritten(src, from, to);
  if (!hit) return null;
  const { L, e } = hit;
  const raw = linesOf(src)[L.lineNo];
  const f = tryParse(src);
  const spot = f?.nodes.find((n) => n.text === e.to)?.spots.find((s) => s.line === L.lineNo);
  const at = spot ? spot.start : L.lead.length;
  if (e.token == null) return { line: L.lineNo, start: at, end: at };
  const start = raw.lastIndexOf(e.token, at);
  return start >= 0 ? { line: L.lineNo, start, end: start + e.token.length } : { line: L.lineNo, start: at, end: at };
}

// ---- groups: a "Name:" line, the steps indented under it

const isHeader = (body) => { const m = /^([^:]+?)\s*:$/.exec(body); return !!(m && !ARROW_RE.test(m[1])); };
const isBlank = (l) => { const b = l.trim(); return !b || b.startsWith('#') || b.startsWith('//'); };

// Where the lines indented under line i end (the line after the last).
function blockEnd(ls, i) {
  const ind = widthOf(ls[i]);
  let last = i;
  for (let j = i + 1; j < ls.length; j++) {
    if (isBlank(ls[j])) continue;
    if (widthOf(ls[j]) <= ind) break;
    last = j;
  }
  return last + 1;
}

// The line a line goes on from (the one above it, less indented), or -1.
function parentLine(ls, i) {
  for (let j = i - 1; j >= 0; j--) if (!isBlank(ls[j]) && widthOf(ls[j]) < widthOf(ls[i])) return j;
  return -1;
}

// A group's name as written: one line, no ":" in it; one that would read as
// something else (a colour or direction line, a comment, arrows) is refused.
function titleOf(title) {
  const t = String(title).replace(/\s*:\s*/g, ' - ').replace(/\s+/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '').trim();
  if (t && (!isHeader(`${t}:`) || isColorLine(`${t}:`) || DIRECTION_LINE.test(`${t}:`) || /^(#|\/\/)/.test(t))) throw new Error(`“${t}” can’t name a group.`);
  return t;
}

// Its arrows, by the names of their steps: what a change of groups keeps.
const arrowsOf = (f) => {
  const name = new Map(f.nodes.map((n) => [n.id, n.text]));
  return f.edges.map((e) => `${name.get(e.from)}|${e.kind}|${e.label}|${name.get(e.to)}`).sort().join('\n');
};

// The text changed, checked: the same steps and arrows, and `ok` of it.
function checked(src, text, ok) {
  const [a, b] = [tryParse(src), tryParse(text)];
  if (!b || arrowsOf(a) !== arrowsOf(b) || a.nodes.length !== b.nodes.length || !ok(b)) throw new Error('That would change more than the groups — change the text instead.');
  return text;
}

// Steps put in a group of their own: a "Title:" line and the steps under
// it, written before the (outermost) line where the first of them is, so
// that they are the group's wherever else they are written. A line that
// only named one of them (at the top, or in a group) goes, and so does a
// group left empty by it.
export function groupBoxes(src, names, title) {
  const t = titleOf(title);
  const f = tryParse(src);
  const nodes = (f?.nodes || []).filter((n) => names.includes(n.text));
  if (!nodes.length || !t) return src;
  const ls = linesOf(src);
  const kids = (i) => blockEnd(ls, i) > i + 1;
  const drop = new Set();
  const named = new Map(); // a step → the line that only named it (its shape with it)
  for (const n of nodes) {
    for (const l of n.lines) {
      const body = ls[l].trim();
      if (body.split(ARROW_RE).length > 1 || noteOf(body).note || parseStep(body).text !== n.text || kids(l)) continue;
      const p = parentLine(ls, l);
      if (p >= 0 && !isHeader(ls[p].trim())) continue;
      drop.add(l);
      if (!named.has(n.text)) named.set(n.text, body);
    }
  }
  // Groups left with nothing in them (the innermost first).
  for (const g of [...f.groups].sort((a, b) => b.line - a.line)) {
    const left = ls.slice(g.line + 1, blockEnd(ls, g.line)).some((l, k) => !isBlank(l) && !drop.has(g.line + 1 + k));
    if (!left) drop.add(g.line);
  }
  const base = Math.min(...ls.filter((l) => !isBlank(l)).map(widthOf));
  let at = Math.min(...nodes.map((n) => Math.min(...n.lines)));
  while (at > 0 && (isBlank(ls[at]) || widthOf(ls[at]) > base)) at--;
  const lead = ' '.repeat(base);
  const block = [`${lead}${t}:`, ...nodes.map((n) => `${lead}  ${named.get(n.text) || written(n.text)}`)];
  const out = [];
  ls.forEach((l, i) => {
    if (i === at) out.push(...block);
    if (!drop.has(i)) out.push(l);
  });
  return checked(src, out.join('\n'), (r) => {
    const g = r.groups.find((x) => x.title === t && !x.parent && !f.groups.some((y) => y.id === x.id && y.title === t && y.line === x.line));
    return !!g && nodes.every((n) => r.nodes.find((m) => m.text === n.text)?.group === g.id);
  });
}

// The group whose "Title:" is on line `line`, named anew.
export function renameGroup(src, line, title) {
  const t = titleOf(title);
  const ls = linesOf(src);
  if (!t || !isHeader(ls[line]?.trim() || '')) return src;
  ls[line] = `${ls[line].slice(0, ls[line].length - ls[line].trimStart().length)}${t}:`;
  return checked(src, ls.join('\n'), (r) => r.groups.some((g) => g.line === line && g.title === t));
}

// The group on line `line` taken away: its title line goes, the lines under
// it come out one step (its steps are where it was). A line under it that
// only named a step written elsewhere too goes with it.
export function ungroup(src, line) {
  const ls = linesOf(src);
  if (!isHeader(ls[line]?.trim() || '')) return src;
  const end = blockEnd(ls, line);
  const inner = ls.slice(line + 1, end).filter((l) => !isBlank(l));
  const by = inner.length ? Math.min(...inner.map(widthOf)) - widthOf(ls[line]) : 0;
  const out = (l) => {
    const lead = l.slice(0, l.length - l.trimStart().length).replace(/\t/g, '  ');
    return l.trim() ? `${lead.slice(Math.min(by, lead.length))}${l.trimStart()}` : l;
  };
  const f = tryParse(src);
  const bare = (i) => {
    const body = ls[i].trim();
    const n = f?.nodes.find((m) => m.text === parseStep(body).text);
    return !!n && body === written(n.text) && blockEnd(ls, i) === i + 1 && n.lines.some((l) => l < line || l >= end);
  };
  const kept = [];
  for (let i = line + 1; i < end; i++) if (isBlank(ls[i]) || !bare(i)) kept.push(out(ls[i]));
  const text = [...ls.slice(0, line), ...kept, ...ls.slice(end)].join('\n');
  return checked(src, text, (r) => r.groups.length === tryParse(src).groups.length - 1);
}
