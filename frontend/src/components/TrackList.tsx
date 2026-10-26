import { AlertTriangle, Heart, Layers, MoreHorizontal, Play } from "lucide-react";
import { formatTime, playbackType, qualityLabel, type Track } from "../api";
import { usePlayer } from "../player";
import { Cover, IconButton } from "./ui";

const probe = typeof document !== "undefined" ? document.createElement("audio") : null;
const playable = (t: Track) => !probe || probe.canPlayType(playbackType(t)) !== "";

export function TrackList({ tracks, onOpen, onFavorite }: {
  tracks: Track[];
  onOpen(t: Track): void;
  onFavorite(t: Track): void;
}) {
  const player = usePlayer();

  if (!tracks.length) return null;

  return (
    <div role="list" className="text-sm">
      <div className="hidden md:grid grid-cols-[2.5rem_minmax(0,2fr)_minmax(0,1.3fr)_8.5rem_2rem_3.5rem_2rem] gap-4 px-3 pb-2 text-[11px] uppercase tracking-[0.14em] text-ash border-b border-line/70">
        <span className="text-right">#</span>
        <span>标题</span>
        <span>专辑</span>
        <span>音质</span>
        <span />
        <span className="text-right">时长</span>
        <span />
      </div>
      {tracks.map((t, i) => {
        const isCurrent = player.current?.id === t.id;
        const canPlay = playable(t) && !t.file_missing;
        return (
          <div
            role="listitem"
            key={t.id}
            onDoubleClick={() => player.playQueue(tracks, i)}
            className={`group grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] md:grid-cols-[2.5rem_minmax(0,2fr)_minmax(0,1.3fr)_8.5rem_2rem_3.5rem_2rem] items-center gap-3 md:gap-4 px-2 md:px-3 py-2 rounded-md transition-colors hover:bg-smoke/70 ${isCurrent ? "bg-smoke/50" : ""}`}
          >
            <button
              type="button"
              aria-label={`播放 ${t.title}`}
              onClick={() => player.playQueue(tracks, i)}
              className="relative h-8 grid place-items-center md:justify-items-end text-ash tabular-nums"
            >
              {isCurrent ? (
                <span className={`eq flex items-end h-3 ${player.playing ? "" : "paused"}`}><span /><span /><span /></span>
              ) : (
                <>
                  <span className="group-hover:opacity-0 transition-opacity">{i + 1}</span>
                  <Play className="absolute w-3.5 h-3.5 opacity-0 group-hover:opacity-100 fill-bone text-bone" />
                </>
              )}
            </button>

            <button type="button" onClick={() => player.playQueue(tracks, i)} className="flex items-center gap-3 min-w-0 text-left">
              <Cover track={t} className="w-10 h-10 shrink-0" rounded="rounded" />
              <span className="min-w-0">
                <span className={`flex items-center gap-1.5 truncate ${isCurrent ? "text-walnut-light" : "text-bone"}`}>
                  <span className="truncate">{t.title}</span>
                  {t.version_count > 1 && (
                    <span title={`同一作品共 ${t.version_count} 个录音版本`} className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-ash border border-line rounded px-1">
                      <Layers className="w-2.5 h-2.5" />{t.version_count}
                    </span>
                  )}
                  {!canPlay && (
                    <span title={t.file_missing ? "文件丢失" : "此浏览器无法播放该格式"}>
                      <AlertTriangle className="shrink-0 w-3.5 h-3.5 text-ember" />
                    </span>
                  )}
                </span>
                <span className="block truncate text-ash text-xs mt-0.5">
                  {[t.artist, t.version_label].filter(Boolean).join(" · ") || "未知艺术家"}
                  <span className="md:hidden">{t.album ? ` — ${t.album}` : ""}</span>
                </span>
              </span>
            </button>

            <span className="hidden md:block truncate text-ash">{t.album ?? "—"}</span>
            <span className="hidden md:block truncate text-[11px] text-ash/80 tracking-wide">{qualityLabel(t)}</span>
            <span className="md:hidden" />

            <IconButton
              label={t.favorite ? "取消收藏" : "收藏"}
              onClick={() => onFavorite(t)}
              className={`hidden md:grid w-8 h-8 ${t.favorite ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
              active={t.favorite}
            >
              <Heart className={`w-4 h-4 ${t.favorite ? "fill-walnut-light" : ""}`} strokeWidth={1.5} />
            </IconButton>
            <span className="hidden md:block text-right text-ash tabular-nums">{formatTime(t.duration)}</span>
            <IconButton label="详情与编辑" onClick={() => onOpen(t)} className="w-8 h-8">
              <MoreHorizontal className="w-4 h-4" />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
