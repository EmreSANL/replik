import { verifySupabaseAuthHeader } from '@/lib/supabase';
import {
  prepareDialogueBackground,
  validateSeparationSource,
  type SeparationJob,
  type SeparationStore,
} from '@/lib/dialogue-separation';

export const maxDuration = 120;

/** Editor-only preparation. Each request starts or checks one durable job. */
export async function POST(req: Request) {
  const { user, client } = await verifySupabaseAuthHeader(req);
  if (!user) return Response.json({ error: 'Ses hazırlamak için giriş yapın.' }, { status: 401 });
  try {
    const body = await req.json() as { videoUrl?: string; retry?: boolean };
    if (typeof body.videoUrl !== 'string') return Response.json({ error: 'Video adresi gerekli.' }, { status: 400 });
    const source = validateSeparationSource(body.videoUrl, process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    const bucket = client.storage.from('videos');
    const store: SeparationStore = {
      async read(path) {
        const { data, error } = await bucket.download(path);
        if (error) {
          if (['404', 'not_found', 'NoSuchKey', 'notFound'].includes(String(error.statusCode)) ||
              error.message.toLowerCase() === 'object not found') return null;
          throw new Error(`İşlem durumu okunamadı: ${error.message}`);
        }
        return JSON.parse(await data.text()) as SeparationJob;
      },
      async create(path, job) {
        const { error } = await bucket.upload(path, JSON.stringify(job), { contentType: 'application/json', cacheControl: '0', upsert: false });
        if (error) {
          if (String(error.statusCode) === '409' || error.message.toLowerCase().includes('already exists')) return false;
          throw new Error(`Ses hazırlama başlatılamadı: ${error.message}`);
        }
        return true;
      },
      async write(path, job) {
        const { error } = await bucket.update(path, JSON.stringify(job), { contentType: 'application/json', cacheControl: '0' });
        if (error) throw new Error(`İşlem durumu kaydedilemedi: ${error.message}`);
      },
      async saveAudio(path, audio) {
        const { error } = await bucket.upload(path, audio, { contentType: 'audio/wav', cacheControl: '31536000', upsert: false });
        if (error && String(error.statusCode) !== '409' && !error.message.toLowerCase().includes('already exists')) {
          throw new Error(`Arka plan sesi kaydedilemedi: ${error.message}`);
        }
        return bucket.getPublicUrl(path).data.publicUrl;
      },
    };
    const useAudioShake = Boolean(process.env.AUDIOSHAKE_API_KEY?.trim());
    const job = await prepareDialogueBackground({
      source, userId: user.id, store, retry: body.retry === true,
      apiKey: useAudioShake ? process.env.AUDIOSHAKE_API_KEY?.trim() : process.env.CINEMATIC_API_KEY?.trim(),
      apiBase: useAudioShake ? 'https://api.audioshake.ai' : process.env.CINEMATIC_API_URL?.replace(/\/$/, '') || 'http://127.0.0.1:8011',
      engine: useAudioShake ? 'audioshake-dme-v1' : 'cinematic-cdx23-ensemble-v2',
    });
    return Response.json(job, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: (error as Error).message || 'Ses hazırlanamadı.' }, { status: 503 });
  }
}
