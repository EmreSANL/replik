'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Check, Film, Users, Clock, Edit3, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { scenes, getAllScenes, getCustomScenes, type Scene } from '@/lib/scenes';
import { getScenesFromSupabase } from '@/lib/supabase';

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
  const [customList, setCustomList] = useState<Scene[]>([]);

  useEffect(() => {
    if (!open) return;
    // Yerel ve Supabase sahnelerini birleştir
    const local = getCustomScenes();
    setCustomList(local);
    getScenesFromSupabase().then((sc) => {
      if (sc && sc.length > 0) {
        setCustomList(sc);
      }
    });
  }, [open]);

  const allAvailableScenes = getAllScenes(customList);

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
          <DialogTitle>SAHNE SEÇ & DEĞİŞTİR</DialogTitle>
          <DialogDescription>
            Ekibinizle seslendirmek istediğiniz sahneyi belirleyin veya editörde düzenleyin.
          </DialogDescription>
        </div>

        <div className="scene-picker-grid">
          {allAvailableScenes.map((s) => (
            <div
              key={s.id}
              className={`scene-picker-card ${selected === s.id ? 'active' : ''}`}
              onClick={() => setSelected(s.id)}
              style={{ cursor: 'pointer', position: 'relative' }}
            >
              <div
                className="scene-picker-thumb"
                style={{
                  backgroundImage: s.poster ? `url('${s.poster}')` : undefined,
                  backgroundColor: '#282b20',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <span className="scene-picker-cat">
                  {s.isCustom ? 'MEME / ÖZEL' : s.category}
                </span>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <h4>{s.title}</h4>
                  <Link
                    href={`/editor?sceneId=${s.id}`}
                    target="_blank"
                    onClick={(e) => e.stopPropagation()}
                    className="scene-picker-edit-btn"
                    title="Bu sahneyi ve altyazılarını yeni sekmede editörde düzenle"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#d8fb51',
                      background: 'rgba(216, 251, 81, 0.12)',
                      border: '1px solid rgba(216, 251, 81, 0.35)',
                      padding: '3px 7px',
                      borderRadius: '6px',
                      textDecoration: 'none',
                      flexShrink: 0,
                    }}
                  >
                    <Edit3 size={11} /> Düzenle ↗
                  </Link>
                </div>
                <p>{s.mood}</p>
                <span className="scene-picker-roles">
                  <Users size={13} /> {s.roles.join(', ')}
                </span>
              </div>
            </div>
          ))}

          {/* Yeni Sahne Yap Kartı */}
          <Link
            href="/editor"
            target="_blank"
            className="scene-picker-card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '24px 16px',
              border: '2px dashed #3e4133',
              background: 'rgba(25, 27, 20, 0.6)',
              borderRadius: '12px',
              textDecoration: 'none',
              minHeight: '160px',
            }}
          >
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: '#d8fb51',
                color: '#10110d',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '8px',
              }}
            >
              <Plus size={20} />
            </div>
            <strong style={{ color: '#f4f4e9', fontSize: '13px' }}>Yeni Meme Sahnesi Ekle</strong>
            <span style={{ color: '#8c8e82', fontSize: '11px', marginTop: '4px' }}>
              Editörde video yükle & seslendir ↗
            </span>
          </Link>
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
