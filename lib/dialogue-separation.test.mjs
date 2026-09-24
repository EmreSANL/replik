import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDialogueBackground, validateSeparationSource } from './dialogue-separation.ts';

const source = 'https://project.supabase.co/storage/v1/object/public/videos/uploads/user/clip.mp4';
function wav() {
  const bytes = new Uint8Array(100);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WAVE'), 8);
  return new Blob([bytes], { type: 'audio/wav' });
}
function fixture() {
  const jobs = new Map();
  let starts = 0;
  let polls = 0;
  let audioWrites = 0;
  let complete = false;
  let failed = false;
  let failStorage = false;
  let invalidAudio = false;
  const store = {
    async read(path) { return jobs.has(path) ? structuredClone(jobs.get(path)) : null; },
    async create(path, job) {
      if (jobs.has(path)) return false;
      jobs.set(path, structuredClone(job));
      return true;
    },
    async write(path, job) { jobs.set(path, structuredClone(job)); },
    async saveAudio() {
      audioWrites++;
      if (failStorage) throw new Error('storage unavailable');
      return 'https://project.supabase.co/storage/v1/object/public/videos/instrumentals/prepared.wav';
    },
  };
  const fetcher = async (url, init) => {
    if (init?.method === 'POST') {
      starts++;
      assert.deepEqual(JSON.parse(init.body), { url: source, targets: [{ model: 'music_fx', formats: ['wav'] }] });
      assert.equal(init.headers['x-api-key'], 'server-key');
      return Response.json({ id: 'task-' + starts });
    }
    if (url.startsWith('https://api.audioshake.ai/tasks/')) {
      polls++;
      return Response.json({ id: 'task-1', targets: [{ model: 'music_fx', status: failed ? 'error' : complete ? 'completed' : 'processing', output: [{ link: 'https://provider.test/result.wav' }] }] });
    }
    assert.equal(url, 'https://provider.test/result.wav');
    assert.equal(init.headers, undefined, 'API key is never forwarded to external output hosts');
    return new Response(invalidAudio ? '<html>error</html>' : wav());
  };
  return {
    run: (options = {}) => prepareDialogueBackground({ source, userId: 'user', apiKey: 'server-key', store, fetcher, ...options }),
    complete: () => { complete = true; }, fail: () => { failed = true; }, invalidAudio: () => { invalidAudio = true; },
    breakStorage: () => { failStorage = true; }, restoreStorage: () => { failStorage = false; },
    counts: () => ({ starts, polls, audioWrites }), jobs,
  };
}

test('reloading the editor reuses an in-progress task and then its permanent audio', async () => {
  const f = fixture();
  assert.equal((await f.run()).status, 'processing');
  assert.equal((await f.run()).status, 'processing');
  f.complete();
  const ready = await f.run();
  assert.equal(ready.status, 'ready');
  assert.match(ready.instrumentalUrl, /project.supabase.co/);
  assert.deepEqual(await f.run(), ready);
  assert.deepEqual(f.counts(), { starts: 1, polls: 2, audioWrites: 1 });
});

test('simultaneous requests only start one separation task', async () => {
  const f = fixture();
  await Promise.all([f.run(), f.run(), f.run()]);
  assert.equal(f.counts().starts, 1);
});

test('storage failure never marks a scene ready and retry does not rerun the model', async () => {
  const f = fixture();
  await f.run();
  f.complete(); f.breakStorage();
  await assert.rejects(f.run(), /storage unavailable/);
  assert.equal([...f.jobs.values()][0].status, 'processing');
  f.restoreStorage();
  assert.equal((await f.run()).status, 'ready');
  assert.equal(f.counts().starts, 1);
});

test('a failed model is visible and only an explicit retry starts another task', async () => {
  const f = fixture();
  await f.run(); f.fail();
  assert.equal((await f.run()).status, 'failed');
  assert.equal((await f.run()).status, 'failed');
  assert.equal(f.counts().starts, 1);
  assert.equal((await f.run({ retry: true })).status, 'processing');
  assert.equal(f.counts().starts, 2);
});

test('invalid provider output is rejected without marking audio ready', async () => {
  const f = fixture();
  await f.run(); f.complete(); f.invalidAudio();
  await assert.rejects(f.run(), /WAV/);
  assert.equal(f.counts().audioWrites, 0);
});

test('missing configuration fails explicitly without creating an unusable reservation', async () => {
  const f = fixture();
  await assert.rejects(f.run({ apiKey: undefined }), /yapılandırılmadı/);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.counts().starts, 0);
});

test('an uncertain task submission is not automatically submitted again', async () => {
  const f = fixture();
  await assert.rejects(f.run({ fetcher: async () => { throw new Error('network timeout'); }, now: () => 1 }), /doğrulanamadı/);
  const job = await f.run({ retry: true, now: () => 200000 });
  assert.equal(job.status, 'failed');
  assert.equal(job.retryable, false);
  assert.equal(f.counts().starts, 0);
});

test('changing the source video requires a new background', async () => {
  const f = fixture();
  await f.run(); f.complete(); await f.run();
  const job = await f.run({ source: source.replace('clip.mp4', 'replacement.mp4'), fetcher: async () => Response.json({ id: 'replacement' }) });
  assert.equal(job.status, 'processing');
  assert.equal(f.jobs.size, 2);
});

test('only public uploads from the configured media store are accepted', () => {
  assert.equal(validateSeparationSource(source, 'https://project.supabase.co'), source);
  for (const bad of ['http://localhost:3000', 'https://evil.test/file.mp4', source.replace('/uploads/', '/audio-jobs/'), source + '?override=1']) {
    assert.throws(() => validateSeparationSource(bad, 'https://project.supabase.co'));
  }
});

test('the local cinematic worker uses the same durable flow and authenticates its output request', async () => {
  const f = fixture();
  const options = { engine: 'cinematic-cdx23-ensemble-v1', apiBase: 'http://127.0.0.1:8011', fetcher: async (url, init) => {
    assert.equal(init.headers['x-api-key'], 'server-key');
    if (init.method === 'POST') return Response.json({ id: 'local' });
    if (url.endsWith('/tasks/local')) return Response.json({ targets: [{ model: 'music_fx', status: 'completed', output: [{ link: 'http://127.0.0.1:8011/outputs/local.wav' }] }] });
    assert.equal(url, 'http://127.0.0.1:8011/outputs/local.wav');
    return new Response(wav());
  } };
  assert.equal((await f.run(options)).status, 'processing');
  assert.equal((await f.run(options)).status, 'ready');
});
