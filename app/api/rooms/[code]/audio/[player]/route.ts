import { playerCues } from '@/lib/scenes';
import { db, files, fail, member, snapshot } from '@/lib/server';
type C = { params: Promise<{ code: string; player: string }> };
export async function PUT(req: Request, { params }: C) {
  const { code, player } = await params;
  const me = await member(req, code);
  if (!me || me.id !== player) return fail('Bu kaydı değiştiremezsin.', 403);
  const room = await snapshot(code);
  if (!room || room.status !== 'recording')
    return fail('Kayıt aşaması sona ermiş.', 409);
  const rawSegment = new URL(req.url).searchParams.get('segment');
  const segment = rawSegment === null ? null : Number(rawSegment);
  const assigned = playerCues(
    room.scene,
    room.players.findIndex((p) => p.id === player),
    room.players.length,
  );
  if (
    segment !== null &&
    (!Number.isInteger(segment) || !assigned.some((c) => c.id === segment))
  )
    return fail('Bu bölüm sana ait değil.', 403);
  const type = req.headers.get('content-type') || '';
  if (!/^audio\/(webm|mp4|ogg|mpeg|wav)(;.*)?$/.test(type))
    return fail('Desteklenmeyen ses biçimi.');
  const length = Number(req.headers.get('content-length'));
  if (length > 5000000) return fail('Kayıt en fazla 5 MB olabilir.', 413);
  const reader = req.body?.getReader();
  if (!reader) return fail('Kayıt boş.');
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 5000000) {
      await reader.cancel();
      return fail('Kayıt en fazla 5 MB olabilir.', 413);
    }
    parts.push(value);
  }
  if (size < 100) return fail('Kayıt boş. Tekrar dene.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  const key =
    segment === null
      ? `${code}/${player}`
      : `${code}/${player}/${segment}/${crypto.randomUUID()}`;
  await files().put(key, bytes, { httpMetadata: { contentType: type } });
  const operations = [];
  if (segment !== null) {
    operations.push(
      db()
        .prepare(
          'INSERT INTO recordings (player,segment,object_key) VALUES (?,?,?) ON CONFLICT(player,segment) DO UPDATE SET object_key = excluded.object_key',
        )
        .bind(player, segment, key),
    );
    operations.push(
      db()
        .prepare(
          'UPDATE players SET audio = ?, ready = 0 WHERE id = ? AND (SELECT COUNT(*) FROM recordings WHERE player = ?) = ?',
        )
        .bind('segments', player, player, assigned.length),
    );
  } else {
    operations.push(
      db()
        .prepare('UPDATE players SET audio = ?, ready = 0 WHERE id = ?')
        .bind(key, player),
    );
  }
  operations.push(
    db()
      .prepare(
        "UPDATE rooms SET status = 'final' WHERE code = ? AND NOT EXISTS (SELECT 1 FROM players WHERE room = ? AND audio IS NULL)",
      )
      .bind(code, code),
  );
  await db().batch(operations);
  return Response.json({ room: await snapshot(code) });
}
export async function GET(req: Request, { params }: C) {
  const { code, player } = await params;
  const me = await member(req, code);
  if (!me) return fail('Oturum gerekli.', 401);
  const room = await snapshot(code);
  if (!room) return fail('Oda bulunamadı.', 404);
  if (room.status !== 'final' && me.id !== player)
    return fail('Diğer sesler finalde açılır.', 403);
  const rawSegment = new URL(req.url).searchParams.get('segment');
  const record =
    rawSegment === null
      ? await db()
          .prepare(
            'SELECT audio AS objectKey FROM players WHERE id = ? AND room = ?',
          )
          .bind(player, code)
          .first<{ objectKey: string }>()
      : await db()
          .prepare(
            'SELECT recordings.object_key AS objectKey FROM recordings INNER JOIN players ON players.id = recordings.player WHERE recordings.player = ? AND recordings.segment = ? AND players.room = ?',
          )
          .bind(player, Number(rawSegment), code)
          .first<{ objectKey: string }>();
  if (!record?.objectKey) return fail('Kayıt bulunamadı.', 404);
  const object = await files().get(record.objectKey);
  if (!object) return fail('Kayıt bulunamadı.', 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'audio/webm',
      'Cache-Control': 'private, no-store',
    },
  });
}
