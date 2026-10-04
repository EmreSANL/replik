type PcmWav = { sampleRate: number; channels: number; samples: Int16Array };

function readPcmWav(bytes: ArrayBuffer): PcmWav {
  const view = new DataView(bytes);
  if (view.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 ||
      view.getUint32(8, false) !== 0x57415645) throw new Error('MVSEP geçerli WAV dosyası döndürmedi.');
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let blockAlign = 0;
  let dataStart = -1;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > view.byteLength) throw new Error('MVSEP WAV dosyası eksik.');
    const id = view.getUint32(offset, false);
    if (id === 0x666d7420 && size >= 16) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      blockAlign = view.getUint16(start + 12, true);
      bits = view.getUint16(start + 14, true);
      if (format === 0xfffe) {
        // WAVE_FORMAT_EXTENSIBLE: the subtype GUID identifies PCM or IEEE float.
        if (size < 40 || view.getUint16(start + 16, true) < 22 ||
            view.getUint32(start + 28, false) !== 0x00001000 ||
            view.getUint32(start + 32, false) !== 0x800000aa ||
            view.getUint32(start + 36, false) !== 0x00389b71) {
          throw new Error('MVSEP desteklenmeyen genişletilmiş WAV biçimi döndürdü.');
        }
        format = view.getUint32(start + 24, true);
      }
    } else if (id === 0x64617461 && dataStart < 0) {
      dataStart = start;
      dataSize = size;
    }
    offset = start + size + (size % 2);
  }
  const sampleBytes = bits / 8;
  if (!((format === 1 && [16, 24, 32].includes(bits)) ||
        (format === 3 && [32, 64].includes(bits))) ||
      ![1, 2].includes(channels) || !sampleRate ||
      blockAlign !== channels * sampleBytes || dataStart < 0 ||
      dataSize === 0 || dataSize % blockAlign !== 0) {
    throw new Error(`MVSEP desteklenmeyen WAV biçimi döndürdü (kod ${format}, ${bits} bit, ${channels} kanal).`);
  }
  const samples = new Int16Array(dataSize / sampleBytes);
  for (let i = 0; i < samples.length; i++) {
    const offset = dataStart + i * sampleBytes;
    if (format === 1 && bits === 16) samples[i] = view.getInt16(offset, true);
    else if (format === 1 && bits === 24) {
      const value = (view.getUint8(offset) | view.getUint8(offset + 1) << 8 |
        view.getUint8(offset + 2) << 16) << 8 >> 8;
      samples[i] = value >> 8;
    } else if (format === 1) samples[i] = view.getInt32(offset, true) >> 16;
    else {
      const value = bits === 32 ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
      const clamped = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
      samples[i] = Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767);
    }
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

/** Decode PCM WAV without depending on a browser's installed media decoders. */
export function decodePcmWavAudioBuffer(bytes: ArrayBuffer, context: Pick<BaseAudioContext, 'createBuffer'>): AudioBuffer {
  const pcm = readPcmWav(bytes);
  const frames = pcm.samples.length / pcm.channels;
  const output = context.createBuffer(pcm.channels, frames, pcm.sampleRate);
  for (let channel = 0; channel < pcm.channels; channel++) {
    const values = output.getChannelData(channel);
    for (let frame = 0; frame < frames; frame++) {
      values[frame] = pcm.samples[frame * pcm.channels + channel] / 32768;
    }
  }
  return output;
}

export async function decodeMediaAudioBytes(bytes: ArrayBuffer, context: Pick<BaseAudioContext, 'createBuffer' | 'decodeAudioData'>): Promise<AudioBuffer> {
  try {
    return await context.decodeAudioData(bytes.slice(0));
  } catch (error) {
    const header = new DataView(bytes);
    if (bytes.byteLength < 12 || header.getUint32(0, false) !== 0x52494646 || header.getUint32(8, false) !== 0x57415645) throw error;
    return decodePcmWavAudioBuffer(bytes, context);
  }
}
