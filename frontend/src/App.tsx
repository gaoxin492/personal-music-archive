import { Disc3, Heart, Import, Library, Menu, Pencil, Play, Plus, Search, Shuffle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, formatTime, type Collection, type SortKey, type Track } from "./api";
import { CollectionEditor } from "./components/CollectionEditor";
import { ImportView } from "./components/ImportView";
import { NowPlaying } from "./components/NowPlaying";
import { PlayerBar } from "./components/PlayerBar";
import { TrackDetail } from "./components/TrackDetail";
import { TrackList } from "./components/TrackList";
import { Button, CollectionCover, IconButton, themeColor } from "./components/ui";
import { usePlayer } from "./player";

type View = { kind: "library" } | { kind: "favorites" } | { kind: "import" } | { kind: "collection"; id: number };

function parseHash(): View {
  const m = location.hash.match(/^#\/(\w+)(?:\/(\d+))?/);
  if (m?.[1] === "collection" && m[2]) return { kind: "collection", id: +m[2] };
  if (m?.[1] === "favorites") return { kind: "favorites" };
  if (m?.[1] === "import") return { kind: "import" };
  return { kind: "library" };
}
const toHash = (v: View) => (v.kind === "collection" ? `#/collection/${v.id}` : `#/${v.kind}`);

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "", label: "默认顺序" },
  { value: "title", label: "标题" },
  { value: "artist", label: "艺术家" },
  { value: "album", label: "专辑" },
  { value: "added", label: "导入时间" },
  { value: "year", label: "年份" },
  { value: "rating", label: "喜欢程度" },
  { value: "duration", label: "时长" },
];

export default function App() {
  const player = usePlayer();
  const [view, setView] = useState<View>(parseHash);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<SortKey>("");
  const [desc, setDesc] = useState(false);
  const [reload, setReload] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailFocus, setDetailFocus] = useState<"lyrics" | undefined>();
  const [nowPlaying, setNowPlaying] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [editor, setEditor] = useState<{ collection: Collection | null; kind: Collection["kind"] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const go = (v: View) => {
    setView(v);
    setNavOpen(false);
    setSort("");
    history.pushState(null, "", toHash(v));
  };
  useEffect(() => {
    const onPop = () => setView(parseHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(id);
  }, [q]);

  const refreshCollections = useCallback(() => {
    api.collections().then(setCollections).catch((e) => notify(e.message));
  }, [notify]);
  useEffect(refreshCollections, [refreshCollections, reload]);

  useEffect(() => {
    if (view.kind === "import") return;
    let alive = true;
    setLoading(true);
    api
      .tracks({
        q: debouncedQ,
        collection_id: view.kind === "collection" ? view.id : undefined,
        favorite: view.kind === "favorites",
        sort,
        desc,
      })
      .then((t) => alive && setTracks(t))
      .catch((e) => alive && notify(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [view, debouncedQ, sort, desc, reload, notify]);

  // Space toggles playback unless typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== "Space" || el.closest("input, textarea, select, button, [contenteditable]")) return;
      e.preventDefault();
      player.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const toggleFavorite = useCallback(async (t: Track) => {
    try {
      const u = await api.updateNote(t.id, { favorite: !t.favorite });
      setTracks((list) => list.map((x) => (x.id === u.id ? { ...x, favorite: u.favorite } : x)));
      player.patchTrack({ id: u.id, favorite: u.favorite });
    } catch (e) {
      notify((e as Error).message);
    }
  }, [player, notify]);

  const onTrackChanged = useCallback((t?: Partial<Track> & { id: number }) => {
    if (t) {
      setTracks((list) => list.map((x) => (x.id === t.id ? { ...x, ...t } : x)));
      player.patchTrack(t);
    }
    if (!t || "collection_ids" in t) setReload((n) => n + 1);
  }, [player]);

  const active = view.kind === "collection" ? collections.find((c) => c.id === view.id) ?? null : null;
  const mainCollections = collections.filter((c) => c.kind === "collection");
  const playlists = collections.filter((c) => c.kind === "playlist");
  const totalDuration = useMemo(() => tracks.reduce((s, t) => s + (t.duration ?? 0), 0), [tracks]);

  const heading =
    view.kind === "favorites" ? { eyebrow: "Favorites", title: "我的收藏", sub: "标记为喜欢的单曲" } :
    { eyebrow: "Library", title: "全部曲目", sub: "曲库中的所有录音" };

  const navItem = (v: View, label: string, Icon: typeof Library) => {
    const on = toHash(v) === toHash(view);
    return (
      <button
        type="button"
        onClick={() => go(v)}
        className={`w-full flex items-center gap-3 px-3 h-9 rounded-md text-sm transition-colors ${on ? "bg-smoke text-bone" : "text-mist hover:text-bone"}`}
      >
        <Icon className="w-4 h-4" strokeWidth={1.5} />{label}
      </button>
    );
  };

  const collectionItem = (c: Collection) => {
    const on = view.kind === "collection" && view.id === c.id;
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => go({ kind: "collection", id: c.id })}
        className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left transition-colors ${on ? "bg-smoke" : "hover:bg-smoke/50"}`}
      >
        <CollectionCover c={c} className="w-10 h-10 rounded text-base shrink-0" />
        <span className="min-w-0">
          <span className={`block truncate text-sm ${on ? "text-bone" : "text-mist"}`}>{c.name}</span>
          <span className="block truncate text-xs text-ash">{c.subtitle ?? `${c.track_count} 首`}</span>
        </span>
      </button>
    );
  };

  const sidebar = (
    <nav className="flex flex-col h-full w-72 md:w-64 bg-coal md:bg-transparent border-r border-line/70 overflow-y-auto">
      <div className="flex items-center justify-between px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6">
        <div className="flex items-center gap-2.5">
          <Disc3 className="w-6 h-6 text-walnut-light" strokeWidth={1.25} />
          <div>
            <p className="font-serif text-lg leading-none">Music Archive</p>
            <p className="text-[10px] tracking-[0.3em] text-ash mt-1">私人音乐档案馆</p>
          </div>
        </div>
        <IconButton label="关闭菜单" onClick={() => setNavOpen(false)} className="md:hidden w-8 h-8"><X className="w-4 h-4" /></IconButton>
      </div>
      <div className="px-3 space-y-0.5">
        {navItem({ kind: "library" }, "全部曲目", Library)}
        {navItem({ kind: "favorites" }, "我的收藏", Heart)}
        {navItem({ kind: "import" }, "导入与备份", Import)}
      </div>
      <p className="px-5 mt-7 mb-2 text-[10px] uppercase tracking-[0.25em] text-ash">收藏馆</p>
      <div className="px-3 space-y-0.5">{mainCollections.map(collectionItem)}</div>
      <div className="flex items-center justify-between px-5 mt-7 mb-2">
        <p className="text-[10px] uppercase tracking-[0.25em] text-ash">歌单</p>
        <IconButton label="新建歌单" onClick={() => setEditor({ collection: null, kind: "playlist" })} className="w-6 h-6"><Plus className="w-3.5 h-3.5" /></IconButton>
      </div>
      <div className="px-3 space-y-0.5 pb-6">
        {playlists.map(collectionItem)}
        {!playlists.length && (
          <button type="button" onClick={() => setEditor({ collection: null, kind: "playlist" })} className="px-2 text-xs text-ash hover:text-mist">
            + 新建第一个歌单
          </button>
        )}
      </div>
      <button type="button" onClick={() => setEditor({ collection: null, kind: "collection" })} className="mt-auto mx-5 mb-6 text-left text-xs text-ash hover:text-mist">
        + 新建收藏馆
      </button>
    </nav>
  );

  const moodStyle = { "--mood": themeColor(active?.theme) } as CSSProperties;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        <aside className="hidden md:block shrink-0">{sidebar}</aside>
        {navOpen && (
          <div className="md:hidden fixed inset-0 z-30 flex">
            <div className="relative z-10 h-full">{sidebar}</div>
            <button type="button" aria-label="关闭菜单" className="flex-1 bg-black/60" onClick={() => setNavOpen(false)} />
          </div>
        )}

        <main className="flex-1 min-w-0 overflow-y-auto" style={moodStyle}>
          <div className="md:hidden sticky top-0 z-20 flex items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 bg-ink/90 backdrop-blur">
            <IconButton label="打开菜单" onClick={() => setNavOpen(true)} className="w-10 h-10"><Menu className="w-5 h-5" /></IconButton>
            <span className="font-serif">Music Archive</span>
          </div>

          {view.kind === "import" ? (
            <ImportView onImported={() => setReload((n) => n + 1)} onNotify={notify} />
          ) : (
            <>
              {active ? (
                <header
                  className="relative px-4 md:px-10 pt-8 md:pt-14 pb-8"
                  style={{ background: "linear-gradient(to bottom, color-mix(in oklab, var(--mood) 55%, transparent), transparent)" }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-end gap-6 md:gap-8">
                    <CollectionCover c={active} className="w-44 h-44 md:w-56 md:h-56 rounded-lg shadow-2xl shadow-black/60 text-6xl shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.3em] text-mist/80">{active.kind === "collection" ? "Collection" : "Playlist"}</p>
                      <h1 className="font-serif text-4xl md:text-6xl mt-2 leading-none">{active.name}</h1>
                      {active.subtitle && <p className="mt-3 text-mist">{active.subtitle}</p>}
                      {active.description && <p className="mt-3 text-sm text-ash max-w-2xl whitespace-pre-line leading-relaxed">{active.description}</p>}
                      <p className="mt-3 text-xs text-ash">{active.track_count} 首 · {formatTime(active.total_duration)}</p>
                    </div>
                  </div>
                </header>
              ) : (
                <header className="px-4 md:px-10 pt-8 md:pt-14 pb-6">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-ash">{heading.eyebrow}</p>
                  <h1 className="font-serif text-4xl md:text-5xl mt-2">{heading.title}</h1>
                  <p className="mt-2 text-sm text-ash">{heading.sub} · {tracks.length} 首 · {formatTime(totalDuration)}</p>
                </header>
              )}

              <div className="px-4 md:px-10 flex flex-wrap items-center gap-3 pb-4">
                <button
                  type="button"
                  aria-label="播放全部"
                  disabled={!tracks.length}
                  onClick={() => player.playQueue(tracks, 0, { shuffle: false })}
                  className="w-12 h-12 rounded-full bg-walnut-light text-ink grid place-items-center hover:scale-105 transition-transform disabled:opacity-30 shadow-lg shadow-black/40"
                >
                  <Play className="w-5 h-5 ml-0.5 fill-current" />
                </button>
                <IconButton label="随机播放" disabled={!tracks.length} onClick={() => player.playQueue(tracks, 0, { shuffle: true })} className="w-10 h-10 border border-line">
                  <Shuffle className="w-4 h-4" />
                </IconButton>
                {active && (
                  <IconButton label="编辑" onClick={() => setEditor({ collection: active, kind: active.kind })} className="w-10 h-10 border border-line">
                    <Pencil className="w-4 h-4" />
                  </IconButton>
                )}
                <div className="flex-1" />
                <label className="relative w-full sm:w-64 order-last sm:order-none">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ash" />
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜索标题、艺术家、备注…"
                    aria-label="搜索"
                    className="w-full h-10 bg-coal border border-line rounded-full pl-9 pr-4 text-sm placeholder:text-ash/60 focus:outline-none focus:border-walnut-light/60"
                  />
                </label>
                <select
                  value={sort}
                  aria-label="排序"
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="h-10 bg-coal border border-line rounded-full px-4 text-sm text-mist focus:outline-none"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value === "" && active ? "收藏顺序" : o.value === "" ? "最近导入" : o.label}
                    </option>
                  ))}
                </select>
                <IconButton label={desc ? "降序" : "升序"} onClick={() => setDesc((d) => !d)} className="w-10 h-10 border border-line text-xs">
                  {desc ? "↓" : "↑"}
                </IconButton>
              </div>

              <div className="px-2 md:px-7 pb-16">
                {loading && !tracks.length ? (
                  <p className="px-3 py-10 text-ash text-sm">载入中…</p>
                ) : tracks.length ? (
                  <TrackList tracks={tracks} onOpen={(t) => setDetailId(t.id)} onFavorite={toggleFavorite} />
                ) : (
                  <EmptyState view={view} hasQuery={!!debouncedQ} onImport={() => go({ kind: "import" })} onLibrary={() => go({ kind: "library" })} />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <PlayerBar onExpand={() => setNowPlaying(true)} />

      {nowPlaying && (
        <NowPlaying
          onClose={() => setNowPlaying(false)}
          onFavorite={toggleFavorite}
          onAddLyrics={(id) => {
            setNowPlaying(false);
            setDetailFocus("lyrics");
            setDetailId(id);
          }}
        />
      )}
      {detailId != null && (
        <TrackDetail trackId={detailId} focus={detailFocus} collections={collections} onClose={() => { setDetailId(null); setDetailFocus(undefined); }} onChanged={onTrackChanged} onNotify={notify} />
      )}
      {editor && (
        <CollectionEditor
          collection={editor.collection}
          kind={editor.kind}
          onClose={() => setEditor(null)}
          onSaved={(c) => {
            refreshCollections();
            if (!editor.collection) go({ kind: "collection", id: c.id });
          }}
          onDeleted={() => {
            refreshCollections();
            go({ kind: "library" });
          }}
          onNotify={notify}
        />
      )}
      {toast && (
        <div role="status" className="fixed z-[60] left-1/2 -translate-x-1/2 bottom-28 max-w-[calc(100%-2rem)] bg-smoke border border-line text-sm text-bone rounded-full px-5 py-2.5 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function EmptyState({ view, hasQuery, onImport, onLibrary }: { view: View; hasQuery: boolean; onImport(): void; onLibrary(): void }) {
  if (hasQuery) return <p className="px-3 py-10 text-ash text-sm">没有找到匹配的曲目。</p>;
  if (view.kind === "collection") {
    return (
      <div className="px-3 py-12 text-sm text-ash space-y-4 max-w-md">
        <p>这里还没有曲目。在曲目的「详情」面板中可以把它加入这个收藏馆；一首歌可以同时属于多个收藏馆和歌单。</p>
        <Button onClick={onLibrary}>去全部曲目挑选</Button>
      </div>
    );
  }
  if (view.kind === "favorites") return <p className="px-3 py-10 text-ash text-sm">还没有收藏的单曲。点击曲目旁的心形即可收藏。</p>;
  return (
    <div className="px-3 py-12 text-sm text-ash space-y-4 max-w-md">
      <p>曲库还是空的。导入你合法拥有的音频文件开始建立档案。</p>
      <Button variant="primary" onClick={onImport}>导入音乐</Button>
    </div>
  );
}
