import { Check, FileUp, Heart, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, formatTime, MOOD_SUGGESTIONS, qualityLabel, type Collection, type Track, type TrackDetail as Detail } from "../api";
import { parseLrc, readLyricsFile } from "../lrc";
import { Button, Cover, Field, IconButton, inputCls, Stars } from "./ui";

const META_FIELDS: { key: keyof Track; label: string; type?: "number"; wide?: boolean }[] = [
  { key: "title", label: "标题", wide: true },
  { key: "artist", label: "艺术家 / 歌手" },
  { key: "album", label: "专辑 / 原声" },
  { key: "composer", label: "作曲" },
  { key: "release_year", label: "年份", type: "number" },
  { key: "work", label: "作品（同一作品的不同录音填相同名称）", wide: true },
  { key: "version_label", label: "录音版本，如 1986 Original London Cast" , wide: true },
  { key: "performers", label: "演唱 / 演员" },
  { key: "role", label: "角色（音乐剧）" },
  { key: "track_number", label: "曲序", type: "number" },
  { key: "genre", label: "流派" },
];

export function TrackDetail({ trackId, focus, collections, onClose, onChanged, onNotify }: {
  trackId: number;
  focus?: "lyrics";
  collections: Collection[];
  onClose(): void;
  onChanged(t?: Partial<Track> & { id: number }): void;
  onNotify(msg: string): void;
}) {
  const [t, setT] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [heardAt, setHeardAt] = useState("");
  const [heardCtx, setHeardCtx] = useState("");
  const [moodInput, setMoodInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [savedLyrics, setSavedLyrics] = useState("");
  const [lyricsSource, setLyricsSource] = useState<"manual" | "lrc_file">("manual");
  const lyricsSection = useRef<HTMLElement>(null);
  const lyricsInfo = useMemo(() => {
    if (!lyrics.trim()) return null;
    const parsed = parseLrc(lyrics);
    return parsed.synced
      ? `滚动歌词 · ${parsed.lines.filter((l) => l.text).length} 行带时间点`
      : "普通歌词 · 没有时间点，播放时不会滚动";
  }, [lyrics]);
  const loaded = t != null;
  useEffect(() => {
    if (loaded && focus === "lyrics") lyricsSection.current?.scrollIntoView({ block: "start" });
  }, [loaded, focus]);

  useEffect(() => {
    let alive = true;
    api.track(trackId).then((d) => {
      if (!alive) return;
      setT(d);
      setDraft(Object.fromEntries(META_FIELDS.map((f) => [f.key, d[f.key] == null ? "" : String(d[f.key])])));
      setNote(d.personal_note ?? "");
      setHeardAt(d.first_heard_at ?? "");
      setHeardCtx(d.first_heard_context ?? "");
    }).catch((e) => onNotify(e.message));
    api.lyrics(trackId).then((l) => {
      if (!alive) return;
      setLyrics(l.content ?? "");
      setSavedLyrics(l.content ?? "");
    }).catch(() => {});
    return () => { alive = false; };
  }, [trackId, onNotify]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!t) return <Shell onClose={onClose}><p className="p-6 text-ash">载入中…</p></Shell>;

  const patchNote = async (patch: Parameters<typeof api.updateNote>[1]) => {
    try {
      const updated = await api.updateNote(t.id, patch);
      setT((cur) => (cur ? { ...cur, ...updated } : cur));
      onChanged(updated);
    } catch (e) {
      onNotify((e as Error).message);
    }
  };

  const saveMeta = async (e: FormEvent) => {
    e.preventDefault();
    const patch: Record<string, string | number | null> = {};
    for (const f of META_FIELDS) {
      const v = draft[f.key]?.trim() ?? "";
      const orig = t[f.key] == null ? "" : String(t[f.key]);
      if (v === orig) continue;
      if (f.type === "number") {
        if (v && !/^\d+$/.test(v)) return onNotify(`「${f.label}」需为数字`);
        patch[f.key] = v ? parseInt(v, 10) : null;
      } else patch[f.key] = v || null;
    }
    if ("title" in patch && !patch.title) return onNotify("标题不能为空");
    try {
      if (Object.keys(patch).length) {
        const { file_note, ...updated } = await api.updateTrack(t.id, patch as Partial<Track>);
        setT(updated);
        onChanged(updated);
        if (file_note) onNotify(file_note);
      }
      if (note !== (t.personal_note ?? "") || heardAt !== (t.first_heard_at ?? "") || heardCtx !== (t.first_heard_context ?? "")) {
        await patchNote({ personal_note: note || null, first_heard_at: heardAt || null, first_heard_context: heardCtx || null });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const toggleCollection = async (c: Collection) => {
    const inIt = t.collection_ids.includes(c.id);
    try {
      if (inIt) await api.removeFromCollection(c.id, t.id);
      else await api.addToCollection(c.id, [t.id]);
      const ids = inIt ? t.collection_ids.filter((x) => x !== c.id) : [...t.collection_ids, c.id];
      setT({ ...t, collection_ids: ids });
      onChanged({ id: t.id, collection_ids: ids });
    } catch (e) {
      onNotify((e as Error).message);
    }
  };

  const addMood = (m: string) => {
    const tag = m.trim();
    if (!tag || t.mood_tags.includes(tag)) return;
    void patchNote({ mood_tags: [...t.mood_tags, tag] });
    setMoodInput("");
  };

  const remove = async () => {
    if (!confirm(`从曲库移除《${t.title}》？\n\n音频文件会被移到 MusicArchive/trash/，不会被永久删除；收藏关系和备注会被删除。`)) return;
    try {
      const r = await api.deleteTrack(t.id);
      onChanged();
      onClose();
      if (r.moved_to) onNotify(`已移除，文件已移至 ${r.moved_to}`);
    } catch (e) {
      onNotify((e as Error).message);
    }
  };

  const groups = [
    { title: "收藏馆", items: collections.filter((c) => c.kind === "collection") },
    { title: "歌单", items: collections.filter((c) => c.kind === "playlist") },
  ];

  return (
    <Shell onClose={onClose}>
      <div className="p-5 md:p-6 space-y-7">
        <div className="flex gap-4">
          <Cover track={t} className="w-24 h-24 shrink-0 shadow-xl shadow-black/50" />
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-xl text-bone leading-snug">{t.title}</h2>
            <p className="text-sm text-mist mt-1 truncate">{t.artist}</p>
            <p className="text-xs text-ash mt-2">{qualityLabel(t)} · {formatTime(t.duration)}</p>
            <div className="flex items-center gap-3 mt-3">
              <Stars value={t.rating} onChange={(v) => patchNote({ rating: v })} size={16} />
              <IconButton label={t.favorite ? "取消收藏" : "收藏"} active={t.favorite} onClick={() => patchNote({ favorite: !t.favorite })} className="w-7 h-7">
                <Heart className={`w-4 h-4 ${t.favorite ? "fill-walnut-light" : ""}`} strokeWidth={1.5} />
              </IconButton>
            </div>
          </div>
        </div>

        {t.file_missing && (
          <p className="text-sm text-ember border border-ember/30 bg-ember/10 rounded-md px-3 py-2">音频文件丢失：{t.file_path}</p>
        )}

        <section>
          <h3 className="section-title">加入收藏馆 / 歌单</h3>
          {groups.map((g) => g.items.length > 0 && (
            <div key={g.title} className="flex flex-wrap gap-2 mb-2">
              {g.items.map((c) => {
                const on = t.collection_ids.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCollection(c)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-sm border transition-colors ${on ? "border-walnut-light/70 bg-walnut/25 text-bone" : "border-line text-ash hover:text-bone"}`}
                  >
                    {on && <Check className="w-3.5 h-3.5" />}{c.name}
                  </button>
                );
              })}
            </div>
          ))}
        </section>

        <section>
          <h3 className="section-title">情绪标签</h3>
          <div className="flex flex-wrap gap-2">
            {t.mood_tags.map((m) => (
              <span key={m} className="inline-flex items-center gap-1 rounded-full bg-smoke border border-line pl-3 pr-1 h-7 text-sm text-bone">
                {m}
                <button type="button" aria-label={`移除 ${m}`} onClick={() => patchNote({ mood_tags: t.mood_tags.filter((x) => x !== m) })} className="w-5 h-5 grid place-items-center text-ash hover:text-bone">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              value={moodInput}
              onChange={(e) => setMoodInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addMood(moodInput);
                }
              }}
              placeholder="添加标签…"
              className="bg-transparent border-b border-line focus:border-walnut-light/70 outline-none text-sm px-1 h-7 w-28"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {MOOD_SUGGESTIONS.filter((m) => !t.mood_tags.includes(m)).map((m) => (
              <button key={m} type="button" onClick={() => addMood(m)} className="text-xs text-ash hover:text-bone border border-dashed border-line rounded-full px-2.5 h-6">
                + {m}
              </button>
            ))}
          </div>
        </section>

        <form onSubmit={saveMeta} className="space-y-7">
          <section>
            <h3 className="section-title">私人备注</h3>
            <div className="space-y-3">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="为什么喜欢这首歌…" className={inputCls} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="第一次听到">
                  <input type="date" value={heardAt} onChange={(e) => setHeardAt(e.target.value)} className={inputCls} />
                </Field>
                <Field label="场景">
                  <input value={heardCtx} onChange={(e) => setHeardCtx(e.target.value)} placeholder="深夜的火车上" className={inputCls} />
                </Field>
              </div>
            </div>
          </section>

          <section>
            <h3 className="section-title">元数据 <span className="normal-case tracking-normal text-ash/70">（保存后文件会自动整理为 歌手/专辑/歌名；音频内容不会被改动）</span></h3>
            <div className="grid grid-cols-2 gap-3">
              {META_FIELDS.map((f) => (
                <div key={f.key} className={f.wide ? "col-span-2" : ""}>
                  <Field label={f.label}>
                    <input
                      value={draft[f.key] ?? ""}
                      inputMode={f.type === "number" ? "numeric" : undefined}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      className={inputCls}
                    />
                  </Field>
                </div>
              ))}
            </div>
          </section>

          <div className="flex items-center gap-3 sticky bottom-0 bg-coal py-3 -mx-1 px-1 border-t border-line/60">
            <Button variant="primary" type="submit">{saved ? <><Check className="w-4 h-4" />已保存</> : "保存修改"}</Button>
            <Button onClick={onClose}>关闭</Button>
          </div>
        </form>

        <section ref={lyricsSection}>
          <h3 className="section-title">歌词</h3>
          <textarea
            value={lyrics}
            onChange={(e) => { setLyrics(e.target.value); setLyricsSource("manual"); }}
            rows={8}
            spellCheck={false}
            placeholder={"粘贴 LRC 歌词，例如：\n[00:12.30]第一句歌词\n[00:18.75]第二句歌词\n\n也可以粘贴没有时间点的普通歌词。"}
            className={`${inputCls} font-mono text-xs leading-relaxed`}
          />
          <p className="text-xs text-ash mt-2 min-h-4">{lyricsInfo}</p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Button
              variant="primary"
              disabled={lyrics.trim() === savedLyrics.trim()}
              onClick={async () => {
                try {
                  const r = await api.saveLyrics(t.id, lyrics, lyricsSource);
                  setLyrics(r.content ?? "");
                  setSavedLyrics(r.content ?? "");
                  onNotify(r.content ? "歌词已保存" : "歌词已清除");
                } catch (e) {
                  onNotify((e as Error).message);
                }
              }}
            >
              保存歌词
            </Button>
            <label className="inline-flex items-center gap-2 rounded-full px-4 h-9 text-sm border border-line text-mist hover:text-bone hover:border-ash/60 cursor-pointer">
              <FileUp className="w-4 h-4" />导入 .lrc 文件
              <input
                type="file"
                accept=".lrc,.txt,text/plain"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setLyrics(await readLyricsFile(f));
                  setLyricsSource("lrc_file");
                }}
              />
            </label>
            {lyrics && <Button onClick={() => setLyrics("")}>清空</Button>}
          </div>
        </section>

        {t.versions.length > 0 && (
          <section>
            <h3 className="section-title">同一作品的其他录音版本</h3>
            <ul className="space-y-1.5 text-sm">
              {t.versions.map((v) => (
                <li key={v.id} className="flex justify-between gap-3 text-mist">
                  <span className="truncate">{v.title} — {v.artist}{v.version_label ? ` · ${v.version_label}` : ""}</span>
                  <span className="text-ash shrink-0">{v.release_year ?? ""} {v.audio_format}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="text-xs text-ash space-y-1 break-all">
          <h3 className="section-title">文件</h3>
          <p>{t.file_path}</p>
          <p>
            {t.audio_format} / {t.codec}
            {t.sample_rate ? ` · ${t.sample_rate} Hz` : ""}
            {t.bit_depth ? ` · ${t.bit_depth} bit` : ""}
            {t.bitrate ? ` · ${Math.round(t.bitrate / 1000)} kbps` : ""}
            {t.channels ? ` · ${t.channels}ch` : ""}
            {t.file_size ? ` · ${(t.file_size / 1048576).toFixed(1)} MB` : ""}
          </p>
          <p>导入于 {new Date(t.added_at).toLocaleString()}</p>
        </section>

        <Button variant="danger" onClick={remove}><Trash2 className="w-4 h-4" />从曲库移除</Button>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: ReactNode; onClose(): void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-label="曲目详情" className="relative w-full max-w-lg h-full overflow-y-auto bg-coal border-l border-line shadow-2xl">
        <div className="sticky top-0 z-10 flex justify-end p-2 bg-gradient-to-b from-coal to-transparent">
          <IconButton label="关闭" onClick={onClose} className="w-9 h-9"><X className="w-4 h-4" /></IconButton>
        </div>
        <div className="-mt-10">{children}</div>
      </div>
    </div>
  );
}
