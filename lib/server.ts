import type { Room, Player } from './scenes';
import { env } from 'cloudflare:workers';
export function db() {
  return env.DB;
}
export function files() {
  return (env as unknown as { FILES: R2Bucket }).FILES;
}
export function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
export async function member(req: Request, code: string) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  return db()
    .prepare('SELECT * FROM players WHERE room = ? AND token = ?')
    .bind(code, token)
    .first<{
      id: string;
      room: string;
      host: number;
      audio: string | null;
      role: number;
    }>();
}
export async function snapshot(code: string) {
  const r = await db()
    .prepare(
      'SELECT code,scene,status,play_at AS playAt FROM rooms WHERE code = ? AND created_at > ?',
    )
    .bind(code, Date.now() - 86400000)
    .first<Omit<Room, 'players' | 'serverNow'>>();
  if (!r) return null;
  const ps = await db()
    .prepare(
      'SELECT id,name,host,role,ready,audio FROM players WHERE room = ? ORDER BY joined_at,id',
    )
    .bind(code)
    .all<Omit<Player, 'audio'> & { audio: string | null }>();
  return {
    ...r,
    serverNow: Date.now(),
    players: ps.results.map((p) => ({ ...p, audio: !!p.audio })),
  };
}
