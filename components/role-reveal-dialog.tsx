'use client';
import { Mic, ArrowRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  playerCues,
  getCharacterColor,
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
    const color = '#F5E636';
    const curr = myRoleGroups.get(name) || { color, count: 0 };
    curr.count += 1;
    myRoleGroups.set(name, curr);
  });
  const myDistinctRoles: { name: string; color: string; count: number }[] = [];
  myRoleGroups.forEach((val, name) => {
    myDistinctRoles.push({ name, color: val.color, count: val.count });
  });

  const isSolo = room.players.length <= 1;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onStart(); }}>
      <DialogContent className="role-reveal-dialog">
        <div className="role-reveal-container">
          <div className="role-reveal-top-bar">
            <div className="role-reveal-badge">ROLLER DAĞITILDI</div>
            <DialogTitle className="sr-only">Rol Dağılımı</DialogTitle>
            <DialogDescription className="sr-only">
              Seslendireceğin karakterler.
            </DialogDescription>
          </div>

          <div className="role-reveal-scrollable">
            {/* Senin Rolün Kartı */}
            <div className="role-hero-card">
              <div className="role-hero-header">
                <span className="role-hero-eyebrow">
                  {myDistinctRoles.length > 1
                    ? 'SENİN KARAKTERLERİN'
                    : 'SENİN KARAKTERİN'}
                </span>
                <span className="role-hero-count-pill">
                  Toplam {myCues.length} Replik
                </span>
              </div>

              <div className="role-hero-char-list" style={{ marginBottom: 0 }}>
                {myDistinctRoles.map((r) => (
                  <div key={r.name} className="role-hero-char-badge">
                    <span
                      className="role-char-dot"
                      style={{ background: '#F5E636' }}
                    />
                    <strong className="role-char-title">{r.name}</strong>
                    <span className="role-char-cue-tag">{r.count} Replik</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Sadece çok oyunculu odalarda diğer oyuncuların rollerini göster */}
            {!isSolo && (
              <div className="role-dist-section">
                <div className="role-dist-section-header">
                  <span>ODADAKİ OYUNCULAR</span>
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
                    const pRoleGroup = new Map<
                      string,
                      { color: string; count: number }
                    >();
                    pCues.forEach((c) => {
                      const name = c.roleName || `${idx + 1}. Karakter`;
                      const color = getCharacterColor(
                        c.roleIndex ?? idx,
                        c.roleColor,
                      );
                      const curr = pRoleGroup.get(name) || { color, count: 0 };
                      curr.count += 1;
                      pRoleGroup.set(name, curr);
                    });
                    const pRoles: {
                      name: string;
                      color: string;
                      count: number;
                    }[] = [];
                    pRoleGroup.forEach((val, name) =>
                      pRoles.push({ name, color: val.color, count: val.count }),
                    );

                    const isMe = p.id === playerId;

                    return (
                      <div
                        key={p.id}
                        className={`role-dist-player-card ${isMe ? 'is-me' : ''}`}
                      >
                        <div className="role-dist-player-top">
                          <div className="role-dist-player-name-wrap">
                            <span className="role-dist-avatar">
                              {p.name[0]?.toLocaleUpperCase('tr') || '?'}
                            </span>
                            <strong className="role-dist-player-name">
                              {p.name}
                            </strong>
                            {isMe && (
                              <span className="role-dist-me-pill">SEN</span>
                            )}
                          </div>
                        </div>

                        <div className="role-dist-chars-row">
                          {pRoles.map((pr) => (
                            <span key={pr.name} className="role-dist-char-tag">
                              {pr.name} <small>({pr.count})</small>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="role-reveal-bottom-bar">
            <button className="primary role-start-btn" onClick={onStart}>
              <Mic size={18} /> Kayda Başla <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
