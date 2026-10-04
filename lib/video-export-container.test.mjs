import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink,
  EncodedVideoPacketSource, Input, MP4, WEBM, Mp4OutputFormat, Output, WebMOutputFormat } from 'mediabunny';
import { finalizeVideoContainer } from './video-export-container.ts';
const publishedModule = new URL('./published-video.ts', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === publishedModule && specifier === './video-export-container') {
    return next(new URL('./video-export-container.ts', import.meta.url).href, context);
  }
  return next(specifier, context);
} });
const { preparePublishedVideo } = await import(publishedModule);
const nativeFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = nativeFetch; });

async function fixture(webm = false) {
  const target = new BufferTarget();
  const format = webm ? new WebMOutputFormat({ live: true }) : new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 });
  const output = new Output({ format, target });
  const video = new EncodedVideoPacketSource(webm ? 'vp8' : 'avc');
  const audio = new EncodedAudioPacketSource(webm ? 'opus' : 'aac');
  output.addVideoTrack(video); output.addAudioTrack(audio);
  await output.start();
  const videoConfig = { codec: webm ? 'vp8' : 'avc1.42c01f', codedWidth: webm ? 320 : 478, codedHeight: webm ? 240 : 360,
    ...(webm ? {} : { description: new Uint8Array(Buffer.from('0142c01fffe100126742c01f8c681e0bfa966a0202020f08846a01000468ce3c80', 'hex')) }) };
  const audioConfig = { codec: webm ? 'opus' : 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2,
    ...(webm ? {} : { description: new Uint8Array([0x11,0x90]) }) };
  // Synthetic encoded packets are enough to exercise container indices without a browser encoder.
  await Promise.all([
    (async () => {
      for (let i=0;i<20;i++) await video.add(new EncodedPacket(new Uint8Array([0,0,0,3,i%5===0?0x65:0x41,i,0]), i%5===0?'key':'delta', i, 1), { decoderConfig: videoConfig });
      video.close();
    })(),
    (async () => {
      for (let i=0;i<40;i++) await audio.add(new EncodedPacket(new Uint8Array([0x21,i]), 'key', i/2, 0.5), { decoderConfig: audioConfig });
      audio.close();
    })(),
  ]);
  await output.finalize();
  return new Blob([target.buffer], { type: format.mimeType });
}

async function inspect(blob) {
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, WEBM] });
  try {
    const tracks = [];
    for (const track of await input.getTracks()) {
      const packets = [];
      for await (const packet of new EncodedPacketSink(track).packets()) packets.push({ time: packet.timestamp, duration: packet.duration, type: packet.type, bytes: [...packet.data] });
      const keyAt15 = await new EncodedPacketSink(track).getKeyPacket(15);
      tracks.push({ codec: await track.getCodec(), packets, keyAt15: keyAt15?.timestamp });
    }
    return { duration: await input.getDurationFromMetadata(), actualDuration: await input.computeDuration(), tracks };
  } finally { input.dispose(); }
}

test('fragmented MP4 is finalized with finite duration and seek tables while keeping encoded audio/video', async () => {
  const original = await fixture();
  const before = await inspect(original);
  const finalized = await finalizeVideoContainer(original);
  const after = await inspect(finalized);
  assert.equal(finalized.type, 'video/mp4');
  assert.equal(after.duration, 20);
  assert.equal(after.actualDuration, 20);
  assert.deepEqual(after.tracks, before.tracks);
  const bytes = Buffer.from(await finalized.arrayBuffer());
  assert.equal(bytes.includes(Buffer.from('moof')), false);
  assert.equal(bytes.includes(Buffer.from('stss')), true);
  assert.ok(bytes.indexOf('moov') < bytes.indexOf('mdat'));
});

test('streaming WebM gains duration and cues without changing encoded media or its format', async () => {
  const original = await fixture(true);
  const before = await inspect(original);
  const finalized = await finalizeVideoContainer(original);
  const after = await inspect(finalized);
  assert.equal(finalized.type, 'video/webm');
  assert.equal(after.duration, before.actualDuration);
  assert.deepEqual(after.tracks, before.tracks);
});

test('invalid recorder output is rejected rather than offered as a working download', async () => {
  await assert.rejects(finalizeVideoContainer(new Blob(['not a video'])));
});

test('feed playback prepares the same indexed bytes that the browser saves from its video source', async () => {
  const original = await fixture();
  globalThis.fetch = async () => new Response(original);
  const prepared = await preparePublishedVideo('https://media.example/old.mp4');
  const result = await inspect(prepared);
  assert.equal(result.duration, 20);
  assert.equal(result.tracks[0].packets.length, 20);
  assert.equal(Buffer.from(await prepared.arrayBuffer()).includes(Buffer.from('moof')), false);
});

test('feed preparation recovers a CORS failure through the existing media proxy', async () => {
  const original = await fixture();
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); if (calls.length === 1) throw new TypeError('CORS'); return new Response(original); };
  const result = await preparePublishedVideo('https://media.example/old.mp4');
  assert.equal((await inspect(result)).duration, 20);
  assert.deepEqual(calls, ['https://media.example/old.mp4', '/api/video-proxy?url=https%3A%2F%2Fmedia.example%2Fold.mp4']);
});

test('moving away from a feed clip aborts its preparation without starting a proxy request', async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; controller.abort(); throw new DOMException('Cancelled', 'AbortError'); };
  await assert.rejects(preparePublishedVideo('https://media.example/old.mp4', controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('a feed preparation error remains retryable and cannot expose an HTML error page as video', async () => {
  globalThis.fetch = async () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(preparePublishedVideo('https://media.example/old.mp4'), /hata sayfası/);
  const original = await fixture();
  globalThis.fetch = async () => new Response(original);
  assert.equal((await inspect(await preparePublishedVideo('https://media.example/old.mp4'))).duration, 20);
});
