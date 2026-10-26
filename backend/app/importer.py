"""Import pipeline: validate -> hash -> dedupe -> read metadata -> copy into
audio/Artist/Album/NN - Title.ext -> extract artwork -> index. Every outcome
is written to import_log so nothing is skipped silently."""
import hashlib
import re
import shutil
import sqlite3
from pathlib import Path

from .config import ARCHIVE_ROOT, ARTWORK_DIR, AUDIO_DIR, IMPORT_DIR, IMPORTED_DIR, SUPPORTED_FORMATS
from .db import now_iso
from .filename_guess import guess_from_filename
from .metadata import MetadataError, read_metadata

INVALID_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_name(value: str | None, fallback: str) -> str:
    s = INVALID_CHARS.sub("_", (value or "").strip()).strip(" .")
    return (s or fallback)[:120]


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    i = 2
    while True:
        candidate = path.with_name(f"{path.stem} ({i}){path.suffix}")
        if not candidate.exists():
            return candidate
        i += 1


def rel(path: Path) -> str:
    return path.relative_to(ARCHIVE_ROOT).as_posix()


def library_path(artist: str | None, album_artist: str | None, album: str | None,
                 track_number: int | None, title: str | None, ext: str) -> Path:
    """Where a track belongs on disk: audio/Artist/Album/NN - Title.ext"""
    prefix = f"{track_number:02d} - " if track_number else ""
    return (AUDIO_DIR / safe_name(album_artist or artist, "Unknown Artist") / safe_name(album, "Unknown Album")
            / f"{prefix}{safe_name(title, 'Untitled')}{ext}")


def _is_at(current: Path, expected: Path) -> bool:
    """True if current is expected, or the ' (2)' variant unique_path made for a name clash."""
    return (current.parent == expected.parent and current.suffix.lower() == expected.suffix.lower()
            and re.fullmatch(re.escape(expected.stem) + r"( \(\d+\))?", current.stem) is not None)


def prune_empty_dirs(folder: Path) -> None:
    while folder != AUDIO_DIR and AUDIO_DIR in folder.parents:
        try:
            folder.rmdir()  # only succeeds when empty
        except OSError:
            return
        folder = folder.parent


def reorganize_track(conn: sqlite3.Connection, track_id: int) -> str | None:
    """Move a track's file to match its current title/artist/album. Returns a note
    for the user when something moved or could not be moved, else None."""
    t = conn.execute("SELECT title, artist, album_artist, album, track_number, file_path FROM track WHERE id = ?",
                     (track_id,)).fetchone()
    if not t:
        return None
    current = ARCHIVE_ROOT / t["file_path"]
    expected = library_path(t["artist"], t["album_artist"], t["album"], t["track_number"], t["title"], current.suffix)
    if _is_at(current, expected):
        return None
    if not current.is_file():
        return f"音频文件丢失（{t['file_path']}），未能整理"
    dest = unique_path(expected)
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        # A plain rename is all-or-nothing. shutil.move would fall back to copy+delete
        # when the file is locked, leaving a stray copy behind if the delete fails.
        current.rename(dest)
    except OSError:
        # On Windows a file that is being streamed can't be moved; retried on next save or restart
        return "文件正在使用中（可能正在播放），暂未改名；下次保存或重启服务时会自动整理"
    conn.execute("UPDATE track SET file_path = ? WHERE id = ?", (rel(dest), track_id))
    conn.commit()
    prune_empty_dirs(current.parent)
    return f"文件已整理为 {rel(dest)}"


def reorganize_all(conn: sqlite3.Connection) -> list[dict]:
    out = []
    for (track_id,) in conn.execute("SELECT id FROM track").fetchall():
        note = reorganize_track(conn, track_id)
        if note:
            out.append({"track_id": track_id, "note": note})
    return out


def log(conn: sqlite3.Connection, source: str, status: str, message: str, track_id: int | None = None) -> dict:
    conn.execute(
        "INSERT INTO import_log (created_at, source_name, status, message, track_id) VALUES (?, ?, ?, ?, ?)",
        (now_iso(), source, status, message, track_id),
    )
    conn.commit()
    return {"source_name": source, "status": status, "message": message, "track_id": track_id}


def import_file(conn: sqlite3.Connection, src: Path, source_name: str, move_source: bool = False) -> dict:
    ext = src.suffix.lower()
    if ext not in SUPPORTED_FORMATS:
        supported = ", ".join(sorted({v[0] for v in SUPPORTED_FORMATS.values()}))
        return log(conn, source_name, "unsupported", f"不支持的格式 {ext or '(无扩展名)'}；支持：{supported}")

    try:
        file_hash = sha256_file(src)
    except OSError as e:
        return log(conn, source_name, "error", f"读取文件失败: {e}")

    existing = conn.execute("SELECT id, title FROM track WHERE file_hash = ?", (file_hash,)).fetchone()
    if existing:
        if move_source:
            _archive_source(src)
        return log(conn, source_name, "duplicate",
                   f"完全相同的文件已在曲库中（#{existing['id']} {existing['title']}），未重复导入", existing["id"])

    try:
        meta = read_metadata(src)
    except MetadataError as e:
        return log(conn, source_name, "error", str(e))

    title, artist, track_number = meta.title, meta.artist, meta.track_number
    guessed = ""
    if not title:  # untagged file: read what we can from the filename
        g_title, g_artist, g_track = guess_from_filename(Path(source_name).stem)
        title = g_title or src.stem
        artist = artist or g_artist
        track_number = track_number or g_track
        guessed = f"；未找到标签，已从文件名识别：{title}" + (f" — {artist}" if artist else "")
    dest = unique_path(library_path(artist, meta.album_artist, meta.album, track_number, title, meta.file_ext))

    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        if sha256_file(dest) != file_hash:
            dest.unlink(missing_ok=True)
            return log(conn, source_name, "error", "复制后校验值不一致，已放弃导入（请检查磁盘）")
    except OSError as e:
        return log(conn, source_name, "error", f"写入曲库失败: {e}")

    artwork_rel = None
    if meta.artwork:
        data, art_ext = meta.artwork
        art_path = ARTWORK_DIR / f"{file_hash[:20]}{art_ext}"
        art_path.write_bytes(data)
        artwork_rel = rel(art_path)

    ts = now_iso()
    cur = conn.execute(
        """INSERT INTO track (title, artist, album, album_artist, composer, track_number, disc_number,
               release_year, genre, duration, file_path, audio_format, codec, mime_type, lossless,
               sample_rate, bit_depth, bitrate, channels, file_size, artwork_path, file_hash, added_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (title, artist, meta.album, meta.album_artist, meta.composer, track_number, meta.disc_number,
         meta.release_year, meta.genre, meta.duration, rel(dest), meta.audio_format, meta.codec, meta.mime_type,
         int(meta.lossless), meta.sample_rate, meta.bit_depth, meta.bitrate, meta.channels, dest.stat().st_size,
         artwork_rel, file_hash, ts, ts),
    )
    track_id = cur.lastrowid
    conn.execute("INSERT INTO listening_note (track_id, updated_at) VALUES (?, ?)", (track_id, ts))
    if meta.lyrics:
        conn.execute("INSERT INTO lyrics (track_id, content, source, updated_at) VALUES (?, ?, 'embedded', ?)",
                     (track_id, meta.lyrics, ts))
    conn.commit()

    if move_source:
        _archive_source(src)
    quality = meta.audio_format + (f" {meta.bit_depth}bit" if meta.bit_depth else "") + \
        (f" {meta.sample_rate / 1000:g}kHz" if meta.sample_rate else "") + \
        (f" {round(meta.bitrate / 1000)}kbps" if meta.bitrate and not meta.lossless else "")
    note = f"；原扩展名与实际内容不符，已按 {meta.audio_format} 保存为 {meta.file_ext}" if meta.ext_mismatch else ""
    return log(conn, source_name, "imported", f"已导入 → {rel(dest)}（{quality}）{guessed}{note}", track_id)


def _archive_source(src: Path) -> None:
    try:
        shutil.move(str(src), unique_path(IMPORTED_DIR / src.name))
    except OSError:
        pass


def scan_inbox(conn: sqlite3.Connection) -> list[dict]:
    results = []
    for path in sorted(IMPORT_DIR.rglob("*")):
        parts = path.relative_to(IMPORT_DIR).parts
        if not path.is_file() or parts[0] == IMPORTED_DIR.name or any(p.startswith(".") for p in parts):
            continue
        results.append(import_file(conn, path, path.relative_to(IMPORT_DIR).as_posix(), move_source=True))
    return results
