import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrimRange, formatTrimTime } from './video-trimmer.ts';

test('normalizeTrimRange clamps ranges within valid bounds', () => {
  assert.deepEqual(normalizeTrimRange(5, 15, 30), { start: 5, end: 15 });
  assert.deepEqual(normalizeTrimRange(-10, 50, 30), { start: 0, end: 30 });
  assert.deepEqual(normalizeTrimRange(20, 10, 30), { start: 20, end: 20 });
  assert.deepEqual(normalizeTrimRange(Number.NaN, Number.NaN, 30), { start: 0, end: 30 });
});

test('formatTrimTime formats seconds as MM:SS.t correctly', () => {
  assert.equal(formatTrimTime(0), '00:00.0');
  assert.equal(formatTrimTime(5.4), '00:05.4');
  assert.equal(formatTrimTime(65.2), '01:05.2');
  assert.equal(formatTrimTime(-1), '00:00.0');
});
