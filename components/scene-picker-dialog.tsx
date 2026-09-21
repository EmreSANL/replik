'use client';
import { useState } from 'react';
import { Check, Film, Users, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { scenes } from '@/lib/scenes';

export default function ScenePickerDialog({
  open,
  currentScene,
  onOpenChange,
  onSelectScene,
}: {
  open: boolean;
  currentScene: number;
  onOpenChange: (open: boolean) => void;
  onSelectScene: (sceneId: number) => void;
}) {
  const [selected, setSelected] = useState(currentScene);

  function handleConfirm() {
    onSelectScene(selected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scene-picker-dialog">
        <div className="scene-picker-header">
          <div className="scene-picker-icon">
            <Film size={24} />
          </div>
          <DialogTitle>SAHNE SEÇ</DialogTitle>
          <DialogDescription>
            Ekibinizle seslendirmek istediğiniz sahneyi belirleyin.
          </DialogDescription>
        </div>

        <div className="scene-picker-grid">
          {scenes.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`scene-picker-card ${selected === s.id ? 'active' : ''}`}
              onClick={() => setSelected(s.id)}
            >
              <div
                className="scene-picker-thumb"
                style={{ backgroundImage: `url('${s.poster}')` }}
              >
                <span className="scene-picker-cat">{s.category}</span>
                <span className="scene-picker-dur">
                  <Clock size={12} /> 00:{s.duration}
                </span>
                {selected === s.id && (
                  <span className="scene-picker-badge">
                    <Check size={14} /> SEÇİLİ
                  </span>
                )}
              </div>
              <div className="scene-picker-meta">
                <h4>{s.title}</h4>
                <p>{s.mood}</p>
                <span className="scene-picker-roles">
                  <Users size={13} /> {s.roles.join(', ')}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="scene-picker-footer">
          <button className="secondary" onClick={() => onOpenChange(false)}>
            İptal
          </button>
          <button className="primary" onClick={handleConfirm}>
            <Check size={17} /> Bu Sahneyi Uygula
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
