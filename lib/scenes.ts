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
    { id: 0, name: '1. Karakter', color: '#ef4444', description: '' },
    { id: 1, name: '2. Karakter', color: '#38bdf8', description: '' },
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
    if (numRoles > 1 && rawCues.length > 1) {
      const counts = new Array(numRoles).fill(0);
      rawCues.forEach((c) => {
        const rIdx = typeof c.roleIndex === 'number' && c.roleIndex >= 0 ? c.roleIndex % numRoles : 0;
        counts[rIdx]++;
      });
      const maxC = Math.max(...counts);
      const minC = Math.min(...counts);
      // Eğer bir karaktere 19 replik, diğerine 3 replik gibi dengesiz dağılım varsa otomatik eşit dağıt!
      if (maxC - minC > 2) {
        return rawCues.map((c, idx) => {
          const balancedIdx = idx % numRoles;
          const detail = roleDetails[balancedIdx];
          return {
            ...c,
            roleIndex: balancedIdx,
            roleName: detail ? detail.name : roles[balancedIdx] || `Karakter ${balancedIdx + 1}`,
            roleColor: detail ? detail.color : c.roleColor || '#d8fb51',
          };
        });
      }
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
      roleColor: detail ? detail.color : '#d8fb51',
      text,
      start: Number((id * step).toFixed(2)),
      end: Number(((id + 1) * step).toFixed(2)),
    };
  });
}

export function playerCues(
  sceneId: number,
  playerIndex: number,
  playerCount: number,
  customList?: Scene[],
): Cue[] {
  const all = sceneCues(sceneId, customList);
  if (playerCount <= 1) return all;

  // Rol bazlı dağılımın her oyuncuya eşit sayıda replik verip vermediğini kontrol et
  const countsByPlayer = new Array(playerCount).fill(0);
  all.forEach((c, idx) => {
    const pIdx =
      typeof c.roleIndex === 'number' && c.roleIndex >= 0
        ? c.roleIndex % playerCount
        : idx % playerCount;
    countsByPlayer[pIdx]++;
  });
  const maxPlayerCues = Math.max(...countsByPlayer);
  const minPlayerCues = Math.min(...countsByPlayer);

  // Eğer oyuncular arasında 1 replikten fazla fark oluşuyorsa (örn: 19'a 3),
  // replikleri sırayla (round-robin) %100 eşit olarak paylaştır!
  if (maxPlayerCues - minPlayerCues > 1) {
    return all.filter((_, idx) => idx % playerCount === playerIndex);
  }

  return all.filter((c, idx) => {
    if (typeof c.roleIndex === 'number' && c.roleIndex >= 0) {
      return c.roleIndex % playerCount === playerIndex;
    }
    return idx % playerCount === playerIndex;
  });
}

export function timeLabel(seconds: number) {
  const totalSec = Math.max(0, Math.round(seconds));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

