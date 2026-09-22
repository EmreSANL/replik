/**
 * Replik Game Service - Supabase Backend
 * Multiplayer odalar, oyuncu durumları, ses kayıtları ve lobi senkronizasyonunu
 * tamamen Supabase veritabanı ve Supabase Storage üzerinden yönetir.
 * Bu sayede Vercel, Cloudflare, yerel ortam ve mobilde 0 hata ile çalışır.
 */

import { supabase, getScenesFromSupabase } from './supabase';
import {
  getSceneById,
  sceneCues,
  playerCues,
  type Room,
  type Player,
  type ActivityItem,
} from './scenes';

export type PlayerWithToken = Player & {
  token: string;
};

export type GameRoomRow = {
  code: string;
  scene: number;
  status: string;
  max_players: number;
  play_at: number;
  created_at: number;
  players: PlayerWithToken[];
  reactions: Record<string, number>;
  activities: ActivityItem[];
  recordings: { player: string; segment: number; url: string }[];
  updated_at?: string;
};

function rowToRoom(row: GameRoomRow): Room {
  const recs = row.recordings || [];
  return {
    code: row.code,
    scene: Number(row.scene),
    status: row.status,
    playAt: row.play_at,
    maxPlayers: row.max_players || 4,
    serverNow: Date.now(),
    reactions: row.reactions || { '😂': 0, '🔥': 0, '👏': 0, '❤️': 0 },
    activities: row.activities || [],
    recordings: recs,
    players: (row.players || []).map((p) => {
      const fromRecs = recs.filter((r) => r.player === p.id).map((r) => r.segment);
      const mergedSegments = Array.from(new Set([...(p.segments || []), ...fromRecs]));
      return {
        id: p.id,
        name: p.name,
        host: p.host,
        role: p.role,
        ready: p.ready,
        audio: Boolean(p.audio),
        segments: mergedSegments,
        micTested: Boolean(p.micTested),
      };
    }),
  };
}

/**
 * Yeni oyun odası oluşturur.
 */
export async function createGameRoom(
  name: string,
  scene: number,
  maxPlayers = 4,
): Promise<{ room: Room; token: string; id: string }> {
  const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += codeChars[Math.floor(Math.random() * codeChars.length)];
  }

  const playerId = crypto.randomUUID();
  const token = crypto.randomUUID();

  const hostPlayer: PlayerWithToken = {
    id: playerId,
    token,
    name: name.trim(),
    host: 1,
    role: 0,
    ready: 0,
    audio: false,
    segments: [],
    micTested: false,
  };

  const newRoom: GameRoomRow = {
    code,
    scene: Number(scene) || 0,
    status: 'lobby',
    max_players: maxPlayers,
    play_at: 0,
    created_at: Date.now(),
    players: [hostPlayer],
    reactions: { '😂': 0, '🔥': 0, '👏': 0, '❤️': 0 },
    activities: [
      {
        id: crypto.randomUUID(),
        text: `${name.trim()} odayı kurdu (${maxPlayers === 1 ? 'Solo Dublaj' : `${maxPlayers} kişilik`}).`,
        time: Date.now(),
        type: 'join',
      },
    ],
    recordings: [],
  };

  const { error } = await supabase.from('game_rooms').insert(newRoom);
  if (error) {
    console.error('Supabase createGameRoom error:', error);
    throw new Error(`Oda oluşturulamadı: ${error.message}`);
  }

  return {
    room: rowToRoom(newRoom),
    token,
    id: playerId,
  };
}

/**
 * Var olan bir odaya katılır.
 */
export async function joinGameRoom(
  rawCode: string,
  name: string,
): Promise<{ room: Room; token: string; id: string }> {
  const code = rawCode.toUpperCase().trim();
  const { data: row, error } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('code', code)
    .single<GameRoomRow>();

  if (error || !row) {
    throw new Error('Bu kodla bir oda bulunamadı. Kodu kontrol et.');
  }

  if (row.status !== 'lobby') {
    throw new Error('Oyun zaten başlamış veya oda kapalı.');
  }

  const currentPlayers = row.players || [];
  if (currentPlayers.length >= (row.max_players || 4)) {
    throw new Error(`Oda dolu (Maksimum ${row.max_players || 4} oyuncu).`);
  }

  const playerId = crypto.randomUUID();
  const token = crypto.randomUUID();

  // Müsait olan ilk rolü ata
  const takenRoles = new Set(currentPlayers.map((p) => p.role));
  let assignedRole = -1;
  for (let r = 0; r < (row.max_players || 4); r++) {
    if (!takenRoles.has(r)) {
      assignedRole = r;
      break;
    }
  }

  const newPlayer: PlayerWithToken = {
    id: playerId,
    token,
    name: name.trim(),
    host: 0,
    role: assignedRole,
    ready: 0,
    audio: false,
    segments: [],
    micTested: false,
  };

  const updatedPlayers = [...currentPlayers, newPlayer];
  const updatedActivities = [
    {
      id: crypto.randomUUID(),
      text: `${name.trim()} odaya katıldı.`,
      time: Date.now(),
      type: 'join' as const,
    },
    ...(row.activities || []),
  ].slice(0, 30);

  const { error: updateError } = await supabase
    .from('game_rooms')
    .update({
      players: updatedPlayers,
      activities: updatedActivities,
      updated_at: new Date().toISOString(),
    })
    .eq('code', code);

  if (updateError) {
    throw new Error(`Odaya katılınamadı: ${updateError.message}`);
  }

  const updatedRow: GameRoomRow = {
    ...row,
    players: updatedPlayers,
    activities: updatedActivities,
  };

  return {
    room: rowToRoom(updatedRow),
    token,
    id: playerId,
  };
}

/**
 * Oda anlık görüntüsünü (snapshot) çeker.
 */
export async function getGameRoom(code: string): Promise<Room> {
  const { data: row, error } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('code', code.toUpperCase().trim())
    .single<GameRoomRow>();

  if (error || !row) {
    throw new Error('Oda bulunamadı veya süresi dolmuş.');
  }

  return rowToRoom(row);
}

/**
 * Oda içi eylemleri (hazır olma, rol seçme, sahne değiştirme, oyun başlatma vb.) yürütür.
 */
export async function executeGameRoomAction(
  code: string,
  token: string,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<Room> {
  const cleanCode = code.toUpperCase().trim();
  const { data: row, error } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('code', cleanCode)
    .single<GameRoomRow>();

  if (error || !row) {
    throw new Error('Oda bulunamadı.');
  }

  const playerIndex = (row.players || []).findIndex((p) => p.token === token);
  if (playerIndex === -1) {
    throw new Error('Oturum bulunamadı. Lütfen odaya tekrar katılın.');
  }

  const player = row.players[playerIndex];
  const activities = [...(row.activities || [])];
  const addLog = (text: string, type: ActivityItem['type'] = 'system') => {
    activities.unshift({
      id: crypto.randomUUID(),
      text,
      time: Date.now(),
      type,
    });
    if (activities.length > 30) activities.length = 30;
  };

  if (action === 'ready') {
    player.ready = extra.ready ? 1 : 0;
    addLog(
      `${player.name} ${player.ready ? 'hazır olduğunu bildirdi.' : 'hazırlığını geri aldı.'}`,
      'ready',
    );
  } else if (action === 'mic_tested') {
    player.micTested = true;
    addLog(`${player.name} mikrofon testini tamamladı.`, 'ready');
  } else if (action === 'change_scene') {
    if (!player.host) throw new Error('Sahneyi yalnızca oda kurucusu değiştirebilir.');
    if (row.status !== 'lobby') throw new Error('Oyun başladıktan sonra sahne değiştirilemez.');
    const sceneId = Number(extra.scene);
    row.scene = sceneId;
    const sceneObj = getSceneById(sceneId);
    const title = typeof extra.title === 'string' ? extra.title : (sceneObj?.title || `Sahne #${sceneId}`);
    addLog(`Sahne "${title}" olarak değiştirildi.`, 'system');
  } else if (action === 'set_role') {
    player.role = Number(extra.role);
    const sceneInfo = getSceneById(row.scene);
    const roleName = sceneInfo?.roles?.[player.role] || `${player.role + 1}. Karakter`;
    addLog(`${player.name} rolünü seçti: ${roleName}`, 'ready');
  } else if (action === 'start') {
    if (!player.host) throw new Error('Oyunu oda kurucusu başlatabilir.');
    if (row.status !== 'lobby') throw new Error('Oyun zaten başlamış.');

    // Herkes hazır mı kontrol et
    const notReady = row.players.filter((p) => !p.ready && p.id !== player.id);
    if (notReady.length > 0) {
      throw new Error('Başlamadan önce tüm oyuncular hazır olmalı.');
    }

    // Rolü atanmamış oyunculara rastgele rol ata
    const takenRoles = new Set(row.players.map((p) => p.role).filter((r) => r !== -1));
    let currentRole = 0;
    row.players.forEach((p) => {
      if (p.role === -1) {
        while (takenRoles.has(currentRole)) currentRole++;
        p.role = currentRole;
        takenRoles.add(currentRole);
      }
    });

    row.status = 'recording';
    addLog('Kayıt aşaması başladı! Sahneye çıkın!', 'system');
  } else if (action === 'play' || action === 'finish') {
    row.status = 'final';
    row.play_at = Date.now() + 2800;
    addLog('Tüm replikler tamamlandı! Büyük final başlıyor, odadaki herkesle birlikte izleniyor... 🎬', 'system');
  } else if (action === 'reaction') {
    const emoji = typeof extra.emoji === 'string' ? extra.emoji : '😂';
    row.reactions = row.reactions || { '😂': 0, '🔥': 0, '👏': 0, '❤️': 0 };
    row.reactions[emoji] = (row.reactions[emoji] || 0) + 1;
  } else if (action === 'restart') {
    if (!player.host) throw new Error('Yeni turu yalnızca oda kurucusu başlatabilir.');
    row.status = 'lobby';
    row.play_at = 0;
    if (extra.scene !== undefined && !isNaN(Number(extra.scene))) row.scene = Number(extra.scene);
    row.recordings = [];
    row.players.forEach((p) => {
      p.audio = false;
      p.ready = 0;
      p.role = -1;
      p.segments = [];
    });
    row.reactions = { '😂': 0, '🔥': 0, '👏': 0, '❤️': 0 };
    addLog('Yeni tur için lobiye dönüldü.', 'system');
  }

  const { error: saveError } = await supabase
    .from('game_rooms')
    .update({
      scene: row.scene,
      status: row.status,
      play_at: row.play_at,
      players: row.players,
      reactions: row.reactions,
      activities,
      recordings: row.recordings,
      updated_at: new Date().toISOString(),
    })
    .eq('code', cleanCode);

  if (saveError) {
    throw new Error(`İşlem kaydedilemedi: ${saveError.message}`);
  }

  return rowToRoom({ ...row, activities });
}

/**
 * Oyuncunun kaydettiği ses repliğini Supabase Storage'a yükler ve odayı günceller.
 */
export async function saveAudioRecording(
  code: string,
  playerId: string,
  segment: number | null,
  blob: Blob,
): Promise<{ room: Room; url: string }> {
  const cleanCode = code.toUpperCase().trim();
  const ext = blob.type.includes('wav') ? 'wav' : 'webm';
  const filePath = `recordings/${cleanCode}/${playerId}_${segment ?? 'full'}_${Date.now()}.${ext}`;

  // 1. Supabase Storage'a yükle
  const { error: uploadError } = await supabase.storage
    .from('videos')
    .upload(filePath, blob, {
      contentType: blob.type || 'audio/webm',
      upsert: true,
    });

  if (uploadError) {
    console.error('Ses yükleme hatası:', uploadError);
    throw new Error(`Ses kaydedilemedi: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(filePath);
  const publicUrl = urlData.publicUrl;

  // 2. Odayı çek ve güncelle
  const { data: row, error: fetchError } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('code', cleanCode)
    .single<GameRoomRow>();

  if (fetchError || !row) {
    throw new Error('Oda bulunamadı.');
  }

  const recordings = (row.recordings || []).filter(
    (r) => !(r.player === playerId && r.segment === (segment ?? 0)),
  );
  recordings.push({
    player: playerId,
    segment: segment ?? 0,
    url: publicUrl,
  });

  // Supabase'den güncel sahne repliklerini al
  const remoteScenes = await getScenesFromSupabase().catch(() => []);
  const customList = remoteScenes.length > 0 ? remoteScenes : undefined;
  const sceneCuesList = sceneCues(row.scene, customList);

  const player = row.players.find((p) => p.id === playerId);
  if (player) {
    const segs = new Set(player.segments || []);
    if (segment !== null) segs.add(segment);
    player.segments = Array.from(segs);
  }

  // Her oyuncunun kendi repliklerini tamamlayıp tamamlamadığını recordings tablosuyla birleştirerek hesapla
  const assignedCueIds = new Set<number>();
  row.players.forEach((p, idx) => {
    const pCues = playerCues(row.scene, idx, row.players.length, customList);
    pCues.forEach((c) => assignedCueIds.add(c.id));
    const playerRecSegs = recordings.filter((r) => r.player === p.id).map((r) => r.segment);
    const pSegs = new Set([...(p.segments || []), ...playerRecSegs]);
    p.segments = Array.from(pSegs);
    p.audio = pCues.length > 0 ? pCues.every((c) => pSegs.has(c.id)) : pSegs.size > 0;
  });

  // Sahne replik kontrolü: Tüm oyuncular kendi repliklerini tamamladıysa otomatik Büyük Final'e geç ve odadaki herkes için senkronize oynatmayı başlat!
  const recordedCues = new Set(recordings.map((r) => r.segment));
  const allPlayersFinished = row.players.length > 0 && row.players.every((p) => p.audio);
  const allAssignedRecorded =
    assignedCueIds.size > 0 &&
    Array.from(assignedCueIds).every((cueId) => recordedCues.has(cueId));
  const allSceneCuesRecorded =
    sceneCuesList.length > 0 && recordedCues.size >= sceneCuesList.length;

  if (allPlayersFinished || allAssignedRecorded || allSceneCuesRecorded) {
    row.status = 'final';
    row.play_at = Date.now() + 2800;
  }

  const activities = [...(row.activities || [])];
  if (player) {
    activities.unshift({
      id: crypto.randomUUID(),
      text: `${player.name} bir replik seslendirdi ${segment !== null ? `(Bölüm ${segment + 1})` : ''} ✓`,
      time: Date.now(),
      type: 'record',
    });
    if (row.status === 'final') {
      activities.unshift({
        id: crypto.randomUUID(),
        text: 'Tüm replikler kaydedildi! Büyük Final başlıyor! 🎬',
        time: Date.now(),
        type: 'system',
      });
    }
    if (activities.length > 30) activities.length = 30;
  }

  await supabase
    .from('game_rooms')
    .update({
      status: row.status,
      play_at: row.play_at,
      players: row.players,
      recordings,
      activities,
      updated_at: new Date().toISOString(),
    })
    .eq('code', cleanCode);

  return {
    room: rowToRoom({ ...row, recordings, activities }),
    url: publicUrl,
  };
}

/**
 * Oyuncunun kayıtlı ses dosyasının CDN URL'sini döner.
 */
export async function getAudioRecordingUrl(
  code: string,
  playerId: string,
  segment: number | null,
): Promise<string | null> {
  const cleanCode = code.toUpperCase().trim();
  const { data: row } = await supabase
    .from('game_rooms')
    .select('recordings')
    .eq('code', cleanCode)
    .single<{ recordings: { player: string; segment: number; url: string }[] }>();

  if (!row || !row.recordings) return null;
  const rec = row.recordings.find(
    (r) => r.player === playerId && (segment === null || r.segment === segment),
  );
  return rec ? rec.url : null;
}
