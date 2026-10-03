import test from 'node:test';
import assert from 'node:assert/strict';
import { videoExportFormat, detectVideoExportFormat } from './video-export-format.ts';

test('MP4 recordings keep the MP4 extension and media type', () => {
  assert.deepEqual(videoExportFormat('video/mp4;codecs=avc1,mp4a.40.2'), { extension: 'mp4', contentType: 'video/mp4' });
});
test('WebM recordings are not mislabeled as MP4', () => {
  assert.deepEqual(videoExportFormat('video/webm;codecs=vp8,opus'), { extension: 'webm', contentType: 'video/webm' });
});
test('an unknown export format cannot be published as a video', () => {
  assert.throws(() => videoExportFormat('application/octet-stream'), /video dosyası/);
});
test('an old WebM upload labeled MP4 is recognized from its actual container', async () => {
  const blob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])], { type: 'video/mp4' });
  assert.equal((await detectVideoExportFormat(blob)).extension, 'webm');
});
test('a stored MP4 can be downloaded even when its MIME is generic', async () => {
  const blob = new Blob([new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])]);
  assert.equal((await detectVideoExportFormat(blob)).extension, 'mp4');
});
