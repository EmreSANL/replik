import { db, fail, snapshot, logActivity } from '@/lib/server';
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    !b ||
    typeof b.name !== 'string' ||
    !b.name.trim() ||
    b.name.length > 24 ||
    typeof b.scene !== 'number' ||
    !Number.isInteger(b.scene) ||
    b.scene < 0 ||
    b.scene > 99999
  )
    return fail('Bir oyuncu adı ve geçerli sahne seç.');
  const maxPlayers =
    typeof b.maxPlayers === 'number' &&
    Number.isInteger(b.maxPlayers) &&
    b.maxPlayers >= 1 &&
    b.maxPlayers <= 4
      ? b.maxPlayers
      : 4;

  const code = Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32],
  ).join('');
  const id = crypto.randomUUID(),
    token = crypto.randomUUID();
  await db().batch([
    db()
      .prepare(
        'INSERT INTO rooms (code,scene,created_at,max_players) VALUES (?,?,?,?)',
      )
      .bind(code, b.scene, Date.now(), maxPlayers),
    db()
      .prepare(
        'INSERT INTO players (id,room,token,name,host,joined_at) VALUES (?,?,?,?,1,?)',
      )
      .bind(id, code, token, b.name.trim(), Date.now()),
  ]);
  logActivity(
    code,
    `${b.name.trim()} odayı kurdu (${maxPlayers === 1 ? 'Solo Dublaj' : `${maxPlayers} kişilik`}).`,
    'join',
  );
  return Response.json({ room: await snapshot(code), token, id });
}
