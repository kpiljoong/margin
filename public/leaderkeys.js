// Your own keys after the leader (⌥X), written in a note: LEADER.md at the
// top of the workspace. Each list item with keys in backticks is one rule:
//
//   - `o d` Open today’s journal note     o then d runs that command (its M-x name)
//   - `r m` Recipe: Meeting minutes       a recipe, by its name in M-x
//   - `o` +mine                           a group under o, with its name
//   - `k` off                             takes a key away
//
// Keys are the menu's (leader.js menuKey): a letter (A is Shift+a), a digit,
// SPC, or one of ` / . , ; ' [ ] :. A rule that can't be followed is left out
// with a warning, never more: the menu works as before. Plain logic, tested
// without a page (test/leaderkeys.test.mjs).

export const LEADER_FILE = 'LEADER.md';

const KEY = /^(?:[A-Za-z0-9]|SPC|[`/.,;'[\]:])$/;
const OFF = new Set(['off', 'none', 'nothing', '-']);

// LEADER.md → { rules: [{ keys, kind: 'bind' | 'group' | 'off', name?, label?, line }], errors: [{ line, msg }] }.
export function parseLeaderKeys(text) {
  const rules = [];
  const errors = [];
  let fence = null;
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach((l, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return; }
    if (fence) return;
    const m = /^\s*[-*+]\s+`([^`]*)`\s*(.*?)\s*$/.exec(l);
    if (!m) return;
    const line = i + 1;
    const keys = m[1].trim().split(/\s+/).filter(Boolean);
    const bad = keys.find((k) => !KEY.test(k));
    if (!keys.length || bad) { errors.push({ line, msg: keys.length ? `“${bad}” is not a key (a letter, a digit, SPC or one of \` / . , ; ' [ ] :)` : 'no keys between the backticks' }); return; }
    // What follows may end with a remark after " — ".
    const what = m[2].split(/\s+—\s+/)[0].trim();
    if (!what) { errors.push({ line, msg: `nothing after \`${keys.join(' ')}\`: a command’s name, +a group, or off` }); return; }
    if (OFF.has(what.toLowerCase())) rules.push({ keys, kind: 'off', line });
    else if (what.startsWith('+')) rules.push({ keys, kind: 'group', label: what.slice(1).trim() || keys.at(-1), line });
    else rules.push({ keys, kind: 'bind', name: what, line });
  });
  return { rules, errors };
}

// The menu (leader.js: [{ key, label, run } | { key, label, items }]) with
// the rules followed. resolve(name) → an entry to run ({ label?, run, when? })
// or null. The menu given is left as it was. → { tree, errors }.
export function applyLeaderKeys(tree, rules, resolve) {
  const copy = (items) => items.map((it) => (it.items ? { ...it, items: copy(it.items) } : it));
  const out = copy(tree);
  const errors = [];
  const where = (keys) => `\`${keys.join(' ')}\``;
  // The list the last key goes in; groups on the way made when `make`.
  const parentOf = (keys, make, line) => {
    let items = out;
    for (let d = 0; d < keys.length - 1; d++) {
      const at = items.findIndex((x) => x.key === keys[d]);
      let g = items[at];
      if (!g) {
        if (!make) return null;
        g = { key: keys[d], label: keys[d], items: [], custom: line };
        items.push(g);
      } else if (!g.items) {
        errors.push({ line, msg: `${where(keys.slice(0, d + 1))} runs a command, so nothing can follow it` });
        return null;
      }
      items = g.items;
    }
    return items;
  };
  for (const r of rules) {
    const key = r.keys.at(-1);
    if (r.kind === 'off') {
      const items = parentOf(r.keys, false, r.line);
      const at = items ? items.findIndex((x) => x.key === key) : -1;
      if (at < 0) { if (items) errors.push({ line: r.line, msg: `nothing at ${where(r.keys)} to take away` }); continue; }
      items.splice(at, 1);
      continue;
    }
    let entry;
    if (r.kind === 'group') entry = null;
    else {
      const found = resolve(r.name);
      if (!found) { errors.push({ line: r.line, msg: `no command named “${r.name}” (M-x lists them)` }); continue; }
      entry = { ...found, key, label: found.label || r.name, cmd: found.cmd || r.name, custom: r.line };
      delete entry.items;
    }
    const items = parentOf(r.keys, true, r.line);
    if (!items) continue;
    const at = items.findIndex((x) => x.key === key);
    if (r.kind === 'group') {
      if (at >= 0 && items[at].items) items[at] = { ...items[at], label: r.label, custom: r.line };
      else if (at >= 0) items[at] = { key, label: r.label, items: [], custom: r.line };
      else items.push({ key, label: r.label, items: [], custom: r.line });
    } else if (at >= 0) items[at] = entry;
    else items.push(entry);
  }
  return { tree: out, errors };
}

export const LEADER_STARTER = `# Leader keys

Your own keys after the leader key (⌥X, Alt+X elsewhere). Each list item with keys in backticks is one; Margin reads this note when you save it, and the menu, M-x and “describe key” (⌥X h k) show them.

- \`o\` +my keys
- \`o j\` Open today’s journal note
- \`o t\` Tasks in all notes (agenda)

How to write them:

- keys in backticks, then a command’s name as M-x lists it (recipes too: \`Recipe: Summarize\`)
- a group: \`+name\` (the keys under it follow it)
- a key taken away (Margin’s own too): \`off\`
- after the name, \` — \` and anything you like is a remark

Keys: a letter (\`A\` is Shift+a), a digit, \`SPC\`, or one of \` / . , ; ' [ ] :. A line that can’t be followed is left out, with a warning.
`;
