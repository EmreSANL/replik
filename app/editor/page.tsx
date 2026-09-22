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
  Edit3,
  FolderOpen,
  Copy,
  X,
  Search,
  FileVideo,
} from 'lucide-react';
import {
  type Scene,
  type Cue,
  type RoleInfo,
  getAllScenes,
  sceneCues,
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

  // Mevcut Sahne Düzenleme Modu ve Sahne Seçici Modal Durumu
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [editingSceneTitle, setEditingSceneTitle] = useState('');
  const [isSceneModalOpen, setIsSceneModalOpen] = useState(false);
  const [sceneSearch, setSceneSearch] = useState('');
  const hasLoadedUrlScene = useRef(false);

  // Zaman Çizelgesi Mouse ile Sürükleme ve Genişletme Durumu
  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{
    cueId: number;
    type: 'start' | 'end' | 'move';
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
    timelineRect: { left: number; width: number };
  } | null>(null);

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
  const [whisperModel, setWhisperModel] = useState<
    'onnx-community/whisper-base' | 'onnx-community/whisper-tiny'
  >('onnx-community/whisper-base');

  const handleAutoSubtitle = useCallback(async () => {
    if (!videoUrl) {
      showToast('⚠️ Lütfen önce bir video seçin veya yükleyin.');
      return;
    }
    try {
      const modelLabel = whisperModel.includes('base')
        ? 'Whisper Base (Yüksek Doğruluk)'
        : 'Whisper Tiny (Hızlı)';
      showToast(`🤖 ${modelLabel} ile ses analiz ediliyor ve Türkçe konuşmalar tanınıyor...`);
      const result = await whisper.transcribe(videoUrl, roles, duration, 'turkish', whisperModel);
      if (result.cues && result.cues.length > 0) {
        setCues(result.cues);
        setSelectedCueId(result.cues[0].id);
        showToast(`🎉 ${result.cues.length} replik ses dalgasına (VAD) kilitlenerek eksiksiz oluşturuldu!`);
      } else {
        showToast('ℹ️ Videoda belirgin bir konuşma sesi bulunamadı.');
      }
    } catch (err) {
      showToast(`❌ Hata: ${(err as Error).message}`);
    }
  }, [videoUrl, roles, duration, whisper, whisperModel, showToast]);

  // Mevcut repliklerin başlangıç ve bitişlerini ses dalgasına (VAD) göre otomatik hizala
  const handleAlignCues = useCallback(async () => {
    if (!videoUrl || cues.length === 0) {
      showToast('⚠️ Lütfen önce bir video ve en az bir replik ekleyin.');
      return;
    }
    try {
      showToast('🪄 Replik başlangıç ve bitişleri ses dalgasına (VAD) göre hizalanıyor...');
      const aligned = await whisper.alignExistingCues(cues, videoUrl, duration);
      setCues(aligned);
      showToast(`✨ ${aligned.length} repliğin zamanlamaları ses dalgasına göre milisaniyelik hizalandı!`);
    } catch (err) {
      showToast(`⚠️ Hizalama hatası: ${(err as Error).message}`);
    }
  }, [videoUrl, cues, duration, whisper, showToast]);

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

  // Zaman çizelgesinde mouse ile repliğin başını/sonunu uzatma veya taşıma dinleyicisi
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = dragging.timelineRect;
      if (!rect || rect.width <= 0) return;
      const deltaPixels = e.clientX - dragging.initialMouseX;
      const deltaTime = (deltaPixels / rect.width) * duration;
      const minDuration = 0.25;

      setCues((prev) =>
        prev.map((c) => {
          if (c.id !== dragging.cueId) return c;

          if (dragging.type === 'start') {
            // Başlangıcı sola/sağa genişlet veya daralt
            let newStart = Number((dragging.initialStart + deltaTime).toFixed(2));
            newStart = Math.max(0, Math.min(newStart, c.end - minDuration));
            seekTo(newStart);
            return { ...c, start: newStart };
          } else if (dragging.type === 'end') {
            // Bitişi sağa/sola genişlet veya daralt
            let newEnd = Number((dragging.initialEnd + deltaTime).toFixed(2));
            newEnd = Math.min(duration, Math.max(newEnd, c.start + minDuration));
            seekTo(newEnd);
            return { ...c, end: newEnd };
          } else if (dragging.type === 'move') {
            // Repliği blok halinde zamanda kaydır
            const length = dragging.initialEnd - dragging.initialStart;
            let newStart = Number((dragging.initialStart + deltaTime).toFixed(2));
            newStart = Math.max(0, Math.min(newStart, duration - length));
            const newEnd = Number((newStart + length).toFixed(2));
            seekTo(newStart);
            return { ...c, start: newStart, end: newEnd };
          }
          return c;
        }),
      );
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, duration, seekTo]);

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

      // 4. Videodaki insan seslerini (vokalleri) otomatik temizle (Splitter-AI htdemucs)
      setIsRemovingVocals(true);
      setVocalProgress(15);
      setVocalStage('Splitter AI ile vokaller ayrıştırılıyor...');
      removeVocalsFromVideo(file, file.name, (stage, pct) => {
        setVocalStage(stage);
        setVocalProgress(pct);
      })
        .then(async (res) => {
          setInstrumentalUrl(res.url);
          setIsRemovingVocals(false);
          setAudioMode('instrumental');
          // Sahne zaten kaydedilmişse instrumental_url alanını anında güncelle
          try {
            const { supabase } = await import('@/lib/supabase');
            await supabase
              .from('custom_scenes')
              .update({ instrumental_url: res.url })
              .eq('id', sceneId);
          } catch {}
          showToast('🎵 Splitter AI: Videodaki vokaller %100 ayrıldı, ses efektleri korundu!');
        })
        .catch((err) => {
          setIsRemovingVocals(false);
          console.warn('Vokal temizleme uyarısı:', err);
        });
    },
    [duration, roles, whisper, showToast, sceneId],
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
    setVocalStage('Splitter AI ile vokaller ayrıştırılıyor...');
    try {
      showToast('🎙️ Splitter AI: İnsan sesleri ayrıştırılıyor, ses efektleri korunuyor...');
      const res = await removeVocalsFromVideo(videoUrl, title || 'instrumental', (stage, pct) => {
        setVocalStage(stage);
        setVocalProgress(pct);
      });
      setInstrumentalUrl(res.url);
      setAudioMode('instrumental');
      try {
        const { supabase } = await import('@/lib/supabase');
        await supabase
          .from('custom_scenes')
          .update({ instrumental_url: res.url })
          .eq('id', sceneId);
      } catch {}
      showToast('🎵 Splitter AI: İnsan sesleri başarıyla ayrıldı! Vokalsiz efekt kanalı hazır.');
    } catch (err) {
      showToast(`⚠️ Vokal temizleme hatası: ${(err as Error).message}`);
    } finally {
      setIsRemovingVocals(false);
    }
  }, [videoUrl, title, showToast, sceneId]);

  // Sahne Yükle (Hem Supabase / Meme hem de Hazır Oyun Sahneleri)
  const loadScene = useCallback(
    (sc: Scene) => {
      setSceneId(sc.id);
      setTitle(sc.title);
      setCategory(sc.category || 'Meme & Mizah');
      setMood(sc.mood || 'Doğaçlama komedi');
      setVideoUrl(sc.video);
      setPoster(sc.poster || '');
      setDuration(sc.duration || 20);

      // Karakterler / Roller
      if (sc.roleDetails && sc.roleDetails.length > 0) {
        setRoles(sc.roleDetails);
      } else if (sc.roles && sc.roles.length > 0) {
        setRoles(
          sc.roles.map((r, i) => ({
            id: i,
            name: typeof r === 'string' ? r : (r as unknown as RoleInfo).name,
            color: COLOR_PALETTE[i % COLOR_PALETTE.length],
            description: '',
          })),
        );
      }

      // Replikler (Cue'lar): Varsa doğrudan al, yoksa varsayılan replik şablonunu üret
      const loadedCues =
        sc.cues && sc.cues.length > 0
          ? sc.cues
          : sceneCues(sc.id, supabaseScenes);
      setCues(loadedCues);
      if (loadedCues.length > 0) {
        setSelectedCueId(loadedCues[0].id);
      }

      // Vokalsiz M&E müzik parçası
      if (sc.instrumental) {
        setInstrumentalUrl(sc.instrumental);
        setAudioMode('instrumental');
      } else {
        setInstrumentalUrl('');
        setAudioMode('original');
      }

      setIsEditingExisting(true);
      setEditingSceneTitle(sc.title);
      setIsSceneModalOpen(false);

      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.pause();
      }
      setIsPlaying(false);

      showToast(`✏️ "${sc.title}" sahnesi düzenleme için yüklendi!`);
    },
    [supabaseScenes, showToast],
  );

  // Geriye dönük uyumluluk için alias
  const loadSupabaseScene = loadScene;

  // Sıfırdan Yeni Sahneye Geç
  const handleStartNewScene = useCallback(() => {
    setSceneId(Date.now());
    setTitle('');
    setCategory('Meme & Mizah');
    setMood('Rolleri paylaşın, en komik repliği patlatın.');
    setVideoUrl('');
    setPoster('');
    setDuration(20);
    setRoles([
      { id: 0, name: '1. Karakter', color: '#ef4444', description: 'İlk konuşan karakter' },
      { id: 1, name: '2. Karakter', color: '#38bdf8', description: 'İkinci karakter' },
    ]);
    setCues([]);
    setInstrumentalUrl('');
    setAudioMode('instrumental');
    setIsEditingExisting(false);
    setEditingSceneTitle('');
    setIsSceneModalOpen(false);
    showToast('✨ Yeni boş sahne oluşturma moduna geçildi.');
  }, [showToast]);

  // URL query parametresinden sceneId oku ve ilgili sahneyi otomatik yükle
  useEffect(() => {
    if (typeof window === 'undefined' || hasLoadedUrlScene.current) return;
    const params = new URLSearchParams(window.location.search);
    const sceneIdParam = params.get('sceneId');
    if (!sceneIdParam) return;

    const targetId = Number(sceneIdParam);
    if (isNaN(targetId)) return;

    const all = getAllScenes(supabaseScenes);
    const found = all.find((s) => s.id === targetId);
    if (found) {
      hasLoadedUrlScene.current = true;
      loadScene(found);
    } else {
      void getScenesFromSupabase().then((scs) => {
        const merged = getAllScenes(scs || []);
        const f = merged.find((s) => s.id === targetId);
        if (f) {
          hasLoadedUrlScene.current = true;
          loadScene(f);
        }
      });
    }
  }, [supabaseScenes, loadScene]);

  // Tüm sahneler listesi (Arama ve Seçici için)
  const allScenesList = useMemo(() => {
    return getAllScenes(supabaseScenes);
  }, [supabaseScenes]);

  const filteredScenes = useMemo(() => {
    if (!sceneSearch.trim()) return allScenesList;
    const q = sceneSearch.toLowerCase();
    return allScenesList.filter(
      (s) =>
        s.title?.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q) ||
        s.roles?.some((r) =>
          (typeof r === 'string' ? r : (r as unknown as RoleInfo).name)
            .toLowerCase()
            .includes(q),
        ),
    );
  }, [allScenesList, sceneSearch]);

  // Supabase Sahnesi Sil
  const handleDeleteSupabaseScene = async (id: number, scTitle: string) => {
    if (typeof window !== 'undefined' && !window.confirm(`"${scTitle}" sahnesini silmek istediğinize emin misiniz?`)) {
      return;
    }
    try {
      await deleteSceneFromSupabase(id);
      deleteCustomScene(id);
      setSupabaseScenes((prev) => prev.filter((s) => s.id !== id));
      if (sceneId === id) {
        handleStartNewScene();
      }
      showToast(`🗑️ "${scTitle}" Supabase'den silindi.`);
    } catch {
      deleteCustomScene(id);
      setSupabaseScenes((prev) => prev.filter((s) => s.id !== id));
      if (sceneId === id) {
        handleStartNewScene();
      }
      showToast(`🗑️ "${scTitle}" silindi.`);
    }
  };

  // Sahneyi Kaydet (Mevcut olanı güncelle veya yeni kopya olarak kaydet)
  const handleSaveScene = async (asNewCopy: boolean = false) => {
    if (!videoUrl) {
      showToast('⚠️ Lütfen önce bir video seçin veya yükleyin.');
      return;
    }
    const sortedCues = [...cues].sort((a, b) => a.start - b.start);
    const calculatedDuration = Math.max(
      duration,
      sortedCues.length > 0 ? sortedCues[sortedCues.length - 1].end : 0,
    );

    const targetId = asNewCopy ? Date.now() : sceneId;
    const targetTitle = asNewCopy
      ? (title.includes('(Kopya)') ? title : `${title} (Kopya)`).trim()
      : (title.trim() || 'Meme Sahnesi');

    const newScene: Scene = {
      id: targetId,
      title: targetTitle,
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
      showToast('☁️ Sahne kaydediliyor ve oyuna ekleniyor...');
      await saveSceneToSupabase(newScene);
      saveCustomScene(newScene); // yerel yedek
      setSupabaseScenes((prev) => [newScene, ...prev.filter((s) => s.id !== newScene.id)]);
      setSceneId(targetId);
      setTitle(targetTitle);
      setIsEditingExisting(true);
      setEditingSceneTitle(targetTitle);
      showToast(
        asNewCopy
          ? `🎉 "${targetTitle}" yeni bir sahne olarak oyuna eklendi!`
          : `💾 "${targetTitle}" sahnesindeki değişiklikler başarıyla güncellendi!`,
      );
    } catch (err) {
      saveCustomScene(newScene);
      setSceneId(targetId);
      setTitle(targetTitle);
      setIsEditingExisting(true);
      setEditingSceneTitle(targetTitle);
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
      {/* Gizli Dosya Seçiciler */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileUpload}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleJsonUpload}
      />

      {/* SADE ÜST ÇUBUK (Sadece 3 Temel Buton) */}
      <header className="border-b border-[#25271e] bg-[#151611] px-6 py-3.5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#20221a] hover:bg-[#2b2e23] text-[#d8fb51] border border-[#323628] flex items-center gap-2 transition"
          >
            <ArrowLeft size={15} />
            Oyuna Dön
          </Link>
          <div className="h-5 w-[1px] bg-[#2a2d22] hidden sm:block" />
          <h1 className="text-sm sm:text-base font-extrabold text-[#f4f4e9] flex items-center gap-2">
            <Film size={18} className="text-[#d8fb51]" />
            <span>Sahne Stüdyosu</span>
            {isEditingExisting && title && (
              <span className="text-xs font-semibold text-[#9ca28e] hidden md:inline">
                — “{title}”
              </span>
            )}
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsSceneModalOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#20221a] hover:bg-[#2b2e23] text-[#f4f4e9] border border-[#323628] flex items-center gap-2 transition cursor-pointer"
          >
            <FolderOpen size={15} className="text-[#d8fb51]" />
            <span>Kayıtlı Sahneler ({allScenesList.length})</span>
          </button>

          {videoUrl && (
            <button
              type="button"
              onClick={handleStartNewScene}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#20221a] hover:bg-[#2b2e23] text-[#c7cbb8] border border-[#323628] flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">Yeni Video Yükle</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleSaveScene(false)}
            className="px-5 py-2 rounded-xl text-xs sm:text-sm font-extrabold bg-[#d8fb51] hover:bg-[#e3ff6e] text-[#11120d] flex items-center gap-2 shadow-lg shadow-[#d8fb51]/15 transition cursor-pointer"
          >
            <Check size={16} strokeWidth={2.5} />
            <span>{isEditingExisting ? 'Değişiklikleri Kaydet' : 'Sahneyi Kaydet'}</span>
          </button>
        </div>
      </header>

      {/* TOAST BİLDİRİMİ */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1c1f15] border border-[#d8fb51] text-[#f4f4e9] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-semibold">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ANA İÇERİK: SOLDA VİDEO, SAĞDA 3 BASİT ADIM */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* SOL SÜTUN: VİDEO ÖNİZLEME (6 SÜTUN) */}
        <div className="lg:col-span-6 flex flex-col gap-4 lg:sticky lg:top-20">
          <div className="bg-[#161812] border border-[#282b20] rounded-2xl p-4 flex flex-col gap-3.5 shadow-xl">
            {/* Otomatik İşlem Durum Bildirimleri (Varsa gösterilir) */}
            {(isUploadingToSupabase || isRemovingVocals || whisper.isProcessing) && (
              <div className="flex flex-col gap-2 bg-[#1e2117] border border-[#384126] rounded-xl p-3">
                {isUploadingToSupabase && (
                  <div className="flex items-center justify-between text-xs font-semibold text-[#38bdf8]">
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Video buluta yükleniyor...
                    </span>
                    <span>%{uploadProgress}</span>
                  </div>
                )}
                {isRemovingVocals && (
                  <div className="flex items-center justify-between text-xs font-semibold text-[#c084fc]">
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Konuşma sesleri ayrıştırılıyor, ses efektleri korunuyor...
                    </span>
                    <span>%{vocalProgress}</span>
                  </div>
                )}
                {whisper.isProcessing && (
                  <div className="flex items-center justify-between text-xs font-semibold text-[#d8fb51]">
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      {whisper.statusMessage || 'Yapay zeka konuşmaları yazıya döküyor...'}
                    </span>
                    <span>%{whisper.progress}</span>
                  </div>
                )}
              </div>
            )}

            {/* VİDEO KUTUSU */}
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-[#2a2d22] flex items-center justify-center">
              {!videoUrl ? (
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
                  className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center border-2 border-dashed border-[#383c2c] hover:border-[#d8fb51] bg-[#12130e] transition cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-2xl bg-[#1d2016] border border-[#323726] flex items-center justify-center text-[#d8fb51] group-hover:scale-105 transition">
                    <Upload size={30} />
                  </div>
                  <div className="flex flex-col gap-1 max-w-sm">
                    <h3 className="text-base font-extrabold text-[#f4f4e9]">
                      Videonu Buraya Bırak veya Seç
                    </h3>
                    <p className="text-xs text-[#8e9283]">
                      Videoyu yüklediğinde konuşmalar ve ses efektleri otomatik olarak hazırlanır.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="px-5 py-2.5 rounded-xl text-xs font-extrabold bg-[#d8fb51] text-[#11120d] flex items-center gap-2 shadow-md"
                  >
                    <Upload size={15} />
                    Bilgisayardan Video Seç
                  </button>
                </div>
              ) : (
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

                  {instrumentalUrl && (
                    <audio
                      ref={instrumentalAudioRef}
                      src={instrumentalUrl}
                      preload="auto"
                      playsInline
                      style={{ display: 'none' }}
                    />
                  )}

                  {/* Video Üzerindeki Canlı Altyazı */}
                  {currentActiveCue && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[92%] bg-black/85 backdrop-blur-md border border-white/15 rounded-xl px-4 py-2.5 text-center pointer-events-none">
                      <span
                        className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-extrabold text-black mb-1"
                        style={{ backgroundColor: currentActiveCue.roleColor }}
                      >
                        {currentActiveCue.roleName}
                      </span>
                      <p className="text-sm sm:text-base font-bold text-white leading-snug">
                        “{currentActiveCue.text}”
                      </p>
                    </div>
                  )}

                  {!isPlaying && (
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="absolute p-4 rounded-full bg-black/65 text-[#d8fb51] border border-white/20 hover:scale-105 transition shadow-2xl cursor-pointer"
                      aria-label="Oynat"
                    >
                      <Play size={30} fill="currentColor" />
                    </button>
                  )}
                </>
              )}
            </div>

            {/* SADE VİDEO KONTROL ÇUBUĞU */}
            {videoUrl && (
              <div className="flex flex-col gap-2.5">
                {/* Tek Çizgi İlerleme Çubuğu */}
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, duration)}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => seekTo(parseFloat(e.target.value))}
                  className="w-full accent-[#d8fb51] h-2 bg-[#25281e] rounded-lg cursor-pointer"
                />

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="px-3.5 py-2 rounded-xl bg-[#d8fb51] text-[#11120d] font-extrabold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      {isPlaying ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
                      <span>{isPlaying ? 'Durdur' : 'Oynat'}</span>
                    </button>

                    <span className="text-xs font-mono text-[#a4a896] bg-[#12130e] px-3 py-2 rounded-xl border border-[#26291f]">
                      {timeLabel(currentTime)} / {timeLabel(duration)}
                    </span>
                  </div>

                  {/* Ses Modu Seçimi (Vokalsiz Efektli vs Orijinal) */}
                  <div className="flex items-center gap-1.5">
                    {instrumentalUrl ? (
                      <div className="flex items-center bg-[#12130e] border border-[#2b2e22] rounded-xl p-1">
                        <button
                          type="button"
                          onClick={() => {
                            setAudioMode('instrumental');
                            if (videoRef.current) videoRef.current.muted = true;
                            if (instrumentalAudioRef.current) {
                              instrumentalAudioRef.current.currentTime = videoRef.current?.currentTime || 0;
                              if (isPlaying) instrumentalAudioRef.current.play().catch(() => {});
                            }
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                            audioMode === 'instrumental'
                              ? 'bg-[#d8fb51] text-[#11120d]'
                              : 'text-[#9ca28e] hover:text-white'
                          }`}
                        >
                          🔊 Vokalsiz (Efektli)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAudioMode('original');
                            if (instrumentalAudioRef.current) instrumentalAudioRef.current.pause();
                            if (videoRef.current) videoRef.current.muted = false;
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                            audioMode === 'original'
                              ? 'bg-[#d8fb51] text-[#11120d]'
                              : 'text-[#9ca28e] hover:text-white'
                          }`}
                        >
                          🎙️ Orijinal Ses
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleManualVocalRemoval}
                        disabled={isRemovingVocals}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#231a31] hover:bg-[#312345] text-[#d8b4fe] border border-[#4c356b] flex items-center gap-1.5 cursor-pointer"
                      >
                        <Music size={14} />
                        <span>Vokalleri Temizle</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#20221a] hover:bg-[#2c2f24] text-[#c7cbb8] border border-[#323628] cursor-pointer"
                    >
                      Videoyu Değiştir
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* SAĞ SÜTUN: 3 BASİT ADIMDA DÜZENLEME (6 SÜTUN) */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          {/* ADIM 1: SAHNE ADI */}
          <div className="bg-[#161812] border border-[#282b20] rounded-2xl p-4 flex flex-col gap-2.5 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#d8fb51] text-[#11120d] text-xs font-black flex items-center justify-center">
                1
              </span>
              <h2 className="text-sm font-extrabold text-[#f4f4e9]">Sahne Adı</h2>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn: Gökhan Abi ve Cio Tartışıyor"
              className="w-full bg-[#10110d] border border-[#2d3024] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[#f4f4e9] focus:outline-none focus:border-[#d8fb51]"
            />
          </div>

          {/* ADIM 2: KARAKTERLER */}
          <div className="bg-[#161812] border border-[#282b20] rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#d8fb51] text-[#11120d] text-xs font-black flex items-center justify-center">
                  2
                </span>
                <h2 className="text-sm font-extrabold text-[#f4f4e9]">
                  Karakterler ({roles.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={addRole}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#23261c] hover:bg-[#2f3326] text-[#d8fb51] border border-[#393e2d] flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus size={14} /> Karakter Ekle
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="bg-[#10110d] border border-[#2a2d22] rounded-xl px-3 py-2 flex items-center gap-2"
                >
                  <input
                    type="color"
                    value={role.color}
                    onChange={(e) => updateRole(role.id, { color: e.target.value })}
                    className="w-5 h-5 rounded-full border-0 cursor-pointer bg-transparent p-0 shrink-0"
                    title="Karakter Rengi"
                  />
                  <input
                    type="text"
                    value={role.name}
                    onChange={(e) => updateRole(role.id, { name: e.target.value })}
                    className="w-full bg-transparent text-xs font-bold text-[#f4f4e9] focus:outline-none"
                    placeholder="Karakter Adı"
                  />
                  {roles.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRoles((prev) => prev.filter((r) => r.id !== role.id))}
                      className="text-[#6d7062] hover:text-[#ff7878] p-0.5 transition cursor-pointer"
                      title="Sil"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ADIM 3: REPLİKLER (KONUŞMALAR) */}
          <div className="bg-[#161812] border border-[#282b20] rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#d8fb51] text-[#11120d] text-xs font-black flex items-center justify-center">
                  3
                </span>
                <h2 className="text-sm font-extrabold text-[#f4f4e9]">
                  Replikler ({cues.length})
                </h2>
              </div>

              <div className="flex items-center gap-2">
                {videoUrl && (
                  <button
                    type="button"
                    onClick={handleAutoSubtitle}
                    disabled={whisper.isProcessing}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#23261c] hover:bg-[#2f3326] text-[#d8fb51] border border-[#393e2d] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                  >
                    {whisper.isProcessing ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Wand2 size={14} />
                    )}
                    <span>Otomatik Altyazı Çıkar</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={addCue}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-extrabold bg-[#d8fb51] hover:bg-[#e3ff6e] text-[#11120d] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus size={14} /> Yeni Replik Ekle
                </button>
              </div>
            </div>

            {cues.length === 0 ? (
              <div className="bg-[#10110d] border border-dashed border-[#2d3024] rounded-xl p-6 text-center flex flex-col items-center gap-2">
                <p className="text-xs text-[#9ca28e]">
                  Henüz replik yok. <strong>“Otomatik Altyazı Çıkar”</strong> veya{' '}
                  <strong>“Yeni Replik Ekle”</strong> butonuna basarak başlayabilirsin.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-[520px] overflow-y-auto pr-1">
                {cues.map((cue, index) => {
                  const isSelected = cue.id === selectedCueId;
                  return (
                    <div
                      key={cue.id}
                      onClick={() => {
                        setSelectedCueId(cue.id);
                        seekTo(cue.start);
                      }}
                      className={`p-3 rounded-xl border transition flex flex-col gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-[#1e2117] border-[#d8fb51]'
                          : 'bg-[#10110d] border-[#26291f] hover:border-[#383c2c]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {/* Sol: Sıra No & Hangi Karakter Konuşuyor */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-[#8e9283]">
                            #{index + 1}
                          </span>
                          <select
                            value={cue.roleIndex}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateCue(cue.id, { roleIndex: parseInt(e.target.value) });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-extrabold px-2.5 py-1 rounded-lg border-0 text-black cursor-pointer"
                            style={{ backgroundColor: cue.roleColor }}
                          >
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Sağ: Başlangıç - Bitiş Saniyesi, İzle ve Sil */}
                        <div
                          className="flex items-center gap-1.5 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1 bg-[#181a13] px-2 py-1 rounded-lg border border-[#2c3022]">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max={duration}
                              value={cue.start}
                              onChange={(e) =>
                                updateCue(cue.id, { start: parseFloat(e.target.value) || 0 })
                              }
                              className="w-11 bg-transparent text-[#d8fb51] text-xs font-bold focus:outline-none text-center"
                              title="Başlangıç Saniyesi"
                            />
                            <span className="text-[#7c8070] text-[11px]">sn</span>
                          </div>
                          <span className="text-[#5e6252]">–</span>
                          <div className="flex items-center gap-1 bg-[#181a13] px-2 py-1 rounded-lg border border-[#2c3022]">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max={duration}
                              value={cue.end}
                              onChange={(e) =>
                                updateCue(cue.id, { end: parseFloat(e.target.value) || 0 })
                              }
                              className="w-11 bg-transparent text-[#d8fb51] text-xs font-bold focus:outline-none text-center"
                              title="Bitiş Saniyesi"
                            />
                            <span className="text-[#7c8070] text-[11px]">sn</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => playCueOnly(cue)}
                            className="p-1.5 rounded-lg bg-[#23261c] hover:bg-[#313627] text-[#d8fb51] transition cursor-pointer"
                            title="Bu Repliği İzle"
                          >
                            <Play size={13} fill="currentColor" />
                          </button>

                          <button
                            type="button"
                            onClick={() => removeCue(cue.id)}
                            className="p-1.5 rounded-lg bg-[#23261c] hover:bg-[#3b2020] text-[#8a8e7e] hover:text-[#ff7878] transition cursor-pointer"
                            title="Repliği Sil"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Replik Sözü */}
                      <input
                        type="text"
                        value={cue.text}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateCue(cue.id, { text: e.target.value })}
                        placeholder="Karakterin söyleyeceği cümleyi buraya yaz..."
                        className="w-full bg-[#161812] border border-[#2b2e22] rounded-lg px-3 py-2 text-xs sm:text-sm font-medium text-[#f4f4e9] focus:outline-none focus:border-[#d8fb51]"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SAHNELERİ AÇ & DÜZENLE MODALI */}
      {isSceneModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsSceneModalOpen(false)}
        >
          <div
            className="bg-[#171912] border border-[#313327] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#292b21]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#d8fb51]/15 text-[#d8fb51] flex items-center justify-center border border-[#d8fb51]/30">
                  <FolderOpen size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#f4f4e9]">
                    Sahneleri Aç &amp; Düzenle
                  </h3>
                  <p className="text-xs text-[#8c8e82]">
                    İstediğiniz sahneyi seçerek altyazılarını, replik zamanlamalarını veya vokal temizliğini editörde düzenleyin.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSceneModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-[#22241b] hover:bg-[#2e3025] text-[#9ca08e] hover:text-[#f4f4e9] flex items-center justify-center transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Search & Filter */}
            <div className="px-6 py-3 border-b border-[#24261c] bg-[#141610] flex items-center justify-between gap-4">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7c7f71]" />
                <input
                  type="text"
                  value={sceneSearch}
                  onChange={(e) => setSceneSearch(e.target.value)}
                  placeholder="Sahne adı, kategori veya karakter ara..."
                  className="w-full bg-[#1b1c15] border border-[#2d3023] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[#f4f4e9] focus:outline-none focus:border-[#d8fb51]"
                />
              </div>
              <span className="text-xs text-[#8c8e82] whitespace-nowrap">
                Toplam {filteredScenes.length} sahne
              </span>
            </div>

            {/* Modal Scene Grid */}
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {filteredScenes.map((sc) => {
                const isCurrent = isEditingExisting && sceneId === sc.id;
                return (
                  <div
                    key={sc.id}
                    className={`bg-[#12130e] border rounded-xl overflow-hidden flex flex-col transition group ${
                      isCurrent
                        ? 'border-[#d8fb51] shadow-lg shadow-[#d8fb51]/10'
                        : 'border-[#282a20] hover:border-[#424634]'
                    }`}
                  >
                    {/* Thumbnail / Poster */}
                    <div
                      className="h-32 bg-[#202419] relative bg-cover bg-center flex items-end p-2.5"
                      style={
                        sc.poster
                          ? { backgroundImage: `url('${sc.poster}')` }
                          : undefined
                      }
                    >
                      <span className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm text-[10px] text-[#c7cbba] font-mono px-1.5 py-0.5 rounded">
                        00:{sc.duration}
                      </span>
                      {sc.isCustom && (
                        <span className="absolute top-2 right-2 bg-[#d8fb51] text-[#12130e] text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                          Meme / Özel
                        </span>
                      )}
                      {sc.instrumental && (
                        <span className="absolute bottom-2 left-2 bg-[#a855f7]/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Music size={10} /> M&amp;E Vokalsiz
                        </span>
                      )}
                    </div>

                    {/* Metadata & Actions */}
                    <div className="p-3 flex-1 flex flex-col justify-between gap-3">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-[#f4f4e9] group-hover:text-[#d8fb51] transition line-clamp-1">
                            {sc.title}
                          </h4>
                          {isCurrent && (
                            <span className="text-[10px] text-[#d8fb51] font-bold shrink-0">
                              ● Açık
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#8c8e82] mt-0.5">
                          {sc.category} · {sc.roles?.length || 0} Karakter
                        </p>
                        {sc.mood && (
                          <p className="text-[10px] text-[#6d7062] mt-1 line-clamp-1 italic">
                            {sc.mood}
                          </p>
                        )}
                      </div>

                      {/* Buttons */}
                      <div className="flex items-center gap-1.5 pt-2 border-t border-[#22241b]">
                        <button
                          onClick={() => loadScene(sc)}
                          className="flex-1 py-1.5 px-2 bg-[#d8fb51] hover:bg-[#e4ff6b] text-[#12130e] text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <Edit3 size={13} />
                          {isCurrent ? 'Yeniden Yükle' : 'Düzenle'}
                        </button>
                        {sc.isCustom && (
                          <button
                            onClick={() => handleDeleteSupabaseScene(sc.id, sc.title)}
                            className="p-1.5 bg-[#20211b] hover:bg-[#3d1e1e] text-[#828577] hover:text-[#ff7878] rounded-lg transition cursor-pointer"
                            title="Sahneyi Sil"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-[#24261c] bg-[#141610] flex items-center justify-between">
              <span className="text-xs text-[#8c8e82]">
                💡 Düzenlemek istediğiniz sahneye tıklayın, tüm replikleri ve zamanlamaları anında önünüze gelecektir.
              </span>
              <button
                onClick={handleStartNewScene}
                className="px-3 py-1.5 bg-[#25281e] hover:bg-[#323628] text-[#d8fb51] text-xs font-semibold rounded-lg flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus size={14} /> Sıfırdan Yeni Sahne Yap
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
