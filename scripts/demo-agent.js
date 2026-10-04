#!/usr/bin/env node
'use strict';
// Offline, deterministic stand-in for a real AI agent, so the delegate →
// review → apply loop can be tried without any account or network.
// It does NOT understand free-form tasks; it recognises a few keywords
// (English/Korean) and says so, without editing anything, for other tasks.
// Runs with cwd = the staged copy; edits files in place like a real agent would.

const fs = require('fs');
const path = require('path');

const task = (process.env.AGENT_NOTES_TASK || '').toLowerCase();
const focus = process.env.AGENT_NOTES_FOCUS || '';
const round = Number(process.env.AGENT_NOTES_ROUND || 1);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(md|markdown)$/i.test(e.name)) out.push(path.relative('.', p).split(path.sep).join('/'));
  }
  return out.sort();
}

function tidy(text) {
  const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  const out = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (!fence) {
      l = l.replace(/^(\s*)[*+](\s+)/, '$1-$2');           // one bullet style
      l = l.replace(/^(#{1,6})([^#\s])/, '$1 $2');         // "#Title" → "# Title"
      const isHeading = /^#{1,6}\s/.test(l);
      if (isHeading && out.length && out[out.length - 1] !== '') out.push('');
      out.push(l);
      if (isHeading && lines[i + 1] !== undefined && lines[i + 1].trim() !== '') out.push('');
      continue;
    }
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function firstSentence(text) {
  const body = text.replace(/^---[\s\S]*?\n---\n/, '').split('\n')
    .filter((l) => l.trim() && !/^(#|>|-|\*|\d+\.|```|\|)/.test(l.trim()));
  const s = (body[0] || '').trim().split(/(?<=[.!?。])\s/)[0];
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

function addTldr(text) {
  if (/^> \*\*TL;DR\*\*/m.test(text)) return text;
  const s = firstSentence(text);
  if (!s) return text;
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => /^# /.test(l));
  lines.splice(h1 + 1, 0, '', `> **TL;DR** ${s}`, '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function openTasks(files) {
  const rows = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l) => {
      const m = l.match(/^\s*[-*+]\s+\[ \]\s+(.*)$/);
      if (m) rows.push(`- [ ] ${m[1].trim()} — [[${path.basename(f, path.extname(f))}]]`);
    });
  }
  return rows;
}

const files = walk('.');
const targets = focus && files.includes(focus) ? [focus] : files;
const wants = (...words) => words.some((w) => task.includes(w));
console.log(`[demo-agent] round ${round}; ${files.length} note(s) visible; task: ${process.env.AGENT_NOTES_TASK}`);

// Each also in Korean (tidy, format / summary / to-do, to-do, task / short).
const TIDY = ['tidy', 'format', 'clean', '\uC815\uB9AC', '\uC11C\uC2DD'];
const SUMMARY = ['summar', 'tl;dr', 'tldr', '\uC694\uC57D'];
const TASKS = ['task', 'todo', '\uD560 \uC77C', '\uD560\uC77C', '\uC791\uC5C5'];
const SHORTER = ['shorter', 'short', '\uC9E7'];
// Red pen (빨간펜): marks in the margin instead of edits; "comments only" (코멘트만): remarks without suggestions.
const RED = ['red pen', 'comments.json', '\uBE68\uAC04\uD39C'];
const REMARKS_ONLY = ['comments only', 'remarks only', '\uCF54\uBA58\uD2B8\uB9CC'];
// Pictures (그림): a step added to each ```flow, a callout on each picture (its ```ink lines).
const DRAW = ['draw', 'picture', 'mark up', '\uADF8\uB9BC'];
// The lens (public/lens.js): what it sees, beside the note, nothing changed.
const LENS = ['lens.json'];
// Forks (public/forks.js): the paragraph of the task, other ways.
const FORKS = ['forks.json'];
const understood = wants(...TIDY, ...SUMMARY, ...TASKS, ...RED, ...DRAW, ...LENS, ...FORKS) || (round > 1 && wants(...SHORTER));

// A picture's size in pixels (PNG, or an SVG's width and height), else a guess.
function sizeOf(file) {
  try {
    const b = fs.readFileSync(file);
    if (b.slice(1, 4).toString() === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
    const svg = b.toString('utf8', 0, 2000);
    const w = /\swidth="(\d+)/.exec(svg);
    const h = /\sheight="(\d+)/.exec(svg);
    if (w && h) return [Number(w[1]), Number(h[1])];
  } catch { /* not there: guessed */ }
  return [800, 600];
}

// After each ```flow block's lines, one more step from its first line's last;
// under each picture on a line of its own, a box and words in its ```ink block.
function drawOn(f, text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    out.push(l);
    if (/^\s*```flow\s*$/i.test(l)) {
      const arrow = lines.slice(i + 1).find((x) => x.includes('->')) || '';
      const first = arrow.split('>').pop().trim().replace(/^[[(]+|[\])]+$/g, '');
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) out.push(lines[j++]);
      if (first) out.push(`${first} -> Double-check`);
      if (j < lines.length) out.push(lines[j]);
      i = j;
      continue;
    }
    const pic = /^\s*!\[[^\]]*\]\(([^)\s]+)\)\s*$/.exec(l);
    if (!pic) continue;
    const [w, h] = sizeOf(path.join(path.dirname(f), decodeURI(pic[1])));
    const marks = [`box red: ${Math.round(w * 0.1)},${Math.round(h * 0.1)} ${Math.round(w * 0.4)}x${Math.round(h * 0.25)}`, `text red: ${Math.round(w * 0.1)},${Math.round(h * 0.38)} Look here`];
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (/^\s*```ink\s*$/i.test(lines[j] || '')) {
      for (let k = i + 1; k <= j; k++) out.push(lines[k]);
      for (j++; j < lines.length && !/^\s*```\s*$/.test(lines[j]); j++) out.push(lines[j]);
      out.push(...marks);
      i = j - 1; // the closing fence comes next
    } else out.push('', '```ink', ...marks, '```');
  }
  return out.join('\n');
}

// A few mechanical proofreading marks: a repeated word, "very", a long sentence.
function marks(f, text) {
  const out = [];
  for (const rep of text.matchAll(/\b([\p{L}]+) \1\b/giu)) out.push({ file: f, quote: rep[0], comment: 'Repeated word.', suggest: rep[1] });
  for (const very of text.matchAll(/\bvery ([\p{L}]+)/gu)) out.push({ file: f, quote: very[0], comment: '“very” adds little here.', suggest: very[1] });
  for (const [long, short] of [['in order to', 'to'], ['utilize', 'use'], ['at this point in time', 'now'], ['a lot of', 'many']]) {
    if (text.includes(long)) out.push({ file: f, quote: long, comment: 'Shorter says the same.', suggest: short });
  }
  const s = firstSentence(text);
  if (s.length > 100) out.push({ file: f, quote: s.slice(0, 60), comment: 'A long sentence: consider splitting it.' });
  if (!out.length) {
    const head = /^#+\s+(.+)$/m.exec(text);
    if (head) out.push({ file: f, quote: head[1], comment: 'Reads well.' });
  }
  return out;
}

// Through the lens, mechanically: a line ending in "?" is open, one with
// "decided" (or 결정) decided, "obviously", "everyone"… is a claim with
// nothing behind it, and two different weekdays for the same note disagree.
function lensOf(f, text) {
  const out = [];
  const said = [];
  let fence = false;
  for (const l of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence || /^\s*#/.test(l)) continue;
    const q = l.replace(/^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|>\s?)/, '').trim().slice(0, 120);
    if (!q) continue;
    said.push(q);
    if (/\?$/.test(q)) out.push({ file: f, kind: 'open', quotes: [q], note: 'Still open: the note doesn\'t answer it.' });
    else if (/\b(decided|agreed)\b|\uACB0\uC815/i.test(q)) out.push({ file: f, kind: 'decided', quotes: [q], note: 'Decided.' });
    if (/\b(obviously|clearly|everyone|always|never)\b/i.test(q)) out.push({ file: f, kind: 'gap', quotes: [q], note: 'Said as a fact, with nothing to back it.' });
  }
  const DAY = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;
  const dated = said.filter((q) => DAY.test(q));
  const other = dated.find((q) => DAY.exec(q)[1] !== DAY.exec(dated[0])[1]);
  if (other) out.push({ file: f, kind: 'conflict', quotes: [dated[0], other], note: `${DAY.exec(dated[0])[1]} here, ${DAY.exec(other)[1]} there: which is it?` });
  return out;
}

// The paragraph between <<< and >>> in the task, three ways: its first
// sentence alone, its sentences as a list, and the other way round.
function forksOf(f, text) {
  const quote = /<<<\n([\s\S]*?)\n>>>/.exec(process.env.AGENT_NOTES_TASK || '')?.[1];
  if (!quote || !text.includes(quote)) return [];
  const said = quote.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
  const options = [
    { text: said[0], why: 'Shorter: the first sentence alone.' },
    { text: said.map((x) => `- ${x}`).join('\n'), why: 'As a list.' },
    { text: [...said].reverse().join(' '), why: 'The other way round.' },
  ].filter((o) => o.text !== quote);
  return options.length ? [{ file: f, quote, options }] : [];
}

// "Make or change a command…": whatever was asked, the demo adds one macro,
// "Make it a task", on ⌥X o t (and a step Margin can't read when asked for
// a broken one, to see the review say so).
function commandNotes() {
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const macros = read('MACROS.md');
  const steps = ['move line-start', 'type "- [ ] "', 'move down', ...(task.includes('broken') ? ['fly away'] : [])];
  if (!/^## Make it a task$/m.test(macros)) fs.writeFileSync('MACROS.md', `${macros.trim() ? `${macros.trimEnd()}\n\n` : '# Macros\n\n'}## Make it a task\nTurns the line into a task and goes to the next one.\n\n\`\`\`macro\n${steps.join('\n')}\n\`\`\`\n`);
  const leader = read('LEADER.md');
  if (!/`o t`/.test(leader)) fs.writeFileSync('LEADER.md', `${leader.trim() ? `${leader.trimEnd()}\n` : '# Leader keys\n\n'}- \`o t\` Macro: Make it a task\n`);
  console.log("[demo-agent] I'm the offline demo agent: whatever you asked, I add the macro “Make it a task” (MACROS.md) on ⌥X o t (LEADER.md).");
}

setTimeout(() => {
  if (process.env.AGENT_NOTES_SCOPE === 'commands') { commandNotes(); return; }
  if (!understood) {
    console.log([
      "I'm the offline demo agent, not an AI, so I can't do this task.",
      'I only understand a few keywords: tidy / format, summarize / TL;DR, tasks / todo, and draw (in English or Korean).',
      'For real tasks, add Claude Code or Codex in Agent › Manage Agents… and pick it when you delegate.',
    ].join('\n'));
    return;
  }
  let changed = 0;
  const write = (f, next, why) => {
    const prev = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    if (prev === next) return;
    fs.mkdirSync(path.dirname(f) || '.', { recursive: true });
    fs.writeFileSync(f, next);
    changed++;
    console.log(`[demo-agent] ${prev === null ? 'created' : 'edited '} ${f}  (${why})`);
  };

  if (wants(...FORKS)) {
    const forks = targets.flatMap((f) => forksOf(f, fs.readFileSync(f, 'utf8')));
    fs.mkdirSync('.agent-notes', { recursive: true });
    fs.writeFileSync(path.join('.agent-notes', 'forks.json'), JSON.stringify({ forks }, null, 2));
    console.log(`[demo-agent] done: ${forks.length} paragraph(s) written other ways, the notes untouched.`);
    return;
  }
  if (wants(...LENS)) {
    const findings = targets.flatMap((f) => lensOf(f, fs.readFileSync(f, 'utf8')));
    fs.mkdirSync('.agent-notes', { recursive: true });
    fs.writeFileSync(path.join('.agent-notes', 'lens.json'), JSON.stringify({ findings }, null, 2));
    console.log(`[demo-agent] done: ${findings.length} thing(s) seen through the lens, the notes untouched.`);
    return;
  }
  if (wants(...RED)) {
    const all = targets.flatMap((f) => marks(f, fs.readFileSync(f, 'utf8')));
    const only = wants(...REMARKS_ONLY);
    const out = all.map((m) => (only && m.suggest != null ? { file: m.file, quote: m.quote, comment: `${m.comment} Perhaps: “${m.suggest}”.` } : m));
    fs.mkdirSync('.agent-notes', { recursive: true });
    fs.writeFileSync(path.join('.agent-notes', 'comments.json'), JSON.stringify(out, null, 2));
    console.log(`[demo-agent] done: ${out.length} mark(s) in the margin, the notes untouched.`);
    return;
  }
  if (wants(...TASKS)) {
    const rows = openTasks(files);
    write('Open tasks.md', `# Open tasks\n\nCollected from ${files.length} note(s).\n\n${rows.join('\n') || '_Nothing open._'}\n`, 'collected open tasks');
  }
  for (const f of targets) {
    let text = fs.readFileSync(f, 'utf8');
    if (wants(...SUMMARY)) text = addTldr(text);
    if (wants(...TIDY)) text = tidy(text);
    if (wants(...DRAW)) text = drawOn(f, text);
    if (round > 1 && wants(...SHORTER)) text = text.replace(/^> \*\*TL;DR\*\* (.{0,60}).*$/m, '> **TL;DR** $1…');
    write(f, text, 'formatting / summary');
  }
  console.log(changed ? `[demo-agent] done: ${changed} file(s) changed. Review them in Margin.` : '[demo-agent] nothing to change.');
}, 900);
