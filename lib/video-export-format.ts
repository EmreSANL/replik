export function videoExportFormat(mime: string): { extension: 'mp4' | 'webm'; contentType: string } {
  const contentType = mime.split(';')[0].trim().toLowerCase();
  if (contentType === 'video/mp4') return { extension: 'mp4', contentType };
  if (contentType === 'video/webm') return { extension: 'webm', contentType };
  throw new Error('Tarayıcı desteklenen bir video dosyası oluşturamadı.');
}

export async function detectVideoExportFormat(blob: Blob) {
  const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return videoExportFormat('video/mp4');
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    if (new TextDecoder().decode(bytes).includes('matroska')) return { extension: 'mkv', contentType: 'video/x-matroska' };
    return videoExportFormat('video/webm');
  }
  throw new Error('Kaydedilen video dosyası okunamadı.');
}
