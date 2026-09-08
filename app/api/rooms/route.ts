import { db, fail, snapshot } from '@/lib/server';
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
    b.scene > 2
  )
    return fail('Bir oyuncu adı ve geçerli sahne seç.');
  const code = Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32],
  ).join('');
  const id = crypto.randomUUID(),
    token = crypto.randomUUID();
  await db().batch([
    db()
      .prepare('INSERT INTO rooms (code,scene,created_at) VALUES (?,?,?)')
      .bind(code, b.scene, Date.now()),
    db()
      .prepare(
        'INSERT INTO players (id,room,token,name,host,joined_at) VALUES (?,?,?,?,1,?)',
      )
      .bind(id, code, token, b.name.trim(), Date.now()),
  ]);
  return Response.json({ room: await snapshot(code), token, id });
}
