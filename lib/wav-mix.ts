type PcmWav = { sampleRate: number; channels: number; samples: Int16Array };

function readPcmWav(bytes: ArrayBuffer): PcmWav {
  const view = new DataView(bytes);
  if (view.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 ||
      view.getUint32(8, false) !== 0x57415645) throw new Error('MVSEP geçerli WAV dosyası döndürmedi.');
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let samples: Int16Array | undefined;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > view.byteLength) throw new Error('MVSEP WAV dosyası eksik.');
    const id = view.getUint32(offset, false);
    if (id === 0x666d7420 && size >= 16) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (id === 0x64617461) {
      if (size % 2) throw new Error('MVSEP WAV örnekleri bozuk.');
      samples = new Int16Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(start + i * 2, true);
    }
    offset = start + size + (size % 2);
  }
  if (format !== 1 || bits !== 16 || ![1, 2].includes(channels) || !sampleRate || !samples?.length) {
    throw new Error('MVSEP 16 bit PCM WAV dosyası döndürmedi.');
  }
  return { sampleRate, channels, samples };
}

export function mixPcmWav(music: ArrayBuffer, effects: ArrayBuffer): Blob {
  const a = readPcmWav(music);
  const b = readPcmWav(effects);
  if (a.sampleRate !== b.sampleRate || a.channels !== b.channels ||
      Math.abs(a.samples.length - b.samples.length) > a.sampleRate * a.channels) {
    throw new Error('MVSEP müzik ve efekt kanallarının biçimi veya süresi eşleşmiyor.');
  }
  const frames = Math.max(a.samples.length, b.samples.length);
  const bytes = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(bytes);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, a.channels, true);
  view.setUint32(24, a.sampleRate, true);
  view.setUint32(28, a.sampleRate * a.channels * 2, true);
  view.setUint16(32, a.channels * 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const mixed = (a.samples[i] || 0) + (b.samples[i] || 0);
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, mixed)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
