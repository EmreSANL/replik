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

export const scenes: Scene[] = [
  {
    id: 0,
    title: 'Ormanda İşler Karıştı',
    category: 'Animasyon',
    start: 0,
    duration: 20,
    poster: '/scene-0.jpg',
    video: '/scene-0.mp4',
    mood: 'Bir sabah. Hiç beklenmedik bir misafir ve hesaplaşma.',
    roles: ['Ormanın Müdürü', 'Meraklı Komşu', 'Panik Arkadaş', 'Anlatıcı'],
    roleDetails: [
      {
        id: 0,
        name: 'Ormanın Müdürü',
        color: '#f97316',
        description: 'Otoriter, biraz sinirli ve her şeyin kuralına göre olmasını isteyen tavşan.',
      },
      {
        id: 1,
        name: 'Meraklı Komşu',
        color: '#38bdf8',
        description: 'Her şeye burnunu sokan, masum görünüşlü ama ortalığı karıştıran tip.',
      },
      {
        id: 2,
        name: 'Panik Arkadaş',
        color: '#ec4899',
        description: 'En ufak şeyde kaçmaya çalışan, sesi titreyen sincap.',
      },
      {
        id: 3,
        name: 'Anlatıcı',
        color: '#a855f7',
        description: 'Olayları alaycı ve belgesel tonuyla anlatan dış ses.',
      },
    ],
    prompts: [
      'Burası benim ormanım. Toplantı yapacaksanız önce randevu alın!',
      'Ben sadece bir havuç istemiştim… bu kadar olay çıkacağını bilmiyordum.',
      'Arkadaşlar, sakin! Bence hep birlikte yavaşça uzaklaşalım.',
      'Her şey sıradan bir sabah gibi başlamıştı. En azından onlar öyle sanıyordu.',
    ],
  },
  {
    id: 1,
    title: 'Büyük Karşılaşma',
    category: 'Aksiyon & Komedi',
    start: 0,
    duration: 20,
    poster: '/scene-1.jpg',
    video: '/scene-1.mp4',
    mood: 'Küçük bir anlaşmazlık, gereğinden çok büyük bir tantana.',
    roles: ['Cesur Kahraman', 'Şüpheci Dost', 'Gizli Rakip', 'Anlatıcı'],
    roleDetails: [
      {
        id: 0,
        name: 'Cesur Kahraman',
        color: '#eab308',
        description: 'Özgüveni tavan yapmış, planına sonsuz güvenen lider.',
      },
      {
        id: 1,
        name: 'Şüpheci Dost',
        color: '#06b6d4',
        description: 'Hiçbir plana inanmayan, sürekli itiraz eden gerçekçi arkadaş.',
      },
      {
        id: 2,
        name: 'Gizli Rakip',
        color: '#ef4444',
        description: 'Pusuya yatmış, doğru anı bekleyen kurnaz karakter.',
      },
      {
        id: 3,
        name: 'Anlatıcı',
        color: '#8b5cf6',
        description: 'Durumu abartarak anlatan tecrübeli ses.',
      },
    ],
    prompts: [
      'Tamam, plan basit. Ben konuşacağım, siz ciddi ciddi başınızı sallayacaksınız.',
      'En son böyle dediğinde üç gün ağaçtan inememiştik.',
      'Sürpriz! Beni burada görmeyi beklemiyordunuz, değil mi?',
      'O gün ormanda herkesin bir planı vardı. Hiçbiri işe yaramadı.',
    ],
  },
  {
    id: 2,
    title: 'Son Sözü Sen Söyle',
    category: 'Final Sahnesi',
    start: 0,
    duration: 15,
    poster: '/scene-2.jpg',
    video: '/scene-2.mp4',
    mood: 'Büyük hesaplaşmanın sonu. Finale kendi yorumunu kat!',
    roles: ['Büyük Patron', 'Son Gülen', 'Telaşlı Yardımcı', 'Anlatıcı'],
    roleDetails: [
      {
        id: 0,
        name: 'Büyük Patron',
        color: '#10b981',
        description: 'Meseleyi kestirip atmaya çalışan ağır abi.',
      },
      {
        id: 1,
        name: 'Son Gülen',
        color: '#f59e0b',
        description: 'Durumdan zevk alan ve son kozunu oynayan uyanık.',
      },
      {
        id: 2,
        name: 'Telaşlı Yardımcı',
        color: '#f43f5e',
        description: 'Her şeyi batırdığını son anda fark eden asistan.',
      },
      {
        id: 3,
        name: 'Anlatıcı',
        color: '#6366f1',
        description: 'Günün özetini geçen dramatik seslendirme.',
      },
    ],
    prompts: [
      'Bu meseleyi burada kapatıyoruz. Kimse bir daha havuç kelimesini kullanmayacak.',
      'Peki… turuncu uzun sebze diyebilir miyiz?',
      'Bir dakika! Kamerayı kapatmamışız!',
      'Ve böylece orman, tarihinin en tuhaf gününü geride bıraktı.',
    ],
  },
  {
    id: 3,
    title: 'Pazartesi Sendromu & Kaos',
    category: 'Meme & Mizah',
    start: 0,
    duration: 20,
    poster: '/scene-0.jpg',
    video: '/scene-0.mp4',
    mood: 'Ekip toplantısında herkes birbirine giriyor. Tipik bir pazartesi.',
    roles: ['Sinirli Patron', 'Stajyer', 'Kıdemli Yazılımcı', 'İnsan Kaynakları'],
    roleDetails: [
      {
        id: 0,
        name: 'Sinirli Patron',
        color: '#ef4444',
        description: 'Bütçe neden bitti diye hesap soran patron.',
      },
      {
        id: 1,
        name: 'Stajyer',
        color: '#38bdf8',
        description: 'Veritabanını yanlışlıkla silmiş ama henüz kimse bilmiyor.',
      },
      {
        id: 2,
        name: 'Kıdemli Yazılımcı',
        color: '#f59e0b',
        description: 'Benim kodumda hata yok, ortamda sorun var diyen kıdemli.',
      },
      {
        id: 3,
        name: 'İnsan Kaynakları',
        color: '#a855f7',
        description: 'Ortamı yumuşatmaya çalışan yoga tutkunu İK uzmanı.',
      },
    ],
    prompts: [
      'Proje neden hâlâ teslim edilmedi? Açıklama bekliyorum!',
      'Şey... prod veritabanına küçük bir DROP TABLE attım galiba.',
      'Yerel makinemde sorunsuz çalışıyordu, sunucuya kim dokundu?',
      'Arkadaşlar derin bir nefes alıyoruz... Pozitif enerjimizi koruyalım!',
    ],
    cues: [
      {
        id: 0,
        roleIndex: 0,
        roleName: 'Sinirli Patron',
        roleColor: '#ef4444',
        start: 0,
        end: 4.8,
        text: 'Proje neden hâlâ teslim edilmedi? Açıklama bekliyorum!',
      },
      {
        id: 1,
        roleIndex: 1,
        roleName: 'Stajyer',
        roleColor: '#38bdf8',
        start: 4.8,
        end: 9.8,
        text: 'Şey... prod veritabanına küçük bir DROP TABLE attım galiba.',
      },
      {
        id: 2,
        roleIndex: 2,
        roleName: 'Kıdemli Yazılımcı',
        roleColor: '#f59e0b',
        start: 9.8,
        end: 14.8,
        text: 'Yerel makinemde sorunsuz çalışıyordu, sunucuya kim dokundu?',
      },
      {
        id: 3,
        roleIndex: 3,
        roleName: 'İnsan Kaynakları',
        roleColor: '#a855f7',
        start: 14.8,
        end: 20,
        text: 'Arkadaşlar derin bir nefes alıyoruz... Pozitif enerjimizi koruyalım!',
      },
    ],
  },
];

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
  return [...scenes, ...custom];
}

export function getSceneById(sceneId: number, customList?: Scene[]): Scene {
  const all = getAllScenes(customList);
  return all.find((s) => s.id === sceneId) || scenes[0];
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

const cueBounds = [
  [0, 4.5, 9.5, 14.5, 20],
  [0, 5, 10, 15, 20],
  [0, 4, 7.5, 11, 15],
];

const cueLines = [
  [
    'Burası benim ormanım. Randevunuz var mı?',
    'Ben sadece bir havuç istemiştim.',
    'Sakin olun! Yavaşça uzaklaşalım.',
    'Sıradan bir sabah… sandıkları kadar.',
  ],
  [
    'Plan basit. Ben konuşacağım, siz başınızı sallayın.',
    'Son planında ağaçta mahsur kalmıştık!',
    'Sürpriz! Beni beklemiyordunuz, değil mi?',
    'Herkesin bir planı vardı. Hiçbiri tutmadı.',
  ],
  [
    'Bu mesele burada kapanmıştır.',
    'Havuç konusunu da mı?',
    'Dur! Kamera hâlâ açık!',
    'İşte ormanda sıradan bir gün.',
  ],
];

export function sceneCues(sceneId: number, customList?: Scene[]): Cue[] {
  const currentScene = getSceneById(sceneId, customList);
  if (currentScene.cues && currentScene.cues.length > 0) {
    return currentScene.cues;
  }
  const lines = cueLines[sceneId] || cueLines[0];
  const bounds = cueBounds[sceneId] || cueBounds[0];

  return lines.map((text, id) => {
    const roleIdx = id % currentScene.roles.length;
    const detail = currentScene.roleDetails[roleIdx];
    return {
      id,
      roleIndex: roleIdx,
      roleName: detail ? detail.name : currentScene.roles[roleIdx],
      roleColor: detail ? detail.color : '#d8fb51',
      text,
      start: bounds[id] ?? 0,
      end: bounds[id + 1] ?? (currentScene.duration || 20),
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
