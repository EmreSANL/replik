'use client';
import { Sparkles, Mic, ArrowRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { getSceneById, type Room } from '@/lib/scenes';

export default function RoleRevealDialog({
  open,
  room,
  playerId,
  onStart,
}: {
  open: boolean;
  room: Room;
  playerId: string;
  onStart: () => void;
}) {
  const scene = getSceneById(room.scene);
  const me = room.players.find((p) => p.id === playerId);
  const roleIndex = me?.role !== undefined && me.role >= 0 ? me.role : 0;
  const roleInfo = (scene.roleDetails && scene.roleDetails[roleIndex]) || {
    name: (scene.roles && scene.roles[roleIndex]) || 'Karakter',
    color: '#d8fb51',
    description: 'Doğaçlama yaparak karakterine can ver!',
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="role-reveal-dialog">
        <div className="role-reveal-container">
          <div className="role-reveal-header">
            <span className="role-reveal-badge">
              <Sparkles size={14} /> SENİN ROLÜN
            </span>
            <DialogTitle className="sr-only">Karakter Tanıtımı</DialogTitle>
            <DialogDescription className="sr-only">
              Bu sahnedeki karakteriniz ve replikleriniz.
            </DialogDescription>
          </div>

          <div
            className="role-card-display"
            style={{
              borderColor: roleInfo.color,
              boxShadow: `0 0 30px ${roleInfo.color}33`,
            }}
          >
            <div
              className="role-name-banner"
              style={{ backgroundColor: roleInfo.color }}
            >
              <h2>{roleInfo.name}</h2>
            </div>

            <div className="role-card-content">
              <span className="role-scene-label">
                {scene.title} · {scene.category}
              </span>
              <p className="role-desc">{roleInfo.description}</p>
              <div className="role-rules-box">
                <p>
                  🎙️ Karakterinin repliklerini belirlenen sürede seslendir.
                </p>
                <p>
                  🎭 Diğer oyuncuların ne seslendirdiğini finalde hep birlikte izleyeceksiniz!
                </p>
              </div>
            </div>
          </div>

          <button className="primary role-start-btn" onClick={onStart}>
            <Mic size={18} /> Sahneye Çık & Başla <ArrowRight size={18} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
