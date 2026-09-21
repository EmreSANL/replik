import {
  db,
  fail,
  member,
  snapshot,
  logActivity,
  markMicTested,
  recordReaction,
  resetRoomState,
} from '@/lib/server';

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
        "INSERT INTO players (id,room,token,name,joined_at) SELECT ?,?,?,?,? WHERE (SELECT status FROM rooms WHERE code = ?) = 'lobby' AND (SELECT COUNT(*) FROM players WHERE room = ?) < (SELECT COALESCE(max_players, 4) FROM rooms WHERE code = ?)",
      )
      .bind(id, code, token, b.name.trim(), Date.now(), code, code, code)
      .run();
    if (!result.meta.changes)
      return fail(
        `Oda dolu (Maksimum ${room.maxPlayers || 4} oyuncu) veya oyun başlamış.`,
        409,
      );
    logActivity(code, `${b.name.trim()} odaya katıldı.`, 'join');
    return Response.json({ room: await snapshot(code), token, id });
  }

  const me = await member(req, code);
  if (!me) return fail('Oturum bulunamadı.', 401);

  if (b.action === 'ready') {
    if (room.status !== 'lobby' && room.status !== 'final')
      return fail('Bu aşamada hazır durumu değişmez.');
    const readyVal = b.ready ? 1 : 0;
    await db()
      .prepare('UPDATE players SET ready = ? WHERE id = ?')
      .bind(readyVal, me.id)
      .run();
    logActivity(
      code,
      `${me.name} ${readyVal ? 'hazır olduğunu bildirdi.' : 'hazırlığını geri aldı.'}`,
      'ready',
    );
  } else if (b.action === 'mic_tested') {
    markMicTested(code, me.id);
    logActivity(code, `${me.name} mikrofon testini tamamladı.`, 'ready');
  } else if (b.action === 'change_scene') {
    if (!me.host) return fail('Sahneyi yalnızca oda kurucusu değiştirebilir.', 403);
    if (room.status !== 'lobby') return fail('Oyun başladıktan sonra sahne değiştirilemez.', 409);
    const sceneId = Number(b.scene);
    if (!Number.isInteger(sceneId) || sceneId < 0 || sceneId > Number.MAX_SAFE_INTEGER) {
      return fail('Geçersiz sahne seçimi.');
    }
    await db()
      .prepare('UPDATE rooms SET scene = ? WHERE code = ?')
      .bind(sceneId, code)
      .run();
    const title = typeof b.title === 'string' ? b.title : `Sahne #${sceneId}`;
    logActivity(code, `Sahne "${title}" olarak değiştirildi.`, 'system');
  } else if (b.action === 'set_role') {
    if (room.status !== 'lobby') return fail('Roller yalnızca lobide seçilebilir.', 409);
    const roleId = Number(b.role);
    if (!Number.isInteger(roleId) || roleId < 0 || roleId > 10) {
      return fail('Geçersiz rol seçimi.');
    }
    await db()
      .prepare('UPDATE players SET role = ? WHERE id = ?')
      .bind(roleId, me.id)
      .run();
    logActivity(code, `${me.name} ${roleId + 1}. Karakter rolünü seçti.`, 'ready');
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
          .bind(roles[i % 4], p.id),
      ),
    );
    logActivity(code, 'Kayıt aşaması başladı! Sahneye çıkın!', 'system');
  } else if (b.action === 'play') {
    if (!me.host) return fail('Finali oda kurucusu başlatabilir.', 403);
    if (room.status !== 'final')
      return fail('Final henüz başlamadı.', 409);
    await db()
      .prepare('UPDATE rooms SET play_at = ? WHERE code = ?')
      .bind(Date.now() + 3500, code)
      .run();
    logActivity(code, 'Büyük final başladı! Birlikte izleniyor...', 'system');
  } else if (b.action === 'reaction') {
    const emoji = typeof b.emoji === 'string' ? b.emoji : '😂';
    recordReaction(code, emoji);
  } else if (b.action === 'restart') {
    if (!me.host) return fail('Yeni turu yalnızca oda kurucusu başlatabilir.', 403);
    const newScene = typeof b.scene === 'number' && b.scene >= 0 ? b.scene : room.scene;
    await db().batch([
      db().prepare('DELETE FROM recordings WHERE player IN (SELECT id FROM players WHERE room = ?)').bind(code),
      db().prepare('UPDATE players SET audio = NULL, ready = 0, role = -1 WHERE room = ?').bind(code),
      db().prepare("UPDATE rooms SET status = 'lobby', play_at = 0, scene = ? WHERE code = ?").bind(newScene, code),
    ]);
    resetRoomState(code);
    logActivity(code, 'Yeni tur için lobiye dönüldü.', 'system');
  } else return fail('Geçersiz işlem.');

  return Response.json({ room: await snapshot(code) });
}
