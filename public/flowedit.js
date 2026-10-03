// Drawing on a ```flow picture writes its text: each change made on the
// canvas (connect two boxes, add one, colour, delete, turn) is a change to
// the block's source, the smallest that does it, so the text stays the
// source and stays yours to read and edit. New lines go after the steps
// already written, before the colour lines at the end. Plain logic, tested
// without a page (test/flowedit.test.mjs).

import { parseFlow, parseStep, ARROW_RE, COLOR_LINE, DIRECTION_LINE, DIRECTIONS, colorKey, colorNames } from './flow.js';

const linesOf = (src) => String(src).replace(/\r\n?/g, '\n').split('\n');
const tryParse = (src) => { try { return parseFlow(src); } catch { return null; } };
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

// Does the last step line end with this step (no note after it)? Then an
// arrow from it goes on that line: "A -> B" and B -> C is "A -> B -> C".
function endsWith(ls, at, name) {
  const body = ls[at]?.trim();
  if (!body || body.startsWith('#') || body.startsWith('//') || DIRECTION_LINE.test(body) || /\s:\s|:$/.test(body)) return false;
  const pieces = body.split(ARROW_RE);
  return parseStep(pieces[pieces.length - 1]).text === name;
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
  if (from === to) return src;
  const f = tryParse(src);
  const id = (t) => f?.nodes.find((n) => n.text === t)?.id;
  const a = id(from);
  const b = id(to);
  if (a && b && f.edges.some((e) => (e.from === a && e.to === b) || ((e.kind === '<-->' || e.kind === '---') && e.from === b && e.to === a))) return src;
  const text = String(label).replace(/[()]/g, '').trim();
  const arrow = text ? `-(${text})->` : '->';
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
// (an answer under a question with it), and so does its note, which was the
// step's own.
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
    let text = body;
    let note = '';
    const nm = /^(.*\S)\s+:\s+(.+)$/.exec(body);
    if (nm) { text = nm[1]; note = nm[2].trim(); }
    const pieces = text.split(ARROW_RE);
    let steps = pieces.filter((_, i) => i % 2 === 0);
    let arrows = pieces.filter((_, i) => i % 2 === 1).map((a) => a.trim());
    const answerOf = parent?.last && shapes.get(parent.last) === 'decision' && steps.length > 1;
    let answer = null;
    if (answerOf) { answer = `${steps[0].trim()} ${arrows[0]} `; steps = steps.slice(1); arrows = arrows.slice(1); }
    const names = steps.map((s) => parseStep(s).text);
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
    const lone = kept.length === 1 && !answer && !(note && names[names.length - 1] !== name) && !hasChildren(lineNo);
    if (lone && kept[0].piece === parseStep(kept[0].piece).text && linesOfName.get(kept[0].piece)?.some((l) => l !== lineNo)) continue;
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const chain = kept.map((k, i) => (i && k.arrow ? `${k.arrow} ${k.piece}` : k.piece)).join(' ');
    const ownNote = note && names[names.length - 1] !== name ? ` : ${note}` : '';
    out.push(`${lead}${answer || ''}${chain}${ownNote}`);
  }
  return out.join('\n');
}
