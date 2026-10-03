function timed<T>(promise: Promise<T>, ms: number, error: Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (reason) => { clearTimeout(timer); reject(reason); },
    );
  });
}

/** Invoke both browser APIs before yielding the click's user activation. */
export function resumePlaybackAudio(audio: AudioContext, timeoutMs = 3000): Promise<void> {
  return timed(audio.state === 'running' ? Promise.resolve() : audio.resume(), timeoutMs,
    new DOMException('Tarayıcı ses izni bekliyor. İşlem düğmesine tekrar bas.', 'NotAllowedError'));
}

export async function startFinalMedia(
  audio: AudioContext,
  video: HTMLVideoElement,
  userInitiated: boolean,
  timeoutMs = 3000,
): Promise<void> {
  if (!userInitiated && audio.state !== 'running') {
    throw new DOMException('Dublajı başlatmak için oynat düğmesine bas.', 'NotAllowedError');
  }
  video.muted = true;
  const resumed = audio.state === 'running'
    ? Promise.resolve()
    : audio.resume();
  const running = timed(resumed, timeoutMs, new DOMException(
    'Tarayıcı ses izni bekliyor. Dublajı oynat düğmesine tekrar bas.', 'NotAllowedError',
  ));
  // Attach a handler immediately, including if video.play() throws synchronously.
  void running.catch(() => {});
  await Promise.all([
    running,
    timed(Promise.resolve(video.play()), 15000, new Error('Sahne videosu başlatılamadı. Bağlantını kontrol edip tekrar dene.')),
  ]);
  if (audio.state !== 'running') {
    throw new DOMException('Tarayıcı sesi başlatamadı.', 'NotAllowedError');
  }
}

export function isPlaybackPermissionError(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotAllowedError';
}
