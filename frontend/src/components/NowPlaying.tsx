import { ChevronDown, FileText, Heart, ListMusic } from "lucide-react";
import { useEffect, useState } from "react";
import { artworkUrl, formatTime, qualityLabel, type Track } from "../api";
import { usePlayer } from "../player";
import { LyricsView } from "./LyricsView";
import { ModeButton, PlayerError, SeekBar, TransportControls, VolumeControl } from "./PlayerBar";
import { Cover, IconButton } from "./ui";

export function NowPlaying({ onClose, onFavorite, onAddLyrics }: {
  onClose(): void;
  onFavorite(t: Track): void;
  onAddLyrics(trackId: number): void;
}) {
  const p = usePlayer();
  const t = p.current;
  const [panel, setPanel] = useState<"lyrics" | "queue">("lyrics");
  const [mobileSide, setMobileSide] = useState(false); // below lg: side panel replaces the record

  const openPanel = (next: "lyrics" | "queue") => {
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    if (!wide && mobileSide && panel === next) setMobileSide(false);
    else {
      setPanel(next);
      setMobileSide(true);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!t) return null;

  return (
    <div className="fixed inset-0 z-40 bg-ink flex flex-col overflow-hidden" role="dialog" aria-label="正在播放">
      {/* blurred artwork backdrop */}
      {t.has_artwork && (
        <img src={artworkUrl(t.id)} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-25" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/70 to-ink" />

      <header className="relative flex items-center justify-between px-4 md:px-8 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <IconButton label="收起播放页" onClick={onClose} className="w-10 h-10">
          <ChevronDown className="w-5 h-5" />
        </IconButton>
        <span className="text-[11px] uppercase tracking-[0.25em] text-ash">Now Playing</span>
        <div className="flex items-center gap-1">
          <IconButton label="歌词" onClick={() => openPanel("lyrics")} active={panel === "lyrics"} className="w-10 h-10">
            <FileText className="w-5 h-5" />
          </IconButton>
          <IconButton label="播放队列" onClick={() => openPanel("queue")} active={panel === "queue"} className="w-10 h-10">
            <ListMusic className="w-5 h-5" />
          </IconButton>
        </div>
      </header>

      <div className="relative flex-1 min-h-0 flex">
        <div className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-6 md:gap-8 px-6 pb-6 ${mobileSide ? "hidden lg:flex" : ""}`}>
          {/* turntable */}
          <div className="relative w-[min(78vw,46vh,440px)] aspect-square">
            <div className={`vinyl absolute inset-0 spin ${p.playing ? "" : "paused"}`}>
              <div className="absolute inset-[31%] rounded-full overflow-hidden ring-1 ring-black/60">
                <Cover track={t} className="w-full h-full" rounded="rounded-full" />
              </div>
              <div className="absolute left-1/2 top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-1 ring-line" />
            </div>
            {/* tonearm */}
            <div
              aria-hidden
              className="absolute -right-[6%] -top-[4%] w-[8%] aspect-square rounded-full bg-gradient-to-br from-mist to-ash shadow-md"
            />
            <div
              aria-hidden
              className="absolute right-[-2.5%] top-[0%] h-[55%] w-[1.6%] origin-top rounded-full bg-gradient-to-b from-mist via-ash to-ash/80 transition-transform duration-700"
              style={{ transform: `rotate(${p.playing ? 24 : 8}deg)` }}
            />
          </div>

          <div className="w-full max-w-xl text-center">
            <div className="flex items-start justify-center gap-3">
              <h1 className="font-serif text-2xl md:text-3xl text-bone leading-tight">{t.title}</h1>
              <IconButton label={t.favorite ? "取消收藏" : "收藏"} active={t.favorite} onClick={() => onFavorite(t)} className="w-8 h-8 shrink-0 mt-0.5">
                <Heart className={`w-5 h-5 ${t.favorite ? "fill-walnut-light" : ""}`} strokeWidth={1.5} />
              </IconButton>
            </div>
            <p className="mt-2 text-mist">{t.artist ?? "未知艺术家"}</p>
            <p className="mt-1 text-sm text-ash">
              {[t.album, t.release_year, t.version_label].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-3 inline-block text-[10px] uppercase tracking-[0.2em] text-walnut-light/90 border border-walnut/40 rounded-full px-2.5 py-0.5">
              {qualityLabel(t)}
            </p>
          </div>

          <div className="w-full max-w-xl space-y-5">
            <SeekBar />
            <div className="flex items-center justify-between">
              <ModeButton className="w-10 h-10" />
              <TransportControls size="lg" />
              <span className="w-10" />
            </div>
            <div className="hidden md:flex justify-center"><VolumeControl /></div>
          </div>
        </div>

        <aside className={`${mobileSide ? "flex" : "hidden"} lg:flex flex-col w-full lg:w-[30rem] shrink-0 lg:border-l border-line/60 min-h-0`}>
          {mobileSide && (
            <div className="lg:hidden px-6 pb-2">
              <p className="truncate font-serif text-lg text-bone">{t.title}</p>
              <p className="truncate text-sm text-ash">{t.artist ?? "未知艺术家"}</p>
            </div>
          )}
          {panel === "lyrics" ? (
            <div className="flex-1 min-h-0"><LyricsView onAddLyrics={onAddLyrics} /></div>
          ) : (
          <>
          <h2 className="px-5 pt-2 pb-3 text-[11px] uppercase tracking-[0.2em] text-ash">播放队列 · {p.order.length}</h2>
          <ol className="flex-1 overflow-y-auto px-2 pb-6">
            {p.order.map((qi, pos) => {
              const q = p.queue[qi];
              const active = pos === p.queuePos;
              return (
                <li key={`${q.id}-${pos}`}>
                  <button
                    type="button"
                    onClick={() => p.jumpTo(pos)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-smoke/70 ${active ? "bg-smoke/60" : ""}`}
                  >
                    <Cover track={q} className="w-9 h-9 shrink-0" rounded="rounded" />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${active ? "text-walnut-light" : "text-bone"}`}>{q.title}</span>
                      <span className="block truncate text-xs text-ash">{q.artist}</span>
                    </span>
                    <span className="text-xs text-ash tabular-nums">{formatTime(q.duration)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          </>
          )}
          {mobileSide && (
            <div className="lg:hidden px-6 pt-3 pb-5 space-y-4 border-t border-line/50">
              <SeekBar />
              <div className="flex items-center justify-between">
                <ModeButton className="w-10 h-10" />
                <TransportControls />
                <span className="w-10" />
              </div>
            </div>
          )}
        </aside>
      </div>
      <div className="relative pb-safe"><PlayerError /></div>
    </div>
  );
}
