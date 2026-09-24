/**
 * Replik Game Service - Supabase Backend
 * Multiplayer odalar, oyuncu durumları, ses kayıtları ve lobi senkronizasyonunu
 * tamamen Supabase veritabanı ve Supabase Storage üzerinden yönetir.
 * Bu sayede Vercel, Cloudflare, yerel ortam ve mobilde 0 hata ile çalışır.
 */

import {
  supabase,
  getScenesFromSupabase,
  requireAuthenticatedUser,
} from './supabase';
import {
  getSceneById,
  getCustomScenes,
  playerCues,
  getPlayerCharacterMap,
  type Scene,
  type Room,
  type Player,
  type ActivityItem,
} from './scenes';

export type PlayerWithToken = Player & {
  token: string;
  userId?: string;
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
  host_user_id?: string | null;
  updated_at?: string | null;
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
      const mergedSegments = Array.from(new Set([...(p.segments || []), ...fromRecs].map(Number)));
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

/** Retry against the latest row so simultaneous uploads cannot overwrite each other. */
async function updateGameRoom(
  code: string,
  change: (row: GameRoomRow) => Promise<boolean>,
  initial?: GameRoomRow,
): Promise<GameRoomRow> {
  for (let attempt = 0; attempt < 8; attempt++) {
    let row = attempt === 0 ? initial : undefined;
    if (!row) {
      const { data, error } = await supabase.from('game_rooms').select('*').eq('code', code).single<GameRoomRow>();
      if (error || !data) throw new Error('Oda bulunamadı veya süresi dolmuş.');
      row = data;
    }
    const previousVersion = row.updated_at;
    if (!(await change(row))) return row;
    // Always advance the version, even when two writes occur in the same millisecond.
    row.updated_at = new Date(Math.max(Date.now(), (Date.parse(previousVersion || '') || 0) + 1)).toISOString();
    let update = supabase.from('game_rooms').update({
      scene: row.scene,
      status: row.status,
      play_at: row.play_at,
      players: row.players,
      reactions: row.reactions,
      activities: row.activities,
      recordings: row.recordings,
      updated_at: row.updated_at,
    }).eq('code', code);
    update = previousVersion == null
      ? update.is('updated_at', null)
      : update.eq('updated_at', previousVersion);
    const { data, error } = await update.select('*').maybeSingle<GameRoomRow>();
    if (error) throw new Error(`İşlem kaydedilemedi: ${error.message}`);
    if (data) return data;
  }
  throw new Error('Oda aynı anda güncelleniyor. Kaydı tekrar kaydetmeyi deneyin.');
}

async function recordingScenes(): Promise<Scene[]> {
  const remote = await getScenesFromSupabase().catch(() => []);
  const merged = new Map<number, Scene>();
  getCustomScenes().forEach((scene) => merged.set(Number(scene.id), scene));
  remote.forEach((scene) => merged.set(Number(scene.id), scene));
  return Array.from(merged.values());
}

/** Stored audio, rather than a separate ready click, determines completion. */
function completeRecordings(row: GameRoomRow, customScenes: Scene[]): boolean {
  if (row.status !== 'recording' || !customScenes.some((scene) => Number(scene.id) === Number(row.scene))) return false;
  const preferredRoles = row.players.map((player) => player.role);
  row.players.forEach((player, index) => {
    const assigned = playerCues(row.scene, index, row.players.length, customScenes, preferredRoles);
    const segments = new Set((row.recordings || [])
      .filter((recording) => recording.player === player.id && recording.url)
      .map((recording) => Number(recording.segment)));
    player.segments = Array.from(segments);
    player.audio = assigned.every((cue) => segments.has(Number(cue.id)));
    player.ready = player.audio ? 1 : 0;
  });
  if (!row.players.length || !row.players.every((player) => player.audio)) return false;
  row.status = 'final';
  row.play_at = Date.now() + 3000;
  row.activities = [{
    id: crypto.randomUUID(),
    text: 'Tüm replikler kaydedildi! Büyük Final başlıyor! 🎬',
    time: Date.now(),
    type: 'system' as const,
  }, ...(row.activities || [])].slice(0, 30);
  return true;
}

/**
 * Yeni oyun odası oluşturur (Sadece giriş yapmış üyeler).
 */
export async function createGameRoom(
  name: string,
  scene: number,
  maxPlayers = 4,
): Promise<{ room: Room; token: string; id: string }> {
  const user = await requireAuthenticatedUser();
  const selectedScene = (await recordingScenes()).find((item) => Number(item.id) === Number(scene));
  if (!selectedScene?.instrumental?.startsWith('https://')) {
    throw new Error('Bu sahnenin arka plan sesi hazır değil. Önce editörde hazırlayıp kaydedin.');
  }
  const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += codeChars[Math.floor(Math.random() * codeChars.length)];
  }

  const playerId = user.id;
  const token = crypto.randomUUID();
  const displayName =
    name.trim().slice(0, 24) ||
    (user.user_metadata?.name as string)?.trim()?.slice(0, 24) ||
    user.email?.split('@')[0]?.slice(0, 24) ||
    'Oyuncu';

  const hostPlayer: PlayerWithToken = {
    id: playerId,
    userId: user.id,
    token,
    name: displayName,
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
        text: `${displayName} odayı kurdu (${maxPlayers === 1 ? 'Solo Dublaj' : `${maxPlayers} kişilik`}).`,
        time: Date.now(),
        type: 'join',
      },
    ],
    recordings: [],
    host_user_id: user.id,
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
 * Var olan bir odaya katılır (Sadece giriş yapmış üyeler).
 */
export async function joinGameRoom(
  rawCode: string,
  name: string,
): Promise<{ room: Room; token: string; id: string }> {
  const user = await requireAuthenticatedUser();
  const code = rawCode.toUpperCase().trim();
  const { data: row, error } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('code', code)
    .single<GameRoomRow>();

  if (error || !row) {
    throw new Error('Bu kodla bir oda bulunamadı. Kodu kontrol et.');
  }

  const currentPlayers = row.players || [];
  const existingPlayer = currentPlayers.find(
    (p) => p.userId === user.id || p.id === user.id,
  );
  if (existingPlayer) {
    return {
      room: rowToRoom(row),
      token: existingPlayer.token,
      id: existingPlayer.id,
    };
  }

  if (row.status !== 'lobby') {
    throw new Error('Oyun zaten başlamış veya oda kapalı.');
  }

  if (currentPlayers.length >= (row.max_players || 4)) {
    throw new Error(`Oda dolu (Maksimum ${row.max_players || 4} oyuncu).`);
  }

  const playerId = user.id;
  const token = crypto.randomUUID();
  const displayName =
    name.trim().slice(0, 24) ||
    (user.user_metadata?.name as string)?.trim()?.slice(0, 24) ||
    user.email?.split('@')[0]?.slice(0, 24) ||
    'Oyuncu';

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
    userId: user.id,
    token,
    name: displayName,
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
      text: `${displayName} odaya katıldı.`,
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

  // Recover rooms left in recording by an interrupted final update or older clients.
  if (row.status === 'recording' && row.recordings?.length) {
    const scenes = await recordingScenes();
    const updated = await updateGameRoom(row.code, async (current) => completeRecordings(current, scenes), row);
    return rowToRoom(updated);
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
  const updated = await updateGameRoom(cleanCode, async (row) => {
    const playerIndex = (row.players || []).findIndex((p) => p.token === token);
    if (playerIndex === -1) {
      throw new Error('Oturum bulunamadı. Lütfen odaya tekrar katılın.');
    }

    const player = row.players[playerIndex];
    const activities = row.activities = [...(row.activities || [])];
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
        completeRecordings(row, await recordingScenes());
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
      const preparedScene = (await recordingScenes()).find((item) => Number(item.id) === Number(row.scene));
      if (!preparedScene?.instrumental?.startsWith('https://')) {
        throw new Error('Bu sahnenin arka plan sesi hazır değil. Önce editörde hazırlayıp kaydedin.');
      }

      const requiredPlayers = Math.max(1, Number(row.max_players) || 1);
      if (row.players.length < requiredPlayers) {
        throw new Error(
          `Oda ${requiredPlayers} kişilik kuruldu. Oyunun başlaması için ${requiredPlayers - row.players.length} oyuncunun daha katılması gerekiyor.`,
        );
      }

      // Herkes hazır mı kontrol et
      const notReady = row.players.filter((p) => !p.ready);
      if (notReady.length > 0) {
        throw new Error('Başlamadan önce odadaki tüm oyuncular hazır olmalı.');
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

    return true;
  });
  return rowToRoom(updated);
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
  const filePath = `recordings/${cleanCode}/${playerId}_${segment ?? 'full'}_${crypto.randomUUID()}.${ext}`;

  // 1. Supabase Storage'a yükle (başarısız olursa Base64 Data URL fallback kullan)
  let publicUrl = '';
  const { error: uploadError } = await supabase.storage
    .from('videos')
    .upload(filePath, blob, {
      contentType: blob.type || 'audio/webm',
      upsert: true,
    });

  if (uploadError) {
    console.warn('Supabase storage upload fallback to data URL:', uploadError.message);
    publicUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('Ses verisi okunamadı.'));
      reader.readAsDataURL(blob);
    });
  } else {
    const { data: urlData } = supabase.storage.from('videos').getPublicUrl(filePath);
    publicUrl = urlData.publicUrl;
  }

  const customScenes = await recordingScenes();
  const segNum = Number(segment ?? 0);
  const updated = await updateGameRoom(cleanCode, async (row) => {
    if (row.status !== 'recording') throw new Error('Kayıt aşaması sona ermiş.');
    const playerIndex = row.players.findIndex((player) => player.id === playerId);
    if (playerIndex < 0) throw new Error('Oyuncu odada bulunamadı.');
    if (!customScenes.some((scene) => Number(scene.id) === Number(row.scene))) {
      throw new Error('Sahne replikleri yüklenemedi. Lütfen tekrar deneyin.');
    }
    const assigned = playerCues(row.scene, playerIndex, row.players.length, customScenes, row.players.map((player) => player.role));
    if (!Number.isInteger(segNum) || !assigned.some((cue) => Number(cue.id) === segNum)) {
      throw new Error('Bu bölüm sana ait değil.');
    }
    row.recordings = (row.recordings || []).filter(
      (recording) => !(recording.player === playerId && Number(recording.segment) === segNum),
    );
    row.recordings.push({ player: playerId, segment: segNum, url: publicUrl });
    row.activities = [{
      id: crypto.randomUUID(),
      text: `${row.players[playerIndex].name} bir replik seslendirdi (Bölüm ${segNum + 1}) ✓`,
      time: Date.now(),
      type: 'record' as const,
    }, ...(row.activities || [])].slice(0, 30);
    completeRecordings(row, customScenes);
    return true;
  });

  return { room: rowToRoom(updated), url: publicUrl };
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

export type DubComment = {
  id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: number;
};

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
  likedBy?: string[];
  comments?: DubComment[];
  createdBy?: string | null;
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
 * Dublajlanan MP4 videoyu Supabase Storage'a (`videos` bucket) yükler,
 * geçici ses parçalarını siler ve Supabase PostgreSQL (`public.published_dubs`) tablosuna kaydeder.
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
  const user = await requireAuthenticatedUser();
  const cleanCode = room.code.toUpperCase().trim();
  const fileName = `published/${user.id}/replik_${cleanCode}_${Date.now()}.mp4`;

  // 1. Birleştirilmiş MP4 videoyu Supabase Storage'a yükle
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('videos')
    .upload(fileName, mp4Blob, {
      cacheControl: '31536000',
      upsert: false,
      contentType: 'video/mp4',
    });

  if (uploadError || !uploadData) {
    throw new Error(`Dublaj videosu yüklenemedi: ${uploadError?.message || 'Bilinmeyen hata'}`);
  }

  const { data: pubUrlData } = supabase.storage.from('videos').getPublicUrl(uploadData.path);
  const videoUrl = pubUrlData.publicUrl;
  const now = Date.now();
  const dubId = `${cleanCode}_${now}`;

  const newEntry: PublishedDub = {
    id: dubId,
    roomCode: cleanCode,
    sceneId: room.scene,
    sceneTitle,
    category: category || 'Sahne',
    videoUrl,
    posterUrl: posterUrl || '',
    duration: duration || 15,
    players: playersInfo,
    likes: 1,
    createdAt: now,
  };

  // 2. Supabase PostgreSQL `published_dubs` tablosuna kaydet
  const { error: dbError } = await supabase.from('published_dubs').upsert(
    {
      id: dubId,
      room_code: cleanCode,
      scene_id: Number(room.scene) || 0,
      scene_title: sceneTitle,
      category: category || 'Sahne',
      video_url: videoUrl,
      poster_url: posterUrl || '',
      duration: Number(duration) || 15,
      players: playersInfo,
      likes: 1,
      liked_by: [user.id],
      created_by: user.id,
      created_at: now,
    },
    { onConflict: 'id' },
  );

  if (dbError) {
    console.warn('published_dubs veritabanı kayıt uyarısı:', dbError);
  }

  // 3. Geçici parça ses dosyalarını (recordings/{code}/*) Supabase Storage'dan sil
  await removeRoomStorageRecordings(cleanCode, room.recordings || []);

  // 4. Odayı "published" olarak işaretle
  try {
    await supabase
      .from('game_rooms')
      .update({
        status: 'published',
        recordings: [{ player: '__published_mp4__', segment: -1, url: videoUrl }],
        updated_at: new Date().toISOString(),
      })
      .eq('code', cleanCode);
  } catch {}

  return newEntry;
}

type DbPublishedDubRow = {
  id: string;
  room_code: string;
  scene_id: number;
  scene_title: string;
  category: string;
  video_url: string;
  poster_url: string;
  duration: number;
  players: { name: string; roleName: string; roleColor: string }[];
  likes: number;
  liked_by?: string[];
  comments?: DubComment[];
  created_by?: string | null;
  created_at: number;
};

/**
 * Sosyal medya dublaj akışındaki tüm topluluk dublajlarını Supabase PostgreSQL veritabanından getirir.
 */
export async function getPublishedDubsFromSupabase(): Promise<PublishedDub[]> {
  try {
    const { data: rows, error } = await supabase
      .from('published_dubs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);

    if (!error && rows && rows.length > 0) {
      return (rows as DbPublishedDubRow[]).map((r) => ({
        id: r.id,
        roomCode: r.room_code,
        sceneId: Number(r.scene_id),
        sceneTitle: r.scene_title,
        category: r.category || 'Sahne',
        videoUrl: r.video_url,
        posterUrl: r.poster_url || '',
        duration: Number(r.duration) || 15,
        players: Array.isArray(r.players) ? r.players : [],
        likes: Number(r.likes) || 1,
        likedBy: Array.isArray(r.liked_by) ? r.liked_by : [],
        comments: Array.isArray(r.comments) ? r.comments : [],
        createdBy: r.created_by || null,
        createdAt: Number(r.created_at) || Date.now(),
      }));
    }
  } catch {}

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
            roleColor: sc?.roleDetails?.[p.role >= 0 ? p.role : 0]?.color || '#F5E636',
          })),
          likes: Object.values(r.reactions || {}).reduce((a, b) => a + Number(b || 0), 0) || 1,
          likedBy: [],
          comments: [],
          createdAt: Number(r.created_at) || Date.now(),
        };
      })
      .filter(Boolean) as PublishedDub[];
  } catch {
    return [];
  }
}

/**
 * Yayınlanmış bir dublaja üye bazlı beğeni aç/kapat (Toggle Like).
 */
export async function toggleLikePublishedDubInSupabase(dubId: string): Promise<PublishedDub[]> {
  const user = await requireAuthenticatedUser();
  const { data: row } = await supabase
    .from('published_dubs')
    .select('id, likes, liked_by')
    .eq('id', dubId)
    .single<{ id: string; likes: number; liked_by: string[] }>();

  if (row) {
    const likedBy = Array.isArray(row.liked_by) ? row.liked_by : [];
    const alreadyLiked = likedBy.includes(user.id);
    const nextLikedBy = alreadyLiked
      ? likedBy.filter((uid) => uid !== user.id)
      : [...likedBy, user.id];
    const nextLikes = Math.max(
      0,
      alreadyLiked ? (Number(row.likes) || 1) - 1 : (Number(row.likes) || 0) + 1,
    );
    await supabase
      .from('published_dubs')
      .update({ likes: nextLikes, liked_by: nextLikedBy })
      .eq('id', dubId);
  }
  return await getPublishedDubsFromSupabase();
}

export async function likePublishedDubInSupabase(dubId: string): Promise<PublishedDub[]> {
  return await toggleLikePublishedDubInSupabase(dubId);
}

/**
 * Yayınlanmış bir dublaja yorum ekler.
 */
export async function addCommentToPublishedDubInSupabase(
  dubId: string,
  text: string,
): Promise<PublishedDub[]> {
  const user = await requireAuthenticatedUser();
  const cleanText = text.trim().slice(0, 400);
  if (!cleanText) return await getPublishedDubsFromSupabase();

  const userName =
    (user.user_metadata?.name as string)?.trim()?.slice(0, 24) ||
    user.email?.split('@')[0]?.slice(0, 24) ||
    'Oyuncu';

  const { data: row } = await supabase
    .from('published_dubs')
    .select('id, comments')
    .eq('id', dubId)
    .single<{ id: string; comments: DubComment[] }>();

  if (row) {
    const existing = Array.isArray(row.comments) ? row.comments : [];
    const newComment: DubComment = {
      id: crypto.randomUUID(),
      userId: user.id,
      userName,
      text: cleanText,
      createdAt: Date.now(),
    };
    const nextComments = [...existing, newComment];
    await supabase
      .from('published_dubs')
      .update({ comments: nextComments })
      .eq('id', dubId);
  }

  return await getPublishedDubsFromSupabase();
}

/**
 * Kullanıcının kendi yorumunu silmesini sağlar.
 */
export async function deleteCommentFromPublishedDubInSupabase(
  dubId: string,
  commentId: string,
): Promise<PublishedDub[]> {
  const user = await requireAuthenticatedUser();
  const { data: row } = await supabase
    .from('published_dubs')
    .select('id, comments')
    .eq('id', dubId)
    .single<{ id: string; comments: DubComment[] }>();

  if (row && Array.isArray(row.comments)) {
    const nextComments = row.comments.filter(
      (c) => !(c.id === commentId && c.userId === user.id),
    );
    await supabase
      .from('published_dubs')
      .update({ comments: nextComments })
      .eq('id', dubId);
  }

  return await getPublishedDubsFromSupabase();
}

/**
 * Kullanıcının akışta yayınladığı kendi dublaj videosunu (veritabanı + storage) silmesini sağlar.
 */
export async function deletePublishedDubFromSupabase(
  dubId: string,
  videoUrl?: string,
  roomCode?: string,
): Promise<PublishedDub[]> {
  await requireAuthenticatedUser();

  // 1. published_dubs tablosundan sil
  await supabase.from('published_dubs').delete().eq('id', dubId);

  // 2. İlgili game_rooms kaydı varsa onu da sil (fallback akışta tekrar görünmesin)
  const cleanRoomCode = (roomCode || dubId.split('_')[0] || '')
    .trim()
    .toUpperCase();
  if (cleanRoomCode) {
    try {
      await supabase
        .from('game_rooms')
        .delete()
        .eq('code', cleanRoomCode)
        .eq('status', 'published');
    } catch {
      // ignore
    }
  }

  // 3. Supabase Storage 'videos' kovasındaki MP4 dosyasını temizle
  if (videoUrl && videoUrl.includes('/storage/v1/object/public/videos/')) {
    try {
      const storagePath = decodeURIComponent(
        videoUrl.split('/storage/v1/object/public/videos/')[1].split('?')[0],
      );
      if (storagePath) {
        await supabase.storage.from('videos').remove([storagePath]);
      }
    } catch {
      // ignore
    }
  }

  return await getPublishedDubsFromSupabase();
}

