import csv
import io
import json
import logging
import mimetypes
import shutil
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config
from .db import connect, get_db, init_db, now_iso
from .importer import import_file, prune_empty_dirs, rel, reorganize_all, reorganize_track, scan_inbox, sha256_file, unique_path

mimetypes.add_type("application/manifest+json", ".webmanifest")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("archive")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    config.ensure_dirs()
    init_db()
    log.info("Music archive root: %s", config.ARCHIVE_ROOT_DISPLAY)
    conn = connect()
    try:  # finish any file renames that failed earlier (e.g. the file was playing)
        for r in reorganize_all(conn):
            log.info("reorganize #%s: %s", r["track_id"], r["note"])
    finally:
        conn.close()
    yield


app = FastAPI(title="Personal Music Archive", version="0.1.0", lifespan=lifespan)

Db = Depends(get_db)

TRACK_SELECT = """
SELECT t.*, n.rating, COALESCE(n.favorite, 0) AS favorite, COALESCE(n.mood_tags, '[]') AS mood_tags,
       n.personal_note, n.first_heard_at, n.first_heard_context,
       (SELECT group_concat(ct2.collection_id) FROM collection_track ct2 WHERE ct2.track_id = t.id) AS collection_ids,
       CASE WHEN COALESCE(t.work, '') = '' THEN 1
            ELSE (SELECT COUNT(*) FROM track t2 WHERE t2.work = t.work) END AS version_count
FROM track t
LEFT JOIN listening_note n ON n.track_id = t.id
"""

SORTS = {
    "title": "ufold(t.title)",
    "artist": "ufold(COALESCE(t.artist, '')), ufold(COALESCE(t.album, '')), t.disc_number, t.track_number",
    "album": "ufold(COALESCE(t.album, '')), t.disc_number, t.track_number",
    "added": "t.added_at",
    "year": "t.release_year",
    "rating": "COALESCE(n.rating, 0)",
    "duration": "t.duration",
}


def track_out(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["lossless"] = bool(d["lossless"])
    d["favorite"] = bool(d["favorite"])
    d["mood_tags"] = json.loads(d.get("mood_tags") or "[]")
    ids = d.pop("collection_ids", None)
    d["collection_ids"] = [int(x) for x in ids.split(",")] if ids else []
    d["has_artwork"] = bool(d.pop("artwork_path"))
    d.pop("file_hash", None)
    d["file_missing"] = not (config.ARCHIVE_ROOT / d["file_path"]).is_file()
    return d


def get_track_row(conn: sqlite3.Connection, track_id: int) -> sqlite3.Row:
    row = conn.execute(TRACK_SELECT + " WHERE t.id = ?", (track_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"曲目 #{track_id} 不存在")
    return row


# ---------------------------------------------------------------- tracks

@app.get("/api/tracks")
def list_tracks(q: str = "", collection_id: int | None = None, favorite: bool = False,
                sort: str = "", desc: bool = False, conn: sqlite3.Connection = Db):
    sql, params, where = TRACK_SELECT, [], []
    if collection_id is not None:
        sql += " JOIN collection_track ct ON ct.track_id = t.id AND ct.collection_id = ?"
        params.append(collection_id)
    if favorite:
        where.append("n.favorite = 1")
    hay = ("ufold(COALESCE(t.title,'')||' '||COALESCE(t.artist,'')||' '||COALESCE(t.album,'')||' '||"
           "COALESCE(t.composer,'')||' '||COALESCE(t.work,'')||' '||COALESCE(t.version_label,'')||' '||"
           "COALESCE(t.performers,'')||' '||COALESCE(t.role,'')||' '||COALESCE(n.mood_tags,'')||' '||"
           "COALESCE(n.personal_note,''))")
    for token in q.split():
        where.append(f"{hay} LIKE ?")
        params.append(f"%{token.casefold()}%")
    if where:
        sql += " WHERE " + " AND ".join(where)
    if sort in SORTS:
        order = SORTS[sort]
    elif collection_id is not None:
        order = "ct.order_index"
    else:
        order = "t.added_at"
        desc = not desc  # library default: newest first
    direction = " DESC" if desc else ""
    sql += " ORDER BY " + ", ".join(f"{part.strip()}{direction}" for part in order.split(",")) + ", t.id"
    return [track_out(r) for r in conn.execute(sql, params)]


@app.get("/api/tracks/{track_id}")
def get_track(track_id: int, conn: sqlite3.Connection = Db):
    d = track_out(get_track_row(conn, track_id))
    d["acquisitions"] = [dict(r) for r in conn.execute(
        "SELECT * FROM acquisition WHERE track_id = ? ORDER BY id", (track_id,))]
    d["versions"] = []
    if d.get("work"):
        d["versions"] = [dict(r) for r in conn.execute(
            "SELECT id, title, artist, album, version_label, performers, release_year, audio_format "
            "FROM track WHERE work = ? AND id != ? ORDER BY release_year, id", (d["work"], track_id))]
    return d


class TrackPatch(BaseModel):
    title: str | None = Field(None, min_length=1)
    artist: str | None = None
    album: str | None = None
    album_artist: str | None = None
    composer: str | None = None
    track_number: int | None = None
    disc_number: int | None = None
    release_year: int | None = None
    genre: str | None = None
    work: str | None = None
    version_label: str | None = None
    performers: str | None = None
    role: str | None = None


@app.patch("/api/tracks/{track_id}")
def patch_track(track_id: int, body: TrackPatch, conn: sqlite3.Connection = Db):
    """Edits go to the database; tags inside the audio file are never rewritten. If the
    title/artist/album/track number changed, the file is renamed to audio/Artist/Album/NN - Title."""
    get_track_row(conn, track_id)
    fields = body.model_dump(exclude_unset=True)
    if "title" in fields and not (fields["title"] or "").strip():
        raise HTTPException(422, "标题不能为空")
    fields = {k: (v.strip() or None) if isinstance(v, str) else v for k, v in fields.items()}
    file_note = None
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE track SET {sets}, updated_at = ? WHERE id = ?", [*fields.values(), now_iso(), track_id])
        conn.commit()
        if fields.keys() & {"title", "artist", "album_artist", "album", "track_number"}:
            file_note = reorganize_track(conn, track_id)
    return {**get_track(track_id, conn), "file_note": file_note}


@app.post("/api/library/reorganize")
def library_reorganize(conn: sqlite3.Connection = Db):
    """Rename every file whose path no longer matches its track's title/artist/album."""
    return {"results": reorganize_all(conn)}


class NotePatch(BaseModel):
    rating: int | None = Field(None, ge=0, le=5)
    favorite: bool | None = None
    mood_tags: list[str] | None = None
    personal_note: str | None = None
    first_heard_at: str | None = None
    first_heard_context: str | None = None


@app.patch("/api/tracks/{track_id}/note")
def patch_note(track_id: int, body: NotePatch, conn: sqlite3.Connection = Db):
    get_track_row(conn, track_id)
    fields = body.model_dump(exclude_unset=True)
    if "mood_tags" in fields:
        tags = [t.strip() for t in fields["mood_tags"] or [] if t.strip()]
        fields["mood_tags"] = json.dumps(list(dict.fromkeys(tags)), ensure_ascii=False)
    if "favorite" in fields:
        fields["favorite"] = int(bool(fields["favorite"]))
    conn.execute("INSERT OR IGNORE INTO listening_note (track_id, updated_at) VALUES (?, ?)", (track_id, now_iso()))
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE listening_note SET {sets}, updated_at = ? WHERE track_id = ?",
                     [*fields.values(), now_iso(), track_id])
    conn.commit()
    return track_out(get_track_row(conn, track_id))


@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: int, conn: sqlite3.Connection = Db):
    """Removes the track from the library. The audio file is moved to trash/, never hard-deleted."""
    row = get_track_row(conn, track_id)
    src = config.ARCHIVE_ROOT / row["file_path"]
    moved_to = None
    if src.is_file():
        dest = unique_path(config.TRASH_DIR / Path(row["file_path"]).relative_to("audio"))
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), dest)
        moved_to = rel(dest)
        prune_empty_dirs(src.parent)
    conn.execute("DELETE FROM track WHERE id = ?", (track_id,))
    conn.commit()
    return {"deleted": track_id, "moved_to": moved_to}


@app.get("/api/tracks/{track_id}/stream")
def stream_track(track_id: int, conn: sqlite3.Connection = Db):
    row = conn.execute("SELECT file_path, mime_type FROM track WHERE id = ?", (track_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"曲目 #{track_id} 不存在")
    path = config.ARCHIVE_ROOT / row["file_path"]
    if not path.is_file():
        raise HTTPException(404, f"音频文件丢失：{row['file_path']}")
    # FileResponse handles HTTP Range requests, which the <audio> element needs for seeking
    return FileResponse(path, media_type=row["mime_type"] or "application/octet-stream")


@app.get("/api/tracks/{track_id}/artwork")
def track_artwork(track_id: int, conn: sqlite3.Connection = Db):
    row = conn.execute("SELECT artwork_path FROM track WHERE id = ?", (track_id,)).fetchone()
    if not row or not row["artwork_path"] or not (config.ARCHIVE_ROOT / row["artwork_path"]).is_file():
        raise HTTPException(404, "无封面")
    return FileResponse(config.ARCHIVE_ROOT / row["artwork_path"], headers={"Cache-Control": "max-age=86400"})


@app.get("/api/tracks/{track_id}/lyrics")
def get_lyrics(track_id: int, conn: sqlite3.Connection = Db):
    get_track_row(conn, track_id)
    row = conn.execute("SELECT content, source, updated_at FROM lyrics WHERE track_id = ?", (track_id,)).fetchone()
    return dict(row) if row else {"content": None, "source": None, "updated_at": None}


class LyricsIn(BaseModel):
    content: str = Field(max_length=200_000)
    source: str | None = Field(None, pattern="^(manual|lrc_file|embedded)$")


@app.put("/api/tracks/{track_id}/lyrics")
def put_lyrics(track_id: int, body: LyricsIn, conn: sqlite3.Connection = Db):
    """Saves lyrics as given (LRC or plain text); empty content removes them."""
    get_track_row(conn, track_id)
    content = body.content.replace("\r\n", "\n").strip()
    if content:
        conn.execute(
            "INSERT INTO lyrics (track_id, content, source, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(track_id) DO UPDATE SET content = excluded.content, source = excluded.source, "
            "updated_at = excluded.updated_at",
            (track_id, content, body.source or "manual", now_iso()))
    else:
        conn.execute("DELETE FROM lyrics WHERE track_id = ?", (track_id,))
    conn.commit()
    return get_lyrics(track_id, conn)


class AcquisitionIn(BaseModel):
    source_type: str | None = None
    store_name: str | None = None
    purchase_url: str | None = None
    purchase_date: str | None = None
    original_format: str | None = None
    rights_notes: str | None = None


@app.post("/api/tracks/{track_id}/acquisitions")
def add_acquisition(track_id: int, body: AcquisitionIn, conn: sqlite3.Connection = Db):
    get_track_row(conn, track_id)
    f = body.model_dump()
    conn.execute(
        "INSERT INTO acquisition (track_id, source_type, store_name, purchase_url, purchase_date, original_format,"
        " rights_notes, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (track_id, f["source_type"], f["store_name"], f["purchase_url"], f["purchase_date"], f["original_format"],
         f["rights_notes"], now_iso()))
    conn.commit()
    return get_track(track_id, conn)


@app.delete("/api/acquisitions/{acq_id}")
def delete_acquisition(acq_id: int, conn: sqlite3.Connection = Db):
    conn.execute("DELETE FROM acquisition WHERE id = ?", (acq_id,))
    conn.commit()
    return {"deleted": acq_id}


# ---------------------------------------------------------------- collections & playlists

def collections_out(conn: sqlite3.Connection, where: str = "", params: tuple = ()) -> list[dict]:
    rows = conn.execute(
        f"""SELECT c.*, COUNT(ct.track_id) AS track_count, COALESCE(SUM(t.duration), 0) AS total_duration
            FROM collection c
            LEFT JOIN collection_track ct ON ct.collection_id = c.id
            LEFT JOIN track t ON t.id = ct.track_id
            {where} GROUP BY c.id ORDER BY c.kind, c.sort_order, c.id""", params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        cover = d.pop("cover_art")
        d["has_cover"] = bool(cover)
        d["cover_key"] = Path(cover).stem if cover else None  # changes on each upload, for cache-busting
        d["artwork_track_ids"] = [x[0] for x in conn.execute(
            "SELECT t.id FROM collection_track ct JOIN track t ON t.id = ct.track_id "
            "WHERE ct.collection_id = ? AND t.artwork_path IS NOT NULL ORDER BY ct.order_index LIMIT 4", (r["id"],))]
        out.append(d)
    return out


def get_collection_or_404(conn: sqlite3.Connection, cid: int) -> dict:
    found = collections_out(conn, "WHERE c.id = ?", (cid,))
    if not found:
        raise HTTPException(404, f"收藏馆/歌单 #{cid} 不存在")
    return found[0]


@app.get("/api/collections")
def list_collections(conn: sqlite3.Connection = Db):
    return collections_out(conn)


class CollectionIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    subtitle: str | None = None
    description: str | None = None
    theme: str | None = None
    kind: str | None = Field(None, pattern="^(collection|playlist)$")
    sort_order: int | None = None


@app.post("/api/collections")
def create_collection(body: CollectionIn, conn: sqlite3.Connection = Db):
    if not body.name or not body.name.strip():
        raise HTTPException(422, "名称不能为空")
    kind = body.kind or "playlist"
    next_order = conn.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM collection WHERE kind = ?",
                              (kind,)).fetchone()[0]
    cur = conn.execute(
        "INSERT INTO collection (kind, name, subtitle, description, theme, sort_order, created_at) VALUES (?,?,?,?,?,?,?)",
        (kind, body.name.strip(), body.subtitle, body.description, body.theme or "walnut", next_order, now_iso()))
    conn.commit()
    return get_collection_or_404(conn, cur.lastrowid)


@app.patch("/api/collections/{cid}")
def update_collection(cid: int, body: CollectionIn, conn: sqlite3.Connection = Db):
    get_collection_or_404(conn, cid)
    fields = body.model_dump(exclude_unset=True)
    if "name" in fields and not (fields["name"] or "").strip():
        raise HTTPException(422, "名称不能为空")
    if fields:
        conn.execute(f"UPDATE collection SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                     [*fields.values(), cid])
        conn.commit()
    return get_collection_or_404(conn, cid)


@app.delete("/api/collections/{cid}")
def delete_collection(cid: int, conn: sqlite3.Connection = Db):
    """Deletes the grouping only; tracks stay in the library."""
    get_collection_or_404(conn, cid)
    conn.execute("DELETE FROM collection WHERE id = ?", (cid,))
    conn.commit()
    return {"deleted": cid}


class TrackIds(BaseModel):
    track_ids: list[int]


@app.post("/api/collections/{cid}/tracks")
def add_to_collection(cid: int, body: TrackIds, conn: sqlite3.Connection = Db):
    get_collection_or_404(conn, cid)
    nxt = conn.execute("SELECT COALESCE(MAX(order_index), -1) + 1 FROM collection_track WHERE collection_id = ?",
                       (cid,)).fetchone()[0]
    added = 0
    for tid in body.track_ids:
        cur = conn.execute(
            "INSERT OR IGNORE INTO collection_track (collection_id, track_id, order_index, added_at) "
            "SELECT ?, id, ?, ? FROM track WHERE id = ?", (cid, nxt + added, now_iso(), tid))
        added += cur.rowcount
    conn.commit()
    return {"added": added, "collection": get_collection_or_404(conn, cid)}


@app.delete("/api/collections/{cid}/tracks/{track_id}")
def remove_from_collection(cid: int, track_id: int, conn: sqlite3.Connection = Db):
    conn.execute("DELETE FROM collection_track WHERE collection_id = ? AND track_id = ?", (cid, track_id))
    conn.commit()
    return {"removed": track_id}


@app.put("/api/collections/{cid}/order")
def reorder_collection(cid: int, body: TrackIds, conn: sqlite3.Connection = Db):
    for i, tid in enumerate(body.track_ids):
        conn.execute("UPDATE collection_track SET order_index = ? WHERE collection_id = ? AND track_id = ?",
                     (i, cid, tid))
    conn.commit()
    return {"ok": True}


@app.post("/api/collections/{cid}/cover")
async def upload_collection_cover(cid: int, file: UploadFile = File(...), conn: sqlite3.Connection = Db):
    get_collection_or_404(conn, cid)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(415, "封面需为 JPG / PNG / WebP 图片")
    dest = config.ARTWORK_DIR / f"collection-{cid}-{now_iso().replace(':', '')}{ext}"
    dest.write_bytes(await file.read())
    conn.execute("UPDATE collection SET cover_art = ? WHERE id = ?", (rel(dest), cid))
    conn.commit()
    return get_collection_or_404(conn, cid)


@app.get("/api/collections/{cid}/cover")
def collection_cover(cid: int, conn: sqlite3.Connection = Db):
    row = conn.execute("SELECT cover_art FROM collection WHERE id = ?", (cid,)).fetchone()
    if not row or not row["cover_art"] or not (config.ARCHIVE_ROOT / row["cover_art"]).is_file():
        raise HTTPException(404, "无封面")
    return FileResponse(config.ARCHIVE_ROOT / row["cover_art"])


# ---------------------------------------------------------------- import

@app.post("/api/import/upload")
async def import_upload(files: list[UploadFile] = File(...), conn: sqlite3.Connection = Db):
    staging = config.IMPORT_DIR / ".uploading"
    staging.mkdir(exist_ok=True)
    results = []
    for up in files:
        name = Path(up.filename or "upload").name
        tmp = unique_path(staging / name)
        try:
            with tmp.open("wb") as fh:
                while chunk := await up.read(1 << 20):
                    fh.write(chunk)
            results.append(import_file(conn, tmp, name))
        except Exception as e:  # keep going with the remaining files, but record the failure
            log.exception("upload import failed: %s", name)
            results.append({"source_name": name, "status": "error", "message": f"导入失败: {e}", "track_id": None})
        finally:
            tmp.unlink(missing_ok=True)
    return {"results": results}


@app.post("/api/import/scan")
def import_scan(conn: sqlite3.Connection = Db):
    return {"results": scan_inbox(conn)}


@app.get("/api/import/log")
def import_log(limit: int = Query(200, le=2000), conn: sqlite3.Connection = Db):
    return [dict(r) for r in conn.execute("SELECT * FROM import_log ORDER BY id DESC LIMIT ?", (limit,))]


# ---------------------------------------------------------------- integrity & export

@app.get("/api/library/check")
def library_check(verify_hashes: bool = False, conn: sqlite3.Connection = Db):
    missing, mismatched = [], []
    rows = conn.execute("SELECT id, title, artist, file_path, file_hash FROM track").fetchall()
    for r in rows:
        p = config.ARCHIVE_ROOT / r["file_path"]
        if not p.is_file():
            missing.append({"id": r["id"], "title": r["title"], "artist": r["artist"], "file_path": r["file_path"]})
        elif verify_hashes and sha256_file(p) != r["file_hash"]:
            mismatched.append({"id": r["id"], "title": r["title"], "file_path": r["file_path"]})
    return {"checked": len(rows), "missing": missing, "hash_mismatch": mismatched, "hashes_verified": verify_hashes}


def _table(conn: sqlite3.Connection, name: str) -> list[dict]:
    return [dict(r) for r in conn.execute(f"SELECT * FROM {name}")]


@app.get("/api/export/library.json")
def export_json(conn: sqlite3.Connection = Db):
    data = {
        "format": "personal-music-archive", "version": 1, "exported_at": now_iso(),
        "archive_root": config.ARCHIVE_ROOT_DISPLAY,
        **{t: _table(conn, t) for t in ("track", "collection", "collection_track", "listening_note", "acquisition", "lyrics")},
    }
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="music-archive-export.json"'})


@app.get("/api/export/tracks.csv")
def export_csv(conn: sqlite3.Connection = Db):
    rows = list_tracks(conn=conn)
    names = {c["id"]: c["name"] for c in _table(conn, "collection")}
    cols = ["id", "title", "artist", "album", "composer", "release_year", "work", "version_label", "performers",
            "role", "duration", "audio_format", "sample_rate", "bit_depth", "bitrate", "rating", "favorite",
            "mood_tags", "personal_note", "collections", "file_path", "added_at"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        r["mood_tags"] = "、".join(r["mood_tags"])
        r["collections"] = " | ".join(names.get(i, "") for i in r["collection_ids"])
        w.writerow(r)
    # utf-8-sig so Excel opens Chinese/Japanese text correctly
    return Response(buf.getvalue().encode("utf-8-sig"), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="music-archive-tracks.csv"'})


@app.get("/api/health")
def health(conn: sqlite3.Connection = Db):
    return {"ok": True, "archive_root": config.ARCHIVE_ROOT_DISPLAY,
            "inbox": str(config.IMPORT_DIR).replace(str(config.ARCHIVE_ROOT), config.ARCHIVE_ROOT_DISPLAY),
            "tracks": conn.execute("SELECT COUNT(*) FROM track").fetchone()[0]}


# ---------------------------------------------------------------- frontend (production build)

if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")
