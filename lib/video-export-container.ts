import {
  BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink,
  EncodedVideoPacketSource, Input, MATROSKA, MP4, WEBM, MkvOutputFormat,
  Mp4OutputFormat, Output, WebMOutputFormat,
} from 'mediabunny';

/** Finalize recorder output with duration and seek tables, without re-encoding media. */
export async function finalizeVideoContainer(blob: Blob): Promise<Blob> {
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, WEBM, MATROSKA] });
  let output: Output | undefined;
  try {
    const inputFormat = await input.getFormat();
    const format = inputFormat === MP4
      ? new Mp4OutputFormat({ fastStart: 'in-memory' })
      : inputFormat === WEBM ? new WebMOutputFormat() : new MkvOutputFormat();
    const target = new BufferTarget();
    output = new Output({ format, target });
    const copies: Array<() => Promise<void>> = [];
    let hasVideo = false;

    for (const track of await input.getTracks()) {
      if (track.isVideoTrack()) {
        const codec = await track.getCodec();
        const decoderConfig = await track.getDecoderConfig();
        if (!codec || !decoderConfig || !format.getSupportedVideoCodecs().includes(codec)) {
          throw new Error('Videonun sarma bilgileri hazırlanamadı: görüntü biçimi desteklenmiyor.');
        }
        const source = new EncodedVideoPacketSource(codec);
        output.addVideoTrack(source, { rotation: await track.getRotation() });
        hasVideo = true;
        copies.push(async () => {
          for await (const packet of new EncodedPacketSink(track).packets()) {
            await source.add(packet, { decoderConfig });
          }
          source.close();
        });
      } else if (track.isAudioTrack()) {
        const codec = await track.getCodec();
        const decoderConfig = await track.getDecoderConfig();
        if (!codec || !decoderConfig || !format.getSupportedAudioCodecs().includes(codec)) {
          throw new Error('Videonun sarma bilgileri hazırlanamadı: ses biçimi desteklenmiyor.');
        }
        const source = new EncodedAudioPacketSource(codec);
        output.addAudioTrack(source);
        copies.push(async () => {
          for await (const packet of new EncodedPacketSink(track).packets()) {
            await source.add(packet, { decoderConfig });
          }
          source.close();
        });
      } else {
        throw new Error('Videodaki bir iz korunamadığı için indirme hazırlanamadı.');
      }
    }
    if (!hasVideo) throw new Error('İndirilecek dosyada görüntü bulunamadı.');
    await output.start();
    await Promise.all(copies.map(copy => copy()));
    await output.finalize();
    if (!target.buffer?.byteLength) throw new Error('Video dosyası boş oluşturuldu. Tekrar dene.');
    return new Blob([target.buffer], { type: format.mimeType });
  } catch (error) {
    await output?.cancel().catch(() => {});
    throw error;
  } finally {
    input.dispose();
  }
}
