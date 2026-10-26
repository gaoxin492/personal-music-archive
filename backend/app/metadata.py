"""Read tags, stream info and embedded artwork with Mutagen.
The original file is never modified; edits made in the app live in SQLite."""
import base64
import re
import struct
from dataclasses import dataclass, field
from pathlib import Path

import mutagen
from mutagen.aiff import AIFF
from mutagen.flac import FLAC, Picture
from mutagen.id3 import ID3
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE

from .config import SUPPORTED_FORMATS

# Container detected from the file's content -> the extension it should carry.
# Downloads are often mislabelled, e.g. AAC-in-MP4 saved as ".mp3".
REAL_EXTENSION = [(MP4, ".m4a"), (MP3, ".mp3"), (FLAC, ".flac"), (OggOpus, ".opus"),
                  (OggVorbis, ".ogg"), (WAVE, ".wav"), (AIFF, ".aiff")]
EQUIVALENT_EXT = {".mp4": ".m4a", ".aif": ".aiff"}

ID3_FRAMES = {
    "title": "TIT2", "artist": "TPE1", "album": "TALB", "albumartist": "TPE2",
    "composer": "TCOM", "tracknumber": "TRCK", "discnumber": "TPOS", "date": "TDRC", "genre": "TCON",
}


class MetadataError(Exception):
    pass


@dataclass
class AudioMeta:
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    album_artist: str | None = None
    composer: str | None = None
    track_number: int | None = None
    disc_number: int | None = None
    release_year: int | None = None
    genre: str | None = None
    duration: float | None = None
    audio_format: str = ""
    codec: str = ""
    mime_type: str = ""
    lossless: bool = False
    sample_rate: int | None = None
    bit_depth: int | None = None
    bitrate: int | None = None
    channels: int | None = None
    lyrics: str | None = None     # embedded lyrics (often plain text, sometimes LRC)
    file_ext: str = ""            # extension matching the real container
    ext_mismatch: bool = False    # the original file's extension did not match its content
    artwork: tuple[bytes, str] | None = field(default=None, repr=False)  # (data, extension)


def _first_int(value: str | None) -> int | None:
    if not value:
        return None
    m = re.match(r"\s*(\d+)", str(value))
    return int(m.group(1)) if m else None


def _year(value: str | None) -> int | None:
    if not value:
        return None
    m = re.search(r"(\d{4})", str(value))
    return int(m.group(1)) if m else None


def _text(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, list):
        v = v[0] if v else None
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _read_tags(path: Path) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    easy = mutagen.File(path, easy=True)
    tags = getattr(easy, "tags", None) if easy is not None else None
    if tags is None:
        return out
    if isinstance(tags, ID3):  # WAV / AIFF expose raw ID3 even with easy=True
        for key, frame in ID3_FRAMES.items():
            f = tags.get(frame)
            out[key] = _text(f.text) if f is not None else None
        return out
    for key in ID3_FRAMES:
        try:
            out[key] = _text(tags.get(key))
        except (KeyError, ValueError):
            out[key] = None
    return out


def _ext_for_mime(mime: str) -> str:
    return ".png" if "png" in (mime or "").lower() else ".jpg"


def _read_artwork(f) -> tuple[bytes, str] | None:
    tags = getattr(f, "tags", None)
    pictures = getattr(f, "pictures", None)  # FLAC
    if pictures:
        p = pictures[0]
        return p.data, _ext_for_mime(p.mime)
    if isinstance(tags, ID3):
        apics = tags.getall("APIC")
        if apics:
            return apics[0].data, _ext_for_mime(apics[0].mime)
    if isinstance(f, MP4) and tags and "covr" in tags and tags["covr"]:
        c = tags["covr"][0]
        return bytes(c), ".png" if c.imageformat == MP4Cover.FORMAT_PNG else ".jpg"
    if tags is not None and hasattr(tags, "get"):
        try:
            blocks = tags.get("metadata_block_picture")
        except (KeyError, ValueError):
            blocks = None
        if blocks:
            try:
                p = Picture(base64.b64decode(blocks[0]))
                return p.data, _ext_for_mime(p.mime)
            except Exception:
                return None
    return None


def _read_lyrics(f) -> str | None:
    tags = getattr(f, "tags", None)
    if tags is None:
        return None
    text = None
    if isinstance(tags, ID3):
        frames = tags.getall("USLT")
        text = frames[0].text if frames else None
    elif isinstance(f, MP4):
        text = _text(tags.get("\xa9lyr"))
    else:  # Vorbis comments (FLAC / Ogg)
        for key in ("lyrics", "unsyncedlyrics"):
            try:
                text = _text(tags.get(key))
            except (KeyError, ValueError):
                text = None
            if text:
                break
    return text.strip() if text and text.strip() else None


def _fragmented_mp4_duration(path: Path) -> float | None:
    """Fragmented MP4 (DASH, e.g. audio pulled from video sites) leaves the moov
    duration at 0; the real length is the sum of the segment index (sidx) entries."""
    try:
        with path.open("rb") as fh:
            while True:
                header = fh.read(8)
                if len(header) < 8:
                    return None
                size, box = struct.unpack(">I4s", header)
                header_len = 8
                if size == 1:
                    size = struct.unpack(">Q", fh.read(8))[0]
                    header_len = 16
                elif size == 0:
                    return None
                if box == b"sidx":
                    body = fh.read(size - header_len)
                    version = body[0]
                    timescale = struct.unpack(">I", body[8:12])[0]
                    off = 12 + (8 if version == 0 else 16) + 2  # skip pts/offset + reserved
                    count = struct.unpack(">H", body[off:off + 2])[0]
                    off += 2
                    total = sum(struct.unpack(">I", body[off + 12 * i + 4:off + 12 * i + 8])[0] for i in range(count))
                    return total / timescale if timescale else None
                fh.seek(size - header_len, 1)
    except (OSError, struct.error, IndexError):
        return None


def read_metadata(path: Path) -> AudioMeta:
    ext = path.suffix.lower()
    if ext not in SUPPORTED_FORMATS:
        raise MetadataError(f"不支持的格式: {ext or '(无扩展名)'}")
    try:
        f = mutagen.File(path)
    except Exception as e:  # mutagen raises format-specific errors on corrupt files
        raise MetadataError(f"无法解析音频文件: {e}") from e
    if f is None or f.info is None:
        raise MetadataError("无法识别的音频内容（文件可能损坏或扩展名不符）")

    real_ext = next((e for cls, e in REAL_EXTENSION if isinstance(f, cls)), None)
    ext_mismatch = real_ext is not None and EQUIVALENT_EXT.get(ext, ext) != real_ext
    if ext_mismatch:
        ext = real_ext

    fmt, mime, lossless = SUPPORTED_FORMATS[ext]
    info = f.info
    codec = ext.lstrip(".")
    if isinstance(f, MP4):
        codec = getattr(info, "codec", "") or "mp4a"
        if codec == "alac":
            fmt, lossless = "ALAC", True
        else:
            fmt = "AAC"
    elif ext == ".ogg":
        codec = "vorbis"
    elif ext == ".opus":
        codec = "opus"

    tags = _read_tags(path)
    bitrate = getattr(info, "bitrate", None)
    length = getattr(info, "length", None)
    if not length and isinstance(f, MP4):
        length = _fragmented_mp4_duration(path)
    meta = AudioMeta(
        title=tags.get("title"),
        artist=tags.get("artist"),
        album=tags.get("album"),
        album_artist=tags.get("albumartist"),
        composer=tags.get("composer"),
        track_number=_first_int(tags.get("tracknumber")),
        disc_number=_first_int(tags.get("discnumber")),
        release_year=_year(tags.get("date")),
        genre=tags.get("genre"),
        duration=round(float(length), 3) if length else None,
        audio_format=fmt,
        codec=codec,
        mime_type=mime,
        lossless=lossless,
        sample_rate=getattr(info, "sample_rate", None) or None,
        bit_depth=getattr(info, "bits_per_sample", None) or None,
        bitrate=int(bitrate) if bitrate else None,
        channels=getattr(info, "channels", None) or None,
        file_ext=ext,
        ext_mismatch=ext_mismatch,
    )
    try:
        meta.artwork = _read_artwork(f)
    except Exception:
        meta.artwork = None  # artwork is optional; never fail an import on it
    try:
        meta.lyrics = _read_lyrics(f)
    except Exception:
        meta.lyrics = None
    return meta
