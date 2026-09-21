'use client';
/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/media-has-caption, jsx-a11y/label-has-associated-control */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Play,
  Pause,
  Plus,
  Trash2,
  Clock,
  Sparkles,
  Upload,
  Download,
  Film,
  Users,
  Check,
  RotateCcw,
  Volume2,
  VolumeX,
  ArrowLeft,
  Scissors,
  AudioLines,
  Wand2,
  Loader2,
  Cloud,
  CloudUpload,
  Music,
} from 'lucide-react';
import {
  type Scene,
  type Cue,
  type RoleInfo,
  saveCustomScene,
  getCustomScenes,
  deleteCustomScene,
  timeLabel,
} from '@/lib/scenes';
import { useWhisper } from '@/lib/use-whisper';
import { removeVocalsFromVideo } from '@/lib/vocal-remover';
import {
  uploadVideoToSupabase,
  saveSceneToSupabase,
  getScenesFromSupabase,
  deleteSceneFromSupabase,
} from '@/lib/supabase';

const COLOR_PALETTE = [
  '#ef4444', // Kırmızı
  '#38bdf8', // Açık Mavi
  '#f59e0b', // Turuncu
  '#a855f7', // Mor
  '#10b981', // Yeşil
  '#ec4899', // Pembe
  '#d8fb51', // Neon Sarı/Yeşil
  '#f97316', // Turuncu-Kırmızı
];

export default function EditorPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const instrumentalAudioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // Sahne bilgileri (Demo video yok, kullanıcı kendi videosunu yükler)
  const [sceneId, setSceneId] = useState<number>(() => Date.now());
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Meme & Mizah');
  const [mood, setMood] = useState('Rolleri paylaşın, en komik repliği patlatın.');
  const [videoUrl, setVideoUrl] = useState('');
  const [poster, setPoster] = useState('');

  // Video oynatıcı durumu
  const [duration, setDuration] = useState(20);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Vokal Kaldırma (İnsan Sesi Temizleme / M&E Track)
  const [instrumentalUrl, setInstrumentalUrl] = useState<string>('');
  const [isRemovingVocals, setIsRemovingVocals] = useState<boolean>(false);
  const [vocalProgress, setVocalProgress] = useState<number>(0);
  const [vocalStage, setVocalStage] = useState<string>('');
  const [audioMode, setAudioMode] = useState<'original' | 'instrumental'>('instrumental');

  // Supabase bulut depolama ve veritabanı durumu
  const [isUploadingToSupabase, setIsUploadingToSupabase] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [supabaseScenes, setSupabaseScenes] = useState<Scene[]>([]);

  // Roller ve Replikler
  const [roles, setRoles] = useState<RoleInfo[]>([
    { id: 0, name: '1. Karakter', color: '#ef4444', description: 'İlk konuşan karakter' },
    { id: 1, name: '2. Karakter', color: '#38bdf8', description: 'İkinci karakter' },
  ]);

  const [cues, setCues] = useState<Cue[]>([]);
  const [selectedCueId, setSelectedCueId] = useState<number>(0);
  const [livePreview, setLivePreview] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Supabase'den sahneleri çek
  useEffect(() => {
    void getScenesFromSupabase().then((sc) => {
      if (sc && sc.length > 0) {
        setSupabaseScenes(sc);
      } else {
        setSupabaseScenes(getCustomScenes());
      }
    });
  }, []);

  // AI Otomatik Altyazı
  const whisper = useWhisper();

  const handleAutoSubtitle = useCallback(async () => {
    if (!videoUrl) {
      showToast('⚠️ Lütfen önce bir video seçin veya yükleyin.');
      return;
    }
    try {
      showToast('🤖 Video sesi analiz ediliyor ve Türkçe konuşmalar tanınıyor...');
      const result = await whisper.transcribe(videoUrl, roles, duration, 'turkish');
      if (result.cues && result.cues.length > 0) {
        setCues(result.cues);
        setSelectedCueId(result.cues[0].id);
        showToast(`🎉 ${result.cues.length} replik yapay zeka ile otomatik oluşturuldu!`);
      } else {
        showToast('ℹ️ Videoda belirgin bir konuşma sesi bulunamadı.');
      }
    } catch (err) {
      showToast(`❌ Hata: ${(err as Error).message}`);
    }
  }, [videoUrl, roles, duration, whisper, showToast]);

  // Video zaman güncellemesi
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      if (dur && !isNaN(dur) && isFinite(dur)) {
        setDuration(dur);
      }
    }
  };

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      instrumentalAudioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (audioMode === 'instrumental' && instrumentalUrl && instrumentalAudioRef.current) {
        videoRef.current.muted = true;
        instrumentalAudioRef.current.currentTime = videoRef.current.currentTime;
        instrumentalAudioRef.current.muted = isMuted;
        instrumentalAudioRef.current.play().catch(() => {});
      } else {
        videoRef.current.muted = isMuted;
        instrumentalAudioRef.current?.pause();
      }
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying, audioMode, instrumentalUrl, isMuted]);

  const seekTo = useCallback((time: number) => {
    if (!videoRef.current) return;
    const clamped = Math.max(0, Math.min(duration, time));
    videoRef.current.currentTime = clamped;
    if (instrumentalAudioRef.current) {
      instrumentalAudioRef.current.currentTime = clamped;
    }
    setCurrentTime(clamped);
  }, [duration]);

  // Seçili repliğin başlangıcını şu anki video süresi yap
  const markCurrentTimeAsStart = useCallback(() => {
    const time = Number(currentTime.toFixed(2));
    setCues((prev) =>
      prev.map((c) => {
        if (c.id === selectedCueId) {
          const end = c.end <= time ? Number((time + 2.0).toFixed(2)) : c.end;
          return { ...c, start: time, end };
        }
        return c;
      }),
    );
    showToast(`⏱️ Başlangıç [${time.toFixed(2)}s] olarak ayarlandı.`);
  }, [currentTime, selectedCueId, showToast]);

  // Seçili repliğin bitişini şu anki video süresi yap
  const markCurrentTimeAsEnd = useCallback(() => {
    const time = Number(currentTime.toFixed(2));
    setCues((prev) =>
      prev.map((c) => {
        if (c.id === selectedCueId) {
          const start =
            c.start >= time ? Math.max(0, Number((time - 1.0).toFixed(2))) : c.start;
          return { ...c, start, end: time };
        }
        return c;
      }),
    );
    showToast(`⏱️ Bitiş [${time.toFixed(2)}s] olarak ayarlandı.`);
  }, [currentTime, selectedCueId, showToast]);

  // Kısayol tuşları
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Eğer kullanıcı bir input/textarea içinde yazıyorsa kısayolları tetikleme
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === '[') {
        e.preventDefault();
        markCurrentTimeAsStart();
      } else if (e.key === ']') {
        e.preventDefault();
        markCurrentTimeAsEnd();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(currentTime - (e.shiftKey ? 0.1 : 1.0));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(currentTime + (e.shiftKey ? 0.1 : 1.0));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, markCurrentTimeAsStart, markCurrentTimeAsEnd, togglePlay, duration, seekTo]);

  // Seçili repliği oynat
  const playCueOnly = (cue: Cue) => {
    if (!videoRef.current) return;
    seekTo(cue.start);
    videoRef.current.play().catch(() => {});
    setIsPlaying(true);

    const checkStop = () => {
      if (videoRef.current && videoRef.current.currentTime >= cue.end) {
        videoRef.current.pause();
        setIsPlaying(false);
        videoRef.current.removeEventListener('timeupdate', checkStop);
      }
    };
    videoRef.current.addEventListener('timeupdate', checkStop);
  };

  // Yeni replik ekle
  const addCue = () => {
    const lastCue = cues[cues.length - 1];
    const newStart = lastCue ? Number((lastCue.end + 0.2).toFixed(2)) : Number(currentTime.toFixed(2));
    const newEnd = Number(Math.min(duration, newStart + 3.5).toFixed(2));
    const nextRoleIdx = (cues.length) % roles.length;
    const role = roles[nextRoleIdx] || roles[0];

    const newCue: Cue = {
      id: Date.now(),
      roleIndex: nextRoleIdx,
      roleName: role.name,
      roleColor: role.color,
      start: newStart,
      end: newEnd,
      text: 'Yeni replik metni...',
    };

    setCues((prev) => [...prev, newCue]);
    setSelectedCueId(newCue.id);
    seekTo(newStart);
    showToast('✨ Yeni replik satırı eklendi.');
  };

  // Replik güncelle
  const updateCue = (id: number, updates: Partial<Cue>) => {
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, ...updates };
        if (updates.roleIndex !== undefined) {
          const r = roles[updates.roleIndex];
          if (r) {
            updated.roleName = r.name;
            updated.roleColor = r.color;
          }
        }
        return updated;
      }),
    );
  };

  // Replik sil
  const removeCue = (id: number) => {
    if (cues.length <= 1) {
      showToast('⚠️ En az bir replik satırı bulunmalıdır.');
      return;
    }
    setCues((prev) => prev.filter((c) => c.id !== id));
    if (selectedCueId === id) {
      const remaining = cues.filter((c) => c.id !== id);
      if (remaining.length > 0) setSelectedCueId(remaining[0].id);
    }
  };

  // Karakter Ekle
  const addRole = () => {
    if (roles.length >= 6) {
      showToast('⚠️ Maksimum 6 karakter eklenebilir.');
      return;
    }
    const id = roles.length;
    const newRole: RoleInfo = {
      id,
      name: `${id + 1}. Karakter`,
      color: COLOR_PALETTE[id % COLOR_PALETTE.length],
      description: 'Karakter rol açıklaması',
    };
    setRoles((prev) => [...prev, newRole]);
    showToast(`🎭 ${newRole.name} eklendi.`);
  };

  // Karakter Güncelle
  const updateRole = (id: number, updates: Partial<RoleInfo>) => {
    setRoles((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, ...updates };
        return updated;
      }),
    );
    // Rol ad veya rengi değiştiğinde o role ait replikleri de güncelle
    setCues((prev) =>
      prev.map((c) => {
        if (c.roleIndex === id) {
          return {
            ...c,
            roleName: updates.name ?? c.roleName,
            roleColor: updates.color ?? c.roleColor,
          };
        }
        return c;
      }),
    );
  };

  // Video işleme fonksiyonu (Önizleme + Supabase Yükleme + AI Transkripsiyon)
  const processVideoFile = useCallback(
    (file: File) => {
      // 1. Yerel hızlı önizleme
      const localUrl = URL.createObjectURL(file);
      setVideoUrl(localUrl);
      const videoTitle = file.name.replace(/\.[^/.]+$/, '').slice(0, 35);
      setTitle(videoTitle);

      const tempVideo = document.createElement('video');
      tempVideo.src = localUrl;
      tempVideo.crossOrigin = 'anonymous';
      tempVideo.muted = true;
      tempVideo.currentTime = 1.0;
      tempVideo.onloadedmetadata = () => {
        if (
          tempVideo.duration &&
          !isNaN(tempVideo.duration) &&
          isFinite(tempVideo.duration)
        ) {
          setDuration(tempVideo.duration);
        }
      };
      tempVideo.onloadeddata = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 480;
          canvas.height = 270;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setPoster(dataUrl);
        } catch {}
      };

      showToast(`🎬 Video seçildi! Supabase bulutuna yükleniyor ve yapay zeka analiz ediyor...`);

      // 2. Supabase Storage bulutuna arka planda yükle
      setIsUploadingToSupabase(true);
      setUploadProgress(15);
      uploadVideoToSupabase(file, file.name, (pct) => setUploadProgress(pct))
        .then(({ url }) => {
          setVideoUrl(url); // Artık herkese açık kalıcı Supabase URL'si
          setIsUploadingToSupabase(false);
          showToast('☁️ Video Supabase Storage bulutuna başarıyla yüklendi!');
        })
        .catch((err) => {
          setIsUploadingToSupabase(false);
          console.warn('Supabase storage uyarısı:', err);
        });

      // 3. Yapay zeka ile otomatik konuşma tanıma ve zamanlama
      const videoDur = duration > 0 ? duration : 30;
      whisper
        .transcribe(file, roles, videoDur, 'turkish')
        .then((result) => {
          if (result.cues && result.cues.length > 0) {
            setCues(result.cues);
            setSelectedCueId(result.cues[0].id);
            showToast(`🎉 ${result.cues.length} replik otomatik oluşturuldu!`);
          } else {
            showToast('ℹ️ Videoda belirgin konuşma tespit edilemedi.');
          }
        })
        .catch((err) => {
          showToast(`⚠️ Altyazı analizi: ${(err as Error).message}`);
        });

      // 4. Videodaki insan seslerini (vokalleri) otomatik temizle (M&E Track)
      setIsRemovingVocals(true);
      setVocalProgress(15);
      setVocalStage('Ses ayrıştırılıyor...');
      removeVocalsFromVideo(file, file.name, (stage, pct) => {
        setVocalStage(stage);
        setVocalProgress(pct);
      })
        .then((res) => {
          setInstrumentalUrl(res.url);
          setIsRemovingVocals(false);
          setAudioMode('instrumental');
          showToast('🎵 Videodaki insan sesleri temizlendi! (Müzik ve efektler korundu)');
        })
        .catch((err) => {
          setIsRemovingVocals(false);
          console.warn('Vokal temizleme uyarısı:', err);
        });
    },
    [duration, roles, whisper, showToast],
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processVideoFile(file);
  };

  const handleManualVocalRemoval = useCallback(async () => {
    if (!videoUrl) {
      showToast('⚠️ Lütfen önce bir video seçin veya yükleyin.');
      return;
    }
    setIsRemovingVocals(true);
    setVocalProgress(10);
    setVocalStage('Ses ayrıştırılıyor...');
    try {
      showToast('🎙️ İnsan sesleri temizleniyor, arka plan müziği çıkarılıyor...');
      const res = await removeVocalsFromVideo(videoUrl, title || 'instrumental', (stage, pct) => {
        setVocalStage(stage);
        setVocalProgress(pct);
      });
      setInstrumentalUrl(res.url);
      setAudioMode('instrumental');
      showToast('🎵 İnsan sesleri başarıyla temizlendi! Vokalsiz müzik hazır.');
    } catch (err) {
      showToast(`⚠️ Vokal temizleme hatası: ${(err as Error).message}`);
    } finally {
      setIsRemovingVocals(false);
    }
  }, [videoUrl, title, showToast]);

  // Supabase Sahnesi Yükle
  const loadSupabaseScene = (sc: Scene) => {
    setSceneId(sc.id);
    setTitle(sc.title);
    setCategory(sc.category);
    setMood(sc.mood || 'Meme');
    setVideoUrl(sc.video);
    setPoster(sc.poster || '');
    if (sc.roleDetails && sc.roleDetails.length > 0) {
      setRoles(sc.roleDetails);
    } else if (sc.roles) {
      setRoles(
        sc.roles.map((r, i) => ({
          id: i,
          name: typeof r === 'string' ? r : (r as unknown as RoleInfo).name,
          color: COLOR_PALETTE[i % COLOR_PALETTE.length],
          description: '',
        })),
      );
    }
    if (sc.cues) setCues(sc.cues);
    setSelectedCueId(sc.cues?.[0]?.id ?? 0);
    if (sc.instrumental) {
      setInstrumentalUrl(sc.instrumental);
      setAudioMode('instrumental');
    } else {
      setInstrumentalUrl('');
      setAudioMode('original');
    }
    showToast(`☁️ "${sc.title}" sahnesi Supabase'den yüklendi.`);
  };

  // Supabase Sahnesi Sil
  const handleDeleteSupabaseScene = async (id: number, scTitle: string) => {
    try {
      await deleteSceneFromSupabase(id);
      deleteCustomScene(id);
      setSupabaseScenes((prev) => prev.filter((s) => s.id !== id));
      showToast(`🗑️ "${scTitle}" Supabase'den silindi.`);
    } catch {
      deleteCustomScene(id);
      setSupabaseScenes((prev) => prev.filter((s) => s.id !== id));
      showToast(`🗑️ "${scTitle}" silindi.`);
    }
  };

  // Sahneyi Supabase'e Kaydet ve Oyuna Ekle
  const handleSaveScene = async () => {
    if (!videoUrl) {
      showToast('⚠️ Lütfen önce bir video yükleyin.');
      return;
    }
    const sortedCues = [...cues].sort((a, b) => a.start - b.start);
    const calculatedDuration = Math.max(
      duration,
      sortedCues.length > 0 ? sortedCues[sortedCues.length - 1].end : 0,
    );

    const newScene: Scene = {
      id: sceneId,
      title: title.trim() || 'Meme Sahnesi',
      category: category.trim() || 'Meme & Mizah',
      start: 0,
      duration: Math.round(calculatedDuration),
      poster: poster || '',
      video: videoUrl,
      mood: mood.trim() || 'Doğaçlama komedi',
      roles: roles.map((r) => r.name),
      roleDetails: roles,
      prompts: sortedCues.map((c) => c.text),
      cues: sortedCues,
      instrumental: instrumentalUrl || undefined,
      isCustom: true,
    };

    try {
      showToast('☁️ Sahne Supabase veritabanına kaydediliyor...');
      await saveSceneToSupabase(newScene);
      saveCustomScene(newScene); // yerel yedek
      setSupabaseScenes((prev) => [newScene, ...prev.filter((s) => s.id !== newScene.id)]);
      showToast(`🎉 "${newScene.title}" Supabase'e kaydedildi ve oyuna eklendi!`);
    } catch (err) {
      saveCustomScene(newScene);
      showToast(`⚠️ Supabase uyarısı: ${(err as Error).message}. Yerel olarak kaydedildi.`);
    }
  };

  // JSON Dışa Aktar
  const exportJson = () => {
    const sceneData = {
      title,
      category,
      mood,
      videoUrl,
      poster,
      duration,
      roles,
      cues,
    };
    const blob = new Blob([JSON.stringify(sceneData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, '-')}-scene.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Sahne JSON dosyası indirildi.');
  };

  // JSON İçe Aktar
  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.title) setTitle(data.title);
        if (data.category) setCategory(data.category);
        if (data.mood) setMood(data.mood);
        if (data.videoUrl) setVideoUrl(data.videoUrl);
        if (data.poster) setPoster(data.poster);
        if (data.roles) setRoles(data.roles);
        if (data.cues) setCues(data.cues);
        showToast('📤 Sahne JSON dosyası başarıyla aktarıldı.');
      } catch {
        showToast('❌ Geçersiz JSON dosyası.');
      }
    };
    reader.readAsText(file);
  };

  // O anki aktif replik (Canlı dublaj önizlemesi için)
  const currentActiveCue = useMemo(() => {
    return cues.find((c) => currentTime >= c.start && currentTime <= c.end);
  }, [cues, currentTime]);

  return (
    <div className="min-h-screen bg-[#10110d] text-[#f4f4e9] flex flex-col font-sans">
      {/* ÜST BAR */}
      <header className="border-b border-[#292a23] bg-[#151610]/95 backdrop-blur px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-[#d8fb51] font-bold text-lg hover:opacity-80 transition"
          >
            <AudioLines size={22} />
            <span>replik<sup className="text-xs">®</sup></span>
          </Link>
          <span className="text-[#404238]">/</span>
          <div className="flex items-center gap-2">
            <span className="bg-[#d8fb51]/15 text-[#d8fb51] text-xs font-semibold px-2.5 py-1 rounded-full border border-[#d8fb51]/30 flex items-center gap-1">
              <Sparkles size={13} />
              MEME & SAHNE EDİTÖRÜ
            </span>
          </div>
        </div>

        {/* Aksiyon Butonları */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLivePreview(!livePreview)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition border ${
              livePreview
                ? 'bg-[#d8fb51] text-[#10110d] border-[#d8fb51] font-semibold'
                : 'bg-[#20211b] hover:bg-[#2a2b23] text-[#f4f4e9] border-[#36372f]'
            }`}
          >
            <Sparkles size={14} />
            {livePreview ? 'Önizlemeden Çık' : 'Canlı Dublaj Önizle'}
          </button>

          <button
            onClick={exportJson}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#20211b] hover:bg-[#2a2b23] text-[#f4f4e9] border border-[#36372f] flex items-center gap-1.5 transition"
            title="JSON Olarak İndir"
          >
            <Download size={14} />
            JSON
          </button>

          <button
            onClick={() => jsonInputRef.current?.click()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#20211b] hover:bg-[#2a2b23] text-[#f4f4e9] border border-[#36372f] flex items-center gap-1.5 transition"
            title="JSON Yükle"
          >
            <Upload size={14} />
            İçe Aktar
          </button>
          <input
            ref={jsonInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleJsonUpload}
          />

          <button
            onClick={handleSaveScene}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#d8fb51] hover:bg-[#e4ff6b] text-[#12130e] flex items-center gap-1.5 shadow-lg shadow-[#d8fb51]/10 transition cursor-pointer"
          >
            <Check size={15} />
            Kaydet & Oyuna Ekle
          </button>

          <Link
            href="/"
            className="ml-2 px-3 py-1.5 rounded-lg text-xs text-[#a4a69b] hover:text-[#f4f4e9] flex items-center gap-1 transition"
          >
            <ArrowLeft size={14} />
            Oyuna Dön
          </Link>
        </div>
      </header>

      {/* TOAST BİLDİRİMİ */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1e2017] border border-[#d8fb51]/50 text-[#f4f4e9] px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 animate-bounce text-sm">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ANA İÇERİK - İKİ SÜTUNLU DÜZEN */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 max-w-[1700px] w-full mx-auto">
        
        {/* SOL PANEL: VİDEO OYNATICI & ZAMAN ÇİZELGESİ (7 SÜTUN) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          
          {/* VİDEO VE ÖNİZLEME ALANI */}
          <div className="bg-[#181913] border border-[#2d2e26] rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
            
            {/* Üst Sekmeler: Video Kaynağı */}
            <div className="flex items-center justify-between pb-2 border-b border-[#292a23]">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#282a20] hover:bg-[#34362a] text-[#d8fb51] border border-[#3e4132] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Upload size={14} />
                  Kendi Meme Videonu Yükle
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  onClick={handleAutoSubtitle}
                  disabled={whisper.isProcessing}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-[#d8fb51] to-[#bbf438] text-[#12130e] hover:brightness-110 flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-[#d8fb51]/10"
                  title="Videodaki Türkçe konuşmaları yapay zeka ile otomatik zamanlayıp altyazıya dönüştür"
                >
                  {whisper.isProcessing ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>{whisper.statusMessage || 'AI İşliyor...'}</span>
                    </>
                  ) : (
                    <>
                      <Wand2 size={14} />
                      <span>AI ile Otomatik Altyazı</span>
                    </>
                  )}
                </button>
              </div>

              {/* Sağ Taraf: Supabase Sahneleri ve Durum */}
              <div className="flex items-center gap-2">
                {isUploadingToSupabase && (
                  <span className="text-[11px] text-[#38bdf8] bg-[#102431] border border-[#1e445d] px-2.5 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                    <CloudUpload size={12} className="animate-spin text-[#38bdf8]" />
                    Supabase Bulutuna Yükleniyor... %{uploadProgress}
                  </span>
                )}

                {supabaseScenes.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#38bdf8] font-semibold flex items-center gap-1">
                      <Cloud size={13} /> Supabase Sahneleri:
                    </span>
                    <div className="flex items-center gap-1 max-w-[280px] overflow-x-auto py-0.5">
                      {supabaseScenes.map((sc) => (
                        <div
                          key={sc.id}
                          className="flex items-center bg-[#1b221a] border border-[#2e3e2d] rounded-lg px-2 py-0.5 text-xs shrink-0"
                        >
                          <button
                            onClick={() => loadSupabaseScene(sc)}
                            className="text-[#c9cbbe] hover:text-[#d8fb51] truncate max-w-[90px] font-medium"
                            title={sc.title}
                          >
                            {sc.title}
                          </button>
                          <button
                            onClick={() => handleDeleteSupabaseScene(sc.id, sc.title)}
                            className="text-[#727566] hover:text-[#ff7878] ml-1.5 text-xs font-bold"
                            title="Sahneyi Sil"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Vokal Ayrıştırma / Dublaj Müziği Butonları */}
                {isRemovingVocals ? (
                  <span className="text-[11px] text-[#c084fc] bg-[#211432] border border-[#532b78] px-2.5 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                    <Loader2 size={12} className="animate-spin text-[#c084fc]" />
                    <span>Vokal Temizleniyor... %{vocalProgress} ({vocalStage})</span>
                  </span>
                ) : instrumentalUrl ? (
                  <div className="flex items-center gap-1 bg-[#1a1426] border border-[#3e275f] rounded-lg p-0.5">
                    <button
                      onClick={() => {
                        setAudioMode('instrumental');
                        if (videoRef.current) videoRef.current.muted = true;
                        if (instrumentalAudioRef.current) {
                          instrumentalAudioRef.current.currentTime = videoRef.current?.currentTime || 0;
                          if (isPlaying) instrumentalAudioRef.current.play().catch(() => {});
                        }
                      }}
                      className={`px-2 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1 ${
                        audioMode === 'instrumental'
                          ? 'bg-[#a855f7] text-white shadow'
                          : 'text-[#a78bfa] hover:text-white'
                      }`}
                      title="Sadece arka plan müziği ve ses efektleri (insan sesleri silinmiş dublaj kanalı)"
                    >
                      <Music size={12} />
                      Vokalsiz Müzik
                    </button>
                    <button
                      onClick={() => {
                        setAudioMode('original');
                        if (instrumentalAudioRef.current) instrumentalAudioRef.current.pause();
                        if (videoRef.current) videoRef.current.muted = isMuted;
                      }}
                      className={`px-2 py-1 rounded-md text-[11px] font-bold transition ${
                        audioMode === 'original'
                          ? 'bg-[#374151] text-white'
                          : 'text-[#9ca3af] hover:text-white'
                      }`}
                      title="Videonun orijinal konuşmalı sesi"
                    >
                      🎙️ Orijinal Ses
                    </button>
                  </div>
                ) : (
                  videoUrl && (
                    <button
                      onClick={handleManualVocalRemoval}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#2a173d] hover:bg-[#3d2059] text-[#c084fc] border border-[#582e80] flex items-center gap-1.5 transition cursor-pointer"
                      title="Videodaki insan sesini kaldırıp sadece arka plan müziğini ve efektleri bırak"
                    >
                      <Music size={13} />
                      İnsan Sesini Kaldır
                    </button>
                  )
                )}

                {videoUrl && (
                  <button
                    onClick={() => {
                      setVideoUrl('');
                      setPoster('');
                      setCues([]);
                      setTitle('');
                      setInstrumentalUrl('');
                      showToast('🗑️ Video kaldırıldı. Yeni bir video yükleyebilirsiniz.');
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs bg-[#241a1a] hover:bg-[#382222] text-[#ff7878] border border-[#442828] flex items-center gap-1 transition"
                    title="Mevcut videoyu kaldırıp yeni bir video yükle"
                  >
                    Videoyu Değiştir
                  </button>
                )}
              </div>
            </div>

            {/* Video Kutusu */}
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-[#2a2c22] flex items-center justify-center group">
              {!videoUrl ? (
                /* YÜKLEME ALANI (DROPZONE) - Demo video kaldırıldı, doğrudan kullanıcı videosu yüklenir */
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const f = e.dataTransfer.files?.[0];
                    if (f) processVideoFile(f);
                  }}
                  className="w-full h-full flex flex-col items-center justify-center gap-3.5 p-8 text-center border-2 border-dashed border-[#3d4030] hover:border-[#d8fb51] bg-[#12130e]/95 transition cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-2xl bg-[#1d1f16] border border-[#323624] flex items-center justify-center text-[#d8fb51] group-hover:scale-110 group-hover:border-[#d8fb51]/50 transition shadow-2xl">
                    <CloudUpload size={32} />
                  </div>
                  <div className="flex flex-col gap-1 max-w-md">
                    <h3 className="text-base font-bold text-[#f4f4e9] group-hover:text-[#d8fb51] transition">
                      Kendi Meme Videonuzu Buraya Yükleyin
                    </h3>
                    <p className="text-xs text-[#8c8e82] leading-relaxed">
                      Video dosyanızı (MP4, WebM, MOV) sürükleyip bırakın veya seçmek için tıklayın.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[#a4a69b] bg-[#181a13] px-3.5 py-1.5 rounded-full border border-[#2c2f22]">
                    <span className="text-[#38bdf8] font-semibold flex items-center gap-1">
                      <Cloud size={12} /> Supabase Cloud Depolama
                    </span>
                    <span>•</span>
                    <span className="text-[#d8fb51] font-semibold flex items-center gap-1">
                      <Wand2 size={12} /> AI Türkçe Altyazı
                    </span>
                  </div>
                  <button
                    type="button"
                    className="mt-1 px-5 py-2.5 rounded-xl text-xs font-bold bg-[#d8fb51] hover:bg-[#e4ff6b] text-[#12130e] flex items-center gap-2 shadow-lg shadow-[#d8fb51]/20 transition cursor-pointer"
                  >
                    <Upload size={15} />
                    Video Seç & Yükle
                  </button>
                </div>
              ) : (
                /* AKTİF VİDEO OYNATICI */
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    poster={poster}
                    playsInline
                    muted={audioMode === 'instrumental' && Boolean(instrumentalUrl) ? true : isMuted}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => {
                      if (audioMode === 'instrumental' && instrumentalUrl && instrumentalAudioRef.current) {
                        instrumentalAudioRef.current.currentTime = videoRef.current?.currentTime || 0;
                        instrumentalAudioRef.current.play().catch(() => {});
                      }
                      setIsPlaying(true);
                    }}
                    onPause={() => {
                      if (instrumentalAudioRef.current) {
                        instrumentalAudioRef.current.pause();
                      }
                      setIsPlaying(false);
                    }}
                    onSeeked={() => {
                      if (instrumentalAudioRef.current && videoRef.current) {
                        instrumentalAudioRef.current.currentTime = videoRef.current.currentTime;
                      }
                    }}
                    onEnded={() => {
                      setIsPlaying(false);
                      if (instrumentalAudioRef.current) {
                        instrumentalAudioRef.current.pause();
                        instrumentalAudioRef.current.currentTime = 0;
                      }
                    }}
                    className="w-full h-full object-contain cursor-pointer"
                    onClick={togglePlay}
                  />

                  {/* Senkronize Vokalsiz Dublaj / Karaoke Müziği */}
                  {instrumentalUrl && (
                    <audio
                      ref={instrumentalAudioRef}
                      src={instrumentalUrl}
                      preload="auto"
                      playsInline
                      style={{ display: 'none' }}
                    />
                  )}

              {/* CANLI DUBLAJ / OYUN ALTYAZI KATMANI */}
              {currentActiveCue && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-xl bg-black/85 backdrop-blur-md border border-white/20 rounded-xl p-3.5 shadow-2xl flex flex-col gap-1.5 pointer-events-none animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span
                      className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white shadow"
                      style={{ backgroundColor: currentActiveCue.roleColor }}
                    >
                      {currentActiveCue.roleName}
                    </span>
                    <span className="text-[11px] text-white/70 font-mono">
                      {timeLabel(currentTime)} / {timeLabel(currentActiveCue.end)}
                    </span>
                  </div>
                  <p className="text-base sm:text-lg font-bold text-white leading-tight text-center drop-shadow">
                    “{currentActiveCue.text}”
                  </p>
                  {/* Replik Geri Sayım İlerleme Çubuğu */}
                  <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full transition-all duration-75"
                      style={{
                        backgroundColor: currentActiveCue.roleColor,
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            ((currentTime - currentActiveCue.start) /
                              Math.max(0.1, currentActiveCue.end - currentActiveCue.start)) *
                              100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Oynat/Durdur Orta Butonu (Videoya tıklayınca) */}
              {!isPlaying && (
                <button
                  onClick={togglePlay}
                  className="absolute p-4 rounded-full bg-black/60 text-[#d8fb51] border border-white/20 backdrop-blur hover:scale-110 transition shadow-2xl"
                  aria-label="Oynat"
                >
                  <Play size={32} fill="currentColor" />
                </button>
              )}
            </>
          )}
        </div>

            {/* VİDEO KONTROLLERİ & ZAMAN GÖSTERGESİ */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlay}
                  className="p-2 rounded-lg bg-[#282a21] hover:bg-[#35372b] text-[#d8fb51] transition"
                  title="Oynat / Durdur (Space)"
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
                </button>

                <button
                  onClick={() => seekTo(0)}
                  className="p-2 rounded-lg bg-[#20211b] hover:bg-[#2b2d24] text-[#a4a69b] hover:text-[#f4f4e9] transition"
                  title="Başa Sar"
                >
                  <RotateCcw size={16} />
                </button>

                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="p-2 rounded-lg bg-[#20211b] hover:bg-[#2b2d24] text-[#a4a69b] hover:text-[#f4f4e9] transition"
                  title="Ses Aç / Kapa"
                >
                  {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>

                {/* Hız Seçici */}
                <select
                  value={playbackRate}
                  onChange={(e) => {
                    const r = parseFloat(e.target.value);
                    setPlaybackRate(r);
                    if (videoRef.current) videoRef.current.playbackRate = r;
                  }}
                  className="bg-[#20211b] border border-[#33352a] text-[#c9cbbe] text-xs px-2 py-1.5 rounded-lg"
                >
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1.0}>1.0x (Normal)</option>
                  <option value={1.25}>1.25x</option>
                </select>
              </div>

              {/* Büyük Dijital Süre Göstergesi */}
              <div className="font-mono text-sm tracking-wider flex items-center gap-1.5 bg-[#12130e] px-3 py-1.5 rounded-lg border border-[#2b2c23]">
                <Clock size={15} className="text-[#d8fb51]" />
                <span className="text-[#d8fb51] font-bold">{timeLabel(currentTime)}</span>
                <span className="text-[#5b5e50]">/</span>
                <span className="text-[#8c8e82]">{timeLabel(duration)}</span>
              </div>
            </div>

            {/* GÖRSEL ZAMAN ÇİZELGESİ (TIMELINE & SCRUBBER) */}
            <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-[#26271f]">
              <div className="flex items-center justify-between text-[11px] text-[#8c8e82]">
                <span>Zaman Çizelgesi & Replik Aralıkları</span>
                <span>Tıklayarak veya sürükleyerek saniyeye atla</span>
              </div>

              {/* İnteraktif Çubuk */}
              <div
                className="relative h-9 bg-[#12130e] border border-[#2d2f25] rounded-lg overflow-hidden cursor-pointer select-none"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  seekTo(ratio * duration);
                }}
              >
                {/* Replik Blokları (Renkli segmentler) */}
                {cues.map((cue) => {
                  const left = Math.min(100, Math.max(0, (cue.start / duration) * 100));
                  const width = Math.min(100 - left, Math.max(1, ((cue.end - cue.start) / duration) * 100));
                  const isSelected = cue.id === selectedCueId;

                  return (
                    <div
                      key={cue.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCueId(cue.id);
                        seekTo(cue.start);
                      }}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: cue.roleColor,
                        opacity: isSelected ? 0.95 : 0.65,
                      }}
                      className={`absolute top-1 bottom-1 rounded flex items-center px-1.5 text-[10px] font-bold text-black truncate transition hover:opacity-100 hover:ring-2 hover:ring-white ${
                        isSelected ? 'ring-2 ring-white z-10' : ''
                      }`}
                      title={`${cue.roleName}: ${cue.text} (${cue.start}s - ${cue.end}s)`}
                    >
                      <span className="truncate">{cue.roleName}</span>
                    </div>
                  );
                })}

                {/* Video Oynatma İğnesi (Kırmızı/Sarı çizgi) */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-[#d8fb51] shadow-md z-20 pointer-events-none transition-all duration-75"
                  style={{
                    left: `${Math.min(100, Math.max(0, (currentTime / duration) * 100))}%`,
                  }}
                >
                  <div className="w-2.5 h-2.5 bg-[#d8fb51] rounded-full -ml-[4px] -mt-1 shadow" />
                </div>
              </div>
            </div>

            {/* HIZLI ZAMANLAMA KISAYOL ARAÇLARI (TIMING BAR) */}
            <div className="bg-[#12130e] p-3 rounded-xl border border-[#2a2c22] flex flex-wrap items-center justify-between gap-2 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#8c8e82] font-semibold">Kısayol Zamanlama:</span>
                
                {/* Başlangıç Yap [ */}
                <button
                  onClick={markCurrentTimeAsStart}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#282a20] hover:bg-[#383a2d] text-[#d8fb51] border border-[#404332] flex items-center gap-1.5 transition cursor-pointer"
                  title="O anki saniyeyi seçili repliğin başlangıcı yap (Kısayol: [ )"
                >
                  <span className="bg-[#1a1b15] px-1.5 py-0.5 rounded text-[10px] text-[#f4f4e9]">[</span>
                  Başlangıç Yap
                </button>

                {/* Bitiş Yap ] */}
                <button
                  onClick={markCurrentTimeAsEnd}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#282a20] hover:bg-[#383a2d] text-[#d8fb51] border border-[#404332] flex items-center gap-1.5 transition cursor-pointer"
                  title="O anki saniyeyi seçili repliğin bitişi yap (Kısayol: ] )"
                >
                  <span className="bg-[#1a1b15] px-1.5 py-0.5 rounded text-[10px] text-[#f4f4e9]">]</span>
                  Bitiş Yap
                </button>

                {/* Hassas Ayar */}
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => seekTo(currentTime - 0.1)}
                    className="px-2 py-1 rounded text-xs bg-[#20211b] hover:bg-[#2b2d24] text-[#c9cbbe] border border-[#323429]"
                    title="0.1 saniye geri"
                  >
                    -0.1s
                  </button>
                  <button
                    onClick={() => seekTo(currentTime + 0.1)}
                    className="px-2 py-1 rounded text-xs bg-[#20211b] hover:bg-[#2b2d24] text-[#c9cbbe] border border-[#323429]"
                    title="0.1 saniye ileri"
                  >
                    +0.1s
                  </button>
                </div>
              </div>

              {/* Seçili Repliği Dinle */}
              {selectedCueId !== null && (
                <button
                  onClick={() => {
                    const c = cues.find((x) => x.id === selectedCueId);
                    if (c) playCueOnly(c);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1e2316] hover:bg-[#28301d] text-[#d8fb51] border border-[#3f4a2d] flex items-center gap-1.5 transition"
                >
                  <Play size={13} fill="currentColor" />
                  Seçili Repliği Oynat
                </button>
              )}
            </div>

          </div>

          {/* KISAYOL BİLGİLENDİRME KUTUSU */}
          <div className="bg-[#151610] border border-[#24261d] rounded-xl p-3 text-xs text-[#8c8e82] flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span><b>Space:</b> Oynat/Durdur</span>
              <span><b>[:</b> Başlangıç Noktası</span>
              <span><b>]:</b> Bitiş Noktası</span>
              <span><b>←/→:</b> 1sn İleri/Geri</span>
            </div>
            <span className="text-[#d8fb51]">💡 Canlı video oynarken [ ve ] tuşlarına basarak replikleri saniyesinde işaretleyebilirsiniz.</span>
          </div>

        </div>

        {/* SAĞ PANEL: SAHNE, KARAKTERLER & ALTYAZI REPLİKLERİ (5 SÜTUN) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          
          {/* 1. SAHNE DETAYLARI KARTI */}
          <div className="bg-[#181913] border border-[#2d2e26] rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <h2 className="text-sm font-bold text-[#f4f4e9] flex items-center gap-2">
              <Film size={16} className="text-[#d8fb51]" />
              Sahne Bilgileri
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-[#8c8e82] font-semibold block mb-1">
                  Sahne Başlığı
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Örn: Ofiste Kaos"
                  className="w-full bg-[#12130e] border border-[#2e3025] rounded-lg px-3 py-1.5 text-xs text-[#f4f4e9] focus:outline-none focus:border-[#d8fb51]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#8c8e82] font-semibold block mb-1">
                  Kategori
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Meme & Mizah"
                  className="w-full bg-[#12130e] border border-[#2e3025] rounded-lg px-3 py-1.5 text-xs text-[#f4f4e9] focus:outline-none focus:border-[#d8fb51]"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-[#8c8e82] font-semibold block mb-1">
                Kısa Açıklama / Yönlendirme (Mood)
              </label>
              <input
                type="text"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="Örn: Rolleri paylaşın, en komik repliği patlatın."
                className="w-full bg-[#12130e] border border-[#2e3025] rounded-lg px-3 py-1.5 text-xs text-[#f4f4e9] focus:outline-none focus:border-[#d8fb51]"
              />
            </div>
          </div>

          {/* 2. KARAKTER / ROL LİSTESİ */}
          <div className="bg-[#181913] border border-[#2d2e26] rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#f4f4e9] flex items-center gap-2">
                <Users size={16} className="text-[#d8fb51]" />
                Karakterler ({roles.length})
              </h2>
              <button
                onClick={addRole}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#26281e] hover:bg-[#333527] text-[#d8fb51] border border-[#3b3e2f] flex items-center gap-1 transition"
              >
                <Plus size={13} /> Karakter Ekle
              </button>
            </div>

            {/* Karakter Kartları */}
            <div className="flex flex-wrap gap-2">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="bg-[#12130e] border border-[#2a2c22] rounded-xl p-2.5 flex items-center gap-2 flex-1 min-w-[140px]"
                >
                  <input
                    type="color"
                    value={role.color}
                    onChange={(e) => updateRole(role.id, { color: e.target.value })}
                    className="w-6 h-6 rounded-full border-0 cursor-pointer bg-transparent p-0"
                    title="Renk Seç"
                  />
                  <div className="flex-1">
                    <input
                      type="text"
                      value={role.name}
                      onChange={(e) => updateRole(role.id, { name: e.target.value })}
                      className="w-full bg-transparent text-xs font-bold text-[#f4f4e9] focus:outline-none border-b border-transparent focus:border-[#d8fb51]"
                      placeholder="Karakter Adı"
                    />
                  </div>
                  {roles.length > 1 && (
                    <button
                      onClick={() => {
                        setRoles((prev) => prev.filter((r) => r.id !== role.id));
                      }}
                      className="text-[#6d7062] hover:text-[#ff7878] p-1 transition"
                      title="Karakteri Sil"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 3. ALTYAZI VE REPLİK LİSTESİ */}
          <div className="bg-[#181913] border border-[#2d2e26] rounded-2xl p-4 flex flex-col gap-3 shadow-lg flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#f4f4e9] flex items-center gap-2">
                <Scissors size={16} className="text-[#d8fb51]" />
                Altyazılar ve Replikler ({cues.length})
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAutoSubtitle}
                  disabled={whisper.isProcessing}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#282a20] hover:bg-[#383b2b] text-[#d8fb51] border border-[#444835] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                  title="Yapay zeka ile videoyu dinle ve replikleri otomatik oluştur"
                >
                  {whisper.isProcessing ? (
                    <Loader2 size={14} className="animate-spin text-[#d8fb51]" />
                  ) : (
                    <Wand2 size={14} className="text-[#d8fb51]" />
                  )}
                  <span>{whisper.isProcessing ? 'İşleniyor...' : 'AI Otomatik Altyazı'}</span>
                </button>
                <button
                  onClick={addCue}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#d8fb51] hover:bg-[#e4ff6b] text-[#12130e] flex items-center gap-1.5 transition cursor-pointer shadow"
                >
                  <Plus size={14} /> Replik Ekle
                </button>
              </div>
            </div>

            {/* AI İŞLEME DURUMU & İLERLEME ÇUBUĞU */}
            {whisper.isProcessing && (
              <div className="bg-[#212318] border border-[#d8fb51]/40 rounded-xl p-3.5 flex flex-col gap-2 shadow-lg">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-[#d8fb51] flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    {whisper.statusMessage || 'Konuşmalar tanınıyor...'}
                  </span>
                  <span className="text-[#f4f4e9] font-mono">%{whisper.progress}</span>
                </div>
                <div className="w-full bg-[#14150f] rounded-full h-2 overflow-hidden border border-[#303323]">
                  <div
                    className="bg-[#d8fb51] h-full transition-all duration-300 rounded-full shadow-[0_0_8px_#d8fb51]"
                    style={{ width: `${Math.max(5, whisper.progress)}%` }}
                  />
                </div>
                <span className="text-[11px] text-[#8c8e82]">
                  WebGPU hızlandırma aktif • Türkçe konuşmalar ve zamanlama noktaları otomatik tespit ediliyor.
                </span>
              </div>
            )}

            {/* Replik Kartları Kaydırılabilir Liste */}
            <div className="flex flex-col gap-2.5 max-h-[500px] overflow-y-auto pr-1">
              {cues.map((cue, index) => {
                const isSelected = cue.id === selectedCueId;
                const cueDuration = Math.max(0, cue.end - cue.start).toFixed(2);

                return (
                  <div
                    key={cue.id}
                    onClick={() => {
                      setSelectedCueId(cue.id);
                      seekTo(cue.start);
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                      isSelected
                        ? 'bg-[#202219] border-[#d8fb51] ring-1 ring-[#d8fb51]/30 shadow-md'
                        : 'bg-[#12130e] border-[#292b21] hover:border-[#383a2d]'
                    }`}
                  >
                    {/* Üst Satır: Karakter Seçimi, Zaman Rozetleri, Butonlar */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-[#747669]">
                          #{index + 1}
                        </span>

                        {/* Karakter Seçici Dropdown */}
                        <select
                          value={cue.roleIndex}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateCue(cue.id, { roleIndex: parseInt(e.target.value) });
                          }}
                          className="text-xs font-bold px-2 py-1 rounded-md border-0 focus:ring-1 focus:ring-white text-black"
                          style={{ backgroundColor: cue.roleColor }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Başlangıç - Bitiş Girişleri */}
                      <div className="flex items-center gap-1.5 text-xs font-mono" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 bg-[#1a1b14] px-2 py-1 rounded border border-[#313327]">
                          <span className="text-[#8c8e82] text-[10px]">Başla:</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max={duration}
                            value={cue.start}
                            onChange={(e) =>
                              updateCue(cue.id, { start: parseFloat(e.target.value) || 0 })
                            }
                            className="w-12 bg-transparent text-[#d8fb51] text-xs font-bold focus:outline-none"
                          />
                          <span className="text-[#8c8e82] text-[10px]">s</span>
                        </div>

                        <span className="text-[#555749]">-</span>

                        <div className="flex items-center gap-1 bg-[#1a1b14] px-2 py-1 rounded border border-[#313327]">
                          <span className="text-[#8c8e82] text-[10px]">Bitir:</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max={duration}
                            value={cue.end}
                            onChange={(e) =>
                              updateCue(cue.id, { end: parseFloat(e.target.value) || 0 })
                            }
                            className="w-12 bg-transparent text-[#d8fb51] text-xs font-bold focus:outline-none"
                          />
                          <span className="text-[#8c8e82] text-[10px]">s</span>
                        </div>

                        <span className="text-[10px] text-[#8c8e82] ml-1 bg-[#25271e] px-1.5 py-0.5 rounded">
                          {cueDuration}s
                        </span>
                      </div>

                      {/* Aksiyon Butonları: Oynat ve Sil */}
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => playCueOnly(cue)}
                          className="p-1.5 rounded-lg bg-[#25271e] hover:bg-[#34362a] text-[#d8fb51] transition"
                          title="Bu repliği izle"
                        >
                          <Play size={13} fill="currentColor" />
                        </button>
                        <button
                          onClick={() => removeCue(cue.id)}
                          className="p-1.5 rounded-lg bg-[#25271e] hover:bg-[#3d2020] text-[#787a6d] hover:text-[#ff7878] transition"
                          title="Repliği Sil"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Altyazı Metni Input */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <textarea
                        value={cue.text}
                        onChange={(e) => updateCue(cue.id, { text: e.target.value })}
                        placeholder="Oyuncunun okuyacağı replik / altyazı..."
                        rows={2}
                        className="w-full bg-[#171812] border border-[#2e3025] rounded-lg p-2 text-xs text-[#f4f4e9] focus:outline-none focus:border-[#d8fb51] resize-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
