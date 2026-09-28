import { separationKey, type SeparationJob, type SeparationStore } from './dialogue-separation';
import { mixPcmWav } from './wav-mix';

const API_BASE = 'https://de.mvsep.com/api';
const ENGINE = 'mvsep-dnr-v3-scnet-v1';

type MvsepFile = { download?: string; url?: string };
type MvsepResult = {
  success?: boolean;
  status?: string;
  data?: { hash?: string; message?: string; files?: MvsepFile[] };
};

function downloadUrl(file: MvsepFile): string {
  const url = new URL((file.url || '').replace(/\\\//g, '/'));
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.hostname !== 'mvsep.com' && !url.hostname.endsWith('.mvsep.com'))) {
    throw new Error('MVSEP beklenmeyen bir dosya adresi döndürdü.');
  }
  return url.href;
}

export async function prepareMvsepBackground({
  source, userId, apiKey, store, retry = false, fetcher = fetch, now = Date.now,
}: {
  source: string;
  userId: string;
  apiKey: string;
  store: SeparationStore;
  retry?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
}): Promise<SeparationJob> {
  const base = await separationKey(source, userId, ENGINE);
  for (let attempt = 0; attempt < 20; attempt++) {
    const path = `${base}/${attempt}.json`;
    let job = await store.read(path);
    if (job?.status === 'ready') return job;
    if (job?.status === 'failed') {
      if (retry && job.retryable) continue;
      return job;
    }
    if (!job) {
      job = { status: 'starting', createdAt: now() };
      if (!(await store.create(path, job))) return job;
      const form = new FormData();
      form.set('api_token', apiKey);
      form.set('url', source);
      form.set('sep_type', '56');
      form.set('add_opt1', '0'); // SCNet Large; the free plan excludes ensemble models.
      form.set('output_format', '1'); // 16-bit WAV for the lossless Music + Effects mix.
      form.set('is_demo', '0');
      let response: Response;
      try {
        response = await fetcher(`${API_BASE}/separation/create`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(45000),
        });
      } catch {
        throw new Error('MVSEP isteğinin sonucu doğrulanamadı. Birkaç dakika sonra tekrar kontrol edin.');
      }
      const result = await response.json() as MvsepResult;
      if (!response.ok || !result.success || !result.data?.hash) {
        const failed: SeparationJob = {
          ...job, status: 'failed', retryable: response.status !== 401,
          error: result.data?.message || `MVSEP işlemi başlatılamadı (${response.status}).`,
        };
        await store.write(path, failed);
        return failed;
      }
      job = { ...job, status: 'processing', taskId: result.data.hash };
      await store.write(path, job);
      return job;
    }
    if (job.status === 'starting') {
      if (now() - job.createdAt > 120000) {
        return { ...job, status: 'failed', retryable: false, error: 'MVSEP işleminin başlatıldığı doğrulanamadı. Yönetici hesabı kontrol etmeli.' };
      }
      return job;
    }
    if (!job.taskId) throw new Error('MVSEP işlem kimliği bulunamadı.');
    const response = await fetcher(`${API_BASE}/separation/get?hash=${encodeURIComponent(job.taskId)}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`MVSEP işlem durumu alınamadı (${response.status}).`);
    const result = await response.json() as MvsepResult;
    if (result.status === 'failed' || result.status === 'not_found' || result.success === false) {
      const failed: SeparationJob = {
        ...job, status: 'failed', retryable: true,
        error: result.data?.message || 'MVSEP ses ayırma işini tamamlayamadı.',
      };
      await store.write(path, failed);
      return failed;
    }
    if (result.status !== 'done') return job;
    const files = result.data?.files || [];
    const music = files.find((file) => /music/i.test(file.download || ''));
    const effects = files.find((file) => /effects|sfx|fx\b/i.test(file.download || ''));
    if (!music || !effects) throw new Error('MVSEP müzik ve efekt dosyalarını döndürmedi.');
    const [musicResponse, effectsResponse] = await Promise.all([
      fetcher(downloadUrl(music), { signal: AbortSignal.timeout(60000) }),
      fetcher(downloadUrl(effects), { signal: AbortSignal.timeout(60000) }),
    ]);
    if (!musicResponse.ok || !effectsResponse.ok) throw new Error('MVSEP ses dosyaları indirilemedi. Tekrar kontrol edin.');
    const audio = mixPcmWav(await musicResponse.arrayBuffer(), await effectsResponse.arrayBuffer());
    const instrumentalUrl = await store.saveAudio(`instrumentals/${userId}/${ENGINE}_${base.split('/').pop()}_${attempt}.wav`, audio);
    const ready: SeparationJob = { ...job, status: 'ready', instrumentalUrl };
    await store.write(path, ready);
    return ready;
  }
  throw new Error('Bu video için yeniden deneme sınırına ulaşıldı.');
}
