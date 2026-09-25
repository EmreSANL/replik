import type { Cue } from './scenes';

const BACKGROUND_LEVEL = 0.55;
const BACKGROUND_UNDER_VOICE = 0.25;
const FADE_DOWN_SECONDS = 0.05;
const FADE_UP_SECONDS = 0.15;

/** Lower only the backing track while a recorded line is playing. */
export function scheduleBackgroundDucking(
  gain: AudioParam,
  cues: Pick<Cue, 'start' | 'end'>[],
  now: number,
  late = 0,
): void {
  const regions = cues
    .map((cue) => ({
      start: Math.max(0, cue.start - late),
      end: Math.max(0, cue.end - late),
    }))
    .filter((region) => region.end > region.start)
    .sort((a, b) => a.start - b.start)
    .reduce<{ start: number; end: number }[]>((merged, region) => {
      const previous = merged[merged.length - 1];
      if (previous && region.start <= previous.end + FADE_UP_SECONDS + FADE_DOWN_SECONDS) {
        previous.end = Math.max(previous.end, region.end);
      } else {
        merged.push({ ...region });
      }
      return merged;
    }, []);

  gain.setValueAtTime(regions[0]?.start === 0 ? BACKGROUND_UNDER_VOICE : BACKGROUND_LEVEL, now);
  for (const region of regions) {
    if (region.start > 0) {
      gain.setValueAtTime(BACKGROUND_LEVEL, now + Math.max(0, region.start - FADE_DOWN_SECONDS));
      gain.linearRampToValueAtTime(BACKGROUND_UNDER_VOICE, now + region.start);
    }
    gain.setValueAtTime(BACKGROUND_UNDER_VOICE, now + region.end);
    gain.linearRampToValueAtTime(BACKGROUND_LEVEL, now + region.end + FADE_UP_SECONDS);
  }
}
