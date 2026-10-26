import { Check, ImagePlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, type Collection } from "../api";
import { Button, CollectionCover, Field, IconButton, inputCls, THEMES } from "./ui";

/** Create (collection === null) or edit a collection/playlist. */
export function CollectionEditor({ collection, kind, onClose, onSaved, onDeleted, onNotify }: {
  collection: Collection | null;
  kind: Collection["kind"];
  onClose(): void;
  onSaved(c: Collection): void;
  onDeleted(): void;
  onNotify(msg: string): void;
}) {
  const [name, setName] = useState(collection?.name ?? "");
  const [subtitle, setSubtitle] = useState(collection?.subtitle ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [theme, setTheme] = useState(collection?.theme ?? "walnut");
  const [current, setCurrent] = useState(collection);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return onNotify("名称不能为空");
    const body = { name: name.trim(), subtitle: subtitle || null, description: description || null, theme };
    try {
      const saved = current ? await api.updateCollection(current.id, body) : await api.createCollection({ ...body, kind });
      onSaved(saved);
      onClose();
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const uploadCover = async (file: File) => {
    if (!current) return;
    try {
      const c = await api.uploadCover(current.id, file);
      setCurrent(c);
      onSaved(c);
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const remove = async () => {
    if (!current) return;
    if (!confirm(`删除「${current.name}」？\n\n只删除这个分组，曲目和音频文件都会保留在曲库中。`)) return;
    try {
      await api.deleteCollection(current.id);
      onDeleted();
      onClose();
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const label = kind === "collection" ? "收藏馆" : "歌单";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <form onSubmit={submit} role="dialog" aria-label={`编辑${label}`} className="relative w-full max-w-md max-h-full overflow-y-auto bg-coal border border-line rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl">{collection ? `编辑${label}` : `新建${label}`}</h2>
          <IconButton label="关闭" onClick={onClose} className="w-8 h-8"><X className="w-4 h-4" /></IconButton>
        </div>

        {current && (
          <div className="flex items-center gap-4">
            <CollectionCover c={current} className="w-20 h-20 rounded-lg text-3xl" />
            <label className="inline-flex items-center gap-2 text-sm text-mist hover:text-bone cursor-pointer border border-line rounded-full px-4 h-9">
              <ImagePlus className="w-4 h-4" />上传封面
              <input type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])} />
            </label>
          </div>
        )}

        <Field label="名称"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="副标题"><input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="如：坂本龙一 · 深邃与宁静" className={inputCls} /></Field>
        <Field label="描述"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} /></Field>
        <Field label="情绪主题">
          <div className="flex flex-wrap gap-2">
            {Object.entries(THEMES).map(([key, t]) => (
              <button
                key={key}
                type="button"
                title={t.label}
                aria-label={t.label}
                onClick={() => setTheme(key)}
                className={`w-9 h-9 rounded-full grid place-items-center ring-2 ring-offset-2 ring-offset-coal ${theme === key ? "ring-bone/80" : "ring-transparent"}`}
                style={{ background: `radial-gradient(circle at 30% 30%, ${t.color}, #0c0b0a)` }}
              >
                {theme === key && <Check className="w-4 h-4" />}
              </button>
            ))}
          </div>
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <Button variant="primary" type="submit">保存</Button>
          <Button onClick={onClose}>取消</Button>
          {current && <Button variant="danger" onClick={remove} className="ml-auto">删除</Button>}
        </div>
      </form>
    </div>
  );
}
