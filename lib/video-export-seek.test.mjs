import test from 'node:test';
import assert from 'node:assert/strict';
import { seekExportVideo } from './video-export-seek.ts';

test('export waits for the decoded seek rather than a fixed short delay', async () => {
  const video = new EventTarget();
  video.currentTime = 0; video.readyState = 2; video.seeking = false;
  let finished = false;
  const result = seekExportVideo(video, 5).then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(finished, false);
  video.dispatchEvent(new Event('seeked'));
  await result;
});
test('a ready frame at the desired time does not wait for a seek event that will not fire', async () => {
  const video = { currentTime: 5, readyState: 2, seeking: false };
  await seekExportVideo(video, 5);
});
test('a stalled decoder rejects instead of producing stale video frames', async () => {
  const video = new EventTarget(); video.currentTime = 0; video.readyState = 2;
  await assert.rejects(seekExportVideo(video, 3, 10), /Video karesi/);
});
