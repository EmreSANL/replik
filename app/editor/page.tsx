'use client';
/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/media-has-caption, jsx-a11y/label-has-associated-control */

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import {
  Play,
  Pause,
  Plus,
  Trash2,
  Clock,
  Upload,
  Film,
  Check,
  ArrowLeft,
  Wand2,
  Loader2,
  Music,
  Edit3,
  FolderOpen,
  X,
  Search,
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
} from '@/lib/scenes';
import { useWhisper } from '@/lib/use-whisper';
import { removeVocalsFromVideo } from '@/lib/vocal-remover';
import { adjustCueTiming, hasCueOverlap } from '@/lib/timeline';
import { formatTimecode } from '@/lib/timecode';
import { VideoTrimDialog } from '@/components/video-trim-dialog';
import {
  uploadVideoToSupabase,
  saveSceneToSupabase,
  getScenesFromSupabase,
  deleteSceneFromSupabase,
} from '@/lib/supabase';

const COLOR_PALETTE = [
  '#9E8CA9',
  '#AEA932',
];

export default function EditorPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const instrumentalAudioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);

  // Sahne bilgileri (Demo video yok, kullanıcı kendi videosunu yükler)
  const [sceneId, setSceneId] = useState<number>(() => Date.now());
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Meme & Mizah');
  const [mood, setMood] = useState(
    'Rolleri paylaşın, en komik repliği patlatın.',
  );
  const [videoUrl, setVideoUrl] = useState('');
  const [poster, setPoster] = useState('');

  // Video oynatıcı durumu
  const [duration, setDuration] = useState(20);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted] = useState(false);

  // Vokal Kaldırma (İnsan Sesi Temizleme / M&E Track)
  const [instrumentalUrl, setInstrumentalUrl] = useState<string>('');
  const [isRemovingVocals, setIsRemovingVocals] = useState<boolean>(false);
  const [vocalProgress, setVocalProgress] = useState<number>(0);
  const [, setVocalStage] = useState<string>('');
  const [audioMode, setAudioMode] = useState<'original' | 'instrumental'>(
    'instrumental',
  );

  // Supabase bulut depolama ve veritabanı durumu
  const [isUploadingToSupabase, setIsUploadingToSupabase] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [supabaseScenes, setSupabaseScenes] = useState<Scene[]>([]);

  // Roller ve Replikler
  const [roles, setRoles] = useState<RoleInfo[]>([
    {
      id: 0,
      name: '1. Karakter',
      color: '#9E8CA9',
      description: 'İlk konuşan karakter',
    },
    {
      id: 1,
      name: '2. Karakter',
      color: '#AEA932',
      description: 'İkinci karakter',
    },
  ]);

  const [cues, setCues] = useState<Cue[]>([]);
  const [selectedCueId, setSelectedCueId] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mevcut Sahne Düzenleme Modu ve Sahne Seçici Modal Durumu
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [, setEditingSceneTitle] = useState('');
  const [isSceneModalOpen, setIsSceneModalOpen] = useState(false);
  const [sceneSearch, setSceneSearch] = useState('');
  const hasLoadedUrlScene = useRef(false);

  // Zaman Çizelgesi Mouse ile Sürükleme, Ses Dalgası ve Yakınlaştırma Durumu
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [isScrubbingTimeline, setIsScrubbingTimeline] = useState(false);
  const [dragging, setDragging] = useState<{
    cueId: number;
    type: 'start' | 'end' | 'move';
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
    timelineRect: { left: number; width: number };
    spanDuration?: number;
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
  const [whisperModel] = useState<
    'onnx-community/whisper-base' | 'onnx-community/whisper-tiny'
  >('onnx-community/whisper-base');

  const handleAutoSubtitle = useCallback(async () => {
    if (!videoUrl) {
      showToast('Lütfen önce bir video seçin veya yükleyin.');
      return;
    }
    try {
      const modelLabel = whisperModel.includes('base')
        ? 'Whisper Base (Yüksek Doğruluk)'
        : 'Whisper Tiny (Hızlı)';
      showToast(
        `${modelLabel} ile ses analiz ediliyor ve Türkçe konuşmalar tanınıyor...`,
      );
      const result = await whisper.transcribe(
        videoUrl,
        roles,
        duration,
        'turkish',
        whisperModel,
      );
      if (result.cues && result.cues.length > 0) {
        setCues(result.cues);
        setSelectedCueId(result.cues[0].id);
        showToast(
          `${result.cues.length} replik ses dalgasına (VAD) kilitlenerek eksiksiz oluşturuldu!`,
        );
      } else {
        showToast('ℹ️ Videoda belirgin bir konuşma sesi bulunamadı.');
      }
    } catch (err) {
      showToast(`Hata: ${(err as Error).message}`);
    }
  }, [videoUrl, roles, duration, whisper, whisperModel, showToast]);

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
      if (
        audioMode === 'instrumental' &&
        instrumentalUrl &&
        instrumentalAudioRef.current
      ) {
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

  const seekTo = useCallback(
    (time: number) => {
      if (!videoRef.current) return;
      const clamped = Math.max(0, Math.min(duration, time));
      videoRef.current.currentTime = clamped;
      if (instrumentalAudioRef.current) {
        instrumentalAudioRef.current.currentTime = clamped;
      }
      setCurrentTime(clamped);
    },
    [duration],
  );

  // Videodan ses dalgası (waveform) verisini çıkar (Zaman çizelgesinde konuşma yerlerini görmek için)
  useEffect(() => {
    if (!videoUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const fetchUrl =
          videoUrl.startsWith('blob:') || videoUrl.startsWith('/')
            ? videoUrl
            : `/api/video-proxy?url=${encodeURIComponent(videoUrl)}`;
        const res = await fetch(fetchUrl);
        if (!res.ok || cancelled) return;
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0 || cancelled) return;
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        const audioBuffer = await ctx.decodeAudioData(buf);
        void ctx.close().catch(() => {});
        if (cancelled) return;
        const ch = audioBuffer.getChannelData(0);
        const barCount = 140;
        const step = Math.max(1, Math.floor(ch.length / barCount));
        const peaks: number[] = [];
        let maxPeak = 0.01;
        for (let i = 0; i < barCount; i++) {
          let sum = 0;
          const offset = i * step;
          const limit = Math.min(ch.length, offset + step);
          for (let j = offset; j < limit; j += 8) {
            const v = Math.abs(ch[j]);
            if (v > sum) sum = v;
          }
          if (sum > maxPeak) maxPeak = sum;
          peaks.push(sum);
        }
        setWaveformPeaks(
          peaks.map((p) => Math.max(0.08, Math.min(1, p / maxPeak))),
        );
      } catch {
        // Ses dalgası çıkarılamazsa varsayılan görünüm
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoUrl]);

  // Zaman çizelgesinde imleci (playhead) mouse ile sürükleme
  useEffect(() => {
    if (!isScrubbingTimeline) return;
    const handleMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      seekTo(Number((ratio * duration).toFixed(2)));
    };
    const handleUp = () => setIsScrubbingTimeline(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isScrubbingTimeline, duration, seekTo]);

  // Zaman çizelgesinde mouse ile repliğin başını/sonunu uzatma veya taşıma dinleyicisi
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = dragging.timelineRect;
      if (!rect || rect.width <= 0) return;
      const effectiveSpan = dragging.spanDuration || duration;
      const deltaPixels = e.clientX - dragging.initialMouseX;
      const deltaTime = (deltaPixels / rect.width) * effectiveSpan;
      setCues((prev) => {
        const timing = adjustCueTiming(
          prev,
          dragging.cueId,
          dragging.type,
          dragging.initialStart,
          dragging.initialEnd,
          deltaTime,
          duration,
        );
        seekTo(dragging.type === 'end' ? timing.end : timing.start);
        return prev.map((cue) =>
          cue.id === dragging.cueId ? { ...cue, ...timing } : cue,
        );
      });
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
    showToast(`Başlangıç [${time.toFixed(2)}s] olarak ayarlandı.`);
  }, [currentTime, selectedCueId, showToast]);

  // Seçili repliğin bitişini şu anki video süresi yap
  const markCurrentTimeAsEnd = useCallback(() => {
    const time = Number(currentTime.toFixed(2));
    setCues((prev) =>
      prev.map((c) => {
        if (c.id === selectedCueId) {
          const start =
            c.start >= time
              ? Math.max(0, Number((time - 1.0).toFixed(2)))
              : c.start;
          return { ...c, start, end: time };
        }
        return c;
      }),
    );
    showToast(`Bitiş [${time.toFixed(2)}s] olarak ayarlandı.`);
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
  }, [
    currentTime,
    markCurrentTimeAsStart,
    markCurrentTimeAsEnd,
    togglePlay,
    duration,
    seekTo,
  ]);

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
    const requestedStart = lastCue ? lastCue.end + 0.2 : currentTime;
    const newStart = Number(
      Math.max(0, Math.min(duration - 0.2, requestedStart)).toFixed(2),
    );
    const newEnd = Number(Math.min(duration, newStart + 3.5).toFixed(2));
    const nextRoleIdx = cues.length % roles.length;
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
    showToast('Yeni replik satırı eklendi.');
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

  const nudgeCueBoundary = (cue: Cue, type: 'start' | 'end', delta: number) => {
    setCues((prev) => {
      const timing = adjustCueTiming(
        prev,
        cue.id,
        type,
        cue.start,
        cue.end,
        delta,
        duration,
      );
      seekTo(type === 'end' ? timing.end : timing.start);
      return prev.map((item) =>
        item.id === cue.id ? { ...item, ...timing } : item,
      );
    });
  };

  // Replik sil
  const removeCue = (id: number) => {
    if (cues.length <= 1) {
      showToast('En az bir replik satırı bulunmalıdır.');
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
      showToast('Maksimum 6 karakter eklenebilir.');
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
    showToast(`${newRole.name} eklendi.`);
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
    (file: File, selectedDuration: number) => {
      // 1. Yerel hızlı önizleme
      const localUrl = URL.createObjectURL(file);
      setVideoUrl(localUrl);
      setDuration(selectedDuration);
      const videoTitle = file.name.replace(/\.[^/.]+$/, '').slice(0, 35);
      setTitle(videoTitle);

      const tempVideo = document.createElement('video');
      tempVideo.src = localUrl;
      tempVideo.crossOrigin = 'anonymous';
      tempVideo.muted = true;
      tempVideo.onloadedmetadata = () => {
        if (
          tempVideo.duration &&
          !isNaN(tempVideo.duration) &&
          isFinite(tempVideo.duration)
        ) {
          setDuration(tempVideo.duration);
        }
        tempVideo.currentTime = Math.min(1, tempVideo.duration / 2);
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

      showToast(
        `Video seçildi! Supabase bulutuna yükleniyor ve yapay zeka analiz ediyor...`,
      );

      // 2. Supabase Storage bulutuna arka planda yükle
      setIsUploadingToSupabase(true);
      setUploadProgress(15);
      uploadVideoToSupabase(file, file.name, (pct) => setUploadProgress(pct))
        .then(({ url }) => {
          setVideoUrl(url); // Artık herkese açık kalıcı Supabase URL'si
          setIsUploadingToSupabase(false);
          showToast('Video Supabase Storage bulutuna başarıyla yüklendi!');
        })
        .catch((err) => {
          setIsUploadingToSupabase(false);
          console.warn('Supabase storage uyarısı:', err);
        });

      // 3. Yapay zeka ile otomatik konuşma tanıma ve zamanlama
      const videoDur = selectedDuration;
      whisper
        .transcribe(file, roles, videoDur, 'turkish')
        .then((result) => {
          if (result.cues && result.cues.length > 0) {
            setCues(result.cues);
            setSelectedCueId(result.cues[0].id);
            showToast(`${result.cues.length} replik otomatik oluşturuldu!`);
          } else {
            showToast('ℹ️ Videoda belirgin konuşma tespit edilemedi.');
          }
        })
        .catch((err) => {
          showToast(`Altyazı analizi: ${(err as Error).message}`);
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
          showToast(
            'Splitter AI: Videodaki vokaller %100 ayrıldı, ses efektleri korundu!',
          );
        })
        .catch((err) => {
          setIsRemovingVocals(false);
          console.warn('Vokal temizleme uyarısı:', err);
        });
    },
    [roles, whisper, showToast, sceneId],
  );

  const stageVideoFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      showToast('Lütfen bir video dosyası seçin.');
      return;
    }
    setPendingVideo(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) stageVideoFile(file);
    e.target.value = '';
  };

  const handleManualVocalRemoval = useCallback(async () => {
    if (!videoUrl) {
      showToast('Lütfen önce bir video seçin veya yükleyin.');
      return;
    }
    setIsRemovingVocals(true);
    setVocalProgress(10);
    setVocalStage('Splitter AI ile vokaller ayrıştırılıyor...');
    try {
      showToast(
        'Splitter AI: İnsan sesleri ayrıştırılıyor, ses efektleri korunuyor...',
      );
      const res = await removeVocalsFromVideo(
        videoUrl,
        title || 'instrumental',
        (stage, pct) => {
          setVocalStage(stage);
          setVocalProgress(pct);
        },
      );
      setInstrumentalUrl(res.url);
      setAudioMode('instrumental');
      try {
        const { supabase } = await import('@/lib/supabase');
        await supabase
          .from('custom_scenes')
          .update({ instrumental_url: res.url })
          .eq('id', sceneId);
      } catch {}
      showToast(
        'Splitter AI: İnsan sesleri başarıyla ayrıldı! Vokalsiz efekt kanalı hazır.',
      );
    } catch (err) {
      showToast(`Vokal temizleme hatası: ${(err as Error).message}`);
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

      showToast(`"${sc.title}" sahnesi düzenleme için yüklendi!`);
    },
    [supabaseScenes, showToast],
  );

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
      {
        id: 0,
        name: '1. Karakter',
        color: '#9E8CA9',
        description: 'İlk konuşan karakter',
      },
      {
        id: 1,
        name: '2. Karakter',
        color: '#AEA932',
        description: 'İkinci karakter',
      },
    ]);
    setCues([]);
    setInstrumentalUrl('');
    setAudioMode('instrumental');
    setIsEditingExisting(false);
    setEditingSceneTitle('');
    setIsSceneModalOpen(false);
    showToast('Yeni boş sahne oluşturma moduna geçildi.');
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
      queueMicrotask(() => loadScene(found));
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
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `"${scTitle}" sahnesini silmek istediğinize emin misiniz?`,
      )
    ) {
      return;
    }
    try {
      await deleteSceneFromSupabase(id);
      deleteCustomScene(id);
      setSupabaseScenes((prev) => prev.filter((s) => s.id !== id));
      if (sceneId === id) {
        handleStartNewScene();
      }
      showToast(`"${scTitle}" Supabase'den silindi.`);
    } catch {
      deleteCustomScene(id);
      setSupabaseScenes((prev) => prev.filter((s) => s.id !== id));
      if (sceneId === id) {
        handleStartNewScene();
      }
      showToast(`"${scTitle}" silindi.`);
    }
  };

  // Sahneyi Kaydet (Mevcut olanı güncelle veya yeni kopya olarak kaydet)
  const handleSaveScene = async (asNewCopy: boolean = false) => {
    if (!videoUrl) {
      showToast('Lütfen önce bir video seçin veya yükleyin.');
      return;
    }
    if (isUploadingToSupabase || videoUrl.startsWith('blob:')) {
      showToast(
        'Video henüz buluta yüklenmedi. Yükleme tamamlandığında sahneyi kaydedin.',
      );
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
      : title.trim() || 'Meme Sahnesi';

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
      showToast('Sahne kaydediliyor ve oyuna ekleniyor...');
      await saveSceneToSupabase(newScene);
      saveCustomScene(newScene); // yerel yedek
      setSupabaseScenes((prev) => [
        newScene,
        ...prev.filter((s) => s.id !== newScene.id),
      ]);
      setSceneId(targetId);
      setTitle(targetTitle);
      setIsEditingExisting(true);
      setEditingSceneTitle(targetTitle);
      showToast(
        asNewCopy
          ? `"${targetTitle}" yeni bir sahne olarak oyuna eklendi!`
          : `"${targetTitle}" sahnesindeki değişiklikler başarıyla güncellendi!`,
      );
    } catch (err) {
      saveCustomScene(newScene);
      setSceneId(targetId);
      setTitle(targetTitle);
      setIsEditingExisting(true);
      setEditingSceneTitle(targetTitle);
      showToast(
        `Supabase uyarısı: ${(err as Error).message}. Yerel olarak kaydedildi.`,
      );
    }
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
        showToast('Sahne JSON dosyası başarıyla aktarıldı.');
      } catch {
        showToast('Geçersiz JSON dosyası.');
      }
    };
    reader.readAsText(file);
  };

  // O anki aktif replik (Canlı dublaj önizlemesi için)
  const currentActiveCue = useMemo(() => {
    return cues.find((c) => currentTime >= c.start && currentTime <= c.end);
  }, [cues, currentTime]);

  return (
    <div className="replik-editor min-h-screen bg-[#090909] text-[#F4F4E9] flex flex-col font-sans">
      {pendingVideo && (
        <VideoTrimDialog
          file={pendingVideo}
          onCancel={() => setPendingVideo(null)}
          onConfirm={(file, clipDuration) => {
            setPendingVideo(null);
            processVideoFile(file, clipDuration);
          }}
        />
      )}
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
      <header className="border-b border-[#383832] bg-[#1A1A17] px-6 py-3.5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              window.location.assign('/');
            }}
            className="px-4 py-2 rounded-xl text-xs font-extrabold bg-[#22221E] hover:bg-[#F5E636] text-[#F5E636] hover:text-[#090909] border border-[#383832] flex items-center gap-2 transition cursor-pointer no-underline"
          >
            <ArrowLeft size={15} />
            <span>Oyuna Dön</span>
          </a>
          <div className="h-5 w-[1px] bg-[#383832] hidden sm:block" />
          <div
            style={{
              fontSize: '16px',
              letterSpacing: 'normal',
              lineHeight: 1.3,
            }}
            className="font-extrabold text-[#F4F4E9] flex items-center gap-2"
          >
            <Film size={18} className="text-[#F5E636] shrink-0" />
            <span>Sahne Stüdyosu</span>
            {isEditingExisting && title && (
              <span
                style={{ fontSize: '13px', letterSpacing: 'normal' }}
                className="font-semibold text-[#B8B8AE] hidden md:inline"
              >
                — “{title}”
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsSceneModalOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#22221E] hover:bg-[#32322C] text-[#F4F4E9] border border-[#383832] flex items-center gap-2 transition cursor-pointer"
          >
            <FolderOpen size={15} className="text-[#F5E636]" />
            <span>Kayıtlı Sahneler ({allScenesList.length})</span>
          </button>

          {videoUrl && (
            <button
              type="button"
              onClick={handleStartNewScene}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#22221E] hover:bg-[#32322C] text-[#F4F4E9] border border-[#383832] flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">Yeni Video Yükle</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleSaveScene(false)}
            className="px-5 py-2 rounded-xl text-xs sm:text-sm font-extrabold bg-[#F5E636] hover:bg-[#F5E636] text-[#090909] flex items-center gap-2 shadow-lg shadow-[#F5E636]/15 transition cursor-pointer"
          >
            <Check size={16} strokeWidth={2.5} />
            <span className="editor-save-label-full">
              {isEditingExisting ? 'Değişiklikleri Kaydet' : 'Sahneyi Kaydet'}
            </span>
            <span className="editor-save-label-short">Kaydet</span>
          </button>
        </div>
      </header>

      {/* TOAST BİLDİRİMİ */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1A1A17] border border-[#F5E636] text-[#F4F4E9] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-semibold">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ANA İÇERİK: SOLDA VİDEO, SAĞDA 3 BASİT ADIM */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* SOL SÜTUN: VİDEO ÖNİZLEME (6 SÜTUN) */}
        <div className="lg:col-span-6 flex flex-col gap-4 lg:sticky lg:top-20">
          <div className="bg-[#1A1A17] border border-[#383832] rounded-2xl p-4 flex flex-col gap-3.5 shadow-xl">
            {/* Otomatik İşlem Durum Bildirimleri (Varsa gösterilir) */}
            {(isUploadingToSupabase ||
              isRemovingVocals ||
              whisper.isProcessing) && (
              <div className="flex flex-col gap-2 bg-[#22221E] border border-[#383832] rounded-xl p-3">
                {isUploadingToSupabase && (
                  <div className="flex items-center justify-between text-xs font-semibold text-[#9E8CA9]">
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Video buluta yükleniyor...
                    </span>
                    <span>%{uploadProgress}</span>
                  </div>
                )}
                {isRemovingVocals && (
                  <div className="flex items-center justify-between text-xs font-semibold text-[#9E8CA9]">
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Konuşma sesleri ayrıştırılıyor, ses efektleri korunuyor...
                    </span>
                    <span>%{vocalProgress}</span>
                  </div>
                )}
                {whisper.isProcessing && (
                  <div className="flex items-center justify-between text-xs font-semibold text-[#F5E636]">
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      {whisper.statusMessage ||
                        'Yapay zeka konuşmaları yazıya döküyor...'}
                    </span>
                    <span>%{whisper.progress}</span>
                  </div>
                )}
              </div>
            )}

            {/* VİDEO KUTUSU */}
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-[#383832] flex items-center justify-center">
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
                    if (f) stageVideoFile(f);
                  }}
                  className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center border-2 border-dashed border-[#383832] hover:border-[#F5E636] bg-[#1A1A17] transition cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-2xl bg-[#22221E] border border-[#383832] flex items-center justify-center text-[#F5E636] group-hover:scale-105 transition">
                    <Upload size={30} />
                  </div>
                  <div className="flex flex-col gap-1 max-w-sm">
                    <h3 className="text-base font-extrabold text-[#F4F4E9]">
                      Videonu Buraya Bırak veya Seç
                    </h3>
                    <p className="text-xs text-[#B8B8AE]">
                      Videoyu yüklediğinde konuşmalar ve ses efektleri otomatik
                      olarak hazırlanır.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="px-5 py-2.5 rounded-xl text-xs font-extrabold bg-[#F5E636] text-[#090909] flex items-center gap-2 shadow-md"
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
                    muted={
                      audioMode === 'instrumental' && Boolean(instrumentalUrl)
                        ? true
                        : isMuted
                    }
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => {
                      if (
                        audioMode === 'instrumental' &&
                        instrumentalUrl &&
                        instrumentalAudioRef.current
                      ) {
                        instrumentalAudioRef.current.currentTime =
                          videoRef.current?.currentTime || 0;
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
                        instrumentalAudioRef.current.currentTime =
                          videoRef.current.currentTime;
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
                      className="absolute p-4 rounded-full bg-black/65 text-[#F5E636] border border-white/20 hover:scale-105 transition shadow-2xl cursor-pointer"
                      aria-label="Oynat"
                    >
                      <Play size={30} fill="currentColor" />
                    </button>
                  )}
                </>
              )}
            </div>

            {/* ETKİLEŞİMLİ ZAMAN ÇİZELGESİ (MOUSE İLE BAŞLANGIÇ & BİTİŞ AYARLAMA) */}
            {videoUrl && (
              <div className="flex flex-col gap-3">
                {/* Üst Kontroller: Oynat, Süre, Ses Modu */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="px-3.5 py-2 rounded-xl bg-[#F5E636] text-[#090909] font-extrabold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      {isPlaying ? (
                        <Pause size={15} />
                      ) : (
                        <Play size={15} fill="currentColor" />
                      )}
                      <span>{isPlaying ? 'Durdur' : 'Oynat'}</span>
                    </button>

                    <span className="text-xs font-mono text-[#F5E636] bg-[#1A1A17] px-3 py-2 rounded-xl border border-[#383832] font-bold">
                      {formatTimecode(currentTime)} / {formatTimecode(duration)}
                    </span>
                  </div>

                  {/* Ses Modu Seçimi (Vokalsiz Efektli vs Orijinal) */}
                  <div className="flex items-center gap-1.5">
                    {instrumentalUrl ? (
                      <div className="flex items-center bg-[#1A1A17] border border-[#383832] rounded-xl p-1">
                        <button
                          type="button"
                          onClick={() => {
                            setAudioMode('instrumental');
                            if (videoRef.current) videoRef.current.muted = true;
                            if (instrumentalAudioRef.current) {
                              instrumentalAudioRef.current.currentTime =
                                videoRef.current?.currentTime || 0;
                              if (isPlaying)
                                instrumentalAudioRef.current
                                  .play()
                                  .catch(() => {});
                            }
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                            audioMode === 'instrumental'
                              ? 'bg-[#F5E636] text-[#090909]'
                              : 'text-[#B8B8AE] hover:text-white'
                          }`}
                        >
                          Vokalsiz (Efektli)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAudioMode('original');
                            if (instrumentalAudioRef.current)
                              instrumentalAudioRef.current.pause();
                            if (videoRef.current)
                              videoRef.current.muted = false;
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                            audioMode === 'original'
                              ? 'bg-[#F5E636] text-[#090909]'
                              : 'text-[#B8B8AE] hover:text-white'
                          }`}
                        >
                          Orijinal Ses
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleManualVocalRemoval}
                        disabled={isRemovingVocals}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#1A1A17] hover:bg-[#22221E] text-[#9E8CA9] border border-[#383832] flex items-center gap-1.5 cursor-pointer"
                      >
                        <Music size={14} />
                        <span>Vokalleri Temizle</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#22221E] hover:bg-[#22221E] text-[#F4F4E9] border border-[#383832] cursor-pointer"
                    >
                      Videoyu Değiştir
                    </button>
                  </div>
                </div>

                {/* GÖRSEL ZAMAN ÇİZELGESİ KUTUSU */}
                <div className="bg-[#1A1A17] border border-[#383832] rounded-2xl p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="text-[#F5E636]" />
                      <span className="text-xs font-extrabold text-[#F4F4E9]">
                        Zaman Çizelgesi
                      </span>
                      <span className="text-[11px] text-[#B8B8AE]">
                        Kenarlar süreyi ayarlar · Gövde repliği taşır
                      </span>
                    </div>

                    {/* Yakınlaştırma (Zoom) Butonları */}
                    <div className="flex items-center gap-1 bg-[#1A1A17] border border-[#383832] rounded-lg p-0.5">
                      {[1, 2, 4].map((z) => (
                        <button
                          key={z}
                          type="button"
                          onClick={() => setTimelineZoom(z)}
                          className={`px-2 py-0.5 rounded text-[11px] font-extrabold transition cursor-pointer ${
                            timelineZoom === z
                              ? 'bg-[#F5E636] text-[#090909]'
                              : 'text-[#B8B8AE] hover:text-white'
                          }`}
                        >
                          {z}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Kaydırılabilir Ana Zaman Çizelgesi */}
                  <div
                    ref={timelineScrollRef}
                    className="w-full overflow-x-auto pb-1 select-none"
                  >
                    <div
                      ref={timelineRef}
                      style={{
                        width: `${timelineZoom * 100}%`,
                        minWidth: '100%',
                      }}
                      onMouseDown={(e) => {
                        if (!timelineRef.current) return;
                        const rect =
                          timelineRef.current.getBoundingClientRect();
                        const ratio = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / rect.width),
                        );
                        seekTo(Number((ratio * duration).toFixed(1)));
                        setIsScrubbingTimeline(true);
                      }}
                      className={`relative h-28 bg-[#1A1A17] border rounded-xl overflow-hidden cursor-pointer transition-colors ${
                        dragging ? 'border-[#F5E636]' : 'border-[#383832]'
                      }`}
                    >
                      {/* Saniye Cetveli (Ruler) */}
                      <div className="absolute top-0 left-0 right-0 h-5 bg-[#1A1A17] border-b border-[#383832] flex items-center pointer-events-none z-10">
                        {Array.from({
                          length: Math.max(
                            2,
                            Math.floor(
                              duration /
                                (timelineZoom >= 4
                                  ? 2
                                  : timelineZoom >= 2
                                    ? 5
                                    : 10),
                            ) + 1,
                          ),
                        }).map((_, idx) => {
                          const stepSec =
                            timelineZoom >= 4 ? 2 : timelineZoom >= 2 ? 5 : 10;
                          const sec = idx * stepSec;
                          if (sec > duration) return null;
                          const leftPct = (sec / Math.max(1, duration)) * 100;
                          return (
                            <div
                              key={sec}
                              style={{ left: `${leftPct}%` }}
                              className="absolute top-0 bottom-0 flex items-center"
                            >
                              <div className="h-2.5 w-[1px] bg-[#383832]" />
                              <span className="text-[9.5px] font-mono text-[#B8B8AE] ml-1">
                                {formatTimecode(sec)}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Ses Dalgası (Waveform) Arka Planı */}
                      <div className="absolute inset-x-0 top-5 bottom-0 flex items-center justify-between px-0.5 pointer-events-none opacity-35">
                        {(waveformPeaks.length > 0
                          ? waveformPeaks
                          : Array.from(
                              { length: 90 },
                              (_, i) => 0.2 + ((i * 7) % 5) * 0.12,
                            )
                        ).map((peak, idx) => (
                          <div
                            key={idx}
                            style={{
                              height: `${Math.max(12, Math.round(peak * 85))}%`,
                            }}
                            className="w-[2px] rounded-full bg-[#9E8CA9]"
                          />
                        ))}
                      </div>

                      {/* Replik Blokları (Mouse ile Sürüklenebilir) */}
                      <div className="absolute inset-x-0 top-6 bottom-1.5">
                        {cues.map((cue, idx) => {
                          const isSelected = cue.id === selectedCueId;
                          const leftPct = Math.max(
                            0,
                            Math.min(
                              99.5,
                              (cue.start / Math.max(1, duration)) * 100,
                            ),
                          );
                          const widthPct = Math.max(
                            1.2,
                            Math.min(
                              100 - leftPct,
                              ((cue.end - cue.start) / Math.max(1, duration)) *
                                100,
                            ),
                          );

                          return (
                            <div
                              key={cue.id}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                backgroundColor: isSelected ? '#F5E636' : '#9E8CA9',
                                borderColor: isSelected ? '#F5E636' : '#9E8CA9',
                                zIndex: isSelected ? 20 : 10,
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                setSelectedCueId(cue.id);
                                seekTo(cue.start);
                                document
                                  .getElementById(`cue-card-${cue.id}`)
                                  ?.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'nearest',
                                  });
                                if (!timelineRef.current) return;
                                const rect =
                                  timelineRef.current.getBoundingClientRect();
                                setDragging({
                                  cueId: cue.id,
                                  type: 'move',
                                  initialMouseX: e.clientX,
                                  initialStart: cue.start,
                                  initialEnd: cue.end,
                                  timelineRect: {
                                    left: rect.left,
                                    width: rect.width,
                                  },
                                  spanDuration: duration,
                                });
                              }}
                              className={`absolute top-2 bottom-2 rounded-lg border-2 flex items-center justify-between overflow-visible group transition-all cursor-grab active:cursor-grabbing hover:brightness-110 focus-within:ring-2 focus-within:ring-white ${
                                isSelected
                                  ? 'shadow-lg shadow-black/80 ring-2 ring-[#F5E636]'
                                  : 'hover:ring-1 hover:ring-white/70'
                              }`}
                              title={`#${idx + 1} ${cue.roleName}: ${formatTimecode(cue.start)}–${formatTimecode(cue.end)} (ortadan taşı, kenarlardan ayarla)`}
                            >
                              {/* SOL TUTAMAÇ: BAŞLANGIÇ (START) MOUSE SÜRGÜSÜ */}
                              <button
                                type="button"
                                aria-label={`Replik ${idx + 1} başlangıcını sürükle`}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  setSelectedCueId(cue.id);
                                  if (!timelineRef.current) return;
                                  const rect =
                                    timelineRef.current.getBoundingClientRect();
                                  setDragging({
                                    cueId: cue.id,
                                    type: 'start',
                                    initialMouseX: e.clientX,
                                    initialStart: cue.start,
                                    initialEnd: cue.end,
                                    timelineRect: {
                                      left: rect.left,
                                      width: rect.width,
                                    },
                                    spanDuration: duration,
                                  });
                                }}
                                onKeyDown={(e) => {
                                  if (
                                    e.key !== 'ArrowLeft' &&
                                    e.key !== 'ArrowRight'
                                  )
                                    return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  nudgeCueBoundary(
                                    cue,
                                    'start',
                                    e.key === 'ArrowLeft' ? -0.1 : 0.1,
                                  );
                                }}
                                className="h-full w-4 -ml-1 bg-white hover:bg-[#F5E636] focus:bg-[#F5E636] focus:outline-none text-black rounded-l-md flex items-center justify-center cursor-ew-resize shrink-0 shadow-md z-30"
                                title="Başlangıcı (Start) mouse ile sağa/sola sürükle"
                              >
                                <div className="w-[3px] h-4 bg-black/70 rounded-full" />
                              </button>

                              {/* Replik Etiketi */}
                              <div className="px-1.5 truncate text-[10.5px] font-black text-black pointer-events-none select-none leading-tight">
                                #{idx + 1} {cue.roleName}
                              </div>

                              {/* SAĞ TUTAMAÇ: BİTİŞ (END) MOUSE SÜRGÜSÜ */}
                              <button
                                type="button"
                                aria-label={`Replik ${idx + 1} bitişini sürükle`}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  setSelectedCueId(cue.id);
                                  if (!timelineRef.current) return;
                                  const rect =
                                    timelineRef.current.getBoundingClientRect();
                                  setDragging({
                                    cueId: cue.id,
                                    type: 'end',
                                    initialMouseX: e.clientX,
                                    initialStart: cue.start,
                                    initialEnd: cue.end,
                                    timelineRect: {
                                      left: rect.left,
                                      width: rect.width,
                                    },
                                    spanDuration: duration,
                                  });
                                }}
                                onKeyDown={(e) => {
                                  if (
                                    e.key !== 'ArrowLeft' &&
                                    e.key !== 'ArrowRight'
                                  )
                                    return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  nudgeCueBoundary(
                                    cue,
                                    'end',
                                    e.key === 'ArrowLeft' ? -0.1 : 0.1,
                                  );
                                }}
                                className="h-full w-4 -mr-1 bg-white hover:bg-[#F5E636] focus:bg-[#F5E636] focus:outline-none text-black rounded-r-md flex items-center justify-center cursor-ew-resize shrink-0 shadow-md z-30"
                                title="Bitişi (End) mouse ile sağa/sola sürükle"
                              >
                                <div className="w-[3px] h-4 bg-black/70 rounded-full" />
                              </button>

                              {isSelected && (
                                <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[#F5E636]/50 bg-[#1A1A17]/95 px-2 py-1 text-[10px] font-mono font-bold text-[#F5E636] shadow-xl pointer-events-none">
                                  {formatTimecode(cue.start)} — {formatTimecode(cue.end)} · {formatTimecode(cue.end - cue.start)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Kırmızı/Sarı Oynatma İmleci (Playhead) */}
                      <div
                        style={{
                          left: `${Math.max(0, Math.min(100, (currentTime / Math.max(1, duration)) * 100))}%`,
                        }}
                        className="absolute top-0 bottom-0 w-[2px] bg-[#F5E636] pointer-events-none z-30 shadow-[0_0_8px_#F5E636]"
                      >
                        <div className="w-3 h-3 -ml-[5px] rounded-full bg-[#F5E636] border-2 border-black" />
                      </div>
                    </div>
                  </div>

                  {/* Seçili replik özeti — zamanlama ana çizelgeden düzenlenir */}
                  {(() => {
                    const activeCue =
                      cues.find((c) => c.id === selectedCueId) || cues[0];
                    if (!activeCue) return null;
                    const activeIndex = cues.findIndex(
                      (c) => c.id === activeCue.id,
                    );
                    const overlaps = hasCueOverlap(cues, activeCue.id);

                    return (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#383832] bg-[#1A1A17] px-3 py-2.5 flex-wrap">
                        <div className="flex min-w-0 items-center gap-2 text-xs">
                          <span
                            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-extrabold text-black"
                            style={{ backgroundColor: activeCue.roleColor }}
                          >
                            #{activeIndex + 1} · {activeCue.roleName}
                          </span>
                          <span className="truncate text-[#B8B8AE]">
                            “{activeCue.text}”
                          </span>
                          <span className="shrink-0 font-mono font-bold text-[#F5E636]">
                            {formatTimecode(activeCue.start)} — {formatTimecode(activeCue.end)}
                          </span>
                          {overlaps && (
                            <span className="shrink-0 rounded-md bg-[#FA563622] px-2 py-1 text-[10px] font-bold text-[#FA5636]">
                              Çakışma var
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={markCurrentTimeAsStart}
                            className="px-2 py-1 rounded-lg bg-[#22221E] hover:bg-[#32322C] text-[#F5E636] border border-[#383832] text-[11px] font-bold cursor-pointer"
                            title="Videonun şu anki saniyesini bu repliğin başlangıcı yap"
                          >
                            Başlangıç = Oynatma İmleci
                          </button>
                          <button
                            type="button"
                            onClick={markCurrentTimeAsEnd}
                            className="px-2 py-1 rounded-lg bg-[#22221E] hover:bg-[#32322C] text-[#F5E636] border border-[#383832] text-[11px] font-bold cursor-pointer"
                            title="Videonun şu anki saniyesini bu repliğin bitişi yap"
                          >
                            Bitiş = Oynatma İmleci
                          </button>
                          <button
                            type="button"
                            onClick={() => playCueOnly(activeCue)}
                            className="px-2.5 py-1 rounded-lg bg-[#F5E636] text-[#090909] text-[11px] font-extrabold flex items-center gap-1 cursor-pointer"
                          >
                            <Play size={11} fill="currentColor" /> Dinle
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* SAĞ SÜTUN: 3 BASİT ADIMDA DÜZENLEME (6 SÜTUN) */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          {/* ADIM 1: SAHNE ADI */}
          <div className="bg-[#1A1A17] border border-[#383832] rounded-2xl p-4 flex flex-col gap-2.5 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#F5E636] text-[#090909] text-xs font-black flex items-center justify-center">
                1
              </span>
              <h2 className="text-sm font-extrabold text-[#F4F4E9]">
                Sahne Adı
              </h2>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn: Gökhan Abi ve Cio Tartışıyor"
              className="w-full bg-[#090909] border border-[#383832] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[#F4F4E9] focus:outline-none focus:border-[#F5E636]"
            />
          </div>

          {/* ADIM 2: KARAKTERLER */}
          <div className="bg-[#1A1A17] border border-[#383832] rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#F5E636] text-[#090909] text-xs font-black flex items-center justify-center">
                  2
                </span>
                <h2 className="text-sm font-extrabold text-[#F4F4E9]">
                  Karakterler ({roles.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={addRole}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#22221E] hover:bg-[#32322C] text-[#F5E636] border border-[#383832] flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus size={14} /> Karakter Ekle
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="bg-[#090909] border border-[#383832] rounded-xl px-3 py-2 flex items-center gap-2"
                >
                  <input
                    type="color"
                    value={role.color}
                    onChange={(e) =>
                      updateRole(role.id, { color: e.target.value })
                    }
                    className="w-5 h-5 rounded-full border-0 cursor-pointer bg-transparent p-0 shrink-0"
                    title="Karakter Rengi"
                  />
                  <input
                    type="text"
                    value={role.name}
                    onChange={(e) =>
                      updateRole(role.id, { name: e.target.value })
                    }
                    className="w-full bg-transparent text-xs font-bold text-[#F4F4E9] focus:outline-none"
                    placeholder="Karakter Adı"
                  />
                  {roles.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setRoles((prev) => prev.filter((r) => r.id !== role.id))
                      }
                      className="text-[#B8B8AE] hover:text-[#FA5636] p-0.5 transition cursor-pointer"
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
          <div className="bg-[#1A1A17] border border-[#383832] rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#F5E636] text-[#090909] text-xs font-black flex items-center justify-center">
                  3
                </span>
                <h2 className="text-sm font-extrabold text-[#F4F4E9]">
                  Replikler ({cues.length})
                </h2>
              </div>

              <div className="flex items-center gap-2">
                {videoUrl && (
                  <button
                    type="button"
                    onClick={handleAutoSubtitle}
                    disabled={whisper.isProcessing}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#22221E] hover:bg-[#32322C] text-[#F5E636] border border-[#383832] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
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
                  className="px-3.5 py-1.5 rounded-xl text-xs font-extrabold bg-[#F5E636] hover:bg-[#F5E636] text-[#090909] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus size={14} /> Yeni Replik Ekle
                </button>
              </div>
            </div>

            {cues.length === 0 ? (
              <div className="bg-[#090909] border border-dashed border-[#383832] rounded-xl p-6 text-center flex flex-col items-center gap-2">
                <p className="text-xs text-[#B8B8AE]">
                  Henüz replik yok. <strong>“Otomatik Altyazı Çıkar”</strong>{' '}
                  veya <strong>“Yeni Replik Ekle”</strong> butonuna basarak
                  başlayabilirsin.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-[520px] overflow-y-auto pr-1">
                {cues.map((cue, index) => {
                  const isSelected = cue.id === selectedCueId;
                  return (
                    <div
                      id={`cue-card-${cue.id}`}
                      key={cue.id}
                      onClick={() => {
                        setSelectedCueId(cue.id);
                        seekTo(cue.start);
                      }}
                      className={`p-3 rounded-xl border transition flex flex-col gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-[#22221E] border-[#F5E636]'
                          : 'bg-[#090909] border-[#383832] hover:border-[#383832]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {/* Sol: Sıra No & Hangi Karakter Konuşuyor */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-[#B8B8AE]">
                            #{index + 1}
                          </span>
                          <select
                            value={cue.roleIndex}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateCue(cue.id, {
                                roleIndex: parseInt(e.target.value),
                              });
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

                        {/* Sağ: Zaman özeti, izle ve sil */}
                        <div
                          className="flex items-center gap-1.5 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="rounded-lg border border-[#383832] bg-[#1A1A17] px-2 py-1 font-mono text-[11px] font-bold text-[#F5E636]">
                            {formatTimecode(cue.start)} — {formatTimecode(cue.end)}
                          </span>

                          <button
                            type="button"
                            onClick={() => playCueOnly(cue)}
                            className="p-1.5 rounded-lg bg-[#22221E] hover:bg-[#22221E] text-[#F5E636] transition cursor-pointer"
                            title="Bu Repliği İzle"
                          >
                            <Play size={13} fill="currentColor" />
                          </button>

                          <button
                            type="button"
                            onClick={() => removeCue(cue.id)}
                            className="p-1.5 rounded-lg bg-[#22221E] hover:bg-[#FA563622] text-[#B8B8AE] hover:text-[#FA5636] transition cursor-pointer"
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
                        onChange={(e) =>
                          updateCue(cue.id, { text: e.target.value })
                        }
                        placeholder="Karakterin söyleyeceği cümleyi buraya yaz..."
                        className="w-full bg-[#1A1A17] border border-[#383832] rounded-lg px-3 py-2 text-xs sm:text-sm font-medium text-[#F4F4E9] focus:outline-none focus:border-[#F5E636]"
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
            className="bg-[#1A1A17] border border-[#383832] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#383832]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#F5E636]/15 text-[#F5E636] flex items-center justify-center border border-[#F5E636]/30">
                  <FolderOpen size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#F4F4E9]">
                    Sahneleri Aç &amp; Düzenle
                  </h3>
                  <p className="text-xs text-[#B8B8AE]">
                    İstediğiniz sahneyi seçerek altyazılarını, replik
                    zamanlamalarını veya vokal temizliğini editörde düzenleyin.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSceneModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-[#22221E] hover:bg-[#383832] text-[#B8B8AE] hover:text-[#F4F4E9] flex items-center justify-center transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Search & Filter */}
            <div className="px-6 py-3 border-b border-[#22221E] bg-[#1A1A17] flex items-center justify-between gap-4">
              <div className="relative flex-1">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B8B8AE]"
                />
                <input
                  type="text"
                  value={sceneSearch}
                  onChange={(e) => setSceneSearch(e.target.value)}
                  placeholder="Sahne adı, kategori veya karakter ara..."
                  className="w-full bg-[#1A1A17] border border-[#383832] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[#F4F4E9] focus:outline-none focus:border-[#F5E636]"
                />
              </div>
              <span className="text-xs text-[#B8B8AE] whitespace-nowrap">
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
                    className={`bg-[#1A1A17] border rounded-xl overflow-hidden flex flex-col transition group ${
                      isCurrent
                        ? 'border-[#F5E636] shadow-lg shadow-[#F5E636]/10'
                        : 'border-[#383832] hover:border-[#383832]'
                    }`}
                  >
                    {/* Thumbnail / Poster */}
                    <div
                      className="h-32 bg-[#1A1A17] relative bg-cover bg-center flex items-end p-2.5"
                      style={
                        sc.poster
                          ? { backgroundImage: `url('${sc.poster}')` }
                          : undefined
                      }
                    >
                      <span className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm text-[10px] text-[#F4F4E9] font-mono px-1.5 py-0.5 rounded">
                        00:{sc.duration}
                      </span>
                      {sc.isCustom && (
                        <span className="absolute top-2 right-2 bg-[#F5E636] text-[#1A1A17] text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                          Meme / Özel
                        </span>
                      )}
                      {sc.instrumental && (
                        <span className="absolute bottom-2 left-2 bg-[#9E8CA9]/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Music size={10} /> M&amp;E Vokalsiz
                        </span>
                      )}
                    </div>

                    {/* Metadata & Actions */}
                    <div className="p-3 flex-1 flex flex-col justify-between gap-3">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-[#F4F4E9] group-hover:text-[#F5E636] transition line-clamp-1">
                            {sc.title}
                          </h4>
                          {isCurrent && (
                            <span className="text-[10px] text-[#F5E636] font-bold shrink-0">
                              ● Açık
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#B8B8AE] mt-0.5">
                          {sc.category} · {sc.roles?.length || 0} Karakter
                        </p>
                        {sc.mood && (
                          <p className="text-[10px] text-[#B8B8AE] mt-1 line-clamp-1 italic">
                            {sc.mood}
                          </p>
                        )}
                      </div>

                      {/* Buttons */}
                      <div className="flex items-center gap-1.5 pt-2 border-t border-[#22221E]">
                        <button
                          onClick={() => loadScene(sc)}
                          className="flex-1 py-1.5 px-2 bg-[#F5E636] hover:bg-[#F5E636] text-[#1A1A17] text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <Edit3 size={13} />
                          {isCurrent ? 'Yeniden Yükle' : 'Düzenle'}
                        </button>
                        {sc.isCustom && (
                          <button
                            onClick={() =>
                              handleDeleteSupabaseScene(sc.id, sc.title)
                            }
                            className="p-1.5 bg-[#1A1A17] hover:bg-[#FA563622] text-[#B8B8AE] hover:text-[#FA5636] rounded-lg transition cursor-pointer"
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
            <div className="px-6 py-3 border-t border-[#22221E] bg-[#1A1A17] flex items-center justify-between">
              <span className="text-xs text-[#B8B8AE]">
                Düzenlemek istediğiniz sahneye tıklayın, tüm replikleri ve
                zamanlamaları anında önünüze gelecektir.
              </span>
              <button
                onClick={handleStartNewScene}
                className="px-3 py-1.5 bg-[#22221E] hover:bg-[#383832] text-[#F5E636] text-xs font-semibold rounded-lg flex items-center gap-1.5 transition cursor-pointer"
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
