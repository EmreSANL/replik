import { finalizeVideoContainer } from './video-export-container';

/** Prepare downloads independently from the feed's streaming video source. */
export async function preparePublishedVideo(source: string, signal?: AbortSignal): Promise<Blob> {
  const read = async (url: string, range?: string) => {
    const response = await fetch(url, { cache: 'no-store', headers: range ? { Range: range } : undefined, signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Video yüklenemedi (HTTP ${response.status}).`);
    if (/text\/html|application\/json/i.test(response.headers.get('content-type') || '')) {
      throw new Error('Video dosyası yerine bir hata sayfası alındı.');
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('Video dosyası boş.');
    return { blob, response };
  };
  let blob: Blob;
  try {
    blob = (await read(source)).blob;
  } catch (error) {
    if (signal?.aborted || !source.startsWith('https://')) throw error;
    // Keep each fallback response below Vercel's function response-size limit.
    const proxy = `/api/video-proxy?url=${encodeURIComponent(source)}`;
    const chunkSize = 3 * 1024 * 1024;
    const chunks: Blob[] = [];
    let start = 0;
    let total: number | undefined;
    do {
      signal?.throwIfAborted();
      const end = total === undefined ? start + chunkSize - 1 : Math.min(total - 1, start + chunkSize - 1);
      const part = await read(proxy, `bytes=${start}-${end}`);
      if (part.response.status === 200 && start === 0) { chunks.push(part.blob); break; }
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(part.response.headers.get('content-range') || '');
      if (part.response.status !== 206 || !match) throw new Error('Video parçası indirilemedi. Tekrar dene.');
      const [, rangeStart, rangeEnd, rangeTotal] = match.map(Number);
      if (rangeStart !== start || rangeEnd < start || rangeEnd > end || rangeEnd >= rangeTotal
        || !Number.isSafeInteger(rangeTotal) || (total !== undefined && total !== rangeTotal)
        || part.blob.size !== rangeEnd - start + 1) throw new Error('Video parçası eksik alındı. Tekrar dene.');
      total = rangeTotal;
      chunks.push(part.blob);
      start = rangeEnd + 1;
    } while (total !== undefined && start < total);
    blob = new Blob(chunks, { type: chunks[0]?.type || 'video/mp4' });
  }
  signal?.throwIfAborted();
  const prepared = await finalizeVideoContainer(blob);
  signal?.throwIfAborted();
  return prepared;
}
