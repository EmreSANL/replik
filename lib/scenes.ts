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
  const index = current.findIndex((s) => s.id === scene.id);
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
  const updated = current.filter((s) => s.id !== sceneId);
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
  return all.find((s) => s.id === sceneId) || all[0] || fallbackScene;
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
  if (currentScene.cues && currentScene.cues.length > 0) {
    return currentScene.cues;
  }
  const lines =
    currentScene.prompts && currentScene.prompts.length > 0
      ? currentScene.prompts
      : ['Replik 1', 'Replik 2'];
  const duration = currentScene.duration || 20;
  const step = duration / Math.max(1, lines.length);
  const roles =
    currentScene.roles && currentScene.roles.length > 0
      ? currentScene.roles
      : ['1. Karakter', '2. Karakter'];
  const roleDetails = currentScene.roleDetails || [];

  return lines.map((text, id) => {
    const roleIdx = id % roles.length;
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
  return all.filter((c) => c.id % playerCount === playerIndex);
}

export function timeLabel(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
