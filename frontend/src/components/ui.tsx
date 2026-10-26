import { Music2, Star } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { artworkUrl, coverUrl, type Collection, type Track } from "../api";

export const THEMES: Record<string, { color: string; label: string }> = {
  solitude: { color: "#3b4856", label: "冷墨 · Solitude" },
  theatre: { color: "#6b1f27", label: "绛红 · Theatre" },
  memories: { color: "#8a5a2b", label: "琥珀 · Memories" },
  walnut: { color: "#6e4c31", label: "胡桃木" },
  moss: { color: "#46503a", label: "苔绿" },
  plum: { color: "#4d2f45", label: "暮紫" },
};

export const themeColor = (theme: string | null | undefined) => THEMES[theme ?? ""]?.color ?? THEMES.walnut.color;

export function Cover({ track, className = "", rounded = "rounded-md" }: { track: Pick<Track, "id" | "has_artwork" | "title"> | null; className?: string; rounded?: string }) {
  const [failed, setFailed] = useState(false);
  if (track?.has_artwork && !failed) {
    return (
      <img
        src={artworkUrl(track.id)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${rounded} object-cover bg-smoke ${className}`}
      />
    );
  }
  return (
    <div className={`${rounded} bg-gradient-to-br from-smoke to-coal grid place-items-center text-ash/60 ${className}`}>
      <Music2 className="w-1/3 h-1/3" strokeWidth={1.25} />
    </div>
  );
}

export function CollectionCover({ c, className = "" }: { c: Collection; className?: string }) {
  const [failed, setFailed] = useState(false);
  const color = themeColor(c.theme);
  if (c.has_cover && !failed) {
    return <img src={coverUrl(c)} alt="" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
  }
  const ids = c.artwork_track_ids;
  if (ids.length >= 4) {
    return (
      <div className={`grid grid-cols-2 grid-rows-2 overflow-hidden ${className}`}>
        {ids.slice(0, 4).map((id) => (
          <img key={id} src={artworkUrl(id)} alt="" className="w-full h-full object-cover" />
        ))}
      </div>
    );
  }
  return (
    <div
      className={`relative overflow-hidden grid place-items-center ${className}`}
      style={{ background: `radial-gradient(120% 90% at 30% 20%, ${color}, #0c0b0a 85%)` }}
    >
      {ids[0] != null && <img src={artworkUrl(ids[0])} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35 mix-blend-luminosity" />}
      <span className="relative font-serif text-bone/90 tracking-wide" style={{ fontSize: "min(2.2em, 22cqw)" }}>
        {c.name.slice(0, 1)}
      </span>
    </div>
  );
}

export function Stars({ value, onChange, size = 14 }: { value: number | null; onChange?: (v: number) => void; size?: number }) {
  const v = value ?? 0;
  return (
    <div className="flex items-center gap-0.5" role={onChange ? "radiogroup" : undefined} aria-label="喜欢程度">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          aria-label={`${n} 星`}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.(n === v ? 0 : n);
          }}
          className={onChange ? "cursor-pointer p-0.5 -m-0.5" : "cursor-default"}
        >
          <Star
            width={size}
            height={size}
            strokeWidth={1.5}
            className={n <= v ? "fill-walnut-light text-walnut-light" : "text-line"}
          />
        </button>
      ))}
    </div>
  );
}

export function IconButton({ label, children, className = "", active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid place-items-center rounded-full transition-colors hover:text-bone disabled:opacity-30 disabled:pointer-events-none ${active ? "text-walnut-light" : "text-mist"} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({ variant = "ghost", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-bone text-ink hover:bg-white",
    ghost: "border border-line text-mist hover:text-bone hover:border-ash/60",
    danger: "border border-ember/40 text-ember hover:bg-ember/10",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 h-9 text-sm transition-colors disabled:opacity-40 ${styles} ${className}`}
      {...rest}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.14em] text-ash mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full bg-coal border border-line rounded-md px-3 py-2 text-sm text-bone placeholder:text-ash/50 focus:outline-none focus:border-walnut-light/70";
