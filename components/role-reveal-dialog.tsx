'use client';
import { Sparkles, Mic, ArrowRight, Users, Scale } from 'lucide-react';
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
  const myCues = playerCues(
    room.scene,
    myIdx,
    room.players.length,
    customScenes,
  );
  const myRoleNames = Array.from(
    new Set(myCues.map((c) => c.roleName).filter(Boolean)),
  );
  const primaryRoleName =
    myRoleNames.join(' & ') ||
    (scene.roles && scene.roles[myIdx % Math.max(1, scene.roles.length)]) ||
    'Karakter';
  const primaryRoleColor =
    myCues[0]?.roleColor ||
    scene.roleDetails?.[myIdx % Math.max(1, scene.roleDetails.length)]?.color ||
    '#d8fb51';

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="role-reveal-dialog">
        <div className="role-reveal-container">
          <div className="role-reveal-header">
            <span className="role-reveal-badge">
              <Sparkles size={14} /> KARAKTER & REPLİK DAĞILIM TABLOSU
            </span>
            <DialogTitle className="sr-only">
              Karakter ve Replik Dağılım Tablosu
            </DialogTitle>
            <DialogDescription className="sr-only">
              Hangi oyuncunun hangi karakteri ve kaç repliği seslendireceğinin eşit dağılım tablosu.
            </DialogDescription>
          </div>

          <div
            className="role-card-display"
            style={{
              borderColor: primaryRoleColor,
              boxShadow: `0 0 30px ${primaryRoleColor}26`,
            }}
          >
            <div
              className="role-name-banner"
              style={{ backgroundColor: primaryRoleColor }}
            >
              <h2>SENİN ROLÜN: {primaryRoleName.toUpperCase()}</h2>
            </div>

            <div className="role-card-content">
              <span className="role-scene-label">
                {scene.title} · Toplam {allCues.length} Replik
              </span>

              <div className="fair-distribution-banner">
                <Scale size={15} />
                <span>
                  <strong>Eşit Replik Garantisi:</strong> Tüm replikler odadaki{' '}
                  {room.players.length} oyuncuya eşit sayıda ({myCues.length}{' '}
                  replik) paylaştırıldı.
                </span>
              </div>

              <div className="role-distribution-table-wrap">
                <div className="role-distribution-table-title">
                  <Users size={14} />
                  <span>ODADAKİ OYUNCU & KARAKTER TABLOSU</span>
                </div>
                <table className="role-distribution-table">
                  <thead>
                    <tr>
                      <th>Oyuncu</th>
                      <th>Seslendireceği Karakter</th>
                      <th>Replik Sayısı</th>
                      <th>Sıralar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {room.players.map((p, idx) => {
                      const pCues = playerCues(
                        room.scene,
                        idx,
                        room.players.length,
                        customScenes,
                      );
                      const pRoles = Array.from(
                        new Set(pCues.map((c) => c.roleName).filter(Boolean)),
                      );
                      const roleLabel =
                        pRoles.join(' / ') ||
                        scene.roles?.[idx % Math.max(1, scene.roles.length)] ||
                        `${idx + 1}. Karakter`;
                      const roleColor =
                        pCues[0]?.roleColor ||
                        scene.roleDetails?.[
                          idx % Math.max(1, scene.roleDetails?.length || 1)
                        ]?.color ||
                        '#d8fb51';
                      const cueIndices = pCues
                        .map((pc) => {
                          const globalIdx = allCues.findIndex(
                            (ac) => Number(ac.id) === Number(pc.id),
                          );
                          return `#${String(globalIdx + 1).padStart(2, '0')}`;
                        })
                        .slice(0, 5)
                        .join(', ');

                      return (
                        <tr
                          key={p.id}
                          className={p.id === playerId ? 'is-me-row' : ''}
                        >
                          <td>
                            <div className="table-player-cell">
                              <span
                                className="table-player-dot"
                                style={{ background: roleColor }}
                              />
                              <strong>{p.name}</strong>
                              {p.id === playerId && (
                                <span className="table-me-tag">SEN</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span
                              className="table-role-pill"
                              style={{
                                borderColor: `${roleColor}88`,
                                color: roleColor,
                                background: `${roleColor}18`,
                              }}
                            >
                              🎭 {roleLabel}
                            </span>
                          </td>
                          <td>
                            <strong className="table-cue-count">
                              {pCues.length} Replik
                            </strong>
                          </td>
                          <td className="table-cue-nums">
                            {cueIndices}
                            {pCues.length > 5 ? '…' : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="role-rules-box">
                <p>
                  🎙️ Sıra sana geldiğinde önce orijinal sahne oynatılacak, ardından dublajını kaydedeceksin.
                </p>
                <p>
                  🎬 Herkes repliklerini tamamladığı anda <strong>Büyük Final</strong> odadaki tüm oyuncularta aynı anda başlayacak!
                </p>
              </div>
            </div>
          </div>

          <button className="primary role-start-btn" onClick={onStart}>
            <Mic size={18} /> Tabloyu Gördüm · Sahneye Çık & Başla{' '}
            <ArrowRight size={18} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
