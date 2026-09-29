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
const understood = wants(...TIDY, ...SUMMARY, ...TASKS) || (round > 1 && wants(...SHORTER));

setTimeout(() => {
  if (!understood) {
    console.log([
      "I'm the offline demo agent, not an AI, so I can't do this task.",
      'I only understand a few keywords: tidy / format, summarize / TL;DR, and tasks / todo (in English or Korean).',
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

  if (wants(...TASKS)) {
    const rows = openTasks(files);
    write('Open tasks.md', `# Open tasks\n\nCollected from ${files.length} note(s).\n\n${rows.join('\n') || '_Nothing open._'}\n`, 'collected open tasks');
  }
  for (const f of targets) {
    let text = fs.readFileSync(f, 'utf8');
    if (wants(...SUMMARY)) text = addTldr(text);
    if (wants(...TIDY)) text = tidy(text);
    if (round > 1 && wants(...SHORTER)) text = text.replace(/^> \*\*TL;DR\*\* (.{0,60}).*$/m, '> **TL;DR** $1…');
    write(f, text, 'formatting / summary');
  }
  console.log(changed ? `[demo-agent] done: ${changed} file(s) changed. Review them in Margin.` : '[demo-agent] nothing to change.');
}, 900);
