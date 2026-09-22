export type RoleInfo = {
  id: number;
  name: string;
  color: string;
  description: string;
};

export type Scene = {
  id: number;
  title: string;
  start: number;
  duration: number;
  poster: string;
  video: string;
  mood: string;
  category: string;
  roles: string[];
  roleDetails: RoleInfo[];
  prompts: string[];
  cues?: Cue[];
  instrumental?: string;
  isCustom?: boolean;
};

export const CUSTOM_SCENES_STORAGE_KEY = 'replik_custom_scenes_v1';

export const scenes: Scene[] = [];

export const fallbackScene: Scene = {
  id: 0,
  title: 'Sahne Yok',
  category: 'Meme & Mizah',
  start: 0,
  duration: 20,
  poster: '',
  video: '',
  mood: 'Lütfen bir sahne seçin veya editörden video yükleyin.',
  roles: ['1. Karakter', '2. Karakter'],
  roleDetails: [
    { id: 0, name: '1. Karakter', color: '#9E8CA9', description: '' },
    { id: 1, name: '2. Karakter', color: '#AEA932', description: '' },
  ],
  prompts: [],
};

export function getCustomScenes(): Scene[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_SCENES_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Scene[];
  } catch {
    return [];
  }
}

export function saveCustomScene(scene: Scene): Scene[] {
  if (typeof window === 'undefined') return [];
  const current = getCustomScenes();
  const index = current.findIndex((s) => Number(s.id) === Number(scene.id));
  let updated: Scene[];
  if (index >= 0) {
    updated = [...current];
    updated[index] = scene;
  } else {
    updated = [...current, scene];
  }
  localStorage.setItem(CUSTOM_SCENES_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function deleteCustomScene(sceneId: number): Scene[] {
  if (typeof window === 'undefined') return [];
  const current = getCustomScenes();
  const updated = current.filter((s) => Number(s.id) !== Number(sceneId));
  localStorage.setItem(CUSTOM_SCENES_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function getAllScenes(customList?: Scene[]): Scene[] {
  const custom =
    customList || (typeof window !== 'undefined' ? getCustomScenes() : []);
  return [...custom];
}

export function getSceneById(sceneId: number, customList?: Scene[]): Scene {
  const all = getAllScenes(customList);
  return all.find((s) => Number(s.id) === Number(sceneId)) || all[0] || fallbackScene;
}

export type Player = {
  id: string;
  name: string;
  host: number;
  role: number;
  ready: number;
  audio: boolean;
  segments: number[];
  micTested?: boolean;
};

export type ActivityItem = {
  id: string;
  text: string;
  time: number;
  type?: 'join' | 'ready' | 'record' | 'system';
};

export type Room = {
  serverNow: number;
  code: string;
  scene: number;
  status: string;
  playAt: number;
  maxPlayers?: number;
  players: Player[];
  reactions?: Record<string, number>;
  activities?: ActivityItem[];
  recordings?: { player: string; segment: number; url: string }[];
};

export type Cue = {
  id: number;
  roleIndex: number;
  roleName: string;
  roleColor: string;
  start: number;
  end: number;
  text: string;
};

export function sceneCues(sceneId: number, customList?: Scene[]): Cue[] {
  const currentScene = getSceneById(sceneId, customList);
  const roles =
    currentScene.roles && currentScene.roles.length > 0
      ? currentScene.roles
      : ['1. Karakter', '2. Karakter'];
  const roleDetails = currentScene.roleDetails || [];
  const numRoles = Math.max(1, roles.length);

  if (currentScene.cues && currentScene.cues.length > 0) {
    const rawCues = currentScene.cues;
    const distinctRoles = new Set(
      rawCues.map((c) => (typeof c.roleIndex === 'number' && c.roleIndex >= 0 ? c.roleIndex : 0)),
    );
    // Sadece sahnede birden fazla karakter tanımlı olmasına rağmen TÜM replikler tek bir karaktere (0) yığılmışsa dağıt
    if (numRoles > 1 && rawCues.length > 1 && distinctRoles.size === 1) {
      return rawCues.map((c, idx) => {
        const balancedIdx = idx % numRoles;
        const detail = roleDetails[balancedIdx];
        return {
          ...c,
          roleIndex: balancedIdx,
          roleName: detail ? detail.name : roles[balancedIdx] || `Karakter ${balancedIdx + 1}`,
          roleColor: detail ? detail.color : c.roleColor || '#9E8CA9',
        };
      });
    }
    return rawCues;
  }

  const lines =
    currentScene.prompts && currentScene.prompts.length > 0
      ? currentScene.prompts
      : ['Replik 1', 'Replik 2'];
  const duration = currentScene.duration || 20;
  const step = duration / Math.max(1, lines.length);

  return lines.map((text, id) => {
    const roleIdx = id % numRoles;
    const detail = roleDetails[roleIdx];
    return {
      id,
      roleIndex: roleIdx,
      roleName: detail ? detail.name : roles[roleIdx] || `Karakter ${roleIdx + 1}`,
      roleColor: detail ? detail.color : '#9E8CA9',
      text,
      start: Number((id * step).toFixed(2)),
      end: Number(((id + 1) * step).toFixed(2)),
    };
  });
}

/**
 * Bir karakteri ASLA iki farklı oyuncuya bölmez!
 * Her karakter (örn: Gökhan Abi) baştan sona SADECE TEK BİR oyuncu tarafından seslendirilir.
 * Eğer sahnedeki karakter sayısı oyuncu sayısından fazlaysa (örn: 5 karakter, 2 oyuncu),
 * kalan yan karakterler bütün olarak replik sayısı az olan oyuncuya dengeli şekilde verilir.
 */
export function getPlayerCharacterMap(
  sceneId: number,
  playerCount: number,
  customList?: Scene[],
  preferredRoles?: number[],
): Map<number, number> {
  const all = sceneCues(sceneId, customList);
  const roleToPlayer = new Map<number, number>();
  if (playerCount <= 1) {
    all.forEach((c) => {
      const rIdx = typeof c.roleIndex === 'number' && c.roleIndex >= 0 ? c.roleIndex : 0;
      roleToPlayer.set(rIdx, 0);
    });
    return roleToPlayer;
  }

  // 1. Her karakterin (roleIndex) toplam kaç repliği olduğunu hesapla
  const roleCounts = new Map<number, number>();
  all.forEach((c) => {
    const rIdx = typeof c.roleIndex === 'number' && c.roleIndex >= 0 ? c.roleIndex : 0;
    roleCounts.set(rIdx, (roleCounts.get(rIdx) || 0) + 1);
  });

  const distinctRoleIndices = Array.from(roleCounts.keys());

  // Eğer sahnede sadece 1 karakter varsa ve birden fazla oyuncu varsa
  if (distinctRoleIndices.length <= 1) {
    roleToPlayer.set(distinctRoleIndices[0] ?? 0, 0);
    return roleToPlayer;
  }

  const playerLoad = Array.from({ length: playerCount }, () => 0);
  const assignedRoles = new Set<number>();

  // 2. Önce oyuncuların lobide seçtiği ana rolleri (her oyuncuya 1 benzersiz karakter) ata
  if (preferredRoles && preferredRoles.length === playerCount) {
    preferredRoles.forEach((prefRole, pIdx) => {
      if (
        typeof prefRole === 'number' &&
        prefRole >= 0 &&
        roleCounts.has(prefRole) &&
        !assignedRoles.has(prefRole)
      ) {
        roleToPlayer.set(prefRole, pIdx);
        assignedRoles.add(prefRole);
        playerLoad[pIdx] += roleCounts.get(prefRole) || 0;
      }
    });
  }

  // 3. Kalan karakterleri replik sayısına göre büyükten küçüğe sırala
  const remainingRoles = distinctRoleIndices
    .filter((r) => !assignedRoles.has(r))
    .sort((a, b) => (roleCounts.get(b) || 0) - (roleCounts.get(a) || 0));

  // 4. Önce henüz hiç karakter almamış oyunculara en büyük karakterleri birer birer ver
  for (let pIdx = 0; pIdx < playerCount; pIdx++) {
    const hasAnyRole = Array.from(roleToPlayer.values()).includes(pIdx);
    if (!hasAnyRole && remainingRoles.length > 0) {
      const nextRole = remainingRoles.shift()!;
      roleToPlayer.set(nextRole, pIdx);
      assignedRoles.add(nextRole);
      playerLoad[pIdx] += roleCounts.get(nextRole) || 0;
    }
  }

  // 5. Sahnedeki ekstra karakterleri (bütün karakteri bölmeden!) o an en az repliği olan oyuncuya ata
  for (const rIdx of remainingRoles) {
    let minPlayerIdx = 0;
    for (let pIdx = 1; pIdx < playerCount; pIdx++) {
      if (playerLoad[pIdx] < playerLoad[minPlayerIdx]) {
        minPlayerIdx = pIdx;
      }
    }
    roleToPlayer.set(rIdx, minPlayerIdx);
    playerLoad[minPlayerIdx] += roleCounts.get(rIdx) || 0;
  }

  return roleToPlayer;
}

export function playerCues(
  sceneId: number,
  playerIndex: number,
  playerCount: number,
  customList?: Scene[],
  preferredRoles?: number[],
): Cue[] {
  const all = sceneCues(sceneId, customList);
  if (playerCount <= 1) return all;

  const roleCounts = new Set(
    all.map((c) => (typeof c.roleIndex === 'number' && c.roleIndex >= 0 ? c.roleIndex : 0)),
  );

  // Sadece sahnede tek 1 karakter varsa replikleri sırayla böl
  if (roleCounts.size <= 1) {
    return all.filter((_, idx) => idx % playerCount === playerIndex);
  }

  // Birden fazla karakter varsa HER KARAKTER SADECE TEK BİR OYUNCUYA aittir!
  const roleMap = getPlayerCharacterMap(sceneId, playerCount, customList, preferredRoles);
  return all.filter((c) => {
    const rIdx = typeof c.roleIndex === 'number' && c.roleIndex >= 0 ? c.roleIndex : 0;
    return roleMap.get(rIdx) === playerIndex;
  });
}

export function timeLabel(seconds: number) {
  const totalSec = Math.max(0, Math.round(seconds));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

