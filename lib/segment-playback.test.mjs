import test from 'node:test';
import assert from 'node:assert/strict';
import { startSegmentReplay, segmentReplayFinished } from './segment-playback.ts';

test('listening holds the muted video frame and starts only the recorded voice', async () => {
  const video = { currentTime: 12.9, muted: false, paused: false,
    pause() { this.paused = true; }, play() { assert.fail('scene must remain frozen'); } };
  let resolveAudio;
  const audio = { play() { return new Promise(resolve => { resolveAudio = resolve; }); } };
  const started = startSegmentReplay(video, audio);
  assert.equal(video.paused, true);
  assert.equal(video.muted, true);
  assert.equal(video.currentTime, 12.9);
  resolveAudio();
  await started;
});

test('failed voice start stops playback and preserves the failure for retry', async () => {
  const failure = new Error('Voice unavailable');
  const video = { pause() { this.paused = true; } };
  const audio = { play: () => Promise.reject(failure), pause() { this.paused = true; } };
  await assert.rejects(startSegmentReplay(video, audio), error => error === failure);
  assert.equal(video.paused, true);
  assert.equal(audio.paused, true);
});

test('an advancing voice clock does not change the held scene frame or end early', async () => {
  const video = { currentTime: 12.9, ended: true, pause() {}, play() { assert.fail('scene must remain frozen'); } };
  const audio = { currentTime: 0, ended: false, play: () => Promise.resolve() };
  await startSegmentReplay(video, audio);
  for (const time of [0, 1.25, 2.99]) {
    audio.currentTime = time;
    assert.equal(segmentReplayFinished(audio, 3), false);
    assert.equal(video.currentTime, 12.9);
  }
});

test('listening finishes at the cue duration even if the recording file is longer', () => {
  const audio = { currentTime: 3, ended: false };
  assert.equal(segmentReplayFinished(audio, 3), true);
  audio.currentTime = 3.2;
  assert.equal(segmentReplayFinished(audio, 3), true);
});

test('a shorter recording ends listening when its audio ends', () => {
  assert.equal(segmentReplayFinished({ currentTime: 1, ended: true }, 3), true);
});
