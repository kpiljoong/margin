// node --test (npm test): meetings in space (public/stage.js) — the agenda's
// arc on the floor, the decision orbit's camera (where CSS draws a point of
// the floor is where a card is put) and where each card goes in the orbit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gaugeArcs, project, orbitTransform, orbitLayout, polar, ORBIT, ORBIT_CAMERA, ORBIT_MAX } from '../public/stage.js';
import { wallOf, agendaOf } from '../public/meeting.js';

test('gaugeArcs: the agenda over half a circle, each item its share of the minutes', () => {
  const arcs = gaugeArcs([{ title: 'A', budget: 1 }, { title: 'B', budget: 2 }, { title: 'C', budget: 1 }], { gap: 0 });
  assert.equal(arcs.length, 3);
  const half = Math.PI * 210;
  assert.ok(Math.abs(arcs[0].len - half / 4) < 0.01);
  assert.ok(Math.abs(arcs[1].len - half / 2) < 0.01);
  assert.deepEqual(arcs.map((a) => Math.round(a.mid)), [203, 270, 338]);
  assert.match(arcs[0].d, /^M50\.0,250\.0 A210,210 0 0 1 /);
  assert.deepEqual(gaugeArcs([]), []);
});

// The floor as CSS turns it: the transform's matrices, then the perspective.
function css(cam, w, h, [x, y, z]) {
  const r = (d) => (d * Math.PI) / 180;
  const ops = orbitTransform(cam).match(/\w+\([^)]*\)/g).map((op) => [op.slice(0, op.indexOf('(')), parseFloat(op.slice(op.indexOf('(') + 1))]);
  let p = [x, y, z];
  for (const [f, v] of ops.reverse()) {
    const [a, b, c] = p;
    if (f === 'rotateZ') p = [a * Math.cos(r(v)) - b * Math.sin(r(v)), a * Math.sin(r(v)) + b * Math.cos(r(v)), c];
    else if (f === 'rotateX') p = [a, b * Math.cos(r(v)) - c * Math.sin(r(v)), b * Math.sin(r(v)) + c * Math.cos(r(v))];
    else if (f === 'translateZ') p = [a, b, c + v];
    else if (f === 'translateY') p = [a, b + v, c];
    else throw new Error(f);
  }
  const s = cam.persp / (cam.persp - p[2]);
  return [w / 2 + p[0] * s, h / 2 + p[1] * s];
}

test('project: a card is put where CSS draws its place on the floor, from any camera', () => {
  const cams = [ORBIT_CAMERA, { ...ORBIT_CAMERA, yaw: -70, pitch: 74, dist: 1500 }, { ...ORBIT_CAMERA, yaw: 133, pitch: 30, dist: -150 }];
  for (const cam of cams) {
    for (const pt of [[0, 0, 0], [300, -200, 0], [-480, 90, 60], [...polar(217, ORBIT.pillars), 400]]) {
      const p = project(cam, 1600, 900, pt);
      const [x, y] = css(cam, 1600, 900, pt);
      assert.ok(Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6, `${JSON.stringify(cam)} ${pt}`);
    }
  }
  // Nearer the camera: bigger, and in front.
  const near = project(ORBIT_CAMERA, 1600, 900, [0, 400, 0]);
  const far = project(ORBIT_CAMERA, 1600, 900, [0, -400, 0]);
  assert.ok(near.s > far.s && near.depth > far.depth && near.y > far.y);
  // The first agenda item is in front, at yaw 0.
  assert.ok(project(ORBIT_CAMERA, 1600, 900, [...polar(90, 400), 0]).depth > project(ORBIT_CAMERA, 1600, 900, [...polar(270, 400), 0]).depth);
});

const NOTE = [
  '# Weekly',
  '## Status (1m)',
  '> [!decision] Beta stays open.',
  '- [ ] Send the survey @ann',
  '## Launch (1m)',
  '> [!decision] We launch on the 20th.',
  '> [!question] A press kit?',
  '- [ ] Draft the notes @bob',
  '- [ ] Book the call',
  '- [ ] Write the post @ann',
  '',
].join('\n\n');

test('orbitLayout: decisions high in their item\'s sector, questions on the ring, a pillar for each owner', () => {
  const agenda = agendaOf(NOTE);
  const l = orbitLayout(wallOf(NOTE), agenda);
  assert.deepEqual(l.sectors.map((s) => [s.title, s.angle]), [['Status', 90], ['Launch', 270]]);
  const node = (body) => l.nodes.find((n) => n.item.body === body);
  assert.equal(node('Beta stays open.').kind, 'decision');
  assert.equal(node('Beta stays open.').a, 90);
  assert.equal(node('We launch on the 20th.').a, 270);
  assert.ok(node('We launch on the 20th.').z > 200);
  assert.equal(node('A press kit?').r, ORBIT.ring);
  assert.ok(node('A press kit?').orbit);
  assert.deepEqual(l.pillars.map((p) => [p.title, p.n]), [['@ann', 2], ['@bob', 1], ['No owner', 1]]);
  // An owner's to-dos up their pillar, one above the other.
  const ann = l.nodes.filter((n) => n.owner === 'ann');
  assert.equal(new Set(ann.map((n) => n.a)).size, 1);
  assert.deepEqual(ann.map((n) => n.z), [64, 64 + ORBIT.step]);
  // Too many: as many as fit, and how many more.
  const many = `## A (1m)\n\n${Array.from({ length: 30 }, (_, i) => `> [!question] Q${i}?`).join('\n\n')}\n`;
  const m = orbitLayout(wallOf(many), agendaOf(many));
  assert.equal(m.nodes.length, ORBIT_MAX.question);
  assert.deepEqual(m.more, [{ kind: 'question', n: 30 - ORBIT_MAX.question }]);
  // No agenda: one sector.
  assert.equal(orbitLayout(wallOf('> [!decision] X\n'), []).sectors.length, 1);
});
