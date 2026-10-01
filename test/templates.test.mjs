// node --test (npm test): filling note templates (public/templates.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, formatDate, isTemplate } from '../public/templates.js';

const now = new Date(2026, 9, 2, 9, 5, 7); // Friday, 2 October 2026, 09:05:07

test('the title, dates and times are filled in; the rest is left alone', () => {
  const { text, cursor } = fillTemplate('# {{title}}\n{{date}} {{time}} · {{date:dddd D/M/YY}} · {{ yesterday }} {{tomorrow:MM-DD}}\n{{cursor}}\n{{unknown}} {{title:x}}', { title: 'Plan', now });
  assert.equal(text, '# Plan\n2026-10-02 09:05 · Friday 2/10/26 · 2026-10-01 10-03\n\n{{unknown}} {{title:x}}');
  assert.equal(cursor, text.indexOf('\n\n{{unknown') + 1);
});

test('only the first {{cursor}} is used; no cursor is null', () => {
  const r = fillTemplate('a{{cursor}}b{{cursor}}', { now });
  assert.deepEqual(r, { text: 'ab{{cursor}}', cursor: 1 });
  assert.equal(fillTemplate('x', { now }).cursor, null);
  assert.equal(formatDate(now, 'YYYY-MM-DD HH:mm:ss ddd'), '2026-10-02 09:05:07 Fri');
});

test('templates are the notes in templates/', () => {
  assert.equal(isTemplate('templates/Meeting.md'), true);
  assert.equal(isTemplate('Templates/x/Daily.md'), true);
  assert.equal(isTemplate('notes/templates/x.md'), false);
});
