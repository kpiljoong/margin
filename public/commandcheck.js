// What a run that writes Margin's notes of commands (LEADER.md, RECIPES.md,
// MACROS.md) would do once applied, for the review: the lines Margin couldn't
// read (each left out), and what changes on the keys — a key of Margin's
// replaced, a group renamed, a key taken away. Only what the run brings:
// problems there before it are not its. Plain logic, tested without a page
// (test/commandcheck.test.mjs).

import { parseLeaderKeys, applyLeaderKeys, LEADER_FILE } from './leaderkeys.js';
import { parseRecipes, mergeRecipes, RECIPES_FILE } from './recipes.js';
import { parseMacros, MACROS_FILE } from './macrotext.js';

export const COMMAND_NOTES = [LEADER_FILE, RECIPES_FILE, MACROS_FILE];
const norm = (n) => String(n).toLowerCase().replace(/…$/, '').trim();

// texts: { [file]: text } as they would be. tree: Margin's leader menu
// without the user's keys. known(name): one of Margin's own commands.
function scan(texts, tree, known) {
  const problems = [];
  const rec = parseRecipes(texts[RECIPES_FILE] || '');
  const mac = parseMacros(texts[MACROS_FILE] || '');
  for (const e of rec.errors) problems.push({ file: RECIPES_FILE, ...e });
  for (const e of mac.errors) problems.push({ file: MACROS_FILE, ...e });
  const recipes = mergeRecipes(rec.recipes).map((r) => norm(r.name));
  const macros = mac.macros.map((m) => norm(m.name));
  const exists = (name) => {
    const r = /^recipe:\s*(.+)$/i.exec(name);
    if (r) return recipes.includes(norm(r[1]));
    const m = /^macro:\s*(.+)$/i.exec(name);
    if (m) return macros.includes(norm(m[1]));
    return known(name) || recipes.includes(norm(name));
  };
  for (const m of mac.macros) {
    m.steps.forEach((s, i) => {
      if (s.t === 'cmd' && !exists(s.label)) problems.push({ file: MACROS_FILE, line: m.lines[i], msg: `“${m.name}” runs “${s.label}”, and no command has that name` });
    });
  }
  const lead = parseLeaderKeys(texts[LEADER_FILE] || '');
  const applied = applyLeaderKeys(tree, lead.rules, (name) => (exists(name) ? { run() {} } : null));
  for (const e of [...lead.errors, ...applied.errors]) problems.push({ file: LEADER_FILE, ...e });
  return { problems, rules: lead.rules };
}

// → { problems: [{ file, line, msg }], keys: [{ keys, line, what, was?, rename?, off? }] }
export function checkCommandNotes({ after, before, tree, known }) {
  const now = { ...before, ...after };
  const old = scan(before, tree, known);
  const res = scan(now, tree, known);
  const seen = new Set(old.problems.map((p) => `${p.file}\n${p.msg}`));
  const problems = res.problems.filter((p) => !seen.has(`${p.file}\n${p.msg}`)).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  // The rules this run brings, against Margin's own menu.
  const sig = (r) => `${r.keys.join(' ')}\n${r.kind}\n${r.name || r.label || ''}`;
  const had = new Set(old.rules.map(sig));
  const at = (keys) => {
    let items = tree;
    let it = null;
    for (const k of keys) { it = items?.find((x) => x.key === k); if (!it) return null; items = it.items; }
    return it;
  };
  const keys = [];
  for (const r of res.rules) {
    if (had.has(sig(r))) continue;
    const there = at(r.keys);
    const was = there && !there.items ? there.cmd || there.label : null;
    if (r.kind === 'bind') keys.push({ keys: r.keys, line: r.line, what: r.name, ...(was && norm(was) !== norm(r.name) ? { was } : {}), ...(there?.items ? { was: `+${there.label}` } : {}) });
    else if (r.kind === 'group') keys.push({ keys: r.keys, line: r.line, what: `+${r.label}`, ...(there?.items && norm(there.label) !== norm(r.label) ? { rename: there.label } : {}), ...(was ? { was } : {}) });
    else keys.push({ keys: r.keys, line: r.line, off: true, ...(there ? { was: there.items ? `+${there.label}` : was } : {}) });
  }
  return { problems, keys };
}
