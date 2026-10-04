import { finalizeVideoContainer } from './video-export-container';

/** Feed playback and browser Save Video must use the same finalized media bytes. */
export async function preparePublishedVideo(source: string, signal?: AbortSignal): Promise<Blob> {
  const read = async (url: string) => {
    const response = await fetch(url, { signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Video yüklenemedi (HTTP ${response.status}).`);
    if (/text\/html|application\/json/i.test(response.headers.get('content-type') || '')) {
      throw new Error('Video dosyası yerine bir hata sayfası alındı.');
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('Video dosyası boş.');
    return blob;
  };
  let blob: Blob;
  try {
    blob = await read(source);
  } catch (error) {
    if (signal?.aborted || !source.startsWith('https://')) throw error;
    blob = await read(`/api/video-proxy?url=${encodeURIComponent(source)}`);
  }
  signal?.throwIfAborted();
  const prepared = await finalizeVideoContainer(blob);
  signal?.throwIfAborted();
  return prepared;
}
