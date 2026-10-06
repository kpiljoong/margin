import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';

test('a quote that starts with [!type] is a callout', () => {
  const html = renderMarkdown('> [!warning] Mind the **gap**\n> Body text.');
  assert.match(html, /<div class="callout callout-warning" data-line="0" data-callout="warning"><div class="callout-title">Mind the <strong>gap<\/strong><\/div>/);
  assert.match(html, /<div class="callout-body"><p data-line="1">Body text.<\/p><\/div>/);
});

test('a callout without a title is named by its type; unknown types are notes', () => {
  assert.match(renderMarkdown('> [!TIP]\n> x'), /callout-tip".*<div class="callout-title">Tip<\/div>/);
  assert.match(renderMarkdown('> [!recipe] Soup'), /class="callout callout-note" data-line="0" data-callout="recipe"><div class="callout-title">Soup<\/div><\/div>/);
});

test('+ or - after the type folds the callout, open or shut', () => {
  assert.match(renderMarkdown('> [!faq]- Why?\n> Because.'), /^<details class="callout callout-important"[^>]*><summary class="callout-title">Why\?<\/summary>/);
  assert.match(renderMarkdown('> [!faq]+ Why?\n> Because.'), /data-callout="faq" open>/);
});

test('an ordinary quote stays a quote, and the type is escaped', () => {
  assert.match(renderMarkdown('> just [!note] words'), /^<blockquote/);
  assert.doesNotMatch(renderMarkdown('> [!x"onmouseover=y]'), /"onmouseover/);
});

test('a meeting\u2019s marks (#decision, #question\u2026): a small chip in the list item, the list as it is', () => {
  const html = renderMarkdown('- launch\n  - go w/ 20th #decision\n  - press kit? #question\n- other #tag');
  assert.match(html, /<li[^>]*>go w\/ 20th <a href="#" class="tag mark-tag callout-tip" data-tag="decision" title="#decision">decided<\/a><\/li>/);
  assert.match(html, /class="tag mark-tag callout-important" data-tag="question" title="#question">question<\/a>/);
  assert.match(html, /<a href="#" class="tag" data-tag="tag">#tag<\/a>/);
  assert.equal((html.match(/<ul>/g) || []).length, 2, 'the inner list stays inside');
  assert.ok(!html.includes('callout callout-'));
});
