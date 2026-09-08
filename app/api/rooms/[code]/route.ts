import { db, fail, member, snapshot } from '@/lib/server';
type C = { params: Promise<{ code: string }> };
export async function GET(req: Request, { params }: C) {
  const { code } = await params;
  if (!(await member(req, code)))
    return fail('Bu odaya tekrar katılmalısın.', 401);
  const room = await snapshot(code);
  return room
    ? Response.json({ room }, { headers: { 'Cache-Control': 'no-store' } })
    : fail('Odanın süresi dolmuş.', 404);
}
export async function POST(req: Request, { params }: C) {
  const { code } = await params;
  const b = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!b) return fail('İstek okunamadı.');
  const room = await snapshot(code);
  if (!room) return fail('Bu kodla bir oda bulunamadı. Kodu kontrol et.', 404);
  if (b.action === 'join') {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 24)
      return fail('1–24 karakterlik bir oyuncu adı yaz.');
    const id = crypto.randomUUID(),
      token = crypto.randomUUID();
    const result = await db()
      .prepare(
        "INSERT INTO players (id,room,token,name,joined_at) SELECT ?,?,?,?,? WHERE (SELECT status FROM rooms WHERE code = ?) = 'lobby' AND (SELECT COUNT(*) FROM players WHERE room = ?) < 4",
      )
      .bind(id, code, token, b.name.trim(), Date.now(), code, code)
      .run();
    if (!result.meta.changes)
      return fail(
        'Oda dolu veya oyun başlamış. Yeni bir oda kurabilirsin.',
        409,
      );
    return Response.json({ room: await snapshot(code), token, id });
  }
  const me = await member(req, code);
  if (!me) return fail('Oturum bulunamadı.', 401);
  if (b.action === 'ready') {
    if (room.status !== 'lobby' && room.status !== 'final')
      return fail('Bu aşamada hazır durumu değişmez.');
    await db()
      .prepare('UPDATE players SET ready = ? WHERE id = ?')
      .bind(b.ready ? 1 : 0, me.id)
      .run();
  } else if (b.action === 'start') {
    if (!me.host) return fail('Oyunu oda kurucusu başlatabilir.', 403);
    if (room.status !== 'lobby') return fail('Oyun zaten başlamış.', 409);
    const lock = await db()
      .prepare(
        "UPDATE rooms SET status = 'recording' WHERE code = ? AND status = 'lobby' AND NOT EXISTS (SELECT 1 FROM players WHERE room = ? AND ready = 0)",
      )
      .bind(code, code)
      .run();
    if (!lock.meta.changes)
      return fail('Başlamadan önce herkes hazır olmalı.', 409);
    const ps = (await snapshot(code))!.players;
    const roles = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    await db().batch(
      ps.map((p, i) =>
        db()
          .prepare(
            'UPDATE players SET role = ?, ready = 0 WHERE id = ? AND role = -1',
          )
          .bind(roles[i], p.id),
      ),
    );
  } else if (b.action === 'play') {
    if (!me.host) return fail('Finali oda kurucusu başlatabilir.', 403);
    if (room.status !== 'final' || !room.players.every((p) => p.ready))
      return fail('Herkes önce final için hazır olmalı.', 409);
    await db()
      .prepare('UPDATE rooms SET play_at = ? WHERE code = ?')
      .bind(Date.now() + 5000, code)
      .run();
  } else return fail('Geçersiz işlem.');
  return Response.json({ room: await snapshot(code) });
}
