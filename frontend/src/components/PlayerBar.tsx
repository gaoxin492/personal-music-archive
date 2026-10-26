import { AlertTriangle, ChevronUp, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { formatTime } from "../api";
import { usePlayer, type PlayMode } from "../player";
import { Cover, IconButton } from "./ui";

const MODES: { mode: PlayMode; label: string }[] = [
  { mode: "sequence", label: "顺序播放" },
  { mode: "repeat-all", label: "列表循环" },
  { mode: "repeat-one", label: "单曲循环" },
  { mode: "shuffle", label: "随机播放" },
];

export function ModeButton({ className = "w-9 h-9" }: { className?: string }) {
  const p = usePlayer();
  const idx = MODES.findIndex((m) => m.mode === p.mode);
  const nextMode = MODES[(idx + 1) % MODES.length];
  const Icon = p.mode === "repeat-one" ? Repeat1 : p.mode === "shuffle" ? Shuffle : Repeat;
  return (
    <IconButton
      label={`${MODES[idx].label}（点击切换为${nextMode.label}）`}
      active={p.mode !== "sequence"}
      onClick={() => p.setMode(nextMode.mode)}
      className={className}
    >
      <Icon className="w-4 h-4" />
    </IconButton>
  );
}

export function SeekBar({ className = "" }: { className?: string }) {
  const p = usePlayer();
  const dur = p.duration || p.current?.duration || 0;
  const pct = dur ? (p.time / dur) * 100 : 0;
  return (
    <div className={`flex items-center gap-3 text-[11px] text-ash tabular-nums ${className}`}>
      <span className="w-10 text-right">{formatTime(p.time)}</span>
      <input
        type="range"
        className="seek flex-1"
        aria-label="播放进度"
        min={0}
        max={dur || 1}
        step={0.1}
        value={p.time}
        disabled={!p.current}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={(e) => p.seek(parseFloat(e.target.value))}
      />
      <span className="w-10">{formatTime(dur)}</span>
    </div>
  );
}

export function TransportControls({ size = "md" }: { size?: "md" | "lg" }) {
  const p = usePlayer();
  const big = size === "lg";
  return (
    <div className={`flex items-center ${big ? "gap-8" : "gap-4"}`}>
      <IconButton label="上一首" onClick={p.prev} disabled={!p.current} className={big ? "w-12 h-12" : "w-9 h-9"}>
        <SkipBack className={`${big ? "w-6 h-6" : "w-4 h-4"} fill-current`} />
      </IconButton>
      <button
        type="button"
        aria-label={p.playing ? "暂停" : "播放"}
        onClick={p.toggle}
        disabled={!p.current || !!p.error}
        className={`grid place-items-center rounded-full bg-bone text-ink hover:scale-105 transition-transform disabled:opacity-30 ${big ? "w-16 h-16" : "w-9 h-9"}`}
      >
        {p.playing ? <Pause className={`${big ? "w-7 h-7" : "w-4 h-4"} fill-current`} /> : <Play className={`${big ? "w-7 h-7 ml-1" : "w-4 h-4 ml-0.5"} fill-current`} />}
      </button>
      <IconButton label="下一首" onClick={p.next} disabled={!p.current} className={big ? "w-12 h-12" : "w-9 h-9"}>
        <SkipForward className={`${big ? "w-6 h-6" : "w-4 h-4"} fill-current`} />
      </IconButton>
    </div>
  );
}

export function VolumeControl() {
  const p = usePlayer();
  const Icon = p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-2">
      <IconButton label={p.volume === 0 ? "取消静音" : "静音"} onClick={() => p.setVolume(p.volume === 0 ? 0.8 : 0)} className="w-8 h-8">
        <Icon className="w-4 h-4" />
      </IconButton>
      <input
        type="range"
        className="seek w-24"
        aria-label="音量"
        min={0}
        max={1}
        step={0.01}
        value={p.volume}
        style={{ ["--pct" as string]: `${p.volume * 100}%` }}
        onChange={(e) => p.setVolume(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function PlayerError() {
  const p = usePlayer();
  if (!p.error) return null;
  return (
    <div role="alert" className="flex items-start gap-3 px-4 py-2.5 bg-ember/15 border-t border-ember/30 text-sm text-bone">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-ember" />
      <p className="flex-1 leading-relaxed">{p.error}</p>
      {p.queue.length > 1 && (
        <button type="button" onClick={p.next} className="shrink-0 text-walnut-light hover:underline">
          跳到下一首
        </button>
      )}
      <IconButton label="关闭提示" onClick={p.dismissError} className="w-6 h-6 shrink-0">
        <X className="w-3.5 h-3.5" />
      </IconButton>
    </div>
  );
}

export function PlayerBar({ onExpand }: { onExpand(): void }) {
  const p = usePlayer();
  const t = p.current;
  if (!t) return null;
  const dur = p.duration || t.duration || 0;
  return (
    <div className="shrink-0 border-t border-line bg-coal/95 backdrop-blur-xl pb-safe">
      <PlayerError />
      {/* mobile */}
      <div className="md:hidden">
        <div className="h-0.5 bg-line">
          <div className="h-full bg-walnut-light" style={{ width: `${dur ? (p.time / dur) * 100 : 0}%` }} />
        </div>
        <div className="flex items-center gap-3 px-3 py-2">
          <button type="button" onClick={onExpand} className="flex items-center gap-3 min-w-0 flex-1 text-left" aria-label="打开播放页">
            <Cover track={t} className="w-11 h-11 shrink-0" rounded="rounded" />
            <span className="min-w-0">
              <span className="block truncate text-sm text-bone">{t.title}</span>
              <span className="block truncate text-xs text-ash">{t.artist}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label={p.playing ? "暂停" : "播放"}
            onClick={p.toggle}
            disabled={!!p.error}
            className="w-10 h-10 grid place-items-center text-bone disabled:opacity-30"
          >
            {p.playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
          </button>
          <IconButton label="下一首" onClick={p.next} className="w-10 h-10">
            <SkipForward className="w-5 h-5 fill-current" />
          </IconButton>
        </div>
      </div>
      {/* desktop */}
      <div className="hidden md:grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-6 px-5 py-3">
        <button type="button" onClick={onExpand} className="flex items-center gap-3 min-w-0 text-left group" aria-label="打开播放页">
          <Cover track={t} className="w-14 h-14 shrink-0 shadow-lg shadow-black/40" rounded="rounded" />
          <span className="min-w-0">
            <span className="block truncate text-sm text-bone group-hover:underline underline-offset-4 decoration-line">{t.title}</span>
            <span className="block truncate text-xs text-ash mt-0.5">{[t.artist, t.album].filter(Boolean).join(" — ")}</span>
          </span>
        </button>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-3">
            <ModeButton className="w-8 h-8" />
            <TransportControls />
            <span className="w-8" />
          </div>
          <SeekBar className="w-full max-w-xl" />
        </div>
        <div className="flex items-center justify-end gap-3">
          <VolumeControl />
          <IconButton label="打开播放页" onClick={onExpand} className="w-8 h-8">
            <ChevronUp className="w-4 h-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
