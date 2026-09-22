/** Cancel audio shared equally by the left and right channels of a PCM WAV. */
export function reduceStereoWav(bytes) {
  const input = new DataView(bytes);
  if (bytes.byteLength < 44 || input.getUint32(0, true) !== 0x46464952 || input.getUint32(8, true) !== 0x45564157 || input.getUint16(20, true) !== 1 || input.getUint16(22, true) !== 2 || input.getUint16(34, true) !== 16) {
    throw new Error('Yedek yöntem yalnızca 16 bit stereo WAV seste çalışır. AI ayrıştırmayı yeniden deneyin.');
  }
  const frames = Math.floor((bytes.byteLength - 44) / 4);
  const result = new ArrayBuffer(44 + frames * 4);
  const output = new DataView(result);
  new Uint8Array(result, 0, 44).set(new Uint8Array(bytes, 0, 44));
  output.setUint32(4, 36 + frames * 4, true);
  output.setUint32(40, frames * 4, true);
  let sideEnergy = 0;
  let totalEnergy = 0;
  for (let frame = 0; frame < frames; frame++) {
    const offset = 44 + frame * 4;
    const left = input.getInt16(offset, true);
    const right = input.getInt16(offset + 2, true);
    const side = Math.round((left - right) * 0.7);
    output.setInt16(offset, Math.max(-32768, Math.min(32767, side)), true);
    output.setInt16(offset + 2, Math.max(-32768, Math.min(32767, -side)), true);
    sideEnergy += side * side;
    totalEnergy += left * left + right * right;
  }
  if (totalEnergy === 0 || sideEnergy / totalEnergy < 0.002) {
    throw new Error('Stereo kanallarda yeterli fark yok; bu yöntem sesi fazla kısar. AI ayrıştırmayı yeniden deneyin.');
  }
  return result;
}
