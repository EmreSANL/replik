import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink,
  EncodedVideoPacketSource, Input, MP4, WEBM, Mp4OutputFormat, Output, WebMOutputFormat } from 'mediabunny';
import { finalizeVideoContainer } from './video-export-container.ts';

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
