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
};
export type Room = {
  serverNow: number;
  code: string;
  scene: number;
  status: string;
  playAt: number;
  players: Player[];
};
