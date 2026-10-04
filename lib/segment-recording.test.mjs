import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentRecordingProgress } from './segment-recording.ts';

test('a paused scene does not end the take; the recording clock covers the full cue', () => {
  assert.deepEqual(segmentRecordingProgress(2.9, 6.9, 0), { position: 2.9, fraction: 0, complete: false });
  assert.deepEqual(segmentRecordingProgress(2.9, 6.9, 2), { position: 4.9, fraction: 0.5, complete: false });
  assert.equal(segmentRecordingProgress(2.9, 6.9, 3.99).complete, false);
  assert.deepEqual(segmentRecordingProgress(2.9, 6.9, 4), { position: 6.9, fraction: 1, complete: true });
});

test('timer delays clamp at cue end and very short cues preserve the minimum take length', () => {
  assert.deepEqual(segmentRecordingProgress(5, 8, 9), { position: 8, fraction: 1, complete: true });
  assert.equal(segmentRecordingProgress(5, 5.1, 0.1).complete, false);
  assert.equal(segmentRecordingProgress(5, 5.1, 0.25).complete, true);
});
