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
import { meetingItems, agendaOf, agendaAt, nextAgendaEdit, classifyLine, typedKind, moveItem, wallOf, previousOf, nextMeetingPath, minutes, wrapTask, bodyOf, foldNote, nextNote, foldQuestions } from '../public/meeting.js';

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

test('meetingItems: lines marked with a tag, at any depth of a list, read as callouts are', () => {
  const text = [
    '## Launch (10m)', '', '- launch date', '  - 20th? mkt ok', '  - -> go w/ 20th #decision', '    - [ ] ann: survey thurs @ann', '    1. press kit?? #question',
    '- review may slip #risk', '  - free first month #idea', '- offer range #next', '> [!decision] An old one, as a callout.', 'see `#decision` and https://x.test/#risk',
  ].join('\n');
  assert.deepEqual(meetingItems(text).map((i) => [i.kind, i.body, i.section]), [
    ['decision', '-> go w/ 20th', 'Launch'],
    ['todo', 'ann: survey thurs', 'Launch'],
    ['question', 'press kit??', 'Launch'],
    ['risk', 'review may slip', 'Launch'],
    ['idea', 'free first month', 'Launch'],
    ['next', 'offer range', 'Launch'],
    ['decision', 'An old one, as a callout.', 'Launch'],
  ]);
  // The wall moves it in its place: its depth and list kept.
  const items = meetingItems(text);
  assert.match(moveItem(text, items[0], { kind: 'question' }), /\n {2}- -> go w\/ 20th #question\n/);
  assert.match(moveItem(text, items[2], { kind: 'todo', owner: 'bob' }), /\n {4}1\. \[ \] press kit\?\? @bob\n/);
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
  assert.equal(now, 'Intro\nWe ship Friday #decision\nAfter\n', 'where it is, a tag at its end');
  assert.equal(e.kind, 'decision');
  const back = classifyLine(now, now.indexOf('We'), 'decision');
  assert.equal(back.insert, 'We ship Friday');
  assert.equal(back.kind, null);
  assert.equal(classifyLine('- ask Bob @bob\n', 2, 'todo').insert, '- [ ] ask Bob @bob');
  assert.equal(classifyLine('! it is so\n', 2, 'question').insert, 'it is so #question');
  // In a list within a list: its mark and its depth kept.
  const nested = '- launch\n  - we ship friday\n    1. ask bob\n';
  assert.equal(classifyLine(nested, nested.indexOf('we'), 'decision').insert, '  - we ship friday #decision');
  assert.equal(classifyLine(nested, nested.indexOf('ask'), 'todo').insert, '    1. [ ] ask bob');
  assert.equal(classifyLine('  - [ ] ask bob\n', 8, 'question').insert, '  - ask bob #question');
  assert.equal(classifyLine('  - we ship #decision\n', 6, 'risk').insert, '  - we ship #risk');
  // An old callout: a plain line now.
  assert.equal(classifyLine('> [!question] who books\n', 16, 'todo').insert, '- [ ] who books');
  assert.equal(classifyLine('> [!question] who books\n', 16, 'decision').insert, 'who books #decision');
  assert.equal(classifyLine('\n', 0, 'todo'), null);
  assert.equal(typedKind('! We ship'), 'decision');
  assert.equal(typedKind('? Why'), 'question');
  assert.equal(typedKind('[] Call @ann'), 'todo');
  assert.equal(typedKind('  - ! We ship'), 'decision');
  assert.equal(typedKind('1. ? Why'), 'question');
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
  // A to-do decided: in its list, marked.
  assert.match(moveItem(NOTE, items[4], { kind: 'decision' }), /- \[x\] Draft the notes @\S+\n- Book the call #decision\n/);
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
    assert.match(note, /### To-dos by owner\n\n\*\*@ann\*\*\n\n- Send the survey \u{1F4C5} 2026-10-08 \u00b7 \[\[#Status \(5m\)\]\]\n/u);
    assert.match(note, /\*\*No owner\*\*\n\n- Book the call \u00b7 \[\[#Launch date \(10\uBD84\)\]\]\n/);
    assert.match(note, /- ~~Draft the notes~~ \u00b7/);
    assert.match(note, /Next meeting: \[\[Weekly 2026-10-12\]\]\n$/);
    // Left in place: the to-do where it was, and its words in the wrap-up.
    assert.match(note, /- \[x\] Draft the notes @\uBBFC\uC218\n- \[ \] Book the call\n/);
    assert.equal(note.match(/Book the call/g).length, 2);
    assert.equal(meetingItems(note).filter((i) => i.kind === 'todo').length, 3);
    const next = fs.readFileSync(path.join(ws, 'Weekly 2026-10-12.md'), 'utf8');
    assert.equal(previousOf(next), 'Weekly 2026-10-05');
    assert.match(next, /## Launch date \(10\uBD84\)\n\n- Do we need a press kit\? #question\n/);
    assert.deepEqual(agendaOf(next).map((a) => a.title), ['Status', 'Launch date']);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

const MORE = [
  '# Weekly 2026-10-05',
  '',
  '## Launch (10m)',
  '',
  '> [!warning] The store review may take a week.',
  '',
  '> [!idea] A first month free instead of a discount?',
  '',
  '- The offer range #next',
  'Pricing for teams #next',
  '- [ ] Ask legal #next @ann',
  '',
].join('\n');

test('risks, ideas and topics for next time: read, marked, moved, on the wall', () => {
  const items = meetingItems(MORE);
  assert.deepEqual(items.map((i) => [i.kind, i.body]), [
    ['risk', 'The store review may take a week.'],
    ['idea', 'A first month free instead of a discount?'],
    ['next', 'The offer range'],
    ['next', 'Pricing for teams'],
    ['todo', 'Ask legal #next'],
  ]);
  // Marked: a tag at the end, "#risk", "#next"; again: plain words.
  const text = '## Launch (10m)\nreview may slip\noffer range\n';
  const risk = classifyLine(text, text.indexOf('review'), 'risk');
  assert.equal(risk.insert, 'review may slip #risk');
  const later = classifyLine(text, text.indexOf('offer'), 'next');
  assert.equal(later.insert, 'offer range #next');
  assert.equal(classifyLine('- offer range #next', 3, 'next').insert, '- offer range');
  assert.equal(classifyLine('> [!idea] free month', 3, 'idea').insert, 'free month');
  // Moved on the wall: a risk decided, an idea for next time, a topic as a to-do.
  assert.match(moveItem(MORE, items[0], { kind: 'decision' }), /> \[!decision\] The store review may take a week\./);
  assert.match(moveItem(MORE, items[1], { kind: 'next' }), /\n- A first month free instead of a discount\? #next\n/);
  assert.match(moveItem(MORE, items[2], { kind: 'todo', owner: 'bob' }), /\n- \[ \] The offer range @bob\n/);
  assert.match(moveItem(MORE, items[2], { kind: 'risk' }), /\n- The offer range #risk\n/);
  // The wall: risks after the questions, ideas and next time last; none, no column.
  assert.deepEqual(wallOf(MORE).map((c) => [c.id, c.items.length]), [['decided', 0], ['open', 0], ['risks', 1], ['@ann', 1], ['nobody', 0], ['ideas', 1], ['later', 2]]);
  assert.ok(!wallOf(NOTE).some((c) => ['risks', 'ideas', 'later'].includes(c.id)));
  assert.match(wrapTask('W.md', 'W2.md', []), /### Risks/);
});

test('the demo agent carries risks and ideas into the wrap-up, and #next to the next meeting', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-meeting-test-'));
  try {
    fs.writeFileSync(path.join(ws, 'Weekly 2026-10-05.md'), MORE);
    const task = wrapTask('Weekly 2026-10-05.md', 'Weekly 2026-10-12.md', []);
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'demo-agent.js')], { cwd: ws, env: { ...process.env, AGENT_NOTES_TASK: task, AGENT_NOTES_FOCUS: 'Weekly 2026-10-05.md' }, stdio: 'pipe' });
    const note = fs.readFileSync(path.join(ws, 'Weekly 2026-10-05.md'), 'utf8');
    assert.match(note, /### Risks\n\n- The store review may take a week\. #risk\n\n### Ideas\n\n- A first month free[^\n]* #idea\n/);
    const next = fs.readFileSync(path.join(ws, 'Weekly 2026-10-12.md'), 'utf8');
    assert.match(next, /## Launch \(10m\)\n\n- The offer range\n- Pricing for teams\n/);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('fold: a to-do in a nested list stays under its item', () => {
  const note = ['# M', '', '## Launch', '', '- Press', '  - kit?? #question', '  - [ ] Draft the kit @bob \u{1F4C5} 2026-10-09', '- Venue', '  - [ ] Book it #decision', ''].join('\n');
  const out = foldNote(note, { path: 'M.md', next: 'M2.md' });
  assert.ok(out.startsWith(note.trimEnd()), 'the note as it was');
  assert.match(out, /\*\*@bob\*\*\n\n- Draft the kit \u{1F4C5} 2026-10-09 \u00b7 \[\[#Launch\]\]\n\n\*\*No owner\*\*\n\n- Book it \u00b7 \[\[#Launch\]\]\n/u);
});

test('fold: to-dos left in place and listed by owner in a Wrap-up, the rest again, the next meeting', () => {
  const note = [
    '# Weekly 2026-10-05', '', '## Launch (10m)', '', '> [!decision] We launch on Oct 10.', '', 'Before that:',
    '- [ ] Decide on QA @sua \u{1F4C5} 2026-10-09', '- [ ] Ship the tool', '- [x] Book the venue @ann', '',
    '> [!question] A press kit?', '', '?? who books the hall', '', '## Pricing (5m)', '', '> [!warning] Review may slip.', '', '- Offer range #next', '',
  ].join('\n');
  const times = [{ title: 'Launch', budget: 10, ms: 12 * 60000 }, { title: 'Pricing', budget: 5, ms: 0 }];
  const out = foldNote(note, { path: 'sub/Weekly 2026-10-05.md', next: 'sub/Weekly 2026-10-12.md', summary: 'We set the launch.', times });
  assert.equal(out, [
    '# Weekly 2026-10-05', '', '## Launch (10m)', '', '> [!decision] We launch on Oct 10.', '', 'Before that:',
    '- [ ] Decide on QA @sua \u{1F4C5} 2026-10-09', '- [ ] Ship the tool', '- [x] Book the venue @ann', '',
    '> [!question] A press kit?', '', '## Pricing (5m)', '', '> [!warning] Review may slip.', '', '- Offer range #next', '',
    '## Wrap-up', '', 'We set the launch.', '', '**Time:** Launch 12m of 10m', '',
    '### To-dos by owner', '', '**@sua**', '', '- Decide on QA \u{1F4C5} 2026-10-09 \u00b7 [[#Launch (10m)]]', '', '**@ann**', '', '- ~~Book the venue~~ \u00b7 [[#Launch (10m)]]', '',
    '**No owner**', '', '- Ship the tool \u00b7 [[#Launch (10m)]]', '',
    '### Decisions', '', '- We launch on Oct 10. #decision', '', '### Open questions', '', '- A press kit? #question', '',
    '### Risks', '', '- Review may slip. #risk', '', 'Next meeting: [[Weekly 2026-10-12]]', '',
  ].join('\n'));
  // Read again, the wrap-up's list is not more to-dos, decisions or questions.
  assert.equal(meetingItems(out).filter((i) => i.kind === 'todo').length, 3);
  // Again: the section is redone, with a new to-do.
  const again = foldNote(`${out.replace('\n## Wrap-up', '- [ ] New one @bob\n\n## Wrap-up')}`, { path: 'sub/Weekly 2026-10-05.md', next: 'sub/Weekly 2026-10-12.md' });
  assert.equal(again.match(/## Wrap-up/g).length, 1);
  assert.match(again, /\*\*@bob\*\*\n\n- New one \u00b7 \[\[#Pricing \(5m\)\]\]\n/);
  assert.equal(again.match(/Decide on QA/g).length, 2);
  assert.ok(!again.includes('We set the launch.'));
  // To-dos an older fold moved into its section: back into the note.
  const older = foldNote('# M\n\n## A\n\n- talk\n\n## Wrap-up\n\n### To-dos by owner\n\n**@bob**\n\n- [ ] Call @bob\n', { path: 'M.md', next: 'M2.md' });
  assert.match(older, /^# M\n\n## A\n\n- talk\n\n- \[ \] Call @bob\n\n## Wrap-up\n\n### To-dos by owner\n\n\*\*@bob\*\*\n\n- Call\n/);
  // Next time: the same agenda, its questions and #next under their items.
  assert.equal(nextNote(note, { path: 'sub/Weekly 2026-10-05.md', next: 'sub/Weekly 2026-10-12.md' }), [
    '# Weekly 2026-10-12', '', 'Previous meeting: [[Weekly 2026-10-05]]', '', '## Launch (10m)', '', '- A press kit? #question', '',
    '## Pricing (5m)', '', '- Offer range', '',
  ].join('\n'));
  assert.equal(nextNote('# M\n\n> [!question] Who?\n', { path: 'M.md', next: 'M (next).md' }), '# M (next)\n\nPrevious meeting: [[M]]\n\n- Who? #question\n');
  // A question the meeting settled: not open in the wrap-up, not carried on.
  const settled = foldQuestions(out).map((q) => q.key);
  assert.deepEqual(foldQuestions(out).map((q) => q.body), ['A press kit?']);
  const closed = foldNote(note, { path: 'sub/Weekly 2026-10-05.md', next: 'sub/Weekly 2026-10-12.md', settled });
  assert.ok(!closed.includes('### Open questions'));
  assert.match(closed, /### Settled\n\n- A press kit\?\n/);
  assert.ok(!nextNote(note, { path: 'sub/Weekly 2026-10-05.md', next: 'sub/Weekly 2026-10-12.md', settled }).includes('press kit'));
});
