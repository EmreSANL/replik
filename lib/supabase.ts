import { createClient } from '@supabase/supabase-js';
import type { Scene, RoleInfo, Cue } from './scenes';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  if (typeof window !== 'undefined') {
    console.warn(
      '⚠️ Supabase ortam değişkenleri (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) bulunamadı. Lütfen .env.local dosyasını veya Vercel ortam değişkenlerini kontrol edin.',
    );
  }
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
);

export type DbCustomScene = {
  id: number;
  title: string;
  category: string;
  mood: string | null;
  video_url: string;
  poster_url: string | null;
  duration: number;
  roles: RoleInfo[];
  cues: Cue[];
  instrumental_url?: string | null;
  created_at?: string;
};

/**
 * Videoyu Supabase Storage'a yükler ve herkese açık genel URL döner.
 */
export async function uploadVideoToSupabase(
  file: File | Blob,
  fileName?: string,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; path: string }> {
  const ext = fileName?.split('.').pop() || 'mp4';
  const cleanName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `uploads/${cleanName}`;

  onProgress?.(10);

  const { data, error } = await supabase.storage
    .from('videos')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || 'video/mp4',
    });

  if (error) {
    throw new Error(`Supabase video yükleme hatası: ${error.message}`);
  }

  onProgress?.(90);

  const { data: publicUrlData } = supabase.storage
    .from('videos')
    .getPublicUrl(data.path);

  onProgress?.(100);
  return { url: publicUrlData.publicUrl, path: data.path };
}

/**
 * Sahneyi Supabase veritabanına kaydeder veya günceller
 */
export async function saveSceneToSupabase(scene: Scene): Promise<void> {
  const record: DbCustomScene = {
    id: scene.id,
    title: scene.title,
    category: scene.category,
    mood: scene.mood || '',
    video_url: scene.video,
    poster_url: scene.poster || '',
    duration: Number(scene.duration) || 20,
    roles: (scene.roles || []).map((r, i) =>
      typeof r === 'string'
        ? { id: i, name: r, color: '#ef4444', description: '' }
        : r
    ),
    cues: scene.cues || [],
    instrumental_url: scene.instrumental || null,
  };

  const { error } = await supabase
    .from('custom_scenes')
    .upsert(record, { onConflict: 'id' });

  if (error) {
    throw new Error(`Sahne Supabase'e kaydedilemedi: ${error.message}`);
  }
}

/**
 * Supabase'den tüm sahneleri çeker
 */
export async function getScenesFromSupabase(): Promise<Scene[]> {
  const { data, error } = await supabase
    .from('custom_scenes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase sahneleri çekilemedi:', error);
    return [];
  }

  if (!data) return [];

  return data.map((item: DbCustomScene) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    mood: item.mood || '',
    start: 0,
    duration: Number(item.duration),
    poster: item.poster_url || '',
    video: item.video_url,
    roles: (item.roles || []).map((r) => (typeof r === 'string' ? r : r.name)),
    roleDetails: (item.roles || []).map((r, i) =>
      typeof r === 'string'
        ? { id: i, name: r, color: '#ef4444', description: '' }
        : r
    ),
    prompts: (item.cues || []).map((c) => c.text),
    cues: item.cues || [],
    instrumental: item.instrumental_url || undefined,
    isCustom: true,
  }));
}

/**
 * Sahneyi Supabase'den siler
 */
export async function deleteSceneFromSupabase(id: number): Promise<void> {
  const { error } = await supabase.from('custom_scenes').delete().eq('id', id);
  if (error) {
    throw new Error(`Sahne silinemedi: ${error.message}`);
  }
}
