"""Paths and settings. Everything lives under one archive root so the whole
library (audio + database + artwork) can be copied to another disk as a unit."""
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_ROOT = Path(os.environ.get("MUSIC_ARCHIVE_ROOT", PROJECT_ROOT / "MusicArchive")).resolve()
# Windows caps ordinary paths at 260 characters; Artist/Album/Title trees in a deep
# folder or NAS share exceed that easily. The \\?\ prefix lifts the limit.
if os.name == "nt" and not str(ARCHIVE_ROOT).startswith("\\\\"):
    ARCHIVE_ROOT = Path("\\\\?\\" + str(ARCHIVE_ROOT))
ARCHIVE_ROOT_DISPLAY = str(ARCHIVE_ROOT).removeprefix("\\\\?\\")

AUDIO_DIR = ARCHIVE_ROOT / "audio"
ARTWORK_DIR = ARCHIVE_ROOT / "artwork"
METADATA_DIR = ARCHIVE_ROOT / "metadata"
DATABASE_DIR = ARCHIVE_ROOT / "database"
BACKUP_DIR = ARCHIVE_ROOT / "backups"
IMPORT_DIR = ARCHIVE_ROOT / "import"          # drop files here, then "scan inbox"
IMPORTED_DIR = IMPORT_DIR / "_imported"        # inbox files move here once imported
TRASH_DIR = ARCHIVE_ROOT / "trash"             # removed tracks go here, never hard-deleted
DB_PATH = DATABASE_DIR / "archive.db"

FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

# extension -> (format label, MIME type served to the browser, lossless?)
SUPPORTED_FORMATS: dict[str, tuple[str, str, bool]] = {
    ".mp3": ("MP3", "audio/mpeg", False),
    ".flac": ("FLAC", "audio/flac", True),
    ".m4a": ("M4A", "audio/mp4", False),   # AAC or ALAC; refined from the codec at import
    ".mp4": ("M4A", "audio/mp4", False),
    ".aac": ("AAC", "audio/aac", False),
    ".wav": ("WAV", "audio/wav", True),
    ".aif": ("AIFF", "audio/aiff", True),
    ".aiff": ("AIFF", "audio/aiff", True),
    ".ogg": ("OGG", "audio/ogg", False),
    ".opus": ("OPUS", "audio/ogg", False),
}


def ensure_dirs() -> None:
    for d in (AUDIO_DIR, ARTWORK_DIR, METADATA_DIR, DATABASE_DIR, BACKUP_DIR, IMPORT_DIR, IMPORTED_DIR, TRASH_DIR):
        d.mkdir(parents=True, exist_ok=True)
