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
  Maximize2,
  Minimize2,
  Scissors,
  Layers,
  Palette,
} from 'lucide-react';
import {
  type Scene,
  type Cue,
  type RoleInfo,
  CHARACTER_PALETTE,
  getCharacterColor,
  ensureDistinctRoleColors,
  getAllScenes,
  sceneCues,
  saveCustomScene,
  getCustomScenes,
  deleteCustomScene,
} from '@/lib/scenes';
import { useWhisper } from '@/lib/use-whisper';
import { prepareSceneBackground } from '@/lib/vocal-remover';
import { adjustCueTiming, hasCueOverlap } from '@/lib/timeline';
import { formatTimecode } from '@/lib/timecode';
import { VideoTrimDialog } from '@/components/video-trim-dialog';
import { SceneVideoGifCover } from '@/components/scene-video-gif-cover';
import { resolveVideoDuration } from '@/lib/video-trimmer';
import {
  uploadVideoToSupabase,
  saveSceneToSupabase,
  getScenesFromSupabase,
  deleteSceneFromSupabase,
} from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { MemberTopbarBadge } from '@/components/auth-provider';
import { triggerReplikCurtain } from '@/components/replik-loading-screen';

function waveformFromAudio(channel: Float32Array): number[] {
  const barCount = 140;
  const step = Math.max(1, Math.floor(channel.length / barCount));
  const peaks: number[] = [];
  let maxPeak = 0.01;
  for (let i = 0; i < barCount; i++) {
    let peak = 0;
    const offset = i * step;
    const limit = Math.min(channel.length, offset + step);
    for (let j = offset; j < limit; j += 8) peak = Math.max(peak, Math.abs(channel[j]));
    maxPeak = Math.max(maxPeak, peak);
    peaks.push(peak);
  }
  return peaks.map((peak) => Math.max(0.08, Math.min(1, peak / maxPeak)));
}

export default function EditorPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const instrumentalAudioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const cueListRef = useRef<HTMLDivElement>(null);
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
  const [vocalError, setVocalError] = useState('');
  const [vocalNotice, setVocalNotice] = useState('');
  const [isRemovingVocals, setIsRemovingVocals] = useState<boolean>(false);
  const [vocalProgress, setVocalProgress] = useState<number>(0);
  const [vocalStage, setVocalStage] = useState<string>('');
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
      color: CHARACTER_PALETTE[0],
      description: 'İlk konuşan karakter',
    },
    {
      id: 1,
      name: '2. Karakter',
      color: CHARACTER_PALETTE[1],
      description: 'İkinci karakter',
    },
  ]);

  const [cues, setCues] = useState<Cue[]>([]);
  const [selectedCueId, setSelectedCueId] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const list = cueListRef.current;
    if (!list) return;

    const handleCueTextWheel = (event: WheelEvent) => {
      const input = event.target;
      if (
        !(input instanceof HTMLInputElement) ||
        !input.classList.contains('cue-text-input')
      ) return;

      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
      if (!delta) return;
      const distance = delta * (
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? input.clientWidth : 1
      );
      const previous = input.scrollLeft;
      input.scrollLeft += distance;
      if (input.scrollLeft !== previous) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    list.addEventListener('wheel', handleCueTextWheel, { passive: false });
    return () => list.removeEventListener('wheel', handleCueTextWheel);
  }, [cues.length]);

  // Mevcut Sahne Düzenleme Modu ve Sahne Seçici Modal Durumu
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [, setEditingSceneTitle] = useState('');
  const [isSceneModalOpen, setIsSceneModalOpen] = useState(false);
  const [sceneSearch, setSceneSearch] = useState('');
  const hasLoadedUrlScene = useRef(false);

  // Zaman Çizelgesi Mouse ile Sürükleme, Ses Dalgası ve Yakınlaştırma Durumu
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const [timelineZoom, setTimelineZoom] = useState<number>(2);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const videoJobRef = useRef(0);
  const audioPreparationRef = useRef<{ job: number; controller: AbortController } | null>(null);
  const sourceFileRef = useRef<File | null>(null);
  const originalFileRef = useRef<File | null>(null);
  const localVideoUrlRef = useRef<string | null>(null);
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

  const timelineBoxRef = useRef<HTMLDivElement>(null);
  const timelineZoomRef = useRef(timelineZoom);
  timelineZoomRef.current = timelineZoom;

  // Zaman Çizelgesi Mouse Scroll / Tekerlek / Pinch ile Yakınlaştırma (Zoom In / Zoom Out)
  useEffect(() => {
    const scrollEl = timelineScrollRef.current;
    const boxEl = timelineBoxRef.current || scrollEl;
    if (!scrollEl || !boxEl) return;

    const handleWheel = (e: WheelEvent) => {
      // Shift tuşu basılıysa yatay kaydırmaya izin ver
      if (e.shiftKey) return;

      // Sayfanın aşağı-yukarı kaymasını engelleyip çizelgeyi zoomla
      e.preventDefault();
      e.stopPropagation();

      const rect = scrollEl.getBoundingClientRect();
      const rawMouseX = e.clientX - rect.left;
      const mouseX = Math.max(0, Math.min(rect.width, rawMouseX));
      const currentScroll = scrollEl.scrollLeft;
      const scrollWidth = scrollEl.scrollWidth || 1;
      const focalRatio = (currentScroll + mouseX) / scrollWidth;

      // Hem mouse tekerleği (deltaMode=1 veya büyük deltaY) hem trackpad için akıcı hassasiyet
      const rawDelta = Math.abs(e.deltaY) > 0 ? e.deltaY : e.deltaX;
      if (rawDelta === 0) return;
      const normalizedDelta =
        e.deltaMode === 1
          ? rawDelta * 32
          : Math.max(-120, Math.min(120, rawDelta));
      const zoomSensitivity = e.ctrlKey ? 0.012 : 0.0038;
      const factor = Math.exp(-normalizedDelta * zoomSensitivity);

      setTimelineZoom((prevZoom) => {
        const rawNext = prevZoom * factor;
        const nextZoom = Math.max(
          0.75,
          Math.min(12, Number(rawNext.toFixed(2))),
        );
        if (Math.abs(nextZoom - prevZoom) < 0.01) return prevZoom;

        // Mouse imlecinin altındaki saniyenin yerini koru
        requestAnimationFrame(() => {
          if (scrollEl) {
            const newScrollWidth = scrollEl.scrollWidth;
            scrollEl.scrollLeft = Math.max(
              0,
              focalRatio * newScrollWidth - mouseX,
            );
          }
        });

        return nextZoom;
      });
    };

    boxEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      boxEl.removeEventListener('wheel', handleWheel);
    };
  }, [videoUrl, timelineExpanded, roles.length]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  useEffect(() => () => {
    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current);
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
    const job = videoJobRef.current;
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
        (audio) => { if (videoJobRef.current === job) setWaveformPeaks(waveformFromAudio(audio)); },
      );
      if (videoJobRef.current !== job) return;
      if (result.audioData) setWaveformPeaks(waveformFromAudio(result.audioData));
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
      if (videoJobRef.current !== job) return;
      showToast(`Hata: ${(err as Error).message}`);
    }
  }, [videoUrl, roles, duration, whisper, whisperModel, showToast]);

  // Video zaman güncellemesi
  const handleTimeUpdate = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const rawTime = vid.currentTime;
    if (!Number.isFinite(rawTime)) return;

    if (rawTime > duration + 0.05) {
      setDuration(Number(rawTime.toFixed(2)));
    }
    setCurrentTime(Math.max(0, rawTime));
  };

  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const job = videoJobRef.current;
    if (localVideoUrlRef.current && vid.src !== localVideoUrlRef.current) {
      URL.revokeObjectURL(localVideoUrlRef.current);
      localVideoUrlRef.current = null;
    }
    const dur = vid.duration;
    if (dur && !isNaN(dur) && isFinite(dur) && dur >= 0.5) {
      setDuration(dur);
    } else {
      void resolveVideoDuration(
        vid,
        sourceFileRef.current || undefined,
        duration,
      ).then((resolved) => {
        if (videoJobRef.current === job && Number.isFinite(resolved) && resolved >= 0.5) {
          setDuration(resolved);
        }
      });
    }
  };

  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (isPlaying) {
      vid.pause();
      instrumentalAudioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (
        vid.ended ||
        (duration > 0 && vid.currentTime >= duration - 0.08)
      ) {
        vid.currentTime = 0;
        setCurrentTime(0);
        if (instrumentalAudioRef.current) {
          instrumentalAudioRef.current.currentTime = 0;
        }
      }
      if (audioMode === 'instrumental') {
        vid.muted = true;
        vid.volume = 0;
        if (instrumentalUrl && instrumentalAudioRef.current) {
          instrumentalAudioRef.current.currentTime = vid.currentTime;
          instrumentalAudioRef.current.muted = isMuted;
          instrumentalAudioRef.current.volume = 1;
          instrumentalAudioRef.current.play().catch(() => {});
        }
      } else {
        vid.muted = isMuted;
        vid.volume = 1;
        instrumentalAudioRef.current?.pause();
      }
      vid.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying, audioMode, instrumentalUrl, isMuted, duration]);

  // audioMode veya instrumentalUrl değiştiğinde video sesini kesin olarak sustur ve M&E kanalını senkronla
  useEffect(() => {
    const vid = videoRef.current;
    const inst = instrumentalAudioRef.current;
    if (!vid) return;

    if (audioMode === 'instrumental') {
      vid.muted = true;
      vid.volume = 0;
      if (inst && instrumentalUrl) {
        inst.muted = isMuted;
        inst.volume = 1;
        if (Math.abs(inst.currentTime - vid.currentTime) > 0.15) {
          try {
            inst.currentTime = vid.currentTime;
          } catch {}
        }
        if (isPlaying && inst.paused) {
          inst.play().catch(() => {});
        }
      }
    } else {
      if (inst) inst.pause();
      vid.muted = isMuted;
      vid.volume = 1;
    }
  }, [audioMode, instrumentalUrl, isMuted, isPlaying]);

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
    if (sourceFileRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        let buf: ArrayBuffer;
        if (sourceFileRef.current) {
          buf = await sourceFileRef.current.arrayBuffer();
        } else {
          const res = await fetch(videoUrl);
          if (!res.ok || cancelled) return;
          buf = await res.arrayBuffer();
        }
        if (buf.byteLength === 0 || cancelled) return;
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        const audioBuffer = await ctx.decodeAudioData(buf);
        void ctx.close().catch(() => {});
        if (cancelled) return;
        setWaveformPeaks(waveformFromAudio(audioBuffer.getChannelData(0)));
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
    const handleMove = (e: PointerEvent) => {
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
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [isScrubbingTimeline, duration, seekTo]);

  // Zaman çizelgesinde mouse ile repliğin başını/sonunu uzatma veya taşıma dinleyicisi
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: PointerEvent) => {
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

    window.addEventListener('pointermove', handleMouseMove);
    window.addEventListener('pointerup', handleMouseUp);
    window.addEventListener('pointercancel', handleMouseUp);
    return () => {
      window.removeEventListener('pointermove', handleMouseMove);
      window.removeEventListener('pointerup', handleMouseUp);
      window.removeEventListener('pointercancel', handleMouseUp);
    };
  }, [dragging, duration, seekTo]);

  // Seçili repliğin başlangıcını şu anki video süresi yap
  const markCurrentTimeAsStart = useCallback(() => {
    const time = Number(currentTime.toFixed(2));
    setCues((prev) => {
      const cue = prev.find((item) => item.id === selectedCueId);
      if (!cue) return prev;
      const timing = adjustCueTiming(prev, cue.id, 'start', cue.start, cue.end, time - cue.start, duration);
      return prev.map((item) => item.id === cue.id ? { ...item, ...timing } : item);
    });
    showToast('Başlangıç oynatma imlecine yaklaştırıldı; komşu replik sınırları korundu.');
  }, [currentTime, selectedCueId, duration, showToast]);

  // Seçili repliğin bitişini şu anki video süresi yap
  const markCurrentTimeAsEnd = useCallback(() => {
    const time = Number(currentTime.toFixed(2));
    setCues((prev) => {
      const cue = prev.find((item) => item.id === selectedCueId);
      if (!cue) return prev;
      const timing = adjustCueTiming(prev, cue.id, 'end', cue.start, cue.end, time - cue.end, duration);
      return prev.map((item) => item.id === cue.id ? { ...item, ...timing } : item);
    });
    showToast('Bitiş oynatma imlecine yaklaştırıldı; komşu replik sınırları korundu.');
  }, [currentTime, selectedCueId, duration, showToast]);

  // Kısayol tuşları
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Eğer kullanıcı bir input/textarea içinde yazıyorsa kısayolları tetikleme
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'Escape' && timelineExpanded) {
        setTimelineExpanded(false);
        return;
      }

      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setCues((prev) => {
          const cue = prev.find((item) => item.id === selectedCueId);
          if (!cue) return prev;
          const delta = e.key === 'ArrowLeft' ? -0.1 : 0.1;
          const timing = adjustCueTiming(prev, cue.id, 'move', cue.start, cue.end, delta, duration);
          return prev.map((item) => item.id === cue.id ? { ...item, ...timing } : item);
        });
        return;
      }

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
      } else if (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'l') {
        e.preventDefault();
        const ordered = [...cues].sort((a, b) => a.start - b.start);
        const index = ordered.findIndex((cue) => cue.id === selectedCueId);
        const next = ordered[index + (e.key.toLowerCase() === 'j' ? -1 : 1)];
        if (next) {
          setSelectedCueId(next.id);
          seekTo(next.start);
        }
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
    cues,
    selectedCueId,
    timelineExpanded,
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

  // Yeni replik ekle (Karakter katmanına özel veya genel)
  const addCue = (targetRoleIdx?: number, explicitStart?: number) => {
    const chosenIdx =
      targetRoleIdx !== undefined
        ? targetRoleIdx
        : cues.length % Math.max(1, roles.length);
    const role = roles[chosenIdx] || roles[0];

    const sameRoleCues = cues.filter((c) => (c.roleIndex ?? 0) === chosenIdx);
    const ordered = [...sameRoleCues].sort((a, b) => a.start - b.start);
    const baseTime =
      explicitStart !== undefined
        ? explicitStart
        : currentTime >= duration - 0.3
          ? Math.max(0, duration - 2.5)
          : currentTime;
    let newStart = Math.max(0, Math.min(Math.max(0, duration - 0.5), baseTime));
    for (const cue of ordered) {
      if (cue.end <= newStart) continue;
      if (cue.start - newStart >= 0.3) break;
      newStart = cue.end + 0.1;
    }
    if (newStart > duration - 0.3) {
      // Sonda yer kalmadıysa baştan itibaren ilk boşluğu bul
      let candidate = 0;
      for (const cue of ordered) {
        if (cue.start - candidate >= 0.4) break;
        candidate = cue.end + 0.05;
      }
      if (candidate <= duration - 0.3) {
        newStart = candidate;
      } else {
        newStart = Math.max(0, duration - 1.5);
      }
    }
    const nextCue = ordered.find((cue) => cue.start > newStart + 0.05);
    const newEnd = Number(
      Math.min(
        duration,
        newStart + 2.8,
        nextCue ? Math.max(newStart + 0.4, nextCue.start - 0.05) : duration,
      ).toFixed(2),
    );
    newStart = Number(newStart.toFixed(2));
    if (newEnd - newStart < 0.2) {
      showToast('Bu noktada yeni replik için yeterli boşluk yok.');
      return;
    }

    const newCue: Cue = {
      id: Date.now(),
      roleIndex: chosenIdx,
      roleName: role.name,
      roleColor: role.color,
      start: newStart,
      end: newEnd,
      text: 'Yeni replik metni...',
    };

    setCues((prev) => [...prev, newCue].sort((a, b) => a.start - b.start));
    setSelectedCueId(newCue.id);
    seekTo(newStart);
    showToast(`${role.name} katmanına yeni replik eklendi.`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'n' || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!videoUrl) return;
      event.preventDefault();
      addCue();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [videoUrl]);

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

  const setCueBoundary = (cueId: number, type: 'start' | 'end', value: number) => {
    if (!Number.isFinite(value)) return;
    setCues((prev) => {
      const cue = prev.find((item) => item.id === cueId);
      if (!cue) return prev;
      const original = type === 'start' ? cue.start : cue.end;
      const timing = adjustCueTiming(prev, cueId, type, cue.start, cue.end, value - original, duration);
      return prev.map((item) => item.id === cueId ? { ...item, ...timing } : item);
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
    if (roles.length >= 8) {
      showToast('Maksimum 8 karakter eklenebilir.');
      return;
    }
    const id = roles.length;
    const usedColors = new Set(roles.map((r) => r.color?.toLowerCase()));
    let nextColor = CHARACTER_PALETTE.find((c) => !usedColors.has(c.toLowerCase()));
    if (!nextColor) {
      nextColor = CHARACTER_PALETTE[id % CHARACTER_PALETTE.length];
    }
    const newRole: RoleInfo = {
      id,
      name: `${id + 1}. Karakter`,
      color: nextColor,
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

  const prepareBackground = useCallback(async (source: string, job: number, retry = false) => {
    if (audioPreparationRef.current?.job === job) return;
    audioPreparationRef.current?.controller.abort();
    const controller = new AbortController();
    audioPreparationRef.current = { job, controller };
    setIsRemovingVocals(true);
    setVocalError('');
    setVocalNotice('');
    setVocalProgress(10);
    setVocalStage('Arka plan sesi hazırlanıyor...');
    try {
      const result = await prepareSceneBackground(source, (stage, percent) => {
        if (videoJobRef.current !== job) return;
        setVocalStage(stage);
        setVocalProgress(percent);
      }, { retry, signal: controller.signal });
      if (videoJobRef.current !== job) return;
      setInstrumentalUrl(result.url);
      setAudioMode('instrumental');
      setVocalNotice('Arka plan sesi hazır. Orijinal sesle karşılaştırıp dinleyin; ardından sahneyi kaydedin.');
      showToast('Arka plan sesi hazır. Oyunlarda bu kayıt kullanılacak.');
    } catch (error) {
      if (videoJobRef.current !== job || controller.signal.aborted) return;
      setVocalError((error as Error).message);
      setAudioMode('original');
    } finally {
      if (audioPreparationRef.current?.controller === controller) audioPreparationRef.current = null;
      if (videoJobRef.current === job) setIsRemovingVocals(false);
    }
  }, [showToast]);

  useEffect(() => () => { audioPreparationRef.current?.controller.abort(); }, []);

  // Video işleme fonksiyonu (Önizleme + Supabase Yükleme + AI Transkripsiyon)
  const processVideoFile = useCallback(
    (file: File, selectedDuration: number) => {
      const job = ++videoJobRef.current;
      audioPreparationRef.current?.controller.abort();
      setIsRemovingVocals(false);
      setAudioMode('original');
      sourceFileRef.current = file;
      setVocalError('');
      setVocalNotice('');
      setInstrumentalUrl('');
      setCues([]);
      setWaveformPeaks([]);
      setCurrentTime(0);
      videoRef.current?.pause();
      instrumentalAudioRef.current?.pause();
      // 1. Yerel hızlı önizleme
      if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current);
      const localUrl = URL.createObjectURL(file);
      localVideoUrlRef.current = localUrl;
      setVideoUrl(localUrl);
      setDuration(selectedDuration);
      const videoTitle = file.name.replace(/\.[^/.]+$/, '').slice(0, 35);
      setTitle(videoTitle);

      const tempVideo = document.createElement('video');
      tempVideo.src = localUrl;
      tempVideo.crossOrigin = 'anonymous';
      tempVideo.muted = true;
      tempVideo.playsInline = true;
      tempVideo.preload = 'auto';
      tempVideo.onloadedmetadata = () => {
        if (videoJobRef.current !== job) return;
        const measuredDur =
          tempVideo.duration &&
          !isNaN(tempVideo.duration) &&
          isFinite(tempVideo.duration)
            ? tempVideo.duration
            : selectedDuration;
        if (measuredDur && measuredDur > 0) {
          setDuration(measuredDur);
        }
        // Otomatik olarak videonun tam ortasındaki (50%) sahneyi kapak olarak seç
        tempVideo.currentTime = Math.max(
          0.3,
          ((measuredDur || selectedDuration || 4) * 0.5),
        );
      };
      tempVideo.onseeked = () => {
        if (videoJobRef.current !== job) return;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          if (dataUrl && dataUrl.length > 1000) {
            setPoster(dataUrl);
          }
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
          if (videoJobRef.current !== job) return;
          setVideoUrl(url); // Artık herkese açık kalıcı Supabase URL'si
          setIsUploadingToSupabase(false);
          showToast('Video yüklendi. Arka plan sesi hazırlanıyor...');
          void prepareBackground(url, job);
        })
        .catch((err) => {
          if (videoJobRef.current !== job) return;
          setIsUploadingToSupabase(false);
          showToast(`Video yüklenemedi: ${(err as Error).message}`);
          console.warn('Supabase storage uyarısı:', err);
        });

      // 3. Yapay zeka ile otomatik konuşma tanıma ve zamanlama
      const videoDur = selectedDuration;
      whisper
        .transcribe(file, roles, videoDur, 'turkish', undefined, (audio) => {
          if (videoJobRef.current === job) setWaveformPeaks(waveformFromAudio(audio));
        })
        .then((result) => {
          if (videoJobRef.current !== job) return;
          if (result.audioData) setWaveformPeaks(waveformFromAudio(result.audioData));
          if (result.cues && result.cues.length > 0) {
            const newCues = result.cues;
            setCues(newCues);
            if (newCues.length > 0) setSelectedCueId(newCues[0].id);
            showToast(`AI Altyazı tamamlandı: ${newCues.length} replik yakalandı.`);
          } else {
            showToast('ℹ️ Videoda belirgin konuşma tespit edilemedi.');
          }
        })
        .catch((err) => {
          if (videoJobRef.current !== job) return;
          showToast(`Altyazı analizi: ${(err as Error).message}`);
        });

    },
    [roles, whisper, showToast, prepareBackground],
  );

  const stageVideoFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      showToast('Lütfen bir video dosyası seçin.');
      return;
    }
    originalFileRef.current = file;
    setPendingVideo(file);
  };

  const [isPreparingTrim, setIsPreparingTrim] = useState(false);

  const openTrimModal = useCallback(async () => {
    const job = videoJobRef.current;
    if (originalFileRef.current) {
      setPendingVideo(originalFileRef.current);
      return;
    }
    if (sourceFileRef.current) {
      setPendingVideo(sourceFileRef.current);
      return;
    }
    if (videoUrl) {
      try {
        setIsPreparingTrim(true);
        showToast('Video kırpma editörüne hazırlanıyor...');
        const res = await fetch(videoUrl);
        const blob = await res.blob();
        if (videoJobRef.current !== job) return;
        const file = new File([blob], `${title || 'sahne'}.mp4`, {
          type: blob.type || 'video/mp4',
        });
        sourceFileRef.current = file;
        setPendingVideo(file);
      } catch {
        if (videoJobRef.current === job) {
          showToast('Video kırpıcı açılamadı. Lütfen dosyayı doğrudan seçin.');
        }
      } finally {
        if (videoJobRef.current === job) setIsPreparingTrim(false);
      }
    } else {
      showToast('Önce bir video yükleyin veya sahne seçin.');
    }
  }, [videoUrl, title, showToast]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) stageVideoFile(file);
    e.target.value = '';
  };

  const handleManualVocalRemoval = useCallback(() => {
    if (!videoUrl || isUploadingToSupabase || !videoUrl.startsWith('https://')) {
      showToast('Önce video yüklemesinin tamamlanmasını bekleyin.');
      return;
    }
    void prepareBackground(videoUrl, videoJobRef.current, true);
  }, [videoUrl, isUploadingToSupabase, showToast, prepareBackground]);

  // Sahne Yükle (Hem Supabase / Meme hem de Hazır Oyun Sahneleri)
  const loadScene = useCallback(
    (sc: Scene) => {
      videoJobRef.current += 1;
      sourceFileRef.current = null;
      originalFileRef.current = null;
      setVocalError('');
      setVocalNotice('');
      if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current);
      localVideoUrlRef.current = null;
      setSceneId(sc.id);
      setTitle(sc.title);
      setCategory(sc.category || 'Meme & Mizah');
      setMood(sc.mood || 'Doğaçlama komedi');
      setVideoUrl(sc.video);
      setPoster(sc.poster || '');
      setWaveformPeaks([]);
      setDuration(sc.duration || 20);

      // Karakterler / Roller
      let currentRoles: RoleInfo[] = [];
      if (sc.roleDetails && sc.roleDetails.length > 0) {
        currentRoles = ensureDistinctRoleColors(sc.roleDetails);
        setRoles(currentRoles);
      } else if (sc.roles && sc.roles.length > 0) {
        currentRoles = sc.roles.map((r, i) => ({
          id: i,
          name: typeof r === 'string' ? r : (r as unknown as RoleInfo).name,
          color: CHARACTER_PALETTE[i % CHARACTER_PALETTE.length],
          description: '',
        }));
        setRoles(currentRoles);
      } else {
        currentRoles = [
          { id: 0, name: '1. Karakter', color: CHARACTER_PALETTE[0], description: '' },
          { id: 1, name: '2. Karakter', color: CHARACTER_PALETTE[1], description: '' },
        ];
        setRoles(currentRoles);
      }

      // Replikler (Cue'lar): Varsa doğrudan al, yoksa varsayılan replik şablonunu üret
      const rawLoadedCues =
        sc.cues && sc.cues.length > 0
          ? sc.cues
          : sceneCues(sc.id, supabaseScenes);
      const loadedCues = rawLoadedCues.map((c) => {
        const r = currentRoles[c.roleIndex ?? 0] || currentRoles[0];
        return {
          ...c,
          roleName: r ? r.name : c.roleName,
          roleColor: r ? r.color : getCharacterColor(c.roleIndex ?? 0, c.roleColor),
        };
      });
      setCues(loadedCues);
      if (loadedCues.length > 0) {
        setSelectedCueId(loadedCues[0].id);
      }

      // Opening or editing a saved scene never starts another separation job.
      audioPreparationRef.current?.controller.abort();
      setIsRemovingVocals(false);
      setIsUploadingToSupabase(false);
      setInstrumentalUrl(sc.instrumental || '');
      setAudioMode(sc.instrumental ? 'instrumental' : 'original');
      if (!sc.instrumental) setVocalNotice('Bu sahnenin arka plan sesi henüz hazır değil. Ses hazırlamayı başlatın.');

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
    videoJobRef.current += 1;
    audioPreparationRef.current?.controller.abort();
    sourceFileRef.current = null;
    originalFileRef.current = null;
    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current);
    localVideoUrlRef.current = null;
    videoRef.current?.pause();
    instrumentalAudioRef.current?.pause();
    setCurrentTime(0);
    setIsPlaying(false);
    setIsUploadingToSupabase(false);
    setIsRemovingVocals(false);
    setWaveformPeaks([]);
    setVocalError('');
    setVocalNotice('');
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
        color: CHARACTER_PALETTE[0],
        description: 'İlk konuşan karakter',
      },
      {
        id: 1,
        name: '2. Karakter',
        color: CHARACTER_PALETTE[1],
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

  const handleRemoveVideo = useCallback(() => {
    // Eğer mevcut bir sahne düzenleniyorsa Supabase'den de sil
    if (isEditingExisting) {
      if (
        typeof window !== 'undefined' &&
        !window.confirm(
          `"${title || 'Bu sahne'}" Supabase'den ve ana sayfadan kalıcı olarak silinecek. Devam etmek istiyor musunuz?`,
        )
      ) {
        return;
      }
      const currentSceneId = sceneId;
      const currentTitle = title;
      void (async () => {
        try {
          await deleteSceneFromSupabase(currentSceneId);
          deleteCustomScene(currentSceneId);
          setSupabaseScenes((prev) => prev.filter((s) => s.id !== currentSceneId));
          showToast(`"${currentTitle}" Supabase'den ve ana sayfadan silindi.`);
        } catch {
          deleteCustomScene(currentSceneId);
          setSupabaseScenes((prev) => prev.filter((s) => s.id !== currentSceneId));
          showToast(`"${currentTitle}" silindi.`);
        }
      })();
    } else {
      showToast('Video düzenleyiciden kaldırıldı. Yeni video ekleyebilirsiniz.');
    }

    videoJobRef.current += 1;
    hasLoadedUrlScene.current = true;
    audioPreparationRef.current?.controller.abort();
    sourceFileRef.current = null;
    originalFileRef.current = null;
    videoRef.current?.pause();
    instrumentalAudioRef.current?.pause();
    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current);
    localVideoUrlRef.current = null;
    setVideoUrl('');
    setPoster('');
    setDuration(20);
    setCurrentTime(0);
    setIsPlaying(false);
    setCues([]);
    setSelectedCueId(0);
    setInstrumentalUrl('');
    setWaveformPeaks([]);
    setIsUploadingToSupabase(false);
    setIsRemovingVocals(false);
    setVocalError('');
    setVocalNotice('');
    setPendingVideo(null);
    setIsPreparingTrim(false);
    setUploadProgress(0);
    setTimelineExpanded(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('sceneId')) {
        url.searchParams.delete('sceneId');
        window.history.replaceState(window.history.state, '', url);
      }
    }
    setIsEditingExisting(false);
    setEditingSceneTitle('');
    setSceneId(Date.now());
    setTitle('');
  }, [showToast, isEditingExisting, sceneId, title]);

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
        if (hasLoadedUrlScene.current) return;
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

    let finalPoster = poster || '';
    if (!finalPoster && videoRef.current) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const captured = canvas.toDataURL('image/jpeg', 0.85);
        if (captured && captured.length > 1000) {
          finalPoster = captured;
          setPoster(captured);
        }
      } catch {}
    }

    if (isRemovingVocals || !instrumentalUrl || !instrumentalUrl.startsWith('https://')) {
      showToast(isRemovingVocals
        ? 'Arka plan sesi hazırlanıyor. İşlem tamamlandıktan sonra kaydedin.'
        : 'Sahneyi oyuna eklemeden önce arka plan sesini hazırlayın.');
      return;
    }
    const finalInstrumentalUrl = instrumentalUrl;

    const newScene: Scene = {
      id: targetId,
      title: targetTitle,
      category: category.trim() || 'Meme & Mizah',
      start: 0,
      duration: Math.round(calculatedDuration),
      poster: finalPoster,
      video: videoUrl,
      mood: mood.trim() || 'Doğaçlama komedi',
      roles: roles.map((r) => r.name),
      roleDetails: roles,
      prompts: sortedCues.map((c) => c.text),
      cues: sortedCues,
      instrumental: finalInstrumentalUrl || undefined,
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
          fallbackDuration={duration}
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
              triggerReplikCurtain('OYUNA DÖNÜLÜYOR', () => {
                router.push('/');
              });
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
              onClick={openTrimModal}
              disabled={isPreparingTrim}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#22221E] hover:bg-[#32322C] text-[#F5E636] border border-[#383832] flex items-center gap-1.5 transition cursor-pointer"
              title="Videoyu Kırp / Kesit Değiştir"
            >
              <Scissors size={15} />
              <span className="hidden sm:inline">Videoyu Kırp</span>
            </button>
          )}

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
            disabled={isUploadingToSupabase || isRemovingVocals || !instrumentalUrl}
            className="px-5 py-2 rounded-xl text-xs sm:text-sm font-extrabold bg-[#F5E636] hover:bg-[#F5E636] text-[#090909] flex items-center gap-2 shadow-lg shadow-[#F5E636]/15 transition cursor-pointer"
          >
            <Check size={16} strokeWidth={2.5} />
            <span className="editor-save-label-full">
              {isEditingExisting ? 'Değişiklikleri Kaydet' : 'Sahneyi Kaydet'}
            </span>
            <span className="editor-save-label-short">Kaydet</span>
          </button>
          <MemberTopbarBadge />
        </div>
      </header>

      {/* TOAST BİLDİRİMİ */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1A1A17] border border-[#F5E636] text-[#F4F4E9] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-semibold">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ANA İÇERİK: SOLDA VİDEO, SAĞDA 3 BASİT ADIM */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* SOL SÜTUN: VİDEO ÖNİZLEME (6 SÜTUN) */}
        <div className="lg:col-span-7 flex flex-col gap-4 lg:sticky lg:top-20">
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
                      {vocalStage || 'Arka plan sesi hazırlanıyor...'}
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
                    muted={audioMode === 'instrumental' ? true : isMuted}
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

                  {/* Video Üzerindeki Canlı Altyazı (Arka plan kutusuz, harf kenar konturlu sinematik stil) */}
                  {currentActiveCue && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[92%] px-3 py-1 text-center pointer-events-none flex flex-col items-center gap-1">
                      <span
                        className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-extrabold text-black shadow-[0_2px_8px_rgba(0,0,0,0.75)] ring-1 ring-black/40"
                        style={{ backgroundColor: currentActiveCue.roleColor }}
                      >
                        {currentActiveCue.roleName}
                      </span>
                      <p
                        className="text-base sm:text-lg font-extrabold text-white leading-snug tracking-wide"
                        style={{
                          WebkitTextStroke: '1px rgba(0, 0, 0, 0.88)',
                          paintOrder: 'stroke fill',
                          textShadow:
                            '-1.5px -1.5px 0 rgba(0,0,0,0.92), 1.5px -1.5px 0 rgba(0,0,0,0.92), -1.5px 1.5px 0 rgba(0,0,0,0.92), 1.5px 1.5px 0 rgba(0,0,0,0.92), 0 2px 8px rgba(0,0,0,0.85), 0 0 14px rgba(0,0,0,0.65)',
                        }}
                      >
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
                        disabled={isRemovingVocals || isUploadingToSupabase}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#1A1A17] hover:bg-[#22221E] text-[#9E8CA9] border border-[#383832] flex items-center gap-1.5 cursor-pointer"
                      >
                        <Music size={14} />
                        <span>{vocalError ? 'Tekrar Kontrol Et / Dene' : 'Arka Plan Sesini Hazırla'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#22221E] hover:bg-[#22221E] text-[#F4F4E9] border border-[#383832] cursor-pointer"
                    >
                      Videoyu Değiştir
                    </button>
                    <button type="button" onClick={handleRemoveVideo} className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#22221E] hover:bg-[#FA5636]/15 text-[#FA8270] border border-[#FA5636]/35 flex items-center gap-1.5 cursor-pointer" title="Videoyu ve repliklerini bu düzenlemeden kaldır">
                      <Trash2 size={13} /> Videoyu Kaldır
                    </button>
                  </div>
                </div>

                {vocalError && (
                  <div role="alert" className="rounded-xl border border-[#FA5636] bg-[#1A1A17] px-3 py-2 text-xs text-[#F4B2A6]">
                    <p>Vokalsiz ses hazırlanamadı: {vocalError}</p>

                  </div>
                )}
                {vocalNotice && <div role="status" className="rounded-xl border border-[#AEA932] bg-[#1A1A17] px-3 py-2 text-xs text-[#E4DE8B]">{vocalNotice}</div>}

                {/* GÖRSEL ÇOK KATMANLI (MULTI-TRACK) ZAMAN ÇİZELGESİ KUTUSU */}
                <div
                  ref={timelineBoxRef}
                  className={`editor-timeline-panel bg-[#1A1A17] border border-[#383832] rounded-2xl p-3 flex flex-col gap-3 ${timelineExpanded ? 'editor-timeline-expanded' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Layers size={15} className="text-[#F5E636]" />
                      <span className="text-xs font-extrabold text-[#F4F4E9]">
                        Katmanlı Zaman Çizelgesi
                      </span>
                      <span className="text-[11px] text-[#B8B8AE]">
                        {roles.length} karakter katmanı · {cues.length} replik · {formatTimecode(duration)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Videoyu Kırp Butonu */}
                      <button
                        type="button"
                        onClick={openTrimModal}
                        disabled={isPreparingTrim}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#22221E] hover:bg-[#F5E636] hover:text-[#090909] text-[#F5E636] border border-[#383832] flex items-center gap-1.5 transition cursor-pointer"
                        title="Videoyu Kırp / Kesit Değiştir"
                      >
                        <Scissors size={13} />
                        <span>Kırp</span>
                      </button>

                      {/* Yakınlaştırma (Zoom) Butonları & Göstergesi */}
                      <div className="flex items-center gap-1 bg-[#141412] border border-[#383832] rounded-lg p-0.5" title="Fare tekerleği (Scroll) ile yakınlaştır / uzaklaştır">
                        <button
                          type="button"
                          onClick={() => setTimelineZoom((z) => Math.max(0.75, Number((z - 0.5).toFixed(1))))}
                          className="px-1.5 py-0.5 text-xs text-[#B8B8AE] hover:text-[#F5E636] font-extrabold cursor-pointer"
                          title="Uzaklaştır (-)"
                        >
                          -
                        </button>
                        {[1, 2, 4, 8].map((z) => (
                          <button
                            key={z}
                            type="button"
                            onClick={() => setTimelineZoom(z)}
                            className={`px-2 py-0.5 rounded text-[11px] font-extrabold transition cursor-pointer ${
                              Math.abs(timelineZoom - z) < 0.2
                                ? 'bg-[#F5E636] text-[#090909]'
                                : 'text-[#B8B8AE] hover:text-white'
                            }`}
                          >
                            {z}x
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setTimelineZoom((z) => Math.min(12, Number((z + 0.5).toFixed(1))))}
                          className="px-1.5 py-0.5 text-xs text-[#B8B8AE] hover:text-[#F5E636] font-extrabold cursor-pointer"
                          title="Yakınlaştır (+)"
                        >
                          +
                        </button>
                        {![1, 2, 4, 8].some((z) => Math.abs(timelineZoom - z) < 0.2) && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#F5E636]/20 text-[#F5E636]">
                            {timelineZoom.toFixed(1)}x
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setTimelineExpanded((value) => !value)}
                        className="editor-timeline-expand"
                        aria-label={timelineExpanded ? 'Zaman çizelgesini küçült' : 'Zaman çizelgesini büyüt'}
                        title={timelineExpanded ? 'Küçült (Esc)' : 'Geniş düzenleme alanı'}
                      >
                        {timelineExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                        <span>{timelineExpanded ? 'Küçült' : 'Genişlet'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="editor-shortcut-strip" aria-label="Zaman çizelgesi kısayolları">
                    <span><kbd>Scroll</kbd> Yakınlaştır / Uzaklaştır</span>
                    <span><kbd>Çift Tık</kbd> Katmana replik ekle</span>
                    <span><kbd>Boşluk</kbd> oynat</span>
                    <span><kbd>[</kbd> başlangıç</span>
                    <span><kbd>]</kbd> bitiş</span>
                    <span><kbd>J</kbd>/<kbd>L</kbd> replik seç</span>
                    <span><kbd>N</kbd> replik ekle</span>
                    <span><kbd>⇧ ←/→</kbd> 0,1 sn ilerle</span>
                    <span><kbd>⌥ ←/→</kbd> repliği kaydır</span>
                  </div>

                  {/* Multi-Track Container: Sol Sabit Sidebar + Sağ Kaydırılabilir Grid */}
                  <div className="editor-multitrack-box flex rounded-xl border border-[#383832] bg-[#11110F] overflow-hidden">
                    {/* Sol Sabit Katman Başlıkları (Track Headers Sidebar) */}
                    <div className="w-36 sm:w-44 shrink-0 bg-[#161613] border-r border-[#383832] flex flex-col z-20 select-none">
                      {/* Ruler Yüksekliğiyle Eşleşen Başlık (h-7) */}
                      <div className="h-7 bg-[#1A1A17] border-b border-[#383832] px-2.5 flex items-center justify-between text-[10px] font-extrabold text-[#B8B8AE] uppercase tracking-wider">
                        <span>Katmanlar</span>
                        <span className="text-[#F5E636] font-mono">{roles.length} Rol</span>
                      </div>

                      {/* Karakter Katman Başlıkları */}
                      {roles.map((role, roleIdx) => {
                        const roleCues = cues.filter((c) => (c.roleIndex ?? 0) === roleIdx);
                        return (
                          <div
                            key={role.id || roleIdx}
                            className="h-14 px-2.5 border-b border-[#282824] flex items-center justify-between gap-1.5 bg-[#161613] hover:bg-[#1C1C18] transition group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-3 h-3 rounded-md shrink-0 shadow-sm ring-1 ring-white/30"
                                style={{
                                  backgroundColor: role.color,
                                  boxShadow: `0 0 8px ${role.color}88`,
                                }}
                              />
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-extrabold text-white truncate max-w-[85px] sm:max-w-[105px]">
                                  {role.name}
                                </span>
                                <span className="text-[10px] text-[#B8B8AE] font-mono">
                                  {roleCues.length} replik
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => addCue(roleIdx)}
                              className="p-1 rounded bg-[#242420] hover:bg-[#F5E636] hover:text-[#090909] text-[#B8B8AE] transition shrink-0"
                              title={`${role.name} katmanına bu saniyede replik ekle`}
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Sağ Kaydırılabilir & Zoomlanabilir Çok Katmanlı Grid */}
                    <div
                      ref={timelineScrollRef}
                      className="flex-1 overflow-x-auto pb-0.5 select-none relative"
                    >
                      <div
                        ref={timelineRef}
                        style={{
                          width: `${timelineZoom * 100}%`,
                          minWidth: '100%',
                        }}
                        onPointerDown={(e) => {
                          if (!timelineRef.current) return;
                          const rect = timelineRef.current.getBoundingClientRect();
                          const ratio = Math.max(
                            0,
                            Math.min(1, (e.clientX - rect.left) / rect.width),
                          );
                          seekTo(Number((ratio * duration).toFixed(1)));
                          setIsScrubbingTimeline(true);
                        }}
                        className={`relative flex flex-col cursor-pointer touch-none overflow-hidden transition-colors ${
                          dragging ? 'ring-1 ring-[#F5E636]' : ''
                        }`}
                      >
                        {/* Saniye Cetveli (Ruler - h-7) */}
                        <div className="h-7 bg-[#1A1A17] border-b border-[#383832] sticky top-0 flex items-center pointer-events-none z-10">
                          {Array.from({
                            length: Math.max(
                              2,
                              Math.floor(
                                duration /
                                  (timelineZoom >= 6
                                    ? 1
                                    : timelineZoom >= 3.5
                                      ? 2
                                      : timelineZoom >= 1.8
                                        ? 5
                                        : 10),
                              ) + 1,
                            ),
                          }).map((_, idx) => {
                            const stepSec =
                              timelineZoom >= 6
                                ? 1
                                : timelineZoom >= 3.5
                                  ? 2
                                  : timelineZoom >= 1.8
                                    ? 5
                                    : 10;
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

                        {/* Global Playhead İbresi (Tüm katmanları yukarıdan aşağıya kesen dikey çizgi) */}
                        <div
                          className="absolute top-0 bottom-0 z-30 pointer-events-none"
                          style={{
                            left: `${Math.max(0, Math.min(100, (currentTime / Math.max(0.5, duration)) * 100))}%`,
                          }}
                        >
                          <div className="w-[2px] h-full bg-[#FA5636] relative shadow-[0_0_10px_rgba(250,86,54,0.95)]">
                            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[#FA5636] rounded-full border border-white shadow" />
                          </div>
                        </div>

                        {/* Karakter Katman Satırları (Track Lanes) */}
                        {roles.map((role, roleIdx) => {
                          const roleCues = cues.filter((c) => (c.roleIndex ?? 0) === roleIdx);
                          return (
                            <div
                              key={role.id || roleIdx}
                              className={`h-14 relative border-b border-[#282824] transition-colors ${
                                roleIdx % 2 === 0 ? 'bg-[#11110F]' : 'bg-[#141411]'
                              }`}
                              onDoubleClick={(e) => {
                                if (!timelineRef.current) return;
                                const rect = timelineRef.current.getBoundingClientRect();
                                const ratio = Math.max(
                                  0,
                                  Math.min(1, (e.clientX - rect.left) / rect.width),
                                );
                                const startSec = Number((ratio * duration).toFixed(1));
                                addCue(roleIdx, startSec);
                              }}
                              title={`${role.name} katmanı (Çift tıklayarak bu katmana replik ekleyebilirsiniz)`}
                            >
                              {/* Katman İçi Ses Dalgası İzleri */}
                              <div className="absolute inset-0 flex items-center justify-between px-0.5 pointer-events-none opacity-15">
                                {(waveformPeaks.length > 0
                                  ? waveformPeaks
                                  : Array.from({ length: 70 }, (_, i) => 0.2 + ((i * 7) % 5) * 0.12)
                                ).map((peak, idx) => (
                                  <div
                                    key={idx}
                                    style={{
                                      height: `${Math.max(10, Math.round(peak * 65))}%`,
                                      backgroundColor: role.color,
                                    }}
                                    className="w-[1.5px] rounded-full"
                                  />
                                ))}
                              </div>

                              {/* Bu Karakterin Replik Blokları */}
                              {roleCues.map((cue) => {
                                const cueIndex = cues.findIndex((c) => c.id === cue.id);
                                const isSelected = cue.id === selectedCueId;
                                const leftPct = Math.max(
                                  0,
                                  Math.min(99.5, (cue.start / Math.max(1, duration)) * 100),
                                );
                                const widthPct = Math.max(
                                  1.2,
                                  Math.min(
                                    100 - leftPct,
                                    ((cue.end - cue.start) / Math.max(1, duration)) * 100,
                                  ),
                                );

                                return (
                                  <div
                                    key={cue.id}
                                    style={{
                                      left: `${leftPct}%`,
                                      width: `${widthPct}%`,
                                      backgroundColor: isSelected ? '#F5E636' : (cue.roleColor || role.color || getCharacterColor(roleIdx)),
                                      borderColor: isSelected ? '#F5E636' : (cue.roleColor || role.color || getCharacterColor(roleIdx)),
                                      zIndex: isSelected ? 20 : 10,
                                    }}
                                    onPointerDown={(e) => {
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
                                    className={`absolute top-1.5 bottom-1.5 rounded-lg border flex items-center justify-between overflow-visible group transition-all cursor-grab active:cursor-grabbing hover:brightness-110 focus-within:ring-2 focus-within:ring-white shadow-md ${
                                      isSelected
                                        ? 'shadow-lg shadow-black/80 ring-2 ring-[#F5E636] !text-[#090909]'
                                        : 'hover:ring-1 hover:ring-white/70 text-[#090909]'
                                    }`}
                                    title={`#${cueIndex + 1} ${cue.roleName || role.name}: ${formatTimecode(cue.start)}–${formatTimecode(cue.end)} "${cue.text}"`}
                                  >
                                    {/* SOL TUTAMAÇ: BAŞLANGIÇ */}
                                    <button
                                      type="button"
                                      aria-label={`Replik ${cueIndex + 1} başlangıcını sürükle`}
                                      onPointerDown={(e) => {
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
                                        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        nudgeCueBoundary(cue, 'start', e.key === 'ArrowLeft' ? -0.1 : 0.1);
                                      }}
                                      className="h-full w-2.5 bg-black/25 hover:bg-black/60 focus:bg-black/60 focus:outline-none rounded-l-lg flex items-center justify-center cursor-ew-resize shrink-0 z-30"
                                      title="Başlangıcı sürükle"
                                    >
                                      <div className="w-[1.5px] h-3.5 bg-black/70 rounded-full" />
                                    </button>

                                    {/* Replik Etiketi & Metin Özeti */}
                                    <div className="px-1.5 truncate text-[10.5px] font-black pointer-events-none select-none leading-tight flex items-center gap-1 min-w-0">
                                      <span className="bg-black/20 px-1 py-0.2 rounded text-[9px]">#{cueIndex + 1}</span>
                                      <span className="truncate">{cue.text}</span>
                                    </div>

                                    {/* SAĞ TUTAMAÇ: BİTİŞ */}
                                    <button
                                      type="button"
                                      aria-label={`Replik ${cueIndex + 1} bitişini sürükle`}
                                      onPointerDown={(e) => {
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
                                        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        nudgeCueBoundary(cue, 'end', e.key === 'ArrowLeft' ? -0.1 : 0.1);
                                      }}
                                      className="h-full w-2.5 bg-black/25 hover:bg-black/60 focus:bg-black/60 focus:outline-none rounded-r-lg flex items-center justify-center cursor-ew-resize shrink-0 z-30"
                                      title="Bitişi sürükle"
                                    >
                                      <div className="w-[1.5px] h-3.5 bg-black/70 rounded-full" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
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
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#383832] bg-[#141412] px-3 py-2.5 flex-wrap">
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
                          {overlaps && (
                            <span className="shrink-0 rounded-md bg-[#FA563622] px-2 py-1 text-[10px] font-bold text-[#FA5636]">
                              Çakışma var
                            </span>
                          )}
                        </div>

                        <div className="editor-timing-controls">
                          {(['start', 'end'] as const).map((type) => (
                            <label key={type} className="editor-time-field">
                              <span>{type === 'start' ? 'Başlangıç' : 'Bitiş'}</span>
                              <button type="button" onClick={() => nudgeCueBoundary(activeCue, type, -0.1)} aria-label={`${type === 'start' ? 'Başlangıcı' : 'Bitişi'} 0,1 saniye geri al`}>−</button>
                              <input key={`${activeCue.id}-${type}-${type === 'start' ? activeCue.start : activeCue.end}`} type="number" min={0} max={duration} step={0.1} defaultValue={type === 'start' ? activeCue.start : activeCue.end} onBlur={(event) => { if (event.target.value !== '') setCueBoundary(activeCue.id, type, Number(event.target.value)); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label={`Replik ${type === 'start' ? 'başlangıç' : 'bitiş'} saniyesi`} />
                              <button type="button" onClick={() => nudgeCueBoundary(activeCue, type, 0.1)} aria-label={`${type === 'start' ? 'Başlangıcı' : 'Bitişi'} 0,1 saniye ileri al`}>+</button>
                            </label>
                          ))}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={markCurrentTimeAsStart}
                            className="px-2 py-1 rounded-lg bg-[#22221E] hover:bg-[#32322C] text-[#F5E636] border border-[#383832] text-[11px] font-bold cursor-pointer"
                            title="Videonun şu anki saniyesini bu repliğin başlangıcı yap"
                          >
                            Başlangıç [
                          </button>
                          <button
                            type="button"
                            onClick={markCurrentTimeAsEnd}
                            className="px-2 py-1 rounded-lg bg-[#22221E] hover:bg-[#32322C] text-[#F5E636] border border-[#383832] text-[11px] font-bold cursor-pointer"
                            title="Videonun şu anki saniyesini bu repliğin bitişi yap"
                          >
                            Bitiş ]
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

        {/* SAĞ SÜTUN: 3 BASİT ADIMDA DÜZENLEME (5 SÜTUN) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* ADIM 1: SAHNE ADI */}
          <div className="bg-[#1A1A17] border border-[#383832] rounded-2xl p-4 flex flex-col gap-2.5 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#F5E636] text-[#090909] text-xs font-black flex items-center justify-center">
                1
              </span>
              <h2 className="text-sm sm:text-base font-extrabold text-[#F4F4E9]">
                Sahne Adı
              </h2>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn: Gökhan Abi ve Cio Tartışıyor"
              style={{ fontSize: '15px', color: '#FFFFFF' }}
              className="w-full bg-[#0E0E0C] border border-[#383832] rounded-xl px-4 py-3 text-base font-bold text-white placeholder:text-[#8E8E84] focus:outline-none focus:border-[#F5E636]"
            />
          </div>

          {/* ADIM 2: KARAKTERLER */}
          <div className="bg-[#1A1A17] border border-[#383832] rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#F5E636] text-[#090909] text-xs font-black flex items-center justify-center">
                  2
                </span>
                <h2 className="text-sm sm:text-base font-extrabold text-[#F4F4E9]">
                  Karakterler ({roles.length})
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const updated = roles.map((r, i) => ({
                      ...r,
                      color: CHARACTER_PALETTE[i % CHARACTER_PALETTE.length],
                    }));
                    setRoles(updated);
                    setCues((prev) =>
                      prev.map((c) => {
                        const r = updated.find((role) => role.id === c.roleIndex);
                        return r ? { ...c, roleColor: r.color } : c;
                      }),
                    );
                    showToast('Karakter renkleri canlı ve benzersiz olarak yenilendi.');
                  }}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-[#22221E] hover:bg-[#32322C] text-[#D4D4C8] hover:text-[#F4F4E9] border border-[#383832] flex items-center gap-1.5 transition cursor-pointer"
                  title="Tüm karakterlere benzersiz canlı renkler ata"
                >
                  <Palette size={13} />
                  <span>Renkleri Yenile</span>
                </button>
                <button
                  type="button"
                  onClick={addRole}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#22221E] hover:bg-[#32322C] text-[#F5E636] border border-[#383832] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus size={14} /> Karakter Ekle
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {roles.map((role, idx) => (
                <div
                  key={role.id ?? idx}
                  className="bg-[#0C0C0A] border border-[#383832] hover:border-[#58584E] focus-within:border-[#F5E636] rounded-xl px-3.5 py-2.5 flex items-center gap-3 transition-all shadow-sm group"
                >
                  {/* Renk Seçici Butonu / Swatch */}
                  <label
                    className="relative w-8 h-8 rounded-lg shrink-0 cursor-pointer border-2 border-white/40 shadow-md flex items-center justify-center transition-transform hover:scale-105 active:scale-95 overflow-hidden"
                    style={{
                      backgroundColor: role.color,
                      boxShadow: `0 0 12px ${role.color}66`,
                    }}
                    title="Karakter Rengini Değiştir (Tıkla)"
                  >
                    <input
                      type="color"
                      value={role.color}
                      onChange={(e) =>
                        updateRole(role.id, { color: e.target.value })
                      }
                      className="absolute -top-4 -left-4 w-16 h-16 opacity-0 cursor-pointer"
                    />
                  </label>

                  {/* Karakter Sıra No & Geniş Okunaklı Karakter Adı Kutusu */}
                  <div className="flex-1 flex items-center gap-2.5 min-w-0">
                    <span
                      className="px-2 py-1 rounded-md text-xs font-black shrink-0 select-none text-black"
                      style={{ backgroundColor: role.color }}
                    >
                      {idx + 1}. ROL
                    </span>
                    <input
                      type="text"
                      value={role.name}
                      onChange={(e) =>
                        updateRole(role.id, { name: e.target.value })
                      }
                      style={{ fontSize: '15px', color: '#FFFFFF' }}
                      className="w-full flex-1 bg-[#161613] border border-[#383832] focus:border-[#F5E636] rounded-lg px-3 py-2 text-base font-bold text-white focus:outline-none placeholder:text-[#8E8E84]"
                      placeholder={`${idx + 1}. Karakter adını yazın...`}
                    />
                  </div>

                  {/* Karakter Sil */}
                  {roles.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setRoles((prev) => prev.filter((r) => r.id !== role.id))
                      }
                      className="text-[#A0A096] hover:text-[#FA5636] p-2 rounded-lg hover:bg-[#FA5636]/15 transition cursor-pointer shrink-0"
                      title="Karakteri Sil"
                    >
                      <X size={16} />
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
                <h2 className="text-sm sm:text-base font-extrabold text-[#F4F4E9]">
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
                  onClick={() => addCue()}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-extrabold bg-[#F5E636] hover:bg-[#F5E636] text-[#090909] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus size={14} /> Yeni Replik Ekle
                </button>
              </div>
            </div>

            {cues.length === 0 ? (
              <div className="bg-[#0C0C0A] border border-dashed border-[#383832] rounded-xl p-6 text-center flex flex-col items-center gap-2">
                <p className="text-sm text-[#D8D8CE] leading-relaxed">
                  Henüz replik yok. <strong>“Otomatik Altyazı Çıkar”</strong>{' '}
                  veya <strong>“Yeni Replik Ekle”</strong> butonuna basarak
                  başlayabilirsin.
                </p>
              </div>
            ) : (
              <div ref={cueListRef} className="flex flex-col gap-2.5 max-h-[520px] overflow-y-auto pr-1">
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
                      className={`p-3.5 rounded-xl border transition flex flex-col gap-2.5 cursor-pointer ${
                        isSelected
                          ? 'bg-[#22221E] border-[#F5E636]'
                          : 'bg-[#0C0C0A] border-[#383832] hover:border-[#525248]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {/* Sol: Sıra No & Hangi Karakter Konuşuyor */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs sm:text-sm font-extrabold text-[#D8D8CE]">
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
                            className="text-xs sm:text-sm font-extrabold px-3 py-1.5 rounded-lg border-0 text-black cursor-pointer"
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
                          <span className="rounded-lg border border-[#383832] bg-[#1A1A17] px-2.5 py-1 font-mono text-xs font-bold text-[#F5E636]">
                            {formatTimecode(cue.start)} — {formatTimecode(cue.end)}
                          </span>

                          <button
                            type="button"
                            onClick={() => playCueOnly(cue)}
                            className="p-1.5 rounded-lg bg-[#22221E] hover:bg-[#32322C] text-[#F5E636] transition cursor-pointer"
                            title="Bu Repliği İzle"
                          >
                            <Play size={14} fill="currentColor" />
                          </button>

                          <button
                            type="button"
                            onClick={() => removeCue(cue.id)}
                            className="p-1.5 rounded-lg bg-[#22221E] hover:bg-[#FA563622] text-[#B8B8AE] hover:text-[#FA5636] transition cursor-pointer"
                            title="Repliği Sil"
                          >
                            <Trash2 size={14} />
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
                        style={{ fontSize: '15px', color: '#FFFFFF' }}
                        placeholder="Karakterin söyleyeceği cümleyi buraya yaz..."
                        className="cue-text-input w-full bg-[#161613] border border-[#383832] rounded-lg px-3.5 py-2.5 text-sm sm:text-base font-semibold text-white focus:outline-none focus:border-[#F5E636] placeholder:text-[#8E8E84]"
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
                    {/* Thumbnail / Poster & Mid-Video GIF Loop */}
                    <div
                      className="h-32 bg-[#1A1A17] relative bg-cover bg-center overflow-hidden flex items-end p-2.5"
                      style={
                        sc.poster
                          ? { backgroundImage: `url('${sc.poster}')` }
                          : undefined
                      }
                    >
                      <div className="absolute inset-0 z-0">
                        <SceneVideoGifCover
                          scene={sc}
                          cues={sc.cues || []}
                          showBadge={false}
                        />
                      </div>
                      <span className="absolute top-2 left-2 z-10 bg-black/70 backdrop-blur-sm text-[10px] text-[#F4F4E9] font-mono px-1.5 py-0.5 rounded">
                        00:{sc.duration}
                      </span>
                      {sc.isCustom && (
                        <span className="absolute top-2 right-2 z-10 bg-[#F5E636] text-[#1A1A17] text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                          Meme / Özel
                        </span>
                      )}
                      {sc.instrumental && (
                        <span className="absolute bottom-2 left-2 z-10 bg-[#9E8CA9]/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
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
