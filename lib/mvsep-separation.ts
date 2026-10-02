import { separationKey, type SeparationJob, type SeparationStore } from './dialogue-separation';
import { mixPcmWav } from './wav-mix';

const API_BASE = 'https://de.mvsep.com/api';
const ENGINE = 'mvsep-dnr-v3-scnet-v1';

type MvsepFile = { download?: string; url?: string };
type MvsepResult = {
  success?: boolean;
  status?: string;
  message?: unknown;
  errors?: unknown;
  data?: { hash?: string; message?: string; files?: MvsepFile[]; current_order?: number };
};
type MvsepHistory = { success?: boolean; data?: { hash?: string; job_exists?: boolean }[] };

function createError(result: MvsepResult, status: number, apiKey: string, source: string): string {
  const details = result.errors;
  const candidates: unknown[] = [result.data?.message, result.message];
  if (Array.isArray(details)) candidates.push(...details);
  else if (details && typeof details === 'object') candidates.push(...Object.values(details).flat());
  else candidates.push(details);
  const messages = candidates.filter((value): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 250 &&
    !value.includes(apiKey) && !value.includes(source) && !/https?:\/\/|api[_ -]?token\s*[:=]/i.test(value),
  );
  return messages.length
    ? `MVSEP: ${messages.slice(0, 2).join(' ')}`
    : `MVSEP işlemi başlatılamadı (${status}).`;
}

function downloadUrl(file: MvsepFile): string {
  const url = new URL((file.url || '').replace(/\\\//g, '/'));
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.hostname !== 'mvsep.com' && !url.hostname.endsWith('.mvsep.com'))) {
    throw new Error('MVSEP beklenmeyen bir dosya adresi döndürdü.');
  }
  return url.href;
}

function isSeparationHash(hash: string): boolean {
  return /^\d{14}-[a-z0-9]+-/i.test(hash);
}

async function findCompletedSeparation(source: string, apiKey: string, fetcher: typeof fetch): Promise<string | undefined> {
  const filename = new URL(source).pathname.split('/').pop()?.toLowerCase().replace(/_/g, '-');
  if (!filename) return undefined;
  const url = `${API_BASE}/app/separation_history?api_token=${encodeURIComponent(apiKey)}&limit=20`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return undefined;
  const history = await response.json() as MvsepHistory;
  if (!history.success || !Array.isArray(history.data)) return undefined;
  return history.data.find((item) => item.job_exists !== false && item.hash && isSeparationHash(item.hash) &&
    item.hash.toLowerCase().endsWith(`-${filename}`))?.hash;
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
    // Older deployments queried the remote-download hash as a separation hash.
    // Reuse that MVSEP job instead of consuming another free separation slot.
    if (job?.remoteTaskId && !job.taskId && isSeparationHash(job.remoteTaskId)) {
      job = { ...job, taskId: job.remoteTaskId, remoteTaskId: undefined };
      await store.write(path, job);
    }
    if (job?.taskId && isSeparationHash(job.taskId) && job.status === 'failed' &&
        /File or File Hash not found/i.test(job.error || '')) {
      job = { ...job, status: 'processing', phase: 'queued', error: undefined, retryable: undefined };
      await store.write(path, job);
    }
    if (job?.remoteTaskId && job.status === 'failed' &&
        /File or File Hash not found/i.test(job.error || '')) {
      job = { ...job, status: 'processing', phase: 'downloading', error: undefined, retryable: undefined };
      await store.write(path, job);
    }
    if (job?.taskId && !job.remoteTaskId && !isSeparationHash(job.taskId) &&
        (job.status === 'processing' ||
         (job.status === 'failed' && /File or File Hash not found/i.test(job.error || '')))) {
      job = { ...job, status: 'processing', remoteTaskId: job.taskId, taskId: undefined, error: undefined, retryable: undefined };
      await store.write(path, job);
    }
    if (job?.status === 'failed') {
      if (retry && job.retryable) continue;
      return job;
    }
    if (!job) {
      job = { status: 'starting', createdAt: now() };
      if (!(await store.create(path, job))) return job;
      // The free MVSEP plan accepts at most 100 MB. The editor can still use
      // larger videos, but submitting one to MVSEP would only fail with 400.
      try {
        const head = await fetcher(source, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        const size = Number(head.headers.get('content-length'));
        if (head.ok && Number.isFinite(size) && size > 100 * 1024 * 1024) {
          const failed: SeparationJob = {
            ...job, status: 'failed', retryable: false,
            error: 'MVSEP ücretsiz hesapta en fazla 100 MB dosya kabul ediyor. Daha küçük bir video yükleyin.',
          };
          await store.write(path, failed);
          return failed;
        }
      } catch {
        // Some storage hosts omit or reject HEAD. Let MVSEP validate the URL.
      }
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
          error: createError(result, response.status, apiKey, source),
        };
        await store.write(path, failed);
        return failed;
      }
      job = isSeparationHash(result.data.hash)
        ? { ...job, status: 'processing', phase: 'queued', taskId: result.data.hash }
        : { ...job, status: 'processing', phase: 'downloading', remoteTaskId: result.data.hash };
      await store.write(path, job);
      return job;
    }
    if (job.status === 'starting') {
      if (now() - job.createdAt > 120000) {
        return { ...job, status: 'failed', retryable: false, error: 'MVSEP işleminin başlatıldığı doğrulanamadı. Yönetici hesabı kontrol etmeli.' };
      }
      return job;
    }
    if (!job.taskId && !job.remoteTaskId) throw new Error('MVSEP işlem kimliği bulunamadı.');
    if (!job.taskId && job.remoteTaskId) {
      const remoteResponse = await fetcher(`${API_BASE}/separation/get-remote?hash=${encodeURIComponent(job.remoteTaskId)}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!remoteResponse.ok) throw new Error(`MVSEP video indirme durumu alınamadı (${remoteResponse.status}).`);
      const remote = await remoteResponse.json() as MvsepResult;
      if (remote.status !== 'done' &&
          (remote.status === 'failed' || remote.status === 'not_found' || now() - job.createdAt > 120000) &&
          now() - (job.lastHistoryCheckAt || 0) >= 60000) {
        job = { ...job, lastHistoryCheckAt: now() };
        await store.write(path, job);
        try {
          const recoveredHash = await findCompletedSeparation(source, apiKey, fetcher);
          if (recoveredHash) {
            job = { ...job, phase: 'queued', remoteTaskId: undefined, taskId: recoveredHash };
            await store.write(path, job);
          }
        } catch {
          // History is a recovery path. Keep polling the original remote job.
        }
      }
      if (!job.taskId && (remote.status === 'failed' || remote.status === 'not_found' || remote.success === false)) {
        const failed: SeparationJob = {
          ...job, status: 'failed', retryable: true,
          error: remote.data?.message || 'MVSEP videoyu indiremedi. Yeniden deneyin.',
        };
        await store.write(path, failed);
        return failed;
      }
      if (!job.taskId) {
        if (remote.status !== 'done') return { ...job, phase: 'downloading', queuePosition: remote.data?.current_order };
        if (!remote.data?.hash) throw new Error('MVSEP indirilen videonun ayırma kimliğini döndürmedi.');
        job = { ...job, phase: 'queued', taskId: remote.data.hash };
        await store.write(path, job);
      }
    }
    const separationHash = job.taskId;
    if (!separationHash) throw new Error('MVSEP ses ayırma işlem kimliği bulunamadı.');
    const response = await fetcher(`${API_BASE}/separation/get?hash=${encodeURIComponent(separationHash)}`, {
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
    if (result.status !== 'done') return {
      ...job,
      phase: result.status === 'waiting' ? 'queued' : 'separating',
      queuePosition: result.data?.current_order,
    };
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
