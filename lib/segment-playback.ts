/** Replay the scene image with the player's recording as the only voice. */
export async function startSegmentReplay(video: HTMLVideoElement, audio: HTMLAudioElement): Promise<void> {
  video.muted = true;
  try {
    await Promise.all([video.play(), audio.play()]);
  } catch (error) {
    video.pause();
    audio.pause();
    throw error;
  }
}

/** Keep the scene aligned to the recording, including clips with a scene offset. */
export function syncSegmentReplay(video: HTMLVideoElement, audio: HTMLAudioElement, start: number, duration: number): boolean {
  const finished = audio.ended || video.ended || audio.currentTime >= duration;
  const target = start + Math.min(duration, audio.currentTime);
  if (!finished && !video.seeking && Math.abs(video.currentTime - target) > 0.15) {
    video.currentTime = target;
  }
  return finished;
}
