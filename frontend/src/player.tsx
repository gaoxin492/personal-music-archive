import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { artworkUrl, playbackType, streamUrl, type Track } from "./api";

export type PlayMode = "sequence" | "repeat-all" | "repeat-one" | "shuffle";

interface PlayerApi {
  queue: Track[];
  current: Track | null;
  queuePos: number;
  order: number[];
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  mode: PlayMode;
  error: string | null;
  playQueue(tracks: Track[], start?: number, opts?: { shuffle?: boolean }): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(t: number): void;
  setVolume(v: number): void;
  setMode(m: PlayMode): void;
  jumpTo(orderPos: number): void;
  patchTrack(t: Partial<Track> & { id: number }): void;
  dismissError(): void;
}

const Ctx = createContext<PlayerApi | null>(null);

export const usePlayer = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayer outside PlayerProvider");
  return ctx;
};

function shuffled(n: number, first: number): number[] {
  const rest = [...Array(n).keys()].filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 && first < n ? [first, ...rest] : rest;
}

function readVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem("archive.volume") ?? "");
    return isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  } catch {
    return 0.8;
  }
}

function readMode(): PlayMode {
  try {
    const m = localStorage.getItem("archive.mode");
    if (m === "sequence" || m === "repeat-all" || m === "repeat-one" || m === "shuffle") return m;
  } catch {
    /* storage unavailable */
  }
  return "sequence";
}

const MEDIA_ERRORS: Record<number, string> = {
  1: "播放被中断",
  2: "网络错误，无法读取音频",
  3: "音频解码失败（文件可能损坏，或浏览器不支持此编码）",
  4: "浏览器不支持此音频格式，或文件无法访问",
};

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [pos, setPos] = useState(-1);
  const [loadNonce, setLoadNonce] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(readVolume);
  const [mode, setModeState] = useState<PlayMode>(readMode);
  const [error, setError] = useState<string | null>(null);
  const autoplay = useRef(false);

  const current = pos >= 0 && order[pos] != null ? queue[order[pos]] ?? null : null;

  const goTo = useCallback((p: number, play = true) => {
    autoplay.current = play;
    setPos(p);
    setLoadNonce((n) => n + 1);
  }, []);

  // Load the current track whenever it changes (or is explicitly re-requested).
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    if (!current) {
      a.removeAttribute("src");
      a.load();
      return;
    }
    setTime(0);
    setDuration(current.duration ?? 0);
    const stop = (msg: string) => {
      a.pause();
      a.removeAttribute("src");
      a.load();
      setPlaying(false);
      setError(msg);
    };
    if (current.file_missing) {
      stop(`《${current.title}》的音频文件丢失：${current.file_path}`);
      return;
    }
    if (a.canPlayType(playbackType(current)) === "") {
      stop(
        `当前浏览器无法播放《${current.title}》（${current.audio_format}${current.codec ? " / " + current.codec : ""}）。` +
          `原文件仍完整保存在曲库中；可换用其他浏览器，或在后续版本为它生成兼容的播放缓存。`,
      );
      return;
    }
    setError(null);
    a.src = streamUrl(current.id);
    if (autoplay.current) {
      a.play().catch((e: DOMException) => {
        if (e.name === "NotAllowedError") setPlaying(false); // autoplay blocked: wait for a tap
        else if (e.name !== "AbortError") setError(`无法播放《${current.title}》：${e.message}`);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, loadNonce]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
    try {
      localStorage.setItem("archive.volume", String(volume));
    } catch {
      /* ignore */
    }
  }, [volume]);

  const playQueue = useCallback<PlayerApi["playQueue"]>((tracks, start = 0, opts) => {
    if (!tracks.length) return;
    const shuffle = opts?.shuffle ?? mode === "shuffle";
    if (opts?.shuffle) setModeState("shuffle");
    const first = opts?.shuffle ? Math.floor(Math.random() * tracks.length) : start;
    setQueue(tracks);
    setOrder(shuffle ? shuffled(tracks.length, first) : [...tracks.keys()]);
    goTo(shuffle ? 0 : start);
  }, [goTo, mode]);

  const advance = useCallback((auto: boolean) => {
    const a = audio.current;
    if (!order.length || !a) return;
    if (auto && mode === "repeat-one") {
      a.currentTime = 0;
      void a.play();
      return;
    }
    let np = pos + 1;
    if (np >= order.length) {
      if (mode === "sequence" && auto) {
        setPlaying(false);
        return; // end of queue
      }
      if (mode === "shuffle") setOrder(shuffled(queue.length, -1));
      np = 0;
    }
    goTo(np);
  }, [order, pos, mode, queue.length, goTo]);

  const next = useCallback(() => advance(false), [advance]);

  const prev = useCallback(() => {
    const a = audio.current;
    if (a && a.currentTime > 3) {
      a.currentTime = 0;
      return;
    }
    if (pos > 0) goTo(pos - 1);
    else if (mode === "repeat-all" && order.length) goTo(order.length - 1);
    else if (a) a.currentTime = 0;
  }, [pos, mode, order.length, goTo]);

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a || !current || error) return;
    if (a.paused) {
      if (!a.src) goTo(pos);
      else void a.play().catch(() => setPlaying(false));
    } else a.pause();
  }, [current, error, pos, goTo]);

  const seek = useCallback((t: number) => {
    const a = audio.current;
    if (a && isFinite(t)) {
      a.currentTime = t;
      setTime(t);
    }
  }, []);

  const setMode = useCallback((m: PlayMode) => {
    setModeState(m);
    try {
      localStorage.setItem("archive.mode", m);
    } catch {
      /* ignore */
    }
    // Keep the current track in place while rebuilding the play order.
    const curIndex = order[pos];
    if (curIndex == null) return;
    if (m === "shuffle") {
      setOrder(shuffled(queue.length, curIndex));
      setPos(0);
    } else if (mode === "shuffle") {
      setOrder([...queue.keys()]);
      setPos(curIndex);
    }
  }, [order, pos, queue, mode]);

  const patchTrack = useCallback((t: Partial<Track> & { id: number }) => {
    setQueue((q) => q.map((x) => (x.id === t.id ? { ...x, ...t } : x)));
  }, []);

  // Lock-screen / hardware media keys where the platform supports the Media Session API.
  const handlers = useRef({ toggle, next, prev, seek });
  handlers.current = { toggle, next, prev, seek };
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* action unsupported on this platform */
      }
    };
    set("play", () => handlers.current.toggle());
    set("pause", () => handlers.current.toggle());
    set("nexttrack", () => handlers.current.next());
    set("previoustrack", () => handlers.current.prev());
    set("seekto", (d) => d.seekTime != null && handlers.current.seek(d.seekTime));
  }, []);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist ?? "",
      album: current.album ?? "",
      artwork: current.has_artwork ? [{ src: new URL(artworkUrl(current.id), location.href).href, sizes: "600x600" }] : [],
    });
  }, [current]);

  const value = useMemo<PlayerApi>(() => ({
    queue, current, queuePos: pos, order, playing, time, duration, volume, mode, error,
    playQueue, toggle, next, prev, seek, setVolume: setVolumeState, setMode,
    jumpTo: (p) => goTo(p), patchTrack, dismissError: () => setError(null),
  }), [queue, current, pos, order, playing, time, duration, volume, mode, error, playQueue, toggle, next, prev, seek, setMode, goTo, patchTrack]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio
        ref={audio}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onEnded={() => advance(true)}
        onError={(e) => {
          const el = e.currentTarget;
          if (!el.getAttribute("src") || !current) return;
          setPlaying(false);
          setError(`《${current.title}》${MEDIA_ERRORS[el.error?.code ?? 0] ?? "播放出错"}`);
        }}
      />
    </Ctx.Provider>
  );
}
