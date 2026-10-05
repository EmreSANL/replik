/** Listen to the player's take while holding the cue's opening frame. */
export async function startSegmentReplay(video: HTMLVideoElement, audio: HTMLAudioElement): Promise<void> {
  video.pause();
  video.muted = true;
  try {
    await audio.play();
  } catch (error) {
    video.pause();
    audio.pause();
    throw error;
  }
}

/** Only the voice recording's clock determines when listening finishes. */
export function segmentReplayFinished(audio: HTMLAudioElement, duration: number): boolean {
  return audio.ended || audio.currentTime >= duration;
}
