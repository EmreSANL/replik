/** Server-side AudioShake DME jobs. Never import this module in client components. */
export type SeparationJob = {
  status: 'starting' | 'processing' | 'ready' | 'failed';
  createdAt: number;
  taskId?: string;
  instrumentalUrl?: string;
  error?: string;
  retryable?: boolean;
};

export interface SeparationStore {
  read: (path: string) => Promise<SeparationJob | null>;
  create: (path: string, job: SeparationJob) => Promise<boolean>;
  write: (path: string, job: SeparationJob) => Promise<void>;
  saveAudio: (path: string, audio: Blob) => Promise<string>;
}

type ProviderTask = {
  id: string;
  targets?: { model: string; status: string; output?: { link: string }[] }[];
};

export function validateSeparationSource(source: string, storageUrl: string): string {
  const url = new URL(source);
  const storage = new URL(storageUrl);
  // Only immutable uploaded media from our own bucket, never arbitrary/private URLs.
  if (url.origin !== storage.origin || url.protocol !== 'https:' || url.username || url.password ||
      !url.pathname.startsWith('/storage/v1/object/public/videos/uploads/') || url.search || url.hash) {
    throw new Error('Önce videoyu editörden yükleyin.');
  }
  return url.href;
}

export async function separationKey(source: string, userId: string, engine = 'audioshake-dme-v1'): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hex = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
  return `audio-jobs/${userId}/${engine}/${hex}`;
}

export async function prepareDialogueBackground({
  source, userId, apiKey, store, retry = false, fetcher = fetch, now = Date.now,
  apiBase = 'https://api.audioshake.ai', engine = 'audioshake-dme-v1',
}: {
  source: string;
  userId: string;
  apiKey?: string;
  apiBase?: string;
  engine?: string;
  store: SeparationStore;
  retry?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
}): Promise<SeparationJob> {
  const base = await separationKey(source, userId, engine);
  // Each explicit retry claims a new immutable slot. Concurrent requests can only
  // create one provider task; neither a page reload nor another room starts one.
  for (let attempt = 0; attempt < 20; attempt++) {
    const path = `${base}/${attempt}.json`;
    let job = await store.read(path);
    if (job?.status === 'ready') return job;
    if (job?.status === 'failed') {
      if (retry && job.retryable) continue;
      return job;
    }
    if (!apiKey) throw new Error('Ses ayırma servisi henüz yapılandırılmadı. Yönetici ses ayırma motorunun bağlantısını tamamlamalı.');

    if (!job) {
      if (engine.startsWith('cinematic-')) {
        const health = await fetcher(`${apiBase}/health`, { signal: AbortSignal.timeout(10000) });
        const worker = health.ok ? await health.json() as { engine?: string } : null;
        if (worker?.engine !== engine) {
          throw new Error('Ses ayırma servisi güncellenmeli. Yönetici yeni ses motorunu yayınlamalı.');
        }
      }
      job = { status: 'starting', createdAt: now() };
      if (!(await store.create(path, job))) {
        // A different request owns this slot. Read it on the next poll.
        return { status: 'starting', createdAt: now() };
      }
      try {
        const response = await fetcher(`${apiBase}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ url: source, targets: [{ model: 'music_fx', formats: ['wav'] }] }),
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          job = {
            ...job, status: 'failed',
            retryable: response.status >= 400 && response.status < 500,
            error: `Ses ayırma servisi işlemi başlatamadı (${response.status}).`,
          };
          await store.write(path, job);
          return job;
        }
        const task = await response.json() as ProviderTask;
        if (!task.id) throw new Error('İşlem kimliği alınamadı.');
        job = { ...job, status: 'processing', taskId: task.id };
        await store.write(path, job);
        return job;
      } catch {
        // A timeout can happen after the paid job was accepted. Do not issue a
        // second paid request automatically when its outcome is unknown.
        throw new Error('Ses ayırma isteğinin durumu doğrulanamadı. Yönetici servis panelini kontrol etmeli.');
      }
    }

    if (job.status === 'starting') {
      if (now() - job.createdAt > 120000) {
        return { ...job, status: 'failed', retryable: false, error: 'İşlemin başlatıldığı doğrulanamadı. Yönetici servis panelini kontrol etmeli.' };
      }
      return job;
    }
    if (!job.taskId) throw new Error('Ses ayırma işlemi bulunamadı.');
    const response = await fetcher(`${apiBase}/tasks/${encodeURIComponent(job.taskId)}`, {
      headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Ses ayırma durumu alınamadı (${response.status}). Tekrar kontrol edin.`);
    const task = await response.json() as ProviderTask;
    const target = task.targets?.find((item) => item.model === 'music_fx');
    if (target?.status === 'error') {
      const failed: SeparationJob = { ...job, status: 'failed', retryable: true, error: 'Arka plan sesi ayrılamadı. Yeniden deneyebilirsiniz.' };
      await store.write(path, failed);
      return failed;
    }
    if (!target || target.status !== 'completed') return job;
    const link = target.output?.[0]?.link;
    if (!link || (engine === 'audioshake-dme-v1' ? !link.startsWith('https://') : !link.startsWith(`${apiBase}/outputs/`))) throw new Error('Servis geçerli bir ses dosyası döndürmedi.');
    // Provider links expire. Copy the WAV into our permanent storage before ready.
    const audioResponse = await fetcher(link, { signal: AbortSignal.timeout(60000), ...(engine === 'audioshake-dme-v1' ? {} : { headers: { 'x-api-key': apiKey } }) });
    if (!audioResponse.ok) throw new Error('Hazırlanan arka plan sesi indirilemedi. Tekrar kontrol edin.');
    const audio = await audioResponse.blob();
    if (audio.size <= 44 || await audio.slice(0, 4).text() !== 'RIFF' || await audio.slice(8, 12).text() !== 'WAVE') {
      throw new Error('Servis geçerli bir WAV dosyası döndürmedi.');
    }
    const instrumentalUrl = await store.saveAudio(`instrumentals/${userId}/${engine}_${base.split('/').pop()}_${attempt}.wav`, audio);
    const ready: SeparationJob = { ...job, status: 'ready', instrumentalUrl };
    await store.write(path, ready);
    return ready;
  }
  throw new Error('Bu video için yeniden deneme sınırına ulaşıldı.');
}
