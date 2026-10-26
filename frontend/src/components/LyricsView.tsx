import { FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { activeLine, parseLrc, type ParsedLyrics } from "../lrc";
import { usePlayer } from "../player";

const FADE = "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)";

/** Lyrics for the current track; LRC scrolls with playback, plain text is shown as is. */
export function LyricsView({ onAddLyrics }: { onAddLyrics(trackId: number): void }) {
  const p = usePlayer();
  const trackId = p.current?.id;
  const [state, setState] = useState<{ id: number; lyrics: ParsedLyrics | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const userScrollUntil = useRef(0);

  useEffect(() => {
    if (trackId == null) return;
    let alive = true;
    setState(null);
    api.lyrics(trackId)
      .then((l) => alive && setState({ id: trackId, lyrics: l.content ? parseLrc(l.content) : null }))
      .catch(() => alive && setState({ id: trackId, lyrics: null }));
    return () => { alive = false; };
  }, [trackId]);

  const lyrics = state && state.id === trackId ? state.lyrics : null;
  const current = useMemo(
    () => (lyrics?.synced ? activeLine(lyrics.lines, p.time + 0.15) : -1),
    [lyrics, p.time],
  );

  // keep the sung line centred, unless the listener scrolled by hand in the last few seconds
  useEffect(() => {
    const el = lineRefs.current[current];
    const c = box.current;
    if (!el || !c || Date.now() < userScrollUntil.current) return;
    c.scrollTo({ top: el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [current]);

  // jump back to the top when the song changes
  useEffect(() => {
    box.current?.scrollTo({ top: 0 });
    userScrollUntil.current = 0;
  }, [trackId]);

  if (!p.current) return null;
  if (state?.id !== trackId) return <p className="px-6 py-10 text-sm text-ash">载入歌词…</p>;

  if (!lyrics || !lyrics.lines.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
        <FileText className="w-8 h-8 text-ash/50" strokeWidth={1.25} />
        <p className="text-sm text-ash leading-relaxed">这首歌还没有歌词。<br />可以粘贴 LRC 歌词或导入 .lrc 文件。</p>
        <button
          type="button"
          onClick={() => onAddLyrics(p.current!.id)}
          className="text-sm text-walnut-light hover:underline underline-offset-4"
        >
          添加歌词
        </button>
      </div>
    );
  }

  const markUserScroll = () => { userScrollUntil.current = Date.now() + 4000; };

  return (
    <div
      ref={box}
      onWheel={markUserScroll}
      onTouchMove={markUserScroll}
      className="relative h-full overflow-y-auto px-6 md:px-8 [scrollbar-width:none]"
      style={{ maskImage: FADE, WebkitMaskImage: FADE }}
    >
      <div style={{ height: lyrics.synced ? "38%" : "6%" }} />
      {lyrics.lines.map((line, i) => {
        const active = i === current;
        if (!line.text) return <div key={i} className="h-5" />;
        return (
          <button
            key={i}
            type="button"
            ref={(el) => { lineRefs.current[i] = el; }}
            disabled={!lyrics.synced}
            onClick={() => {
              if (line.time == null) return;
              userScrollUntil.current = 0;
              p.seek(line.time);
            }}
            className={`block w-full text-left py-2 leading-snug transition-all duration-300 origin-left ${
              lyrics.synced ? "cursor-pointer hover:text-mist" : "cursor-default"
            } ${
              active
                ? "text-bone text-xl md:text-2xl font-medium"
                : lyrics.synced
                  ? `text-lg md:text-xl ${i < current ? "text-ash/45" : "text-ash/70"}`
                  : "text-base md:text-lg text-mist"
            }`}
          >
            {line.text}
          </button>
        );
      })}
      <div style={{ height: lyrics.synced ? "50%" : "6%" }} />
      {!lyrics.synced && <p className="pb-8 text-xs text-ash/60">普通歌词没有时间点，不会随播放滚动。</p>}
    </div>
  );
}
