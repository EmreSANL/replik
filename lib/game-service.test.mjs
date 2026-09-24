import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise the real service against an atomic, in-memory Supabase boundary.
// Concurrent reads intentionally see the same version, as two browsers would.
let row;
let scenes;
let writeError;
let conflicts;
let writes;
let uploads;
const copy = (value) => structuredClone(value);
const supabase = {
  storage: {
    from() {
      return {
        async upload() { uploads++; return { error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: `https://audio.test/${path}` } }; },
      };
    },
  },
  from(table) {
    assert.equal(table, 'game_rooms');
    let patch;
    const filters = [];
    const query = {
      select() { return query; },
      update(value) { patch = copy(value); return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      is(key, value) { filters.push([key, value]); return query; },
      async single() { return { data: copy(row), error: null }; },
      async maybeSingle() {
        if (writeError) return { data: null, error: { message: writeError } };
        const matches = filters.every(([key, value]) => (row[key] ?? null) === value);
        if (!matches) { conflicts++; return { data: null, error: null }; }
        row = { ...row, ...patch };
        writes++;
        return { data: copy(row), error: null };
      },
    };
    return query;
  },
};
globalThis.__gameServiceTest = { supabase, getScenes: async () => copy(scenes) };
const serviceUrl = new URL('./game-service.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === serviceUrl) {
      if (specifier === './supabase') {
        return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
          export const supabase = globalThis.__gameServiceTest.supabase;
          export const getScenesFromSupabase = globalThis.__gameServiceTest.getScenes;
          export const requireAuthenticatedUser = async () => ({ id: 'p0' });
        `) };
      }
      if (specifier === './scenes') return nextResolve(new URL('./scenes.ts', import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { saveAudioRecording, getGameRoom, executeGameRoomAction } = await import(serviceUrl);
const blob = new Blob(['recorded audio'], { type: 'audio/webm' });
const record = (player, segment, url = `https://audio.test/${player}/${segment}`) => ({ player, segment, url });
function setup(playerCount = 2, cueCount = 4) {
  row = {
    code: 'ABCDEF', scene: 42, status: 'recording', max_players: playerCount,
    play_at: 0, created_at: 1, updated_at: '2026-01-01T00:00:00.000Z',
    players: Array.from({ length: playerCount }, (_, index) => ({
      id: `p${index}`, token: `t${index}`, name: `Player ${index}`,
      role: index, host: index === 0 ? 1 : 0, audio: false, ready: 0, segments: [],
    })),
    recordings: [], activities: [], reactions: {},
  };
  scenes = [{
    id: 42, title: 'Test', duration: 10, start: 0, roles: ['A', 'B'], roleDetails: [], prompts: [],
    cues: Array.from({ length: cueCount }, (_, index) => ({
      id: 10 + index * 10, roleIndex: index % 2, roleName: index % 2 ? 'B' : 'A',
      roleColor: '#123456', start: index, end: index + 1, text: `Line ${index}`,
    })),
  }];
}
beforeEach(() => { setup(); writeError = null; conflicts = 0; writes = 0; uploads = 0; });

test('solo: the last cue automatically finishes and is present in the final video inputs', async () => {
  setup(1, 2);
  const first = await saveAudioRecording(' abcdef ', 'p0', 10, blob);
  assert.equal(first.room.status, 'recording');
  const last = await saveAudioRecording('ABCDEF', 'p0', 20, blob);
  assert.equal(last.room.status, 'final');
  assert.deepEqual(last.room.players[0].segments, [10, 20]);
  assert.equal(last.room.recordings.find((r) => r.segment === 20).url, last.url);
  assert.equal(row.status, 'final');
  assert.ok(last.room.playAt > Date.now());
});

test('two simultaneous last cues are both retained and finish without a ready click', async () => {
  row.recordings = [record('p0', 10), record('p1', 20)];
  await Promise.all([
    saveAudioRecording('ABCDEF', 'p0', 30, blob),
    saveAudioRecording('ABCDEF', 'p1', 40, blob),
  ]);
  assert.ok(conflicts > 0, 'the test must reproduce a competing write');
  assert.equal(uploads, 2, 'retry room writes without uploading audio again');
  assert.equal(row.recordings.length, 4);
  assert.equal(row.status, 'final');
  assert.ok(row.players.every((player) => player.ready === 1 && player.audio));
  assert.equal(row.activities.filter((a) => a.type === 'system').length, 1);
});

test('all four players can finish simultaneously, including rooms without an initial version', async () => {
  setup(4, 4);
  scenes[0].roles = ['A'];
  scenes[0].cues.forEach((cue) => { cue.roleIndex = 0; });
  row.updated_at = null;
  await Promise.all(row.players.map((player, index) => saveAudioRecording('ABCDEF', player.id, 10 + index * 10, blob)));
  assert.equal(row.status, 'final');
  assert.equal(row.recordings.length, 4);
  assert.ok(conflicts >= 3);
});

test('polling recovers an already-complete room and does not restart its final countdown', async () => {
  row.recordings = [record('p0', '10'), record('p1', 20), record('p0', 30), record('p1', 40)];
  const final = await getGameRoom('ABCDEF');
  assert.equal(final.status, 'final');
  assert.deepEqual(final.players[0].segments, [10, 30]);
  const again = await getGameRoom('ABCDEF');
  assert.equal(again.playAt, final.playAt);
  assert.equal(writes, 1);
});

test('missing stored audio prevents final even when all ready flags and segment counters say complete', async () => {
  row.recordings = [record('p0', 10), record('p1', 20), record('p0', 30)];
  row.players.forEach((p) => { p.ready = 1; p.audio = true; p.segments = [10, 20, 30, 40]; });
  assert.equal((await getGameRoom('ABCDEF')).status, 'recording');
  assert.equal(writes, 0);
});

test('players with no assigned cues do not block completion', async () => {
  setup(3, 2);
  await saveAudioRecording('ABCDEF', 'p0', 10, blob);
  const result = await saveAudioRecording('ABCDEF', 'p1', 20, blob);
  assert.equal(result.room.status, 'final');
  assert.equal(result.room.players[2].ready, 1);
});

test('a database error rejects the save rather than reporting a phantom final', async () => {
  setup(1, 1);
  writeError = 'write denied';
  await assert.rejects(saveAudioRecording('ABCDEF', 'p0', 10, blob), /write denied/);
  assert.equal(row.status, 'recording');
  assert.equal(row.recordings.length, 0);
});

test('re-recording replaces the earlier take in the final video inputs', async () => {
  row.recordings = [record('p0', 10, 'https://audio.test/old-take')];
  const replacement = await saveAudioRecording('ABCDEF', 'p0', 10, blob);
  await saveAudioRecording('ABCDEF', 'p0', 30, blob);
  await saveAudioRecording('ABCDEF', 'p1', 20, blob);
  const final = await saveAudioRecording('ABCDEF', 'p1', 40, blob);
  assert.equal(final.room.status, 'final');
  const takes = final.room.recordings.filter((r) => r.player === 'p0' && r.segment === 10);
  assert.equal(takes.length, 1);
  assert.equal(takes[0].url, replacement.url);
});

test('a competing ready action cannot overwrite the last uploaded cue or revert final', async () => {
  row.recordings = [record('p0', 10), record('p1', 20), record('p0', 30)];
  await Promise.all([
    saveAudioRecording('ABCDEF', 'p1', 40, blob),
    executeGameRoomAction('ABCDEF', 't0', 'recording_ready', { ready: true }),
  ]);
  assert.equal(row.status, 'final');
  assert.equal(row.recordings.length, 4);
});

test('a missing scene cannot silently use another scene to finish a room', async () => {
  scenes[0].id = 999;
  row.recordings = [record('p0', 10)];
  assert.equal((await getGameRoom('ABCDEF')).status, 'recording');
  await assert.rejects(saveAudioRecording('ABCDEF', 'p0', 30, blob), /Sahne replikleri yüklenemedi/);
});

test('late uploads cannot reopen a completed game', async () => {
  row.status = 'final';
  await assert.rejects(saveAudioRecording('ABCDEF', 'p0', 10, blob), /Kayıt aşaması sona ermiş/);
  assert.equal(row.status, 'final');
  assert.equal(writes, 0);
});
