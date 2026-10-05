// node --test (npm test): meetings (public/meeting.js) — decisions, to-dos
// and questions read from a note, the agenda and its minutes, a line marked
// as one of them, a card moved on the decision wall, the next meeting's note;
// and the demo agent's wrap-up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { meetingItems, agendaOf, agendaAt, nextAgendaEdit, classifyLine, typedKind, moveItem, wallOf, previousOf, nextMeetingPath, minutes, wrapTask, bodyOf } from '../public/meeting.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTE = [
  '# Weekly 2026-10-05',
  '',
  '## Status (5m)',
  '',
  'Beta is with 40 testers.',
  '',
  '- [ ] Send the survey @ann \u{1F4C5} 2026-10-08',
  '',
  '## Launch date (10\uBD84)',
  '',
  '> [!decision] We launch on October 20.',
  '',
  '> [!question] Do we need a press kit?',
  '',
  '- [x] Draft the notes @\uBBFC\uC218',
  '- [ ] Book the call',
  '',
  '```',
  '> [!decision] Not this, it is code.',
  '```',
  '',
  '## Notes',
  '',
  '> [!decision] We launch on  October 20.',
  '',
].join('\n');

test('meetingItems: callouts and to-dos, with owner, date and section; one of each wording; not in code', () => {
  const items = meetingItems(NOTE);
  assert.deepEqual(items.map((i) => [i.kind, i.body, i.owner ?? null, i.due ?? null, i.section, !!i.done]), [
    ['todo', 'Send the survey', 'ann', '2026-10-08', 'Status', false],
    ['decision', 'We launch on October 20.', null, null, 'Launch date', false],
    ['question', 'Do we need a press kit?', null, null, 'Launch date', false],
    ['todo', 'Draft the notes', '\uBBFC\uC218', null, 'Launch date', true],
    ['todo', 'Book the call', null, null, 'Launch date', false],
  ]);
  assert.equal(NOTE.slice(items[1].from, items[1].to), '> [!decision] We launch on October 20.');
  assert.equal(bodyOf('Ask @bob about it \u{1F4C5} 2026-01-02'), 'Ask about it');
});

test('agendaOf: headings with minutes, each to the next heading as high; the item at a place', () => {
  const agenda = agendaOf(NOTE);
  assert.deepEqual(agenda.map((a) => [a.title, a.budget]), [['Status', 5], ['Launch date', 10]]);
  assert.equal(agenda[1].lastLine, 20);
  assert.equal(agendaAt(agenda, NOTE.indexOf('Beta')), 0);
  assert.equal(agendaAt(agenda, NOTE.indexOf('Book')), 1);
  assert.equal(agendaAt(agenda, NOTE.indexOf('## Notes') + 3), -1);
  // The next item: after its last line with words.
  const e = nextAgendaEdit(NOTE, NOTE.indexOf('Beta'));
  assert.equal(e.title, 'Launch date');
  assert.equal(NOTE.slice(0, e.from).split('\n').pop(), '```');
  assert.equal(nextAgendaEdit(NOTE, NOTE.indexOf('Book')), null);
});

test('classifyLine and typedKind: a line made a decision, a to-do or a question, and back', () => {
  const text = 'Intro\nWe ship Friday\nAfter\n';
  const e = classifyLine(text, 8, 'decision');
  const now = text.slice(0, e.from) + e.insert + text.slice(e.to);
  assert.equal(now, 'Intro\n\n> [!decision] We ship Friday\n\nAfter\n');
  assert.equal(e.kind, 'decision');
  const back = classifyLine(now, now.indexOf('We'), 'decision');
  assert.equal(back.insert, 'We ship Friday');
  assert.equal(back.kind, null);
  assert.equal(classifyLine('- ask Bob @bob\n', 2, 'todo').insert, '- [ ] ask Bob @bob');
  assert.equal(classifyLine('! it is so\n', 2, 'question').insert, '> [!question] it is so');
  assert.equal(classifyLine('\n', 0, 'todo'), null);
  assert.equal(typedKind('! We ship'), 'decision');
  assert.equal(typedKind('? Why'), 'question');
  assert.equal(typedKind('[] Call @ann'), 'todo');
  assert.equal(typedKind('!important'), null);
  assert.equal(typedKind('Plain'), null);
});

test('moveItem and wallOf: a card moved is the note changed — owner, done, kind; every copy of it', () => {
  const items = meetingItems(NOTE);
  const survey = items[0];
  const toBob = moveItem(NOTE, survey, { kind: 'todo', owner: 'bob' });
  assert.match(toBob, /- \[ \] Send the survey @bob \u{1F4C5} 2026-10-08/u);
  assert.match(moveItem(NOTE, items[4], { kind: 'todo', owner: 'ann' }), /- \[ \] Book the call @ann\n/);
  assert.match(moveItem(NOTE, survey, { kind: 'todo', owner: null }), /- \[ \] Send the survey \u{1F4C5}/u);
  assert.match(moveItem(NOTE, survey, { done: true }), /- \[x\] Send the survey/);
  // A decision back to open: both places it is written.
  const reopened = moveItem(NOTE, items[1], { kind: 'question' });
  assert.equal(reopened.match(/\[!question\] We launch/g).length, 2);
  assert.ok(!/\[!decision\] We launch/.test(reopened));
  // A question handed to someone: a to-do.
  assert.match(moveItem(NOTE, items[2], { kind: 'todo', owner: 'ann' }), /\n- \[ \] Do we need a press kit\? @ann\n/);
  // A to-do decided: a callout of its own.
  assert.match(moveItem(NOTE, items[4], { kind: 'decision' }), /- \[x\] Draft the notes @\S+\n\n> \[!decision\] Book the call\n/);
  const cols = wallOf(NOTE);
  assert.deepEqual(cols.map((c) => [c.id, c.items.length]), [['decided', 1], ['open', 1], ['@ann', 1], ['@\uBBFC\uC218', 1], ['nobody', 1]]);
});

test('the next meeting: its name, the previous one, the wrap-up task', () => {
  assert.equal(nextMeetingPath('m/Weekly 2026-10-05.md'), 'm/Weekly 2026-10-12.md');
  assert.equal(nextMeetingPath('Weekly 2026-12-29.md'), 'Weekly 2027-01-05.md');
  assert.equal(nextMeetingPath('Kickoff.md'), 'Kickoff (next).md');
  assert.equal(previousOf('# W\n\nPrevious meeting: [[Weekly 2026-10-05]]\n'), 'Weekly 2026-10-05');
  assert.equal(previousOf('**Previous meeting:** [[A|the last]]'), 'A');
  assert.equal(previousOf('# Nothing\n'), null);
  assert.equal(minutes(125000), '2:05');
  const task = wrapTask('m/W 2026-10-05.md', 'm/W 2026-10-12.md', [{ title: 'Status', budget: 5, ms: 260000 }, { title: 'Hiring', budget: 10, ms: 0 }]);
  assert.match(task, /^Wrap up this meeting/);
  assert.match(task, /Create the next meeting's note, m\/W 2026-10-12\.md: "# "/);
  assert.match(task, /Previous meeting: \[\[W 2026-10-05\]\]/);
  assert.match(task, /Time on the agenda: Status 4m of 5m\./);
});

test('the demo agent wraps a meeting up: to-dos by owner, decisions, the next meeting with open questions', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-meeting-test-'));
  try {
    fs.writeFileSync(path.join(ws, 'Weekly 2026-10-05.md'), NOTE);
    const task = wrapTask('Weekly 2026-10-05.md', 'Weekly 2026-10-12.md', [{ title: 'Status', budget: 5, ms: 240000 }]);
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'demo-agent.js')], { cwd: ws, env: { ...process.env, AGENT_NOTES_TASK: task, AGENT_NOTES_FOCUS: 'Weekly 2026-10-05.md' }, stdio: 'pipe' });
    const note = fs.readFileSync(path.join(ws, 'Weekly 2026-10-05.md'), 'utf8');
    assert.match(note, /\n## Wrap-up\n\n2 items on the agenda: 1 decided, 1 left open, 3 to-dos for 2 people\./);
    assert.match(note, /\*\*Time:\*\* Status 4m of 5m\n/);
    assert.match(note, /### To-dos by owner\n\n\*\*@ann\*\*\n\n- \[ \] Send the survey @ann/);
    assert.match(note, /\*\*No owner\*\*\n\n- \[ \] Book the call\n/);
    assert.match(note, /Next meeting: \[\[Weekly 2026-10-12\]\]\n$/);
    // Moved, not copied: each to-do once.
    assert.equal(note.match(/Book the call/g).length, 1);
    const next = fs.readFileSync(path.join(ws, 'Weekly 2026-10-12.md'), 'utf8');
    assert.equal(previousOf(next), 'Weekly 2026-10-05');
    assert.match(next, /## Launch date \(10\uBD84\)\n\n> \[!question\] Do we need a press kit\?\n/);
    assert.deepEqual(agendaOf(next).map((a) => a.title), ['Status', 'Launch date']);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});
