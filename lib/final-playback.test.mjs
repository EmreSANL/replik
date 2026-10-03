import test from 'node:test';
import assert from 'node:assert/strict';
import { startFinalMedia, isPlaybackPermissionError } from './final-playback.ts';

test('automatic playback requests a click without awaiting a blocked resume', async () => {
  const audio = { state: 'suspended', resume() { throw new Error('must not resume'); } };
  const video = { play() { throw new Error('must not play'); } };
  await assert.rejects(startFinalMedia(audio, video, false), { name: 'NotAllowedError' });
});

test('a click invokes resume and muted video play synchronously before resume resolves', async () => {
  const calls = [];
  let resolve;
  const audio = { state: 'suspended', resume() { calls.push('resume'); return new Promise(r => { resolve = r; }); } };
  const video = { muted: false, play() { assert.equal(this.muted, true); calls.push('play'); return Promise.resolve(); } };
  const result = startFinalMedia(audio, video, true);
  assert.deepEqual(calls, ['resume', 'play']);
  audio.state = 'running';
  resolve();
  await result;
});

test('an unresolved resume has a bounded, retryable permission failure', async () => {
  const audio = { state: 'suspended', resume: () => new Promise(() => {}) };
  const video = { play: () => Promise.resolve() };
  await assert.rejects(startFinalMedia(audio, video, true, 10), { name: 'NotAllowedError' });
});

test('video format/load errors are preserved rather than labeled as permissions', async () => {
  const failure = new DOMException('Unsupported video', 'NotSupportedError');
  const audio = { state: 'running' };
  const video = { play: () => Promise.reject(failure) };
  await assert.rejects(startFinalMedia(audio, video, true), error => error === failure);
  assert.equal(isPlaybackPermissionError(failure), false);
  assert.equal(isPlaybackPermissionError(new DOMException('', 'NotAllowedError')), true);
});

test('an already running audio context allows scheduled synchronized playback', async () => {
  let played = false;
  await startFinalMedia({ state: 'running' }, { play() { played = true; return Promise.resolve(); } }, false);
  assert.equal(played, true);
});
