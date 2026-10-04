// Keyboard macros kept as a note: MACROS.md at the top of the workspace.
// Each "## Name" is a macro, its steps one per line in a ```macro block;
// M-x lists it as "Macro: Name" and LEADER.md can put it on keys. Text only,
// as a macro is recorded (macro.js steps) — never code:
//
//   type "- [ ] "            types (\n for a line break; JSON string)
//   backspace 2 · delete 1   deletes before / after the caret
//   erase                    deletes the selection
//   edit 1 2 "x"             the text around the caret (1 before, 2 after) becomes "x"
//   move line-start          left right up down word-left word-right line-start
//   select word-right        line-end start end page-up page-down (select: extends)
//   select all
//   delete-to line-end       word-left word-right line-start line-end
//   find "TODO" 2 at-end     the 2nd match from the caret; case, regex; at-start / at-end
//   replace-all "a" "b"      case, regex
//   copy · cut · paste       paste "x": what to paste if nothing was copied
//   key Ctrl-k               a key the editor (or Emacs keys) takes: Cmd- Ctrl- Alt- Shift-
//   undo · redo
//   run Save                 a command, by its M-x name
//   step {"t": …}            a step as JSON, for anything else
//
// Lines starting with # or // are remarks. Plain logic, tested without a page
// (test/macrotext.test.mjs).

export const MACROS_FILE = 'MACROS.md';

const HOW = {
  left: 'left', right: 'right', up: 'up', down: 'down', 'word-left': 'wordLeft', 'word-right': 'wordRight',
  'line-start': 'lineStart', 'line-end': 'lineEnd', start: 'docStart', end: 'docEnd', 'page-up': 'pageUp', 'page-down': 'pageDown',
};
const HOW_NAME = Object.fromEntries(Object.entries(HOW).map(([k, v]) => [v, k]));
const DELETE_HOW = new Set(['wordLeft', 'wordRight', 'lineStart', 'lineEnd']);
const MODS = [['Cmd', 'metaKey'], ['Ctrl', 'ctrlKey'], ['Alt', 'altKey'], ['Shift', 'shiftKey']];
const NAMED = new Set(['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
const SIMPLE = new Set(['copy', 'cut', 'undo', 'redo', 'erase']);

// A key step's name: Ctrl-k, Cmd-Shift-b, Enter, Alt-5 (the key on the
// keyboard, as code says), and the key typed when that isn't what it says.
function keyWords(s) {
  const name = /^Key[A-Z]$/.test(s.code) ? s.code.slice(3).toLowerCase()
    : /^Digit\d$/.test(s.code) ? s.code.slice(5) : s.code === 'Space' ? 'SPC' : s.code;
  const combo = [...MODS.filter(([, k]) => s[k]).map(([m]) => m), name].join('-');
  return s.key === typedKey(s.code, s.shiftKey) ? combo : `${combo} ${JSON.stringify(s.key)}`;
}
function typedKey(code, shift) {
  if (/^Key[A-Z]$/.test(code)) return shift ? code.slice(3) : code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return shift ? null : code.slice(5);
  if (code === 'Space') return ' ';
  return NAMED.has(code) ? code : null;
}
function keyStep(combo, key) {
  const parts = combo.split('-');
  const name = parts.pop();
  const step = { t: 'key', key: '', code: '', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false };
  for (const p of parts) {
    const mod = MODS.find(([m]) => m.toLowerCase() === p.toLowerCase());
    if (!mod) throw new Error(`“${p}” is not Cmd, Ctrl, Alt or Shift`);
    step[mod[1]] = true;
  }
  step.code = /^[a-z]$/i.test(name) ? `Key${name.toUpperCase()}` : /^\d$/.test(name) ? `Digit${name}` : name === 'SPC' ? 'Space' : name;
  if (!name || (!/^[A-Z][A-Za-z0-9]+$/.test(step.code))) throw new Error(`“${name}” is not a key`);
  step.key = key ?? typedKey(step.code, step.shiftKey);
  if (step.key == null) throw new Error(`say what ${combo} types, in quotes after it`);
  return step;
}

// One line → its words: plain words, numbers, and "JSON strings".
function words(line) {
  const out = [];
  const re = /\s*("(?:[^"\\]|\\.)*"|\S+)/gy;
  let m;
  while ((m = re.exec(line))) {
    if (m[1].startsWith('"')) {
      try { out.push({ str: JSON.parse(m[1]) }); } catch { throw new Error(`${m[1]} is not a string in quotes (\\" for a quote, \\n for a line break)`); }
    } else out.push(m[1]);
    if (re.lastIndex >= line.length) break;
  }
  return out;
}
const str = (w, what) => {
  if (w && typeof w === 'object') return w.str;
  throw new Error(`${what}: the text in "quotes"`);
};
const count = (w, dflt) => {
  if (w == null) return dflt;
  if (typeof w === 'string' && /^\d+$/.test(w)) return Number(w);
  throw new Error(`“${typeof w === 'string' ? w : w.str}” is not a number`);
};
function flags(rest, allowed) {
  const out = {};
  for (const w of rest) {
    if (typeof w !== 'string') throw new Error(`one text too many: ${JSON.stringify(w.str)}`);
    const k = allowed(w, out);
    if (!k) throw new Error(`“${w}” is not one of what can follow`);
  }
  return out;
}

// A step's line → the step (throws with what is wrong).
export function parseStep(line) {
  const t = line.trim();
  const [cmd, ...rest] = words(t);
  const op = typeof cmd === 'string' ? cmd.toLowerCase() : '';
  if (op === 'run') {
    const name = t.slice(3).trim();
    if (!name) throw new Error('run what? A command’s name as M-x lists it');
    return { t: 'cmd', label: name };
  }
  if (op === 'step') {
    let step;
    try { step = JSON.parse(t.slice(4)); } catch { throw new Error('step: JSON after it, like {"t": "undo"}'); }
    if (!step || typeof step !== 'object' || typeof step.t !== 'string' || step.t === 'cmd') throw new Error('step: an object with "t" (not "cmd": use run)');
    return step;
  }
  if (SIMPLE.has(op)) {
    if (rest.length) throw new Error(`nothing follows ${op}`);
    return op === 'cut' ? { t: 'copy', cut: true } : op === 'erase' ? { t: 'edit', before: 0, after: 0, text: '', sel: true } : { t: op };
  }
  switch (op) {
    case 'type': {
      if (rest.length !== 1) throw new Error('type: the text in "quotes"');
      return { t: 'edit', before: 0, after: 0, text: str(rest[0], 'type'), sel: false };
    }
    case 'backspace': case 'delete': {
      if (rest.length > 1) throw new Error(`${op}: how many, or nothing for one`);
      const n = count(rest[0], 1);
      return { t: 'edit', before: op === 'backspace' ? n : 0, after: op === 'delete' ? n : 0, text: '', sel: false };
    }
    case 'edit': {
      if (rest.length !== 3) throw new Error('edit: how many before, how many after, then the text in "quotes"');
      return { t: 'edit', before: count(rest[0]), after: count(rest[1]), text: str(rest[2], 'edit'), sel: false };
    }
    case 'move': case 'select': {
      const w = rest[0];
      if (rest.length !== 1 || typeof w !== 'string') throw new Error(`${op}: where to (${Object.keys(HOW).join(', ')})`);
      if (op === 'select' && w === 'all') return { t: 'move', how: 'all', extend: false };
      if (!HOW[w]) throw new Error(`“${w}” is not where a caret goes (${Object.keys(HOW).join(', ')})`);
      return { t: 'move', how: HOW[w], extend: op === 'select' };
    }
    case 'delete-to': {
      const how = HOW[rest[0]];
      if (rest.length !== 1 || !DELETE_HOW.has(how)) throw new Error('delete-to: word-left, word-right, line-start or line-end');
      return { t: 'delete', how };
    }
    case 'find': {
      const query = str(rest[0], 'find');
      const spec = { query, caseSensitive: false, regex: false };
      let k = 1;
      let collapse = null;
      flags(rest.slice(1), (w) => {
        if (w === 'case') return (spec.caseSensitive = true);
        if (w === 'regex') return (spec.regex = true);
        if (/^\d+$/.test(w) && +w > 0) return (k = +w);
        if (w === 'at-start' || w === 'at-end') return (collapse = w.slice(3));
        return false;
      });
      if (!query) throw new Error('find: what to find');
      return { t: 'find', spec, k, ...(collapse ? { collapse } : {}) };
    }
    case 'replace-all': {
      const query = str(rest[0], 'replace-all');
      const spec = { query, caseSensitive: false, regex: false, replace: str(rest[1], 'replace-all: with what') };
      flags(rest.slice(2), (w) => (w === 'case' ? (spec.caseSensitive = true) : w === 'regex' ? (spec.regex = true) : false));
      if (!query) throw new Error('replace-all: what to replace');
      return { t: 'replaceAll', spec };
    }
    case 'paste': {
      if (rest.length > 1) throw new Error('paste: nothing, or the text in "quotes"');
      return { t: 'paste', text: rest.length ? str(rest[0], 'paste') : '' };
    }
    case 'key': {
      if (!rest.length || rest.length > 2 || typeof rest[0] !== 'string') throw new Error('key: like Ctrl-k, Alt-Shift-5 or Enter');
      return keyStep(rest[0], rest.length > 1 ? str(rest[1], 'key') : undefined);
    }
    default:
      throw new Error(`“${typeof cmd === 'string' ? cmd : t}” is not a step (type, move, select, find, key, run …)`);
  }
}

// A step → its line (stepLine(parseStep(x)) is x, or says the same).
export function stepLine(s) {
  const q = (x) => JSON.stringify(x ?? '');
  switch (s.t) {
    case 'cmd': return `run ${String(s.label).replace(/\s+/g, ' ').trim()}`;
    case 'edit':
      if (!s.text && !s.before && !s.after) return 'erase';
      if (!s.before && !s.after) return `type ${q(s.text)}`;
      if (!s.text && !s.after) return s.before === 1 ? 'backspace' : `backspace ${s.before}`;
      if (!s.text && !s.before) return s.after === 1 ? 'delete' : `delete ${s.after}`;
      return `edit ${s.before} ${s.after} ${q(s.text)}`;
    case 'move':
      if (s.how === 'all') return 'select all';
      return `${s.extend ? 'select' : 'move'} ${HOW_NAME[s.how]}`;
    case 'delete': return `delete-to ${HOW_NAME[s.how]}`;
    case 'find': return [`find ${q(s.spec.query)}`, s.spec.caseSensitive && 'case', s.spec.regex && 'regex', s.k > 1 && s.k, s.collapse && `at-${s.collapse}`].filter(Boolean).join(' ');
    case 'replaceAll': return [`replace-all ${q(s.spec.query)} ${q(s.spec.replace)}`, s.spec.caseSensitive && 'case', s.spec.regex && 'regex'].filter(Boolean).join(' ');
    case 'copy': return s.cut ? 'cut' : 'copy';
    case 'paste': return s.text ? `paste ${q(s.text)}` : 'paste';
    case 'key': return `key ${keyWords(s)}`;
    case 'undo': case 'redo': return s.t;
    default: {
      const { run, ...rest } = s;
      return `step ${JSON.stringify(rest)}`;
    }
  }
}

// MACROS.md → { macros: [{ name, steps, doc, line }], errors: [{ line, msg }] }.
// A macro with a step that can't be read is left out (with the error).
export function parseMacros(text) {
  const macros = [];
  const errors = [];
  let cur = null;
  let fence = null; // { ch, macro }
  const finish = () => {
    if (!cur) return;
    if (cur.bad) { /* its error is said */ } else if (!cur.block) errors.push({ line: cur.line, msg: `“${cur.name}” has no \`\`\`macro block with its steps` });
    else if (!cur.steps.length) errors.push({ line: cur.line, msg: `“${cur.name}” has no steps` });
    else macros.push({ name: cur.name, steps: cur.steps, doc: cur.doc.join(' ').trim(), line: cur.line });
    cur = null;
  };
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach((l, i) => {
    const f = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(l);
    if (f && !fence) {
      fence = { ch: f[1][0], macro: f[2].toLowerCase() === 'macro' && !!cur && !cur.block };
      if (fence.macro) cur.block = true;
      return;
    }
    if (f && f[1][0] === fence.ch && !f[2]) { fence = null; return; }
    if (fence) {
      if (!fence.macro || cur.bad) return;
      const t = l.trim();
      if (!t || t.startsWith('#') || t.startsWith('//')) return;
      try { cur.steps.push(parseStep(t)); } catch (e) { cur.bad = true; errors.push({ line: i + 1, msg: `“${cur.name}”: ${e.message}` }); }
      return;
    }
    const head = /^##\s+(.+?)\s*#*\s*$/.exec(l);
    if (head) {
      finish();
      cur = { name: head[1].slice(0, 80), line: i + 1, steps: [], doc: [], block: false, bad: false };
      return;
    }
    if (/^#\s/.test(l)) { finish(); return; }
    if (cur && !cur.block && l.trim()) cur.doc.push(l.trim());
  });
  finish();
  return { macros, errors };
}

// A macro as MACROS.md keeps it.
export function macroSection(name, steps, doc = '') {
  return [`## ${name}`, '', ...(doc ? [doc, ''] : []), '```macro', ...steps.map(stepLine), '```', ''].join('\n');
}

// MACROS.md with one more (or, of the same name, a new one in its place).
export function withMacro(text, name, steps, doc = '') {
  const section = macroSection(name, steps, doc);
  const src = String(text || '');
  if (!src.trim()) return `${MACROS_STARTER}\n${section}`;
  const old = parseMacros(src).macros.find((m) => m.name.toLowerCase() === name.toLowerCase());
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  if (old) {
    // To the next heading of this level or above, outside a block.
    let end = old.line;
    let fence = null;
    for (; end < lines.length; end++) {
      const f = /^\s*(`{3,}|~{3,})/.exec(lines[end]);
      if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
      if (!fence && /^#{1,2}\s/.test(lines[end])) break;
    }
    return [...lines.slice(0, old.line - 1), ...section.split('\n').slice(0, -1), ...(end < lines.length ? [''] : []), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n');
  }
  return `${src.replace(/\s*$/, '')}\n\n${section}`;
}

export const MACROS_STARTER = `# Macros

Keyboard macros, kept: record one (⌥X q q, again to stop), then “Macro: save the last one…” writes it here. Each \`##\` heading is a macro; M-x lists it as “Macro: <name>”, and LEADER.md can put it on keys (\`\` - \`o t\` Macro: Make it a task \`\`). Margin reads this note when you save it.

The steps, one per line in a \`\`\`macro block:

- \`type "text"\` (\`\\n\` is a line break), \`backspace 2\`, \`delete 1\`, \`erase\` (the selection)
- \`move\` or \`select\` (extends the selection) with \`left\` \`right\` \`up\` \`down\` \`word-left\` \`word-right\` \`line-start\` \`line-end\` \`start\` \`end\` \`page-up\` \`page-down\`; \`select all\`
- \`delete-to line-end\` (or \`word-left\`, \`word-right\`, \`line-start\`)
- \`find "TODO"\` (then \`case\`, \`regex\`, \`2\` for the second one, \`at-start\` / \`at-end\` to stop there), \`replace-all "old" "new"\`
- \`copy\`, \`cut\`, \`paste\`, \`undo\`, \`redo\`
- \`key Ctrl-k\`: a key the editor takes (\`Cmd-\` \`Ctrl-\` \`Alt-\` \`Shift-\`, \`Enter\`, \`Tab\` …)
- \`run Save\`: a command, by its M-x name

A step that can’t go on (the end of the note, nothing more to find) ends the macro.

## Make it a task
Turns the line into a task and goes to the next one.

\`\`\`macro
move line-start
type "- [ ] "
move down
\`\`\`
`;
