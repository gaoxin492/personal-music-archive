export interface Track {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  composer: string | null;
  track_number: number | null;
  disc_number: number | null;
  release_year: number | null;
  genre: string | null;
  duration: number | null;
  work: string | null;
  version_label: string | null;
  performers: string | null;
  role: string | null;
  file_path: string;
  audio_format: string;
  codec: string;
  mime_type: string;
  lossless: boolean;
  sample_rate: number | null;
  bit_depth: number | null;
  bitrate: number | null;
  channels: number | null;
  file_size: number | null;
  has_artwork: boolean;
  added_at: string;
  rating: number | null;
  favorite: boolean;
  mood_tags: string[];
  personal_note: string | null;
  first_heard_at: string | null;
  first_heard_context: string | null;
  collection_ids: number[];
  version_count: number;
  file_missing: boolean;
}

export interface Acquisition {
  id: number;
  source_type: string | null;
  store_name: string | null;
  purchase_url: string | null;
  purchase_date: string | null;
  original_format: string | null;
  rights_notes: string | null;
}

export interface TrackDetail extends Track {
  acquisitions: Acquisition[];
  versions: Pick<Track, "id" | "title" | "artist" | "album" | "version_label" | "performers" | "release_year" | "audio_format">[];
}

export interface Lyrics {
  content: string | null;
  source: "manual" | "lrc_file" | "embedded" | null;
  updated_at: string | null;
}

export interface Collection {
  id: number;
  kind: "collection" | "playlist";
  name: string;
  subtitle: string | null;
  description: string | null;
  theme: string | null;
  sort_order: number;
  has_cover: boolean;
  cover_key: string | null;
  track_count: number;
  total_duration: number;
  artwork_track_ids: number[];
}

export interface ImportResult {
  id?: number;
  created_at?: string;
  source_name: string;
  status: "imported" | "duplicate" | "unsupported" | "error";
  message: string;
  track_id: number | null;
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("无法连接到曲库服务器，请确认后端已启动。");
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type SortKey = "" | "title" | "artist" | "album" | "added" | "year" | "rating" | "duration";

export const api = {
  tracks(params: { q?: string; collection_id?: number; favorite?: boolean; sort?: SortKey; desc?: boolean }) {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.collection_id != null) sp.set("collection_id", String(params.collection_id));
    if (params.favorite) sp.set("favorite", "true");
    if (params.sort) sp.set("sort", params.sort);
    if (params.desc) sp.set("desc", "true");
    return request<Track[]>(`/api/tracks?${sp}`);
  },
  track: (id: number) => request<TrackDetail>(`/api/tracks/${id}`),
  updateTrack: (id: number, patch: Partial<Track>) =>
    request<TrackDetail & { file_note: string | null }>(`/api/tracks/${id}`, json("PATCH", patch)),
  updateNote: (id: number, patch: Partial<Pick<Track, "rating" | "favorite" | "mood_tags" | "personal_note" | "first_heard_at" | "first_heard_context">>) =>
    request<Track>(`/api/tracks/${id}/note`, json("PATCH", patch)),
  lyrics: (id: number) => request<Lyrics>(`/api/tracks/${id}/lyrics`),
  saveLyrics: (id: number, content: string, source: Lyrics["source"] = "manual") =>
    request<Lyrics>(`/api/tracks/${id}/lyrics`, json("PUT", { content, source })),
  deleteTrack: (id: number) => request<{ moved_to: string | null }>(`/api/tracks/${id}`, { method: "DELETE" }),
  addAcquisition: (id: number, a: Omit<Acquisition, "id">) => request<TrackDetail>(`/api/tracks/${id}/acquisitions`, json("POST", a)),
  deleteAcquisition: (id: number) => request(`/api/acquisitions/${id}`, { method: "DELETE" }),

  collections: () => request<Collection[]>("/api/collections"),
  createCollection: (c: Partial<Collection>) => request<Collection>("/api/collections", json("POST", c)),
  updateCollection: (id: number, c: Partial<Collection>) => request<Collection>(`/api/collections/${id}`, json("PATCH", c)),
  deleteCollection: (id: number) => request(`/api/collections/${id}`, { method: "DELETE" }),
  addToCollection: (id: number, trackIds: number[]) => request(`/api/collections/${id}/tracks`, json("POST", { track_ids: trackIds })),
  removeFromCollection: (id: number, trackId: number) => request(`/api/collections/${id}/tracks/${trackId}`, { method: "DELETE" }),
  reorderCollection: (id: number, trackIds: number[]) => request(`/api/collections/${id}/order`, json("PUT", { track_ids: trackIds })),
  uploadCover(id: number, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return request<Collection>(`/api/collections/${id}/cover`, { method: "POST", body: fd });
  },

  uploadFiles(files: File[]) {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    return request<{ results: ImportResult[] }>("/api/import/upload", { method: "POST", body: fd });
  },
  scanInbox: () => request<{ results: ImportResult[] }>("/api/import/scan", { method: "POST" }),
  importLog: () => request<ImportResult[]>("/api/import/log"),
  health: () => request<{ archive_root: string; inbox: string; tracks: number }>("/api/health"),
  check: (verify: boolean) =>
    request<{ checked: number; missing: { id: number; title: string; file_path: string }[]; hash_mismatch: { id: number; title: string }[] }>(
      `/api/library/check?verify_hashes=${verify}`,
    ),
};

export const streamUrl = (id: number) => `/api/tracks/${id}/stream`;
export const artworkUrl = (id: number) => `/api/tracks/${id}/artwork`;
export const coverUrl = (c: Collection) => `/api/collections/${c.id}/cover?v=${c.cover_key ?? ""}`;

export function formatTime(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "–:––";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function qualityLabel(t: Pick<Track, "audio_format" | "bit_depth" | "sample_rate" | "bitrate" | "lossless">): string {
  if (t.lossless) {
    const parts = [t.audio_format];
    if (t.bit_depth) parts.push(`${t.bit_depth}bit`);
    if (t.sample_rate) parts.push(`${+(t.sample_rate / 1000).toFixed(1)}kHz`);
    return parts.join(" · ");
  }
  return t.bitrate ? `${t.audio_format} · ${Math.round(t.bitrate / 1000)}kbps` : t.audio_format;
}

/** MIME + codec string for HTMLMediaElement.canPlayType. */
export function playbackType(t: Pick<Track, "mime_type" | "codec">): string {
  switch (t.codec) {
    case "alac": return 'audio/mp4; codecs="alac"';
    case "opus": return 'audio/ogg; codecs="opus"';
    case "vorbis": return 'audio/ogg; codecs="vorbis"';
    case "mp3": return "audio/mpeg";
    default:
      return t.codec.startsWith("mp4a") ? `audio/mp4; codecs="${t.codec}"` : t.mime_type;
  }
}

export const MOOD_SUGGESTIONS = ["宁静", "孤独", "悲伤", "戏剧性", "回忆", "宿命", "温柔", "壮阔", "深夜", "雨天"];
