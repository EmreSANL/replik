import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

let dbError, uploadError, row, saved, uploads, removed;
const supabase = {
  storage: { from() { return {
    async upload(path, blob, options) { uploads.push({ path, type: options.contentType }); return { data: { path }, error: uploadError }; },
    getPublicUrl(path) { return { data: { publicUrl: `https://video.test/${path}` } }; },
    async remove(paths) { removed.push(...paths); return { error: null }; },
  }; } },
  from(table) {
    if (table === 'published_dubs') return { async upsert(value) { saved = value; return { error: dbError }; } };
    assert.equal(table, 'game_rooms');
    let patch;
    const q = {
      select() { return q; }, eq() { return q; }, is() { return q; },
      update(value) { patch = value; return q; },
      async single() { return { data: structuredClone(row), error: null }; },
      async maybeSingle() { row = { ...row, ...patch }; return { data: structuredClone(row), error: null }; },
    };
    return q;
  },
};
globalThis.__publicationTest = supabase;
const serviceUrl = new URL('./game-service.ts', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === serviceUrl) {
    if (specifier === './supabase') return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
      export const supabase=globalThis.__publicationTest;
      export const requireAuthenticatedUser=async()=>({id:'owner'});
      export const getScenesFromSupabase=async()=>[];
    `) };
    if (specifier === './scenes' || specifier === './video-export-format') return next(new URL(`${specifier}.ts`, import.meta.url).href, context);
  }
  return next(specifier, context);
} });
const { publishRoomDubbingToSupabase } = await import(serviceUrl);
beforeEach(() => {
  dbError = null; uploadError = null; saved = null; uploads = []; removed = [];
  row = { code: 'ABCDEF', scene: 42, status: 'final', updated_at: null, recordings: [{ player: 'p1', segment: 1, url: 'https://voice.test/1' }], players: [] };
});
const publish = (type = 'video/mp4') => publishRoomDubbingToSupabase(row, 'Scene', 'Film', '', 10, [], new Blob(['encoded video'], { type }));

test('feed database failure rejects publication and preserves every original recording', async () => {
  dbError = { message: 'insert denied' };
  await assert.rejects(publish(), /insert denied/);
  assert.equal(row.status, 'final');
  assert.equal(row.recordings.length, 1);
  assert.deepEqual(removed, [uploads[0].path]);
});
test('successful publication retains original audio for playback and later download', async () => {
  const result = await publish();
  assert.equal(row.status, 'published');
  assert.equal(row.recordings[0].player, 'p1');
  assert.equal(row.recordings[1].player, '__published_mp4__');
  assert.equal(saved.video_url, result.videoUrl);
  assert.deepEqual(removed, []);
});
test('WebM fallback uploads as actual WebM and repeat publication uses a stable feed id', async () => {
  await publish('video/webm');
  const firstId = saved.id;
  await publish('video/webm');
  assert.equal(saved.id, firstId);
  assert.equal(uploads[0].type, 'video/webm');
  assert.match(uploads[0].path, /\.webm$/);
  assert.equal(row.recordings.filter(r => r.player === '__published_mp4__').length, 1);
});
test('failed video upload does not create a feed entry or alter the room', async () => {
  uploadError = { message: 'storage denied' };
  await assert.rejects(publish(), /storage denied/);
  assert.equal(saved, null);
  assert.equal(row.status, 'final');
  assert.deepEqual(removed, []);
});
