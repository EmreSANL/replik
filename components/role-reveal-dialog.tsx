'use client';
import { Sparkles, Mic, ArrowRight, Users, Scale, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  getSceneById,
  playerCues,
  sceneCues,
  type Room,
  type Scene,
} from '@/lib/scenes';

export default function RoleRevealDialog({
  open,
  room,
  playerId,
  customScenes,
  onStart,
}: {
  open: boolean;
  room: Room;
  playerId: string;
  customScenes?: Scene[];
  onStart: () => void;
}) {
  const scene = getSceneById(room.scene, customScenes);
  const allCues = sceneCues(room.scene, customScenes);
  const myIdx = Math.max(
    0,
    room.players.findIndex((p) => p.id === playerId),
  );
  const preferredRoles = room.players.map((p) => p.role);
  const myCues = playerCues(
    room.scene,
    myIdx,
    room.players.length,
    customScenes,
    preferredRoles,
  );

  // Group distinct characters for "me"
  const myRoleGroups = new Map<string, { color: string; count: number }>();
  myCues.forEach((c) => {
    const name = c.roleName || 'Karakter';
    const color = c.roleColor || '#d8fb51';
    const curr = myRoleGroups.get(name) || { color, count: 0 };
    curr.count += 1;
    myRoleGroups.set(name, curr);
  });
  const myDistinctRoles: { name: string; color: string; count: number }[] = [];
  myRoleGroups.forEach((val, name) => {
    myDistinctRoles.push({ name, color: val.color, count: val.count });
  });

  const isSolo = room.players.length <= 1;
  const primaryRoleColor =
    myDistinctRoles[0]?.color ||
    scene.roleDetails?.[myIdx % Math.max(1, scene.roleDetails?.length || 1)]?.color ||
    '#d8fb51';

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="role-reveal-dialog">
        <div className="role-reveal-container">
          {/* Header */}
          <div className="role-reveal-top-bar">
            <div className="role-reveal-badge">
              <Sparkles size={14} /> KARAKTER & REPLİK DAĞILIMI
            </div>
            <DialogTitle className="sr-only">
              Karakter ve Replik Dağılım Tablosu
            </DialogTitle>
            <DialogDescription className="sr-only">
              Hangi oyuncunun hangi karakteri seslendireceğinin tablosu.
            </DialogDescription>
          </div>

          {/* Scrollable Content */}
          <div className="role-reveal-scrollable">
            {/* Hero Card for Current Player */}
            <div
              className="role-hero-card"
              style={{
                borderColor: `${primaryRoleColor}55`,
                boxShadow: `0 8px 32px ${primaryRoleColor}18`,
              }}
            >
              <div className="role-hero-header">
                <span className="role-hero-eyebrow">
                  {isSolo
                    ? '🎬 SOLO DUBLAJ MODU'
                    : myDistinctRoles.length > 1
                      ? '🎭 SENİN KARAKTERLERİN'
                      : '🎭 SENİN KARAKTERİN'}
                </span>
                <span className="role-hero-count-pill">
                  {myCues.length} / {allCues.length} Replik ({Math.round((myCues.length / Math.max(1, allCues.length)) * 100)}%)
                </span>
              </div>

              {/* Character List */}
              <div className="role-hero-char-list">
                {myDistinctRoles.map((r) => (
                  <div
                    key={r.name}
                    className="role-hero-char-badge"
                    style={{
                      borderColor: `${r.color}66`,
                      background: `${r.color}15`,
                      color: '#ffffff',
                    }}
                  >
                    <span
                      className="role-char-dot"
                      style={{ background: r.color }}
                    />
                    <strong className="role-char-title">{r.name}</strong>
                    <span
                      className="role-char-cue-tag"
                      style={{ background: `${r.color}33`, color: r.color }}
                    >
                      {r.count} Replik
                    </span>
                  </div>
                ))}
              </div>

              <div className="role-hero-scene-meta">
                <span>{scene.title}</span>
              </div>
            </div>

            {/* Fair Rule Callout */}
            <div className="role-rule-pill-box">
              <Scale size={15} className="role-rule-icon" />
              <span>
                <strong>1 Karakter = 1 Oyuncu:</strong> Aynı karakteri iki farklı kişi seslendirmez! Roller bölünmeden dengelendi.
              </span>
            </div>

            {/* Players Character Distribution List */}
            <div className="role-dist-section">
              <div className="role-dist-section-header">
                <Users size={14} />
                <span>ODADAKİ OYUNCU & ROL DAĞILIMI ({room.players.length} Oyuncu)</span>
              </div>

              <div className="role-player-dist-grid">
                {room.players.map((p, idx) => {
                  const pCues = playerCues(
                    room.scene,
                    idx,
                    room.players.length,
                    customScenes,
                    preferredRoles,
                  );
                  const pRoleGroup = new Map<string, { color: string; count: number }>();
                  pCues.forEach((c) => {
                    const name = c.roleName || scene.roles?.[idx % Math.max(1, scene.roles.length)] || `${idx + 1}. Karakter`;
                    const color = c.roleColor || scene.roleDetails?.[idx % Math.max(1, scene.roleDetails?.length || 1)]?.color || '#d8fb51';
                    const curr = pRoleGroup.get(name) || { color, count: 0 };
                    curr.count += 1;
                    pRoleGroup.set(name, curr);
                  });
                  const pRoles: { name: string; color: string; count: number }[] = [];
                  pRoleGroup.forEach((val, name) => pRoles.push({ name, color: val.color, count: val.count }));

                  const isMe = p.id === playerId;
                  const pPrimaryColor = pRoles[0]?.color || '#d8fb51';

                  return (
                    <div
                      key={p.id}
                      className={`role-dist-player-card ${isMe ? 'is-me' : ''}`}
                      style={{ borderColor: isMe ? `${pPrimaryColor}77` : undefined }}
                    >
                      <div className="role-dist-player-top">
                        <div className="role-dist-player-name-wrap">
                          <span
                            className="role-dist-avatar"
                            style={{ background: `${pPrimaryColor}22`, color: pPrimaryColor, borderColor: `${pPrimaryColor}55` }}
                          >
                            {p.name[0]?.toLocaleUpperCase('tr') || '?'}
                          </span>
                          <strong className="role-dist-player-name">{p.name}</strong>
                          {isMe && <span className="role-dist-me-pill">SEN</span>}
                        </div>
                        <span className="role-dist-cue-total">
                          {pCues.length} Replik
                        </span>
                      </div>

                      <div className="role-dist-chars-row">
                        {pRoles.map((pr) => (
                          <span
                            key={pr.name}
                            className="role-dist-char-tag"
                            style={{
                              borderColor: `${pr.color}44`,
                              color: pr.color,
                              background: `${pr.color}14`,
                            }}
                          >
                            🎭 {pr.name} <small>({pr.count})</small>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Flow Hint */}
            <div className="role-quick-hints">
              <div className="role-hint-item">
                <CheckCircle2 size={13} className="role-hint-icon" />
                <span>Replikten önce sahnenin orijinal sesi oynatılır, ardından mikrofonun kayda geçer.</span>
              </div>
              <div className="role-hint-item">
                <CheckCircle2 size={13} className="role-hint-icon" />
                <span>Herkes bitirdiği anda <strong>Büyük Final</strong> odadaki tüm oyuncularla birlikte eşzamanlı izlenir!</span>
              </div>
            </div>
          </div>

          {/* Fixed Bottom Action Bar */}
          <div className="role-reveal-bottom-bar">
            <button className="primary role-start-btn" onClick={onStart}>
              <Mic size={18} /> Tabloyu Gördüm · Sahneye Çık & Başla{' '}
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
