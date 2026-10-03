// Recipes: tasks for the agent, written once and run by name (as Emacs
// commands are, with the agent where Emacs has elisp). They are text only —
// a name, what to ask, which notes to share — never code; whatever they do
// comes back as a staged change to review.
//
// Margin's own come first; RECIPES.md at the top of the workspace adds more
// (or replaces one of the same name): each "## Name" is a recipe, the lines
// right under it may set
//   key: m            a letter for ⌥X r
//   scope: note       note, folder or workspace
//   ask: no           go straight to the agent (yes: show the task dialog)
// and the rest of the section is what the agent is asked.

export const RECIPES_FILE = 'RECIPES.md';

export const BUILTIN_RECIPES = [
  ['Tidy', 'Tidy the formatting: consistent headings, lists and spacing. Do not change the meaning.'],
  ['Summarize', 'Add a short TL;DR at the top of the note summarizing it in 2–3 sentences.'],
  ['Extract tasks', 'Collect every open task (- [ ]) into an "Open tasks" section with a link back to its source note.'],
  ['Link notes', 'Add [[wikilinks]] between notes where one clearly refers to another. Do not invent notes.'],
  ['Proofread', 'Fix spelling and grammar only. Keep the author’s voice and language.'],
  ['Draw as flow', 'Where the text describes a process, workflow or system, add a ```flow block right after it that draws it. Keep the text unchanged and use its names.'],
  ['Red pen', 'Proofread like an editor with a red pen. Do not change the note itself: write your marks to .agent-notes/comments.json — for spelling, grammar and wording, the better text as "suggest" and a few words why as "comment". Mark only what is worth changing.'],
  ['Comments only', 'Review the note like an editor, with comments only: no edits and no "suggest". Remarks on clarity, structure, gaps and claims to check, each next to the passage it is about, in .agent-notes/comments.json.'],
  ['Meeting minutes', 'Make this meeting note clean minutes, as a red pen proposal. Keep what was said and decided; fold in the user\'s margin comments (below) where they belong; fix typos, wording and structure. End with a decisions section (one line each) and an action items section as tasks: "- [ ] what @owner 📅 YYYY-MM-DD" (owner and date only when the note or the comments give them). Headings in the note\'s language (for a Korean note: 결정 사항, 액션 아이템). Edit the note itself, and in .agent-notes/comments.json put a few words on each change, quoting the note as it was (no "suggest" for these).'],
  ['Apply my comments', 'Revise the note as the user\'s margin comments (below) ask, as a red pen proposal: for each comment that asks for a change, an entry in .agent-notes/comments.json quoting the exact words to change, with the new text as "suggest" and as "comment" which comment it answers (its @name, if any). Do not edit the note itself. Skip comments that ask for nothing.'],
].map(([name, prompt], i) => ({ name, prompt, key: String((i + 1) % 10), scope: null, ask: true, builtin: true }));

const SCOPES = { note: 'file', file: 'file', folder: 'folder', workspace: 'workspace', all: 'workspace' };
const YES = { yes: true, true: true, on: true, no: false, false: false, off: false };
// Keys ⌥X r keeps for itself: e edits RECIPES.md.
export const RESERVED_KEYS = new Set(['e']);

// RECIPES.md → { recipes: [{ name, prompt, key, scope, ask, line }], errors: [{ line, msg }] }.
// scope is the server's name for it (file, folder, workspace) or null.
export function parseRecipes(text) {
  const recipes = [];
  const errors = [];
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let cur = null;
  let fence = null;
  const finish = () => {
    if (!cur) return;
    const prompt = cur.body.join('\n').trim();
    if (!prompt) errors.push({ line: cur.line, msg: `“${cur.name}” has nothing to ask the agent` });
    else recipes.push({ name: cur.name, prompt, key: cur.key, scope: cur.scope, ask: cur.ask, line: cur.line });
    cur = null;
  };
  lines.forEach((l, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    const head = !fence && !f && /^##\s+(.+?)\s*#*\s*$/.exec(l);
    if (head) {
      finish();
      cur = { name: head[1].slice(0, 80), line: i + 1, key: null, scope: null, ask: null, body: [], opts: true };
      return;
    }
    if (!cur) return;
    const opt = cur.opts && !fence && !f && /^\s*(?:[-*]\s+)?(key|scope|ask)\s*:\s*(.*?)\s*$/i.exec(l);
    if (opt) {
      const [, k, raw] = opt;
      const v = raw.toLowerCase();
      if (k.toLowerCase() === 'key') {
        if (/^[a-z0-9]$/i.test(raw) && !RESERVED_KEYS.has(raw)) cur.key = raw;
        else errors.push({ line: i + 1, msg: RESERVED_KEYS.has(raw) ? `key “${raw}” is taken (⌥X r ${raw} edits the recipes)` : `key should be one letter or digit, not “${raw}”` });
      } else if (k.toLowerCase() === 'scope') {
        if (SCOPES[v]) cur.scope = SCOPES[v];
        else errors.push({ line: i + 1, msg: `scope should be note, folder or workspace, not “${raw}”` });
      } else if (v in YES) cur.ask = YES[v];
      else errors.push({ line: i + 1, msg: `ask should be yes or no, not “${raw}”` });
      return;
    }
    if (cur.opts && !l.trim() && !cur.body.length) return;
    cur.opts = false;
    cur.body.push(l);
  });
  finish();
  return { recipes, errors };
}

// The built-in recipes with the user's: one of the same name replaces a
// built-in in its place (and keeps its digit); the others follow. A key
// used twice stays with the first.
export function mergeRecipes(user = []) {
  const byName = new Map(user.map((r) => [r.name.toLowerCase(), r]));
  const out = BUILTIN_RECIPES.map((b) => {
    const u = byName.get(b.name.toLowerCase());
    if (!u) return b;
    byName.delete(b.name.toLowerCase());
    return { ...u, key: u.key || b.key, builtin: false, replaces: true };
  });
  const seen = new Set(out.map((r) => r.key));
  for (const u of user) {
    if (!byName.has(u.name.toLowerCase())) continue;
    byName.delete(u.name.toLowerCase());
    out.push({ ...u, key: u.key && !seen.has(u.key) ? u.key : null });
    if (u.key) seen.add(u.key);
  }
  return out;
}

// Straight to the agent, or the task dialog first (to see what is shared):
// a recipe for the note in view goes straight; one for a folder or the
// whole workspace asks, unless it says ask: no. Margin's own always ask.
export const runsDirectly = (r) => !r.builtin && (r.ask === false || (r.ask !== true && r.scope === 'file'));

export const RECIPES_STARTER = `# Recipes

Margin lists each recipe below as a command: run it with ⌥X r, or by name with ⌥X : (M-x). The agent works on a staged copy, and you review what it changed, change by change, as always.

Each \`##\` heading is a recipe. The lines right under it may set:

- \`key:\` a letter for ⌥X r
- \`scope:\` \`note\` (the note in view), \`folder\` or \`workspace\`
- \`ask:\` \`yes\` to see the task dialog first, \`no\` to go straight to the agent

A recipe for the note goes straight to the agent; one for a folder or the workspace shows the dialog first (with the notes it would share), unless it says \`ask: no\`. Private notes are never shared.

## Meeting notes to decisions
key: m
scope: note

Turn these meeting notes into a decision log: a "Decisions" section with one line per decision (what, who, when), and an "Open questions" section. Keep the original notes below it.

## Weekly review
key: w
scope: folder

Write a short weekly review at the top of the newest note in this folder: what got done, what is open, what is next. Link the notes it comes from.
`;
