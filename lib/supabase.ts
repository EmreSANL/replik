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
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

/**
 * Sunucu tarafı API rotaları için kullanıcının Supabase Auth JWT token'ını doğrulayan yardımcı
 */
export function createServerSupabaseClient(accessToken?: string) {
  return createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder',
    accessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      : {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        },
  );
}

export async function verifySupabaseAuthHeader(req: Request) {
  const rawAuth =
    req.headers.get('x-supabase-auth') ||
    req.headers.get('authorization') ||
    '';
  const token = rawAuth.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { user: null, token: null, client: createServerSupabaseClient() };
  }
  const client = createServerSupabaseClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, token: null, client };
  }
  return { user: data.user, token, client };
}

export async function requireAuthenticatedUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error('Bu işlemi yapmak için üye girişi yapmalısınız.');
  }
  return user;
}

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
  created_by?: string | null;
  created_at?: string;
};

/**
 * Videoyu Supabase Storage'a (`videos` bucket) yükler ve URL döner.
 * Sadece giriş yapmış üyeler yükleyebilir.
 */
export async function uploadVideoToSupabase(
  file: File | Blob,
  fileName?: string,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; path: string }> {
  const user = await requireAuthenticatedUser();
  const allowedTypes = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/wav',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
  ];
  if (file.type && !allowedTypes.some((t) => file.type.startsWith(t.split('/')[0]))) {
    throw new Error('Yalnızca geçerli video veya ses dosyaları yüklenebilir.');
  }
  if (file.size > 120 * 1024 * 1024) {
    throw new Error('Dosya boyutu 120 MB sınırını aşamaz.');
  }

  const ext = (fileName?.split('.').pop() || 'mp4').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'mp4';
  const cleanName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `uploads/${user.id}/${cleanName}`;

  onProgress?.(10);

  const { data, error } = await supabase.storage
    .from('videos')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
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
 * Sahneyi Supabase veritabanına kaydeder veya günceller (Üye sahipliği ile)
 */
export async function saveSceneToSupabase(scene: Scene): Promise<void> {
  const user = await requireAuthenticatedUser();
  const record: DbCustomScene = {
    id: scene.id,
    title: scene.title.trim().slice(0, 120),
    category: (scene.category || 'MEME & MİZAH').trim().slice(0, 40),
    mood: (scene.mood || '').trim().slice(0, 60),
    video_url: scene.video,
    poster_url: scene.poster || '',
    duration: Number(scene.duration) || 20,
    roles: (scene.roles || []).map((r, i) =>
      typeof r === 'string'
        ? { id: i, name: r, color: '#ef4444', description: '' }
        : r,
    ),
    cues: scene.cues || [],
    instrumental_url: scene.instrumental || null,
    created_by: user.id,
  };

  const { error } = await supabase
    .from('custom_scenes')
    .upsert(record, { onConflict: 'id' });

  if (error) {
    throw new Error(`Sahne Supabase'e kaydedilemedi: ${error.message}`);
  }
  scenesMemoryCache = null;
}

let scenesMemoryCache: { data: Scene[]; expiresAt: number } | null = null;
let scenesInFlightPromise: Promise<Scene[]> | null = null;

/**
 * Supabase'den tüm sahneleri çeker (Bellek önbelleği ve eşzamanlı istek birleştirme ile optimize edilmiştir)
 */
export async function getScenesFromSupabase(forceRefresh = false): Promise<Scene[]> {
  const now = Date.now();
  if (!forceRefresh && scenesMemoryCache && scenesMemoryCache.expiresAt > now) {
    return scenesMemoryCache.data;
  }
  if (!forceRefresh && scenesInFlightPromise) {
    return scenesInFlightPromise;
  }

  scenesInFlightPromise = (async () => {
    const { data, error } = await supabase
      .from('custom_scenes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) {
      if (error) console.error('Supabase sahneleri çekilemedi:', error);
      return scenesMemoryCache?.data || [];
    }

    const mapped: Scene[] = data.map((item: DbCustomScene) => ({
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
          : r,
      ),
      prompts: (item.cues || []).map((c) => c.text),
      cues: item.cues || [],
      instrumental: item.instrumental_url || undefined,
      isCustom: true,
    }));

    scenesMemoryCache = {
      data: mapped,
      expiresAt: Date.now() + 30_000,
    };
    return mapped;
  })();

  try {
    return await scenesInFlightPromise;
  } finally {
    scenesInFlightPromise = null;
  }
}

/**
 * Sahneyi Supabase'den siler (Sadece sahneyi oluşturan üye silebilir)
 */
export async function deleteSceneFromSupabase(id: number): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { error } = await supabase
    .from('custom_scenes')
    .delete()
    .eq('id', id)
    .eq('created_by', user.id);
  if (error) {
    throw new Error(`Sahne silinemedi: ${error.message}`);
  }
  scenesMemoryCache = null;
}
