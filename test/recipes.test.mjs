import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipes, mergeRecipes, runsDirectly, BUILTIN_RECIPES, RECIPES_STARTER } from '../public/recipes.js';

test('each ## heading is a recipe; key, scope and ask lines set it up, the rest is the task', () => {
  const { recipes, errors } = parseRecipes(`# Recipes

Intro text, with - key: x that is not a recipe.

## Meeting → decisions
key: m
scope: note

Turn the meeting notes into a decision log.

Keep the notes.

## Weekly
- scope: folder
- ask: no
Write a weekly review.
`);
  assert.deepEqual(errors, []);
  assert.equal(recipes.length, 2);
  assert.deepEqual(recipes[0], { name: 'Meeting → decisions', prompt: 'Turn the meeting notes into a decision log.\n\nKeep the notes.', key: 'm', scope: 'file', ask: null, line: 5 });
  assert.equal(recipes[1].scope, 'folder');
  assert.equal(recipes[1].ask, false);
  assert.equal(recipes[1].key, null);
  assert.equal(recipes[1].prompt, 'Write a weekly review.');
});

test('a key: line after the task text is part of the task; ## in a code block is not a recipe', () => {
  const { recipes } = parseRecipes('## A\nDo this.\nkey: z\n\n```\n## not a recipe\n```\n');
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].key, null);
  assert.match(recipes[0].prompt, /key: z/);
  assert.match(recipes[0].prompt, /## not a recipe/);
});

test('mistakes are reported with their line, and the rest still loads', () => {
  const { recipes, errors } = parseRecipes('## A\nkey: ab\nscope: everywhere\nask: maybe\nDo A.\n\n## Empty\n\n## B\nkey: e\nDo B.\n');
  assert.deepEqual(recipes.map((r) => r.name), ['A', 'B']);
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4, 7, 10]);
  assert.equal(recipes[1].key, null); // e is ⌥X r e, edit
});

test('built-ins first with their digits; one of the same name replaces it; a key used twice stays with the first', () => {
  const user = parseRecipes('## proofread\nscope: note\nFix typos only.\n\n## Mine\nkey: m\nMine.\n\n## Other\nkey: m\nOther.\n').recipes;
  const all = mergeRecipes(user);
  assert.equal(all.length, BUILTIN_RECIPES.length + 2);
  const proof = all.find((r) => r.name === 'proofread');
  assert.equal(proof.key, '5');
  assert.equal(proof.prompt, 'Fix typos only.');
  assert.equal(all.filter((r) => /proofread/i.test(r.name)).length, 1);
  assert.deepEqual(all.slice(-2).map((r) => [r.name, r.key]), [['Mine', 'm'], ['Other', null]]);
});

test('a recipe for the note goes straight to the agent; folder and workspace ask first unless ask: no; built-ins ask', () => {
  assert.equal(runsDirectly({ scope: 'file', ask: null }), true);
  assert.equal(runsDirectly({ scope: 'file', ask: true }), false);
  assert.equal(runsDirectly({ scope: 'folder', ask: null }), false);
  assert.equal(runsDirectly({ scope: 'workspace', ask: false }), true);
  assert.equal(runsDirectly({ scope: null, ask: null }), false);
  assert.equal(runsDirectly(BUILTIN_RECIPES[0]), false);
});

test('the starter file is a valid recipes file', () => {
  const { recipes, errors } = parseRecipes(RECIPES_STARTER);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes.map((r) => [r.key, r.scope]), [['m', 'file'], ['w', 'folder']]);
});
