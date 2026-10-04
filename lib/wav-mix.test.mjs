import test from 'node:test';
import assert from 'node:assert/strict';
import { mixPcmWav, decodeMediaAudioBytes } from './wav-mix.ts';

function wav(samples, sampleRate = 44100) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const tag = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

function floatWav(samples) {
  const bytes = wav(Array(samples.length * 2).fill(0));
  const view = new DataView(bytes);
  view.setUint32(4, bytes.byteLength - 8, true);
  view.setUint16(20, 3, true);
  view.setUint32(28, 44100 * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  view.setUint32(40, samples.length * 4, true);
  samples.forEach((sample, index) => view.setFloat32(44 + index * 4, sample, true));
  return bytes;
}

function extensibleWav(samples) {
  const bytes = new ArrayBuffer(68 + samples.length * 2);
  const view = new DataView(bytes);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [60, 'data']]) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }
  view.setUint32(4, bytes.byteLength - 8, true);
  view.setUint32(16, 40, true);
  view.setUint16(20, 0xfffe, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint16(36, 22, true);
  view.setUint16(38, 16, true);
  new Uint8Array(bytes).set([1, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71], 44);
  view.setUint32(64, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(68 + index * 2, sample, true));
  return bytes;
}

test('music and effects are mixed into playable PCM WAV and clipped safely', async () => {
  const result = mixPcmWav(wav([1000, 30000, -30000]), wav([2000, 10000, -10000]));
  const view = new DataView(await result.arrayBuffer());
  assert.equal(result.type, 'audio/wav');
  assert.equal(view.getUint32(40, true), 6);
  assert.deepEqual([0, 1, 2].map((i) => view.getInt16(44 + i * 2, true)), [3000, 32767, -32768]);
});

test('different sample rates cannot produce a synchronized background', () => {
  assert.throws(() => mixPcmWav(wav([1], 44100), wav([1], 48000)), /biçimi veya süresi eşleşmiyor/);
});

test('IEEE float WAV is converted to a playable 16-bit background', async () => {
  const output = mixPcmWav(floatWav([0.5, -1, Number.NaN]), wav([0, 0, 0]));
  const view = new DataView(await output.arrayBuffer());
  assert.deepEqual([0, 1, 2].map((i) => view.getInt16(44 + i * 2, true)), [16384, -32768, 0]);
});

test('WAVE_FORMAT_EXTENSIBLE with PCM subtype is accepted', async () => {
  const output = mixPcmWav(extensibleWav([1000, -1000]), wav([500, 500]));
  const view = new DataView(await output.arrayBuffer());
  assert.deepEqual([0, 1].map((i) => view.getInt16(44 + i * 2, true)), [1500, -500]);
});

function rejectingDecoder() {
  return {
    async decodeAudioData() { throw new DOMException('Unable to decode audio data', 'EncodingError'); },
    createBuffer(channels, frames, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      return { sampleRate: rate, length: frames, numberOfChannels: channels, getChannelData: c => data[c] };
    },
  };
}

test('valid WAV still loads when the browser decoder rejects it with EncodingError', async () => {
  const buffer = await decodeMediaAudioBytes(wav([0, 16384, -32768]), rejectingDecoder());
  assert.equal(buffer.sampleRate, 44100);
  assert.deepEqual(Array.from(buffer.getChannelData(0)), [0, 0.5, -1]);
});
test('PCM fallback preserves stereo channel order and exact scene length', async () => {
  const bytes = wav([32767, -32768, 16384, -16384]);
  const view = new DataView(bytes);
  view.setUint16(22, 2, true); view.setUint32(28, 176400, true); view.setUint16(32, 4, true);
  const buffer = await decodeMediaAudioBytes(bytes, rejectingDecoder());
  assert.equal(buffer.length, 2);
  assert.deepEqual(Array.from(buffer.getChannelData(0)), [32767 / 32768, 0.5]);
  assert.deepEqual(Array.from(buffer.getChannelData(1)), [-1, -0.5]);
});
test('successful native decoding is preserved', async () => {
  const expected = { length: 10 };
  assert.equal(await decodeMediaAudioBytes(new ArrayBuffer(4), { decodeAudioData: async () => expected }), expected);
});
test('invalid non-WAV media retains its native decoding error', async () => {
  await assert.rejects(decodeMediaAudioBytes(new ArrayBuffer(16), rejectingDecoder()), { name: 'EncodingError' });
});
test('truncated WAV is not accepted by the fallback', async () => {
  await assert.rejects(decodeMediaAudioBytes(wav([1, 2]).slice(0, 45), rejectingDecoder()), /WAV dosyası eksik/);
});
