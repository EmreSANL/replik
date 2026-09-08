import { db, files, fail, member, snapshot } from '@/lib/server';
type C = { params: Promise<{ code: string; player: string }> };
export async function PUT(req: Request, { params }: C) {
  const { code, player } = await params;
  const me = await member(req, code);
  if (!me || me.id !== player) return fail('Bu kaydı değiştiremezsin.', 403);
  const room = await snapshot(code);
  if (!room || room.status !== 'recording')
    return fail('Kayıt aşaması sona ermiş.', 409);
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
  const key = `${code}/${player}`;
  await files().put(key, bytes, { httpMetadata: { contentType: type } });
  await db().batch([
    db()
      .prepare('UPDATE players SET audio = ?, ready = 0 WHERE id = ?')
      .bind(key, player),
    db()
      .prepare(
        "UPDATE rooms SET status = 'final' WHERE code = ? AND NOT EXISTS (SELECT 1 FROM players WHERE room = ? AND audio IS NULL)",
      )
      .bind(code, code),
  ]);
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
  const record = await db()
    .prepare('SELECT audio FROM players WHERE id = ? AND room = ?')
    .bind(player, code)
    .first<{ audio: string }>();
  if (!record?.audio) return fail('Kayıt bulunamadı.', 404);
  const object = await files().get(record.audio);
  if (!object) return fail('Kayıt bulunamadı.', 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'audio/webm',
      'Cache-Control': 'private, no-store',
    },
  });
}
