import assert from 'node:assert/strict';
import test from 'node:test';

import { adjustCueTiming, hasCueOverlap } from './timeline.js';

const cues = [
  { id: 1, start: 0, end: 1 },
  { id: 2, start: 2, end: 4 },
  { id: 3, start: 5, end: 6 },
];

void test('resize handles respect neighbouring cues and minimum duration', () => {
  assert.deepEqual(adjustCueTiming(cues, 2, 'start', 2, 4, -5, 10), {
    start: 1,
    end: 4,
  });
  assert.deepEqual(adjustCueTiming(cues, 2, 'end', 2, 4, 5, 10), {
    start: 2,
    end: 5,
  });
  assert.deepEqual(adjustCueTiming(cues, 2, 'start', 2, 4, 3, 10), {
    start: 3.8,
    end: 4,
  });
});

void test('moving a cue preserves duration and clamps it into the available gap', () => {
  assert.deepEqual(adjustCueTiming(cues, 2, 'move', 2, 4, -5, 10), {
    start: 1,
    end: 3,
  });
  assert.deepEqual(adjustCueTiming(cues, 2, 'move', 2, 4, 5, 10), {
    start: 3,
    end: 5,
  });
});

void test('overlap detection only flags intersecting ranges', () => {
  assert.equal(hasCueOverlap(cues, 2), false);
  assert.equal(
    hasCueOverlap([...cues, { id: 4, start: 3.5, end: 4.5 }], 2),
    true,
  );
});

void test('existing overlapping data remains repairable without creating invalid ranges', () => {
  const overlapping = [
    { id: 1, start: 0, end: 3 },
    { id: 2, start: 2, end: 4 },
    { id: 3, start: 3.5, end: 6 },
  ];
  const resized = adjustCueTiming(overlapping, 2, 'start', 2, 4, 1.9, 10);
  assert.ok(resized.start < resized.end);
  assert.ok(resized.end - resized.start >= 0.2);
});
