import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceStereoWav } from './stereo-vocal-reducer.js';

function wav(left, right, channels = 2) {
  const frames = left.length;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(bytes);
  const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, 44100, true);
  view.setUint32(28, 44100 * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * channels * 2, left[i], true);
    if (channels === 2) view.setInt16(46 + i * 4, right[i], true);
  }
  return bytes;
}

test('stereo fallback removes the common center and preserves side content', () => {
  const result = new DataView(reduceStereoWav(wav([3000, 3000], [1000, 3000])));
  assert.equal(result.getInt16(44, true), 1400);
  assert.equal(result.getInt16(46, true), -1400);
  assert.equal(result.getInt16(48, true), 0);
  assert.equal(result.getInt16(50, true), 0);
});

test('stereo fallback rejects mono and effectively mono recordings', () => {
  assert.throws(() => reduceStereoWav(wav([3000], [], 1)), /stereo WAV/);
  assert.throws(() => reduceStereoWav(wav([3000], [3000])), /yeterli fark yok/);
});
