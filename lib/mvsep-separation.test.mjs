import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { separationKey } from './dialogue-separation.ts';

const mvsepUrl = new URL('./mvsep-separation.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === mvsepUrl && (specifier === './dialogue-separation' || specifier === './wav-mix')) {
      return nextResolve(new URL(specifier + '.ts', import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { prepareMvsepBackground } = await import('./mvsep-separation.ts');

const source = 'https://project.supabase.co/storage/v1/object/public/videos/uploads/user/clip.mp4';
const finalFiles = [
  { download: 'Music.wav', url: 'https://de.mvsep.com/files/music.wav' },
  { download: 'Effects.wav', url: 'https://de.mvsep.com/files/effects.wav' },
];

function wav(sample) {
  const bytes = new ArrayBuffer(46);
  const view = new DataView(bytes);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }
  view.setUint32(4, 38, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, 2, true);
  view.setInt16(44, sample, true);
  return bytes;
}

function fixture() {
  const jobs = new Map();
  const calls = [];
  let remoteReady = false;
  let separationReady = false;
  const store = {
    async read(path) { return structuredClone(jobs.get(path) ?? null); },
    async create(path, job) {
      if (jobs.has(path)) return false;
      jobs.set(path, structuredClone(job));
      return true;
    },
    async write(path, job) { jobs.set(path, structuredClone(job)); },
    async saveAudio(path, audio) {
      assert.match(path, /instrumentals/);
      assert.equal(audio.type, 'audio/wav');
      return 'https://project.supabase.co/storage/v1/object/public/videos/instrumentals/ready.wav';
    },
  };
  const fetcher = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/separation/create')) {
      assert.equal(init.body.get('url'), source);
      return Response.json({ success: true, data: { hash: 'remote-1' } });
    }
    if (url.includes('/separation/get-remote?')) {
      return Response.json(remoteReady
        ? { success: true, status: 'done', data: { hash: 'file-1' } }
        : { success: true, status: 'processing', data: {} });
    }
    if (url.includes('/separation/get?')) {
      assert.match(url, /hash=file-1$/);
      return Response.json(separationReady
        ? { success: true, status: 'done', data: { files: finalFiles } }
        : { success: true, status: 'waiting', data: {} });
    }
    if (url === finalFiles[0].url) return new Response(wav(1000));
    if (url === finalFiles[1].url) return new Response(wav(2000));
    throw new Error(`Unexpected request: ${url}`);
  };
  return {
    jobs, calls,
    remoteReady: () => { remoteReady = true; },
    separationReady: () => { separationReady = true; },
    run: (options = {}) => prepareMvsepBackground({ source, userId: 'user', apiKey: 'secret', store, fetcher, ...options }),
  };
}

test('a video URL completes its remote download before polling the separation hash', async () => {
  const f = fixture();
  assert.equal((await f.run()).status, 'processing');
  assert.equal((await f.run()).status, 'processing');
  f.remoteReady();
  assert.equal((await f.run()).status, 'processing');
  f.separationReady();
  const ready = await f.run();
  assert.equal(ready.status, 'ready');
  assert.match(ready.instrumentalUrl, /ready\.wav$/);
  assert.equal(f.calls.filter((url) => url.endsWith('/separation/create')).length, 1);
  assert.equal(f.calls.filter((url) => url.includes('/separation/get?hash=remote-1')).length, 0);
});

test('an already failed job with the old remote hash is resumed without a second submission', async () => {
  const f = fixture();
  const base = await separationKey(source, 'user', 'mvsep-dnr-v3-scnet-v1');
  f.jobs.set(`${base}/0.json`, {
    status: 'failed', createdAt: Date.now(), taskId: 'remote-1', retryable: true,
    error: 'File or File Hash not found',
  });
  f.remoteReady();
  const job = await f.run();
  assert.equal(job.status, 'processing');
  assert.equal(job.remoteTaskId, 'remote-1');
  assert.equal(job.taskId, 'file-1');
  assert.equal(f.calls.filter((url) => url.endsWith('/separation/create')).length, 0);
});

test('MVSEP validation errors explain a rejected submission without exposing credentials', async () => {
  const f = fixture();
  const fetcher = async () => Response.json({
    success: false, errors: ['File exceeds the 100 MB free limit', `api_token: secret`],
  }, { status: 400 });
  const failed = await f.run({ fetcher });
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /100 MB free limit/);
  assert.doesNotMatch(failed.error, /secret/);
});

test('a video over the free plan limit is rejected before creating an MVSEP job', async () => {
  const f = fixture();
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push(url);
    assert.equal(init.method, 'HEAD');
    return new Response(null, { headers: { 'content-length': String(101 * 1024 * 1024) } });
  };
  const failed = await f.run({ fetcher });
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /100 MB/);
  assert.deepEqual(requests, [source]);
});
