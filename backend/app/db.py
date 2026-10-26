"""SQLite schema and connection helpers. Audio never goes into the database;
only paths (relative to the archive root) and metadata do."""
import sqlite3
from datetime import datetime, timezone

from .config import DB_PATH

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS track (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    artist         TEXT,
    album          TEXT,
    album_artist   TEXT,
    composer       TEXT,
    track_number   INTEGER,
    disc_number    INTEGER,
    release_year   INTEGER,
    genre          TEXT,
    duration       REAL,
    -- recording/version identity: several tracks may share one `work`
    work           TEXT,
    version_label  TEXT,     -- e.g. "1986 Original London Cast", "Live 1996"
    performers     TEXT,     -- singers / cast
    role           TEXT,     -- character, for musical theatre
    file_path      TEXT NOT NULL UNIQUE,   -- relative to the archive root
    audio_format   TEXT,
    codec          TEXT,
    mime_type      TEXT,
    lossless       INTEGER NOT NULL DEFAULT 0,
    sample_rate    INTEGER,
    bit_depth      INTEGER,
    bitrate        INTEGER,
    channels       INTEGER,
    file_size      INTEGER,
    artwork_path   TEXT,
    file_hash      TEXT NOT NULL UNIQUE,   -- sha256 of the original file
    added_at       TEXT NOT NULL,
    updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS collection (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'collection',   -- 'collection' | 'playlist'
    name        TEXT NOT NULL,
    subtitle    TEXT,
    description TEXT,
    cover_art   TEXT,
    theme       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_track (
    collection_id INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
    track_id      INTEGER NOT NULL REFERENCES track(id) ON DELETE CASCADE,
    order_index   INTEGER NOT NULL DEFAULT 0,
    added_at      TEXT NOT NULL,
    PRIMARY KEY (collection_id, track_id)
);

CREATE TABLE IF NOT EXISTS listening_note (
    track_id            INTEGER PRIMARY KEY REFERENCES track(id) ON DELETE CASCADE,
    rating              INTEGER,            -- 0..5
    favorite            INTEGER NOT NULL DEFAULT 0,
    mood_tags           TEXT NOT NULL DEFAULT '[]',   -- JSON array
    personal_note       TEXT,
    first_heard_at      TEXT,
    first_heard_context TEXT,
    updated_at          TEXT
);

CREATE TABLE IF NOT EXISTS acquisition (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id        INTEGER NOT NULL REFERENCES track(id) ON DELETE CASCADE,
    source_type     TEXT,     -- download_store | cd_rip | bandcamp | other
    store_name      TEXT,
    purchase_url    TEXT,
    purchase_date   TEXT,
    original_format TEXT,
    rights_notes    TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lyrics (
    track_id    INTEGER PRIMARY KEY REFERENCES track(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,      -- LRC (with [mm:ss.xx] timestamps) or plain text
    source      TEXT,               -- manual | lrc_file | embedded
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    source_name TEXT NOT NULL,
    status      TEXT NOT NULL,      -- imported | duplicate | unsupported | error
    message     TEXT,
    track_id    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_track_work ON track(work);
CREATE INDEX IF NOT EXISTS idx_ct_track ON collection_track(track_id);
"""

DEFAULT_COLLECTIONS = [
    {
        "name": "Solitude",
        "subtitle": "坂本龙一 · 深邃与宁静",
        "description": "钢琴、电影配乐、实验与环境音乐。孤独、哲理、时间、宁静、深邃。\n"
        "候选：Merry Christmas Mr. Lawrence · Energy Flow · Aqua · Bibo no Aozora · Solitude（待确认录音版本）",
        "theme": "solitude",
    },
    {
        "name": "Theatre",
        "subtitle": "音乐剧 · 戏剧与命运",
        "description": "喜欢的音乐剧唱段与原声专辑。同一唱段可保留多个演出版本。\n"
        "初始：The Phantom of the Opera · Hamilton；未来：Elisabeth · Rebecca · Notre-Dame de Paris",
        "theme": "theatre",
    },
    {
        "name": "Memories",
        "subtitle": "华语混选 · 悲情与回忆",
        "description": "旋律鲜明的华语经典，古风、悲情、宿命感，有年代记忆的作品。\n"
        "已表达喜欢：《泪海》《茶汤》（导入时确认歌手与演唱版本）",
        "theme": "memories",
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    # FastAPI may run a dependency's setup and teardown on different worker threads;
    # each connection still serves only one request at a time.
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # SQLite's LIKE only folds ASCII case; use Python's Unicode casefold for search
    conn.create_function("ufold", 1, lambda s: s.casefold() if isinstance(s, str) else s, deterministic=True)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version == 0:
            for i, c in enumerate(DEFAULT_COLLECTIONS):
                conn.execute(
                    "INSERT INTO collection (kind, name, subtitle, description, theme, sort_order, created_at)"
                    " VALUES ('collection', ?, ?, ?, ?, ?, ?)",
                    (c["name"], c["subtitle"], c["description"], c["theme"], i, now_iso()),
                )
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    finally:
        conn.close()


def get_db():
    """FastAPI dependency: one connection per request."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
