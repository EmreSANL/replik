/** Recording time advances independently of the deliberately paused scene. */
export function segmentRecordingProgress(start: number, end: number, elapsed: number) {
  const duration = Math.max(0.25, end - start);
  const seconds = Math.max(0, elapsed);
  return {
    position: Math.min(end, start + seconds),
    fraction: Math.min(1, seconds / duration),
    complete: seconds >= duration,
  };
}
