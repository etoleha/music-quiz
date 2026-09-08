export type ClipPlayer = {
  loadVideoById(options: { videoId: string; startSeconds: number }): void;
  getCurrentTime(): number;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(volume: number): void;
};

type AudioEvents = { playing(): void; ended(): void; error(code: number): void; blocked(): void };

/** Exposes source-relative time so the existing quiz clock also works with a cut file. */
export function createClipAudioPlayer(url: string, sourceStart: number, events: AudioEvents, createAudio: () => HTMLAudioElement = () => new Audio()) {
  let audio: HTMLAudioElement | null = null;
  let generation = 0;
  const stop = () => {
    generation += 1;
    if (!audio) return;
    audio.onplaying = audio.onended = audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio = null;
  };
  const player: ClipPlayer & { dispose(): void } = {
    loadVideoById({ startSeconds }) {
      stop();
      const token = generation;
      const next = createAudio();
      audio = next;
      next.preload = "auto";
      next.src = url;
      next.volume = 1; // The delivered fragment is already normalized.
      next.currentTime = Math.max(0, startSeconds - sourceStart);
      const isCurrent = () => generation === token && audio === next;
      next.onplaying = () => { if (isCurrent()) events.playing(); };
      next.onended = () => { if (isCurrent()) events.ended(); };
      next.onerror = () => { if (isCurrent()) events.error(next.error?.code ?? 0); };
      void next.play().catch((error: unknown) => {
        if (!isCurrent()) return;
        if (error instanceof Error && error.name === "NotAllowedError") events.blocked();
        else if (!(error instanceof Error && error.name === "AbortError")) events.error(next.error?.code ?? 0);
      });
    },
    getCurrentTime: () => sourceStart + (audio?.currentTime ?? 0),
    pauseVideo() { generation += 1; audio?.pause(); },
    stopVideo: stop,
    setVolume() { /* Source-specific iframe gain must not alter normalized audio. */ },
    dispose: stop,
  };
  return player;
}
