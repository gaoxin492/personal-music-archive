import { CheckCircle2, Copy, Download, FolderInput, HardDriveDownload, ShieldCheck, Upload, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ImportResult } from "../api";
import { Button } from "./ui";

const ACCEPT = ".mp3,.flac,.m4a,.mp4,.aac,.wav,.aif,.aiff,.ogg,.opus";

const STATUS: Record<ImportResult["status"], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  imported: { label: "已导入", cls: "text-emerald-400/90", Icon: CheckCircle2 },
  duplicate: { label: "重复", cls: "text-walnut-light", Icon: Copy },
  unsupported: { label: "不支持", cls: "text-ember", Icon: XCircle },
  error: { label: "失败", cls: "text-ember", Icon: XCircle },
};

function ResultList({ items }: { items: ImportResult[] }) {
  return (
    <ul className="divide-y divide-line/60 text-sm">
      {items.map((r, i) => {
        const s = STATUS[r.status];
        return (
          <li key={r.id ?? `n${i}`} className="flex gap-3 py-2.5">
            <s.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${s.cls}`} />
            <div className="min-w-0 flex-1">
              <p className="text-bone truncate">{r.source_name}</p>
              <p className="text-ash text-xs mt-0.5 break-all">{r.message}</p>
            </div>
            <span className={`text-xs shrink-0 ${s.cls}`}>{s.label}</span>
            {r.created_at && <span className="hidden sm:block text-xs text-ash/70 shrink-0 tabular-nums">{new Date(r.created_at).toLocaleString()}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function ImportView({ onImported, onNotify }: { onImported(): void; onNotify(msg: string): void }) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [history, setHistory] = useState<ImportResult[]>([]);
  const [inbox, setInbox] = useState("");
  const [check, setCheck] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(() => {
    api.importLog().then(setHistory).catch((e) => onNotify(e.message));
  }, [onNotify]);

  useEffect(() => {
    loadHistory();
    api.health().then((h) => setInbox(h.inbox)).catch(() => {});
  }, [loadHistory]);

  const run = async (fn: () => Promise<{ results: ImportResult[] }>) => {
    setBusy(true);
    try {
      const r = await fn();
      setResults(r.results);
      if (r.results.some((x) => x.status === "imported")) onImported();
      if (!r.results.length) onNotify("收件箱中没有待导入的文件");
    } catch (e) {
      onNotify((e as Error).message);
    } finally {
      setBusy(false);
      loadHistory();
    }
  };

  const upload = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length) void run(() => api.uploadFiles(list));
  };

  const runCheck = async (verify: boolean) => {
    setCheck(verify ? "正在校验所有文件的 SHA-256…" : "正在检查…");
    try {
      const r = await api.check(verify);
      const parts = [`共检查 ${r.checked} 首`, `丢失 ${r.missing.length}`];
      if (verify) parts.push(`校验值不一致 ${r.hash_mismatch.length}`);
      const detail = [...r.missing.map((m) => `丢失：${m.title}（${m.file_path}）`), ...r.hash_mismatch.map((m) => `校验失败：${m.title}`)];
      setCheck([parts.join(" · "), ...detail].join("\n"));
    } catch (e) {
      setCheck((e as Error).message);
    }
  };

  const counts = results?.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 md:py-12 space-y-10">
      <header>
        <p className="text-[11px] uppercase tracking-[0.25em] text-ash">Import</p>
        <h1 className="font-serif text-3xl md:text-4xl mt-2">导入音乐</h1>
        <p className="text-mist mt-3 max-w-2xl leading-relaxed text-sm">
          导入你合法拥有、无 DRM 的音频文件（MP3、FLAC、M4A/AAC/ALAC、WAV、AIFF、OGG、Opus）。
          文件会被复制进 <code className="text-bone">audio/艺术家/专辑/</code>，原样保存为归档母版；完全相同的文件按 SHA-256 自动去重，
          同名但不同录音的文件不会被合并。每个文件的结果都会记入导入日志。
        </p>
      </header>

      <section className="grid md:grid-cols-2 gap-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
          className={`rounded-xl border border-dashed p-6 flex flex-col items-center text-center gap-3 transition-colors ${dragOver ? "border-walnut-light bg-walnut/10" : "border-line bg-coal/60"}`}
        >
          <Upload className="w-6 h-6 text-walnut-light" strokeWidth={1.5} />
          <p className="text-bone">拖入音频文件</p>
          <p className="text-xs text-ash">或</p>
          <Button variant="primary" disabled={busy} onClick={() => fileInput.current?.click()}>选择文件</Button>
          <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
        </div>
        <div className="rounded-xl border border-line bg-coal/60 p-6 flex flex-col gap-3">
          <FolderInput className="w-6 h-6 text-walnut-light" strokeWidth={1.5} />
          <p className="text-bone">扫描导入收件箱</p>
          <p className="text-xs text-ash leading-relaxed">把购买下载的文件（可含子文件夹）放进下面的目录，再点击扫描。导入成功的原文件会移到 <code>_imported/</code>。</p>
          <code className="text-[11px] text-mist bg-ink/60 rounded px-2 py-1.5 break-all">{inbox || "…"}</code>
          <Button disabled={busy} onClick={() => run(api.scanInbox)} className="self-start">
            {busy ? "导入中…" : "开始扫描"}
          </Button>
        </div>
      </section>

      {results && (
        <section>
          <h2 className="section-title">
            本次结果 · {Object.entries(counts ?? {}).map(([k, v]) => `${STATUS[k as ImportResult["status"]].label} ${v}`).join(" · ")}
          </h2>
          <ResultList items={results} />
        </section>
      )}

      <section className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-line p-5 space-y-3">
          <p className="flex items-center gap-2 text-bone"><HardDriveDownload className="w-4 h-4 text-walnut-light" />导出曲库数据</p>
          <p className="text-xs text-ash">曲目、收藏馆、备注、购买来源，便于备份与迁移（不含音频本身）。</p>
          <div className="flex gap-2">
            <a href="/api/export/library.json" download><Button><Download className="w-4 h-4" />JSON</Button></a>
            <a href="/api/export/tracks.csv" download><Button><Download className="w-4 h-4" />CSV</Button></a>
          </div>
        </div>
        <div className="rounded-xl border border-line p-5 space-y-3">
          <p className="flex items-center gap-2 text-bone"><ShieldCheck className="w-4 h-4 text-walnut-light" />文件完整性</p>
          <p className="text-xs text-ash">检查曲库记录对应的音频是否还在，或重新计算 SHA-256 校验备份。</p>
          <div className="flex gap-2">
            <Button onClick={() => runCheck(false)}>检查丢失</Button>
            <Button onClick={() => runCheck(true)}>完整校验</Button>
          </div>
          {check && <pre className="text-xs text-mist whitespace-pre-wrap">{check}</pre>}
        </div>
      </section>

      <section>
        <h2 className="section-title">导入日志</h2>
        {history.length ? <ResultList items={history} /> : <p className="text-sm text-ash">还没有导入记录。</p>}
      </section>
    </div>
  );
}
