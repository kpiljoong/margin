// Running commands by name (Emacs M-x): fuzzy matching, and the order of the
// list — commands of the buffer you're in first, then the ones used lately.

// The letters of the query in order, in the text: a score (higher is better,
// runs of letters and word starts count more) and where they matched; null if
// they aren't all there. Spaces in the query only separate.
export function fuzzy(qRaw, text) {
  const q = qRaw.replace(/\s+/g, '');
  if (!q) return { score: 0, idx: [] };
  const t = text.toLowerCase();
  const ql = q.toLowerCase();
  const idx = [];
  let score = 0;
  let last = -1;
  for (const ch of ql) {
    const i = t.indexOf(ch, last + 1);
    if (i === -1) return null;
    score += i === last + 1 ? 3 : 1;
    if (i === 0 || '/-_ .:'.includes(t[i - 1])) score += 2;
    idx.push(i);
    last = i;
  }
  return { score: score - text.length * 0.01, idx };
}

// cmds: [{ name, alias?, ctx? }] (alias: a second name, Emacs's; ctx: the
// buffer kinds where it belongs). recent: names, most recent first.
// → [{ cmd, m }] in the order to show; m.alias when the alias matched better.
// Without a query: the buffer's commands, then recent ones, then the rest as
// listed. With one: by score, with a lift for recent and for the buffer's.
export function rankCommands(cmds, query, { recent = [], context = '' } = {}) {
  const rank = new Map(recent.map((n, i) => [n, i]));
  const here = (c) => !!context && !!c.ctx?.includes(context);
  const lift = (c) => (rank.has(c.name) ? Math.max(1, 4 - rank.get(c.name) * 0.25) : 0) + (here(c) ? 3 : 0);
  const match = (cmd) => {
    const m = fuzzy(query, cmd.name);
    const a = cmd.alias && query.trim() ? fuzzy(query, cmd.alias) : null;
    return a && (!m || a.score > m.score) ? { ...a, alias: true } : m;
  };
  const out = cmds.map((cmd, i) => ({ cmd, i, m: match(cmd) })).filter((x) => x.m);
  if (query.trim()) return out.sort((a, b) => b.m.score + lift(b.cmd) - (a.m.score + lift(a.cmd)) || a.i - b.i);
  const group = (c) => (here(c) ? 0 : rank.has(c.name) ? 1 : 2);
  return out.sort((a, b) => group(a.cmd) - group(b.cmd)
    || (group(a.cmd) < 2 ? (rank.get(a.cmd.name) ?? 1e9) - (rank.get(b.cmd.name) ?? 1e9) : 0) || a.i - b.i);
}

// The recent list after running `name`.
export const used = (recent, name, max = 40) => [name, ...recent.filter((n) => n !== name)].slice(0, max);
