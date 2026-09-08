export const scenes = [
  {
    id: 0,
    title: 'Ormanda işler karıştı',
    start: 0,
    duration: 20,
    poster: '/scene-0.jpg',
    video: '/scene-0.mp4',
    mood: 'Bir sabah. Hiç beklenmedik bir misafir.',
    roles: ['Ormanın müdürü', 'Meraklı komşu', 'Panik arkadaş', 'Anlatıcı'],
    prompts: [
      'Burası benim ormanım. Toplantı yapacaksanız önce randevu alın!',
      'Ben sadece bir havuç istemiştim… bu kadar olay çıkacağını bilmiyordum.',
      'Arkadaşlar, sakin! Bence hep birlikte yavaşça uzaklaşalım.',
      'Her şey sıradan bir sabah gibi başlamıştı. En azından onlar öyle sanıyordu.',
    ],
  },
  {
    id: 1,
    title: 'Büyük karşılaşma',
    start: 0,
    duration: 20,
    poster: '/scene-1.jpg',
    video: '/scene-1.mp4',
    mood: 'Küçük bir sorun. Gereğinden büyük bir tepki.',
    roles: ['Cesur kahraman', 'Şüpheci dost', 'Gizli rakip', 'Anlatıcı'],
    prompts: [
      'Tamam, plan basit. Ben konuşacağım, siz ciddi ciddi başınızı sallayacaksınız.',
      'En son böyle dediğinde üç gün ağaçtan inememiştik.',
      'Sürpriz! Beni burada görmeyi beklemiyordunuz, değil mi?',
      'O gün ormanda herkesin bir planı vardı. Hiçbiri işe yaramadı.',
    ],
  },
  {
    id: 2,
    title: 'Son sözü sen söyle',
    start: 0,
    duration: 15,
    poster: '/scene-2.jpg',
    video: '/scene-2.mp4',
    mood: 'Finale kendi yorumunu kat.',
    roles: ['Büyük patron', 'Son gülen', 'Telaşlı yardımcı', 'Anlatıcı'],
    prompts: [
      'Bu meseleyi burada kapatıyoruz. Kimse bir daha havuç kelimesini kullanmayacak.',
      'Peki… turuncu uzun sebze diyebilir miyiz?',
      'Bir dakika! Kamerayı kapatmamışız!',
      'Ve böylece orman, tarihinin en tuhaf gününü geride bıraktı.',
    ],
  },
];
export type Player = {
  id: string;
  name: string;
  host: number;
  role: number;
  ready: number;
  audio: boolean;
  segments: number[];
};
export type Room = {
  serverNow: number;
  code: string;
  scene: number;
  status: string;
  playAt: number;
  players: Player[];
};

export type Cue = { id: number; start: number; end: number; text: string };
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
export function sceneCues(sceneId: number): Cue[] {
  return cueLines[sceneId].map((text, id) => ({
    id,
    text,
    start: cueBounds[sceneId][id],
    end: cueBounds[sceneId][id + 1],
  }));
}
export function playerCues(
  sceneId: number,
  playerIndex: number,
  playerCount: number,
) {
  return sceneCues(sceneId).filter((c) => c.id % playerCount === playerIndex);
}
export function timeLabel(seconds: number) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
