import test from 'node:test';
import assert from 'node:assert/strict';
import { startSegmentReplay, syncSegmentReplay } from './segment-playback.ts';

test('recording replay starts moving muted video together with the recorded voice', async () => {
  const calls = [];
  let resolveVideo;
  const video = { muted: false, play() { assert.equal(this.muted, true); calls.push('video'); return new Promise(resolve => { resolveVideo = resolve; }); } };
  const audio = { play() { calls.push('audio'); return Promise.resolve(); } };
  const started = startSegmentReplay(video, audio);
  assert.deepEqual(calls, ['video', 'audio']);
  resolveVideo();
  await started;
});

test('failed video start also stops the recorded voice and preserves the failure', async () => {
  const failure = new Error('Video unavailable');
  const paused = [];
  const video = { play: () => Promise.reject(failure), pause: () => paused.push('video') };
  const audio = { play: () => Promise.resolve(), pause: () => paused.push('audio') };
  await assert.rejects(startSegmentReplay(video, audio), error => error === failure);
  assert.deepEqual(paused, ['video', 'audio']);
});

test('failed voice start also stops the video', async () => {
  const paused = [];
  const video = { play: () => Promise.resolve(), pause: () => paused.push('video') };
  const audio = { play: () => Promise.reject(new Error('Voice unavailable')), pause: () => paused.push('audio') };
  await assert.rejects(startSegmentReplay(video, audio), /Voice unavailable/);
  assert.deepEqual(paused, ['video', 'audio']);
});

test('replay corrects video drift using scene and cue offsets without interrupting an active seek', () => {
  const video = { currentTime: 10, ended: false, seeking: false };
  const audio = { currentTime: 1.25, ended: false };
  assert.equal(syncSegmentReplay(video, audio, 12, 3), false);
  assert.equal(video.currentTime, 13.25);
  video.seeking = true;
  audio.currentTime = 2;
  syncSegmentReplay(video, audio, 12, 3);
  assert.equal(video.currentTime, 13.25);
});

test('replay finishes when either media ends or the cue duration is reached', () => {
  const video = { currentTime: 13, ended: false, seeking: false };
  const audio = { currentTime: 3, ended: false };
  assert.equal(syncSegmentReplay(video, audio, 10, 3), true);
  audio.currentTime = 1;
  audio.ended = true;
  assert.equal(syncSegmentReplay(video, audio, 10, 3), true);
  audio.ended = false;
  video.ended = true;
  assert.equal(syncSegmentReplay(video, audio, 10, 3), true);
});
