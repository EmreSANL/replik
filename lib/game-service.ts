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
  getPlayerCharacterMap,
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
    status: row.status === 'published' ? 'final' : row.status,
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

  if (action === 'ready' || action === 'recording_ready') {
    const isReadyRequested = extra.ready !== undefined ? Boolean(extra.ready) : true;
    if (row.status === 'recording') {
      const remoteScenes = await getScenesFromSupabase().catch(() => []);
      const customList = remoteScenes.length > 0 ? remoteScenes : undefined;
      const preferredRoles = row.players.map((p) => p.role);
      const assigned = playerCues(
        row.scene,
        playerIndex,
        row.players.length,
        customList,
        preferredRoles,
      );
      const playerSegs = new Set(player.segments || []);
      const hasCompletedAll = assigned.length > 0 ? assigned.every((c) => playerSegs.has(c.id)) : true;

      player.audio = hasCompletedAll;
      player.ready = isReadyRequested && hasCompletedAll ? 1 : 0;

      if (player.ready === 1) {
        addLog(`${player.name} dublajını tamamladı ve hazır! (Ready) ✓`, 'ready');
      } else {
        addLog(`${player.name} kaydını düzenliyor.`, 'ready');
      }

      // Herkes hazır mı kontrol et
      const allDone =
        row.players.length > 0 &&
        row.players.every((p, idx) => {
          const pAssigned = playerCues(
            row.scene,
            idx,
            row.players.length,
            customList,
            preferredRoles,
          );
          const pSegs = new Set(p.segments || []);
          const pCompleted = pAssigned.length > 0 ? pAssigned.every((c) => pSegs.has(c.id)) : true;
          return p.ready === 1 && pCompleted;
        });

      if (allDone) {
        row.status = 'final';
        row.play_at = Date.now() + 3000;
        addLog('Tüm oyuncular hazır ve dublajlarını tamamladı! 🎬 Büyük Final başlıyor...', 'system');
      }
    } else {
      player.ready = isReadyRequested ? 1 : 0;
      addLog(
        `${player.name} ${player.ready ? 'hazır olduğunu bildirdi.' : 'hazırlığını geri aldı.'}`,
        'ready',
      );
    }
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

    // 1 Karakter = 1 Oyuncu kuralına göre her oyuncuya ana karakterini ata
    const remoteScenesForStart = await getScenesFromSupabase().catch(() => []);
    const customListForStart =
      remoteScenesForStart.length > 0 ? remoteScenesForStart : undefined;
    const initialPrefs = row.players.map((p) => p.role);
    const charToPlayerMap = getPlayerCharacterMap(
      row.scene,
      row.players.length,
      customListForStart,
      initialPrefs,
    );

    const usedRoles = new Set<number>();
    row.players.forEach((p, pIdx) => {
      // Bu oyuncuya atanan karakterlerden ilkini ana rolü olarak kaydet
      let assignedRole = -1;
      charToPlayerMap.forEach((ownerIdx, roleIdx) => {
        if (ownerIdx === pIdx && assignedRole === -1 && !usedRoles.has(roleIdx)) {
          assignedRole = roleIdx;
        }
      });
      if (assignedRole === -1) {
        let fallback = 0;
        while (usedRoles.has(fallback)) fallback++;
        assignedRole = fallback;
      }
      p.role = assignedRole;
      usedRoles.add(assignedRole);
      // Kayıt aşaması için hazır durumunu ve segmentleri sıfırla
      p.ready = 0;
      p.audio = false;
      p.segments = [];
    });

    row.status = 'recording';
    addLog('Kayıt aşaması başladı! Sahneye çıkın!', 'system');
  } else if (action === 'play' || action === 'finish') {
    const remoteScenes = await getScenesFromSupabase().catch(() => []);
    const customList = remoteScenes.length > 0 ? remoteScenes : undefined;
    const preferredRoles = row.players.map((p) => p.role);
    const notReadyPlayers = row.players.filter((p, idx) => {
      const pAssigned = playerCues(row.scene, idx, row.players.length, customList, preferredRoles);
      const pSegs = new Set(p.segments || []);
      const isComplete = pAssigned.length > 0 ? pAssigned.every((c) => pSegs.has(c.id)) : true;
      return !isComplete || p.ready !== 1;
    });

    if (notReadyPlayers.length > 0 && !extra.force && !player.host) {
      throw new Error(`Diğer oyuncuların dublajı devam ediyor: ${notReadyPlayers.map((p) => p.name).join(', ')} henüz hazır değil.`);
    }

    row.status = 'final';
    row.play_at = Date.now() + 3000;
    addLog('Tüm replikler tamamlandı! Büyük final başlıyor, odadaki herkesle birlikte izleniyor... 🎬', 'system');
  } else if (action === 'reaction') {
    const emoji = typeof extra.emoji === 'string' ? extra.emoji : '😂';
    row.reactions = row.reactions || { '😂': 0, '🔥': 0, '👏': 0, '❤️': 0 };
    row.reactions[emoji] = (row.reactions[emoji] || 0) + 1;
  } else if (action === 'restart') {
    if (!player.host) throw new Error('Yeni turu yalnızca oda kurucusu başlatabilir.');
    const wasPublished = (row.recordings || []).some((r) => r.player === '__published_mp4__');
    if (!wasPublished) {
      await removeRoomStorageRecordings(cleanCode, row.recordings || []);
    }
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
  const preferredRoles = row.players.map((p) => p.role);
  row.players.forEach((p, idx) => {
    const pCues = playerCues(
      row.scene,
      idx,
      row.players.length,
      customList,
      preferredRoles,
    );
    const playerRecSegs = recordings.filter((r) => r.player === p.id).map((r) => r.segment);
    const pSegs = new Set([...(p.segments || []), ...playerRecSegs]);
    p.segments = Array.from(pSegs);
    const hasCompletedAll = pCues.length > 0 ? pCues.every((c) => pSegs.has(c.id)) : true;
    p.audio = hasCompletedAll;
    if (p.id === playerId) {
      p.ready = hasCompletedAll ? 1 : 0;
    }
  });

  // ASLA tek taraf bitirince oyunu sonlandırma!
  // SADECE VE SADECE odadaki TÜM oyuncular kendi repliklerini 100% tamamlayıp ready verdiğinde finale geç!
  const allPlayersReadyAndFinished =
    row.players.length > 0 &&
    row.players.every((p, idx) => {
      const pCues = playerCues(
        row.scene,
        idx,
        row.players.length,
        customList,
        preferredRoles,
      );
      const pSegs = new Set(p.segments || []);
      const isComplete = pCues.length > 0 ? pCues.every((c) => pSegs.has(c.id)) : true;
      return p.ready === 1 && isComplete;
    });

  if (allPlayersReadyAndFinished) {
    row.status = 'final';
    row.play_at = Date.now() + 3000;
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

export type PublishedDub = {
  id: string;
  roomCode: string;
  sceneId: number;
  sceneTitle: string;
  category: string;
  videoUrl: string;
  posterUrl: string;
  duration: number;
  players: { name: string; roleName: string; roleColor: string }[];
  likes: number;
  createdAt: number;
};

const PUBLISHED_FEED_PATH = 'published/feed.json';

/**
 * Bir odaya ait geçici ses kayıtlarını (recordings/{code}/*) Supabase Storage'dan tamamen siler.
 */
export async function removeRoomStorageRecordings(
  code: string,
  recordings?: { player: string; segment: number; url: string }[],
): Promise<void> {
  const cleanCode = code.toUpperCase().trim();
  const pathsToRemove = new Set<string>();

  // 1. Kayıt URL'lerinden dosya yollarını çıkar
  (recordings || []).forEach((r) => {
    if (r.player === '__published_mp4__') return;
    const match = r.url?.match(/\/storage\/v1\/object\/public\/videos\/(.+)$/);
    if (match && match[1]) {
      pathsToRemove.add(decodeURIComponent(match[1]));
    }
  });

  // 2. Klasördeki tüm dosyaları listele
  try {
    const { data: listData } = await supabase.storage
      .from('videos')
      .list(`recordings/${cleanCode}`, { limit: 100 });
    if (listData && listData.length > 0) {
      listData.forEach((f) => {
        if (f.name) pathsToRemove.add(`recordings/${cleanCode}/${f.name}`);
      });
    }
  } catch {
    // Klasör yoksa yoksay
  }

  if (pathsToRemove.size > 0) {
    await supabase.storage
      .from('videos')
      .remove(Array.from(pathsToRemove))
      .catch(() => {});
  }
}

/**
 * Eğer kullanıcı "Yayınla" butonuna basmadan odadan çıkarsa veya odayı kapatırsa,
 * odanın tüm ses kayıtlarını ve veritabanı kaydını Supabase'den otomatik siler.
 */
export async function deleteUnpublishedRoomFromSupabase(code: string): Promise<void> {
  const cleanCode = code.toUpperCase().trim();
  if (!cleanCode) return;

  try {
    const { data: row } = await supabase
      .from('game_rooms')
      .select('code, status, recordings')
      .eq('code', cleanCode)
      .single<Pick<GameRoomRow, 'code' | 'status' | 'recordings'>>();

    if (!row) return;

    const isPublished =
      row.status === 'published' ||
      (row.recordings || []).some((r) => r.player === '__published_mp4__');

    // Yayınlanmış bir dublajsa ana sayfada kalmaya devam etsin, silinmesin
    if (isPublished) return;

    // Yayınlanmamışsa tüm geçici ses kayıtlarını ve odayı Supabase'den sil!
    await removeRoomStorageRecordings(cleanCode, row.recordings || []);
    await supabase.from('game_rooms').delete().eq('code', cleanCode);
  } catch (err) {
    console.warn('Otomatik oda temizleme uyarısı:', err);
  }
}

/**
 * Arka planda yayınlanmamış eski odaları ve ses dosyalarını Supabase'den temizler.
 */
export async function cleanupStaleUnpublishedRooms(): Promise<void> {
  try {
    const cutoff = Date.now() - 25 * 60 * 1000; // 25 dakikadan eski yayınlanmamış odalar
    const { data: staleRooms } = await supabase
      .from('game_rooms')
      .select('code, status, created_at, recordings')
      .lt('created_at', cutoff)
      .limit(25);

    if (!staleRooms || staleRooms.length === 0) return;

    for (const r of staleRooms) {
      const isPublished =
        r.status === 'published' ||
        (r.recordings || []).some((rec: { player: string }) => rec.player === '__published_mp4__');
      if (!isPublished) {
        await removeRoomStorageRecordings(r.code, r.recordings || []);
        await supabase.from('game_rooms').delete().eq('code', r.code);
      }
    }
  } catch {
    // Sessizce geç
  }
}

/**
 * Dublajlanan MP4 videoyu Supabase Storage'a yükler, geçici ses parçalarını siler
 * ve ana sayfada ("Topluluk Dublajları") herkesin izleyebilmesi için yayınlar.
 */
export async function publishRoomDubbingToSupabase(
  room: Room,
  sceneTitle: string,
  category: string,
  posterUrl: string,
  duration: number,
  playersInfo: { name: string; roleName: string; roleColor: string }[],
  mp4Blob: Blob,
): Promise<PublishedDub> {
  const cleanCode = room.code.toUpperCase().trim();
  const fileName = `published/replik_${cleanCode}_${Date.now()}.mp4`;

  // 1. Birleştirilmiş MP4 videoyu Supabase Storage'a yükle
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('videos')
    .upload(fileName, mp4Blob, {
      cacheControl: '31536000',
      upsert: true,
      contentType: 'video/mp4',
    });

  if (uploadError || !uploadData) {
    throw new Error(`Dublaj videosu yüklenemedi: ${uploadError?.message || 'Bilinmeyen hata'}`);
  }

  const { data: pubUrlData } = supabase.storage.from('videos').getPublicUrl(uploadData.path);
  const videoUrl = pubUrlData.publicUrl;

  const newEntry: PublishedDub = {
    id: `${cleanCode}_${Date.now()}`,
    roomCode: cleanCode,
    sceneId: room.scene,
    sceneTitle,
    category: category || 'Sahne',
    videoUrl,
    posterUrl: posterUrl || '',
    duration: duration || 15,
    players: playersInfo,
    likes: 1,
    createdAt: Date.now(),
  };

  // 2. Geçici parça ses dosyalarını (recordings/{code}/*) Supabase Storage'dan sil (gereksiz yer kaplamasın)
  await removeRoomStorageRecordings(cleanCode, room.recordings || []);

  // 3. Odayı "published" olarak işaretle
  try {
    await supabase
      .from('game_rooms')
      .update({
        status: 'published',
        recordings: [{ player: '__published_mp4__', segment: -1, url: videoUrl }],
        updated_at: new Date().toISOString(),
      })
      .eq('code', cleanCode);
  } catch {
    // The published video and feed can still succeed if this status update fails.
  }

  // 4. Ana sayfa yayın akışı (published/feed.json) listesini güncelle
  try {
    const existing = await getPublishedDubsFromSupabase();
    const filtered = existing.filter((item) => item.roomCode !== cleanCode);
    const updatedFeed = [newEntry, ...filtered].slice(0, 60);

    const feedBlob = new Blob([JSON.stringify(updatedFeed)], {
      type: 'application/json',
    });
    await supabase.storage.from('videos').upload(PUBLISHED_FEED_PATH, feedBlob, {
      cacheControl: '0',
      upsert: true,
      contentType: 'application/json',
    });
  } catch (feedErr) {
    console.warn('Yayın akışı güncelleme uyarısı:', feedErr);
  }

  return newEntry;
}

/**
 * Ana sayfada yayınlanan tüm topluluk dublajlarını Supabase'den getirir.
 */
export async function getPublishedDubsFromSupabase(): Promise<PublishedDub[]> {
  try {
    const { data: pubUrlData } = supabase.storage
      .from('videos')
      .getPublicUrl(PUBLISHED_FEED_PATH);

    if (pubUrlData?.publicUrl) {
      const res = await fetch(`${pubUrlData.publicUrl}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const list = (await res.json()) as PublishedDub[];
        if (Array.isArray(list)) {
          return list.sort((a, b) => b.createdAt - a.createdAt);
        }
      }
    }
  } catch {
    // feed.json henüz yoksa game_rooms tablosundan kontrol et
  }

  try {
    const { data: rows } = await supabase
      .from('game_rooms')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(30);

    if (!rows || rows.length === 0) return [];

    return rows
      .map((r: GameRoomRow) => {
        const pubRec = (r.recordings || []).find((rec) => rec.player === '__published_mp4__');
        if (!pubRec?.url) return null;
        const sc = getSceneById(r.scene);
        return {
          id: `${r.code}_${r.created_at}`,
          roomCode: r.code,
          sceneId: r.scene,
          sceneTitle: sc?.title || 'Dublaj Sahnesi',
          category: sc?.category || 'Sahne',
          videoUrl: pubRec.url,
          posterUrl: sc?.poster || '',
          duration: sc?.duration || 15,
          players: (r.players || []).map((p) => ({
            name: p.name,
            roleName: sc?.roles?.[p.role >= 0 ? p.role : 0] || 'Oyuncu',
            roleColor: sc?.roleDetails?.[p.role >= 0 ? p.role : 0]?.color || '#d8fb51',
          })),
          likes: Object.values(r.reactions || {}).reduce((a, b) => a + Number(b || 0), 0) || 1,
          createdAt: Number(r.created_at) || Date.now(),
        };
      })
      .filter(Boolean) as PublishedDub[];
  } catch {
    return [];
  }
}

/**
 * Ana sayfadaki yayınlanmış bir dublaja beğeni (alkış/kalp) ekler.
 */
export async function likePublishedDubInSupabase(dubId: string): Promise<PublishedDub[]> {
  const list = await getPublishedDubsFromSupabase();
  const updated = list.map((item) =>
    item.id === dubId ? { ...item, likes: (item.likes || 0) + 1 } : item,
  );
  const feedBlob = new Blob([JSON.stringify(updated)], { type: 'application/json' });
  await supabase.storage.from('videos').upload(PUBLISHED_FEED_PATH, feedBlob, {
    cacheControl: '0',
    upsert: true,
    contentType: 'application/json',
  });
  return updated;
}

