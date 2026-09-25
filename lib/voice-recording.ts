const TARGET_PEAK = 0.3;
const MIN_VOICE_PEAK = 0.01;
const MAX_GAIN = 8;
const MAX_WAV_BYTES = 4_500_000;

/** Raise a quiet take by a fixed amount without filtering or compressing it. */
export async function prepareVoiceRecording(
  blob: Blob,
  context: AudioContext,
): Promise<{ blob: Blob; buffer: AudioBuffer }> {
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const wavSize = 44 + frames * channels * 2;
  let peak = 0;

  for (let channel = 0; channel < channels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame++) {
      peak = Math.max(peak, Math.abs(samples[frame]));
    }
  }

  if (
    peak < MIN_VOICE_PEAK ||
    peak >= TARGET_PEAK / 1.1 ||
    wavSize > MAX_WAV_BYTES
  ) {
    return { blob, buffer };
  }

  const gain = Math.min(MAX_GAIN, TARGET_PEAK / peak);
  const wav = new ArrayBuffer(wavSize);
  const view = new DataView(wav);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, wavSize - 8, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, wavSize - 44, true);

  const channelData = Array.from({ length: channels }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][frame] * gain));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return { blob: new Blob([wav], { type: 'audio/wav' }), buffer };
}
