import type { Room, Player, ActivityItem } from './scenes';
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

type RoomMeta = {
  reactions: Record<string, number>;
  activities: ActivityItem[];
  micTested: Set<string>;
};

const roomMetaStore = new Map<string, RoomMeta>();

export function getRoomMeta(code: string): RoomMeta {
  let m = roomMetaStore.get(code);
  if (!m) {
    m = {
      reactions: { '😂': 0, '🔥': 0, '👏': 0, '❤️': 0 },
      activities: [],
      micTested: new Set(),
    };
    roomMetaStore.set(code, m);
  }
  return m;
}

export function logActivity(
  code: string,
  text: string,
  type: ActivityItem['type'] = 'system',
) {
  const m = getRoomMeta(code);
  m.activities.unshift({
    id: crypto.randomUUID(),
    text,
    time: Date.now(),
    type,
  });
  if (m.activities.length > 25) m.activities.length = 25;
}

export function recordReaction(code: string, emoji: string) {
  const m = getRoomMeta(code);
  m.reactions[emoji] = (m.reactions[emoji] || 0) + 1;
}

export function markMicTested(code: string, playerId: string) {
  const m = getRoomMeta(code);
  m.micTested.add(playerId);
}

export function resetRoomState(code: string) {
  const m = getRoomMeta(code);
  m.reactions = { '😂': 0, '🔥': 0, '👏': 0, '❤️': 0 };
  m.micTested.clear();
  logActivity(code, 'Yeni sahne için oyun sıfırlandı. İyi eğlenceler!', 'system');
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
      name: string;
      host: number;
      audio: string | null;
      role: number;
    }>();
}

export async function snapshot(code: string) {
  const r = await db()
    .prepare(
      'SELECT code,scene,status,play_at AS playAt, COALESCE(max_players, 4) AS maxPlayers FROM rooms WHERE code = ? AND created_at > ?',
    )
    .bind(code, Date.now() - 86400000)
    .first<Omit<Room, 'players' | 'serverNow' | 'reactions' | 'activities'>>();
  if (!r) return null;
  const ps = await db()
    .prepare(
      'SELECT id,name,host,role,ready,audio FROM players WHERE room = ? ORDER BY joined_at,id',
    )
    .bind(code)
    .all<Omit<Player, 'audio' | 'micTested'> & { audio: string | null }>();
  const recordings = await db()
    .prepare(
      'SELECT recordings.player, recordings.segment FROM recordings INNER JOIN players ON players.id = recordings.player WHERE players.room = ?',
    )
    .bind(code)
    .all<{ player: string; segment: number }>();

  const meta = getRoomMeta(code);

  return {
    ...r,
    serverNow: Date.now(),
    reactions: { ...meta.reactions },
    activities: [...meta.activities],
    players: ps.results.map((p) => ({
      ...p,
      audio: !!p.audio,
      micTested: meta.micTested.has(p.id),
      segments: recordings.results
        .filter((x) => x.player === p.id)
        .map((x) => x.segment),
    })),
  };
}
