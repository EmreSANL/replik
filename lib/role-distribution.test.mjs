import test from 'node:test';
import assert from 'node:assert/strict';
import { randomPlayerRoles, playerCues } from './scenes.ts';

function scene(roleIndices) {
  return {
    id: 42, title: 'Cast', roles: roleIndices.map(String), roleDetails: [],
    cues: roleIndices.flatMap((roleIndex, index) => Array.from({ length: index + 1 }, (_, line) => ({
      id: index * 10 + line, roleIndex, roleName: String(roleIndex),
      start: index * 10 + line, end: index * 10 + line + 1, text: 'Line',
    }))),
  };
}

test('all six three-player casts are possible regardless of join order', () => {
  const casts = new Set();
  const s = scene([0, 1, 2]);
  for (let first = 0; first < 3; first++) {
    for (let second = 0; second < 2; second++) {
      const draws = [(first + 0.5) / 3, (second + 0.5) / 2];
      const roles = randomPlayerRoles(42, 3, [s], () => draws.shift());
      casts.add(roles.join(','));
      assert.equal(new Set(roles).size, 3);
      roles.forEach((role, player) => {
        assert.ok(playerCues(42, player, 3, [s], roles).every(cue => cue.roleIndex === role));
      });
    }
  }
  assert.equal(casts.size, 6);
  for (let player = 0; player < 3; player++) {
    assert.equal(new Set([...casts].map(cast => cast.split(',')[player])).size, 3);
  }
});

test('extra characters stay whole and every cue has exactly one stable owner', () => {
  const s = scene([2, 7, 10, 15, 19]);
  const roles = randomPlayerRoles(42, 3, [s], () => 0);
  const assigned = roles.map((_, player) => playerCues(42, player, 3, [s], roles));
  assert.deepEqual(assigned.flat().map(cue => cue.id).sort(), s.cues.map(cue => cue.id).sort());
  for (const role of [2, 7, 10, 15, 19]) {
    assert.equal(assigned.filter(cues => cues.some(cue => cue.roleIndex === role)).length, 1);
  }
  roles.forEach((_, player) => assert.deepEqual(playerCues(42, player, 3, [s], roles), assigned[player]));
});

test('solo and scenes with fewer characters retain all cues without duplicates', () => {
  for (const s of [scene([0]), scene([2, 7])]) {
    for (const count of [1, 3]) {
      const roles = randomPlayerRoles(42, count, [s], () => 0);
      assert.equal(roles.length, count);
      assert.equal(new Set(roles).size, count);
      const cues = roles.flatMap((_, player) => playerCues(42, player, count, [s], roles));
      assert.deepEqual(cues.map(cue => cue.id).sort(), s.cues.map(cue => cue.id).sort());
    }
  }
});
