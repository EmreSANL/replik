export const MIN_CUE_DURATION = 0.2;

const roundToTenth = (value) => Number(value.toFixed(1));

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Keep a cue inside the video and, when possible, inside the free space between
 * its chronological neighbours on the SAME character track/layer. Existing overlapping data
 * is left editable instead of trapping the user in an impossible range.
 */
export function adjustCueTiming(
  cues,
  cueId,
  type,
  initialStart,
  initialEnd,
  delta,
  duration,
) {
  const currentCue = cues.find((c) => c.id === cueId);
  const targetRole = currentCue?.roleIndex;

  // Filter cues on the same character track layer
  const sameTrackCues = targetRole !== undefined
    ? cues.filter((c) => c.roleIndex === targetRole)
    : cues;

  const safeDuration = Math.max(MIN_CUE_DURATION, duration);
  const length = Math.max(MIN_CUE_DURATION, initialEnd - initialStart);
  const chronological = [...sameTrackCues].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const index = chronological.findIndex((cue) => cue.id === cueId);
  const previous = index > 0 ? chronological[index - 1] : undefined;
  const next =
    index >= 0 && index < chronological.length - 1
      ? chronological[index + 1]
      : undefined;

  const previousEnd = previous?.end ?? 0;
  const nextStart = next?.start ?? safeDuration;
  const lowerBound =
    previousEnd <= initialEnd - MIN_CUE_DURATION ? previousEnd : 0;
  const upperBound =
    nextStart >= initialStart + MIN_CUE_DURATION ? nextStart : safeDuration;

  if (type === 'start') {
    const start = roundToTenth(
      clamp(
        initialStart + delta,
        lowerBound,
        Math.max(lowerBound, initialEnd - MIN_CUE_DURATION),
      ),
    );
    return { start, end: roundToTenth(initialEnd) };
  }

  if (type === 'end') {
    const end = roundToTenth(
      clamp(
        initialEnd + delta,
        Math.min(upperBound, initialStart + MIN_CUE_DURATION),
        upperBound,
      ),
    );
    return { start: roundToTenth(initialStart), end };
  }

  const moveLowerBound = nextStart - previousEnd >= length ? previousEnd : 0;
  const moveUpperBound =
    nextStart - previousEnd >= length ? nextStart : safeDuration;
  const maxStart = Math.max(moveLowerBound, moveUpperBound - length);
  const start = roundToTenth(
    clamp(initialStart + delta, moveLowerBound, maxStart),
  );
  return { start, end: roundToTenth(start + length) };
}

export function hasCueOverlap(cues, cueId) {
  const cue = cues.find((item) => item.id === cueId);
  if (!cue) return false;
  return cues.some(
    (item) =>
      item.id !== cueId &&
      (cue.roleIndex === undefined || item.roleIndex === cue.roleIndex) &&
      cue.start < item.end &&
      cue.end > item.start,
  );
}

