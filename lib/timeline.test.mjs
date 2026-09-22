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

void test('cues on different character tracks can overlap without blocking movement', () => {
  const multiTrackCues = [
    { id: 1, roleIndex: 0, start: 2, end: 6 }, // Character 1
    { id: 2, roleIndex: 1, start: 3, end: 5 }, // Character 2 (overlaps with Char 1)
  ];
  // Character 2 should be able to move freely through Character 1's time range
  const moved = adjustCueTiming(multiTrackCues, 2, 'move', 3, 5, 2, 10);
  assert.deepEqual(moved, { start: 5, end: 7 });
  assert.equal(hasCueOverlap(multiTrackCues, 2), false); // not considered an overlap because they are on different character tracks
});

