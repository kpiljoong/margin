'use strict';
// How far a change reaches into your own words, and so how much looking at
// it needs — decided by rules, never by a model:
//
//   T0  nothing of yours changes: a note the agent made, its margin notes;
//   T1  added to your words, none taken away: new lines, a box ticked
//       ([ ] → [x]), blank lines, or lines an agent wrote (applied before,
//       as they were) — a glance;
//   T2  your words taken out or written over — each one, in red pen;
//   T3  a paragraph you locked — not applied.
//
// Only a label for the review: nothing is taken or left because of it.

const TICK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[ \](.*)$/;
const ticked = (a, b) => {
  const m = TICK.exec(a);
  return !!m && (b === `${m[1]}[x]${m[2]}` || b === `${m[1]}[X]${m[2]}`);
};

// One hunk ({ removed, added }): → { tier, why }. agent: the lines (trimmed)
// agents wrote in this note, as Origin knows them.
function hunkTier(h, { locked = false, agent = null } = {}) {
  if (locked) return { tier: 3, why: 'locked' };
  const removed = h.removed.filter((l) => l.trim());
  if (!removed.length) return { tier: 1, why: h.removed.length ? 'blank' : 'added' };
  if (h.removed.length === h.added.length && h.removed.every((l, i) => ticked(l, h.added[i]))) return { tier: 1, why: 'ticked' };
  if (agent && removed.every((l) => agent.has(l.trim()))) return { tier: 1, why: 'agent' };
  return { tier: 2, why: h.added.some((l) => l.trim()) ? 'rewritten' : 'deleted' };
}

// A change of a run (lib/diff.js's, as server.js computeChanges makes it):
// → { tier (the highest of it), hunks: [{ tier, why }], counts: [T0, T1, T2, T3] }.
function tiersOf(change, { agent = null } = {}) {
  const counts = [0, 0, 0, 0];
  if (change.status === 'added') { counts[0] = 1; return { tier: 0, why: 'new', hunks: [], counts }; }
  if (change.status === 'deleted' || change.binary || !change.hunks) { counts[2] = 1; return { tier: 2, why: change.status === 'deleted' ? 'deleted' : 'whole', hunks: [], counts }; }
  const locked = new Set(change.locked || []);
  const hunks = change.hunks.map((h, i) => hunkTier(h, { locked: locked.has(i), agent }));
  for (const t of hunks) counts[t.tier]++;
  return { tier: Math.max(0, ...hunks.map((t) => t.tier)), hunks, counts };
}

// The lines agents wrote in a note: Origin's runs (server.js originOf).
const agentLines = (runs) => new Set(runs.flatMap((r) => r.lines || []).map((l) => String(l).trim()).filter(Boolean));

module.exports = { hunkTier, tiersOf, agentLines, ticked };
