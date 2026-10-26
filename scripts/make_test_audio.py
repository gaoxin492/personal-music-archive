"""Generate 20 synthetic, copyright-free test tracks (FLAC / MP3 / WAV / OGG) with
tags and placeholder cover art, written into the import inbox by default.

    python scripts/make_test_audio.py [output_dir]

Requires: pip install -r backend/requirements-dev.txt
"""
import base64
import struct
import sys
import zlib
from pathlib import Path

import lameenc
import numpy as np
import soundfile as sf
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, TALB, TCOM, TDRC, TIT2, TPE1, TRCK
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE

SR = 44100
SECONDS = 24
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "MusicArchive" / "import"

# (title, album, format, base_midi, palette rgb)
TRACKS = [
    ("Test Signal 01 · Still Water", "Test Signals I", "flac24", 57, (40, 52, 64)),
    ("Test Signal 02 · 雨の窓", "Test Signals I", "flac24", 60, (34, 44, 58)),
    ("Test Signal 03 · Slow Light", "Test Signals I", "flac", 55, (48, 58, 70)),
    ("Test Signal 04 · 静寂", "Test Signals I", "flac", 62, (30, 40, 52)),
    ("Test Signal 05 · Tide", "Test Signals I", "mp3", 53, (52, 62, 74)),
    ("Test Signal 06 · Snow Field", "Test Signals I", "ogg", 64, (60, 68, 80)),
    ("Test Signal 07 · Pale Hour", "Test Signals I", "wav", 59, (44, 50, 60)),
    ("Overture Test · Curtain", "Test Signals II", "flac", 50, (92, 24, 30)),
    ("Overture Test · The Masque", "Test Signals II", "mp3", 52, (110, 30, 36)),
    ("Overture Test · Duel at Dawn", "Test Signals II", "mp3", 48, (84, 20, 28)),
    ("Overture Test · Candlelight", "Test Signals II", "flac24", 55, (120, 40, 40)),
    ("Overture Test · Finale", "Test Signals II", "mp3", 57, (96, 26, 32)),
    ("Overture Test · Entr'acte", "Test Signals II", "ogg", 53, (100, 34, 44)),
    ("测试曲 · 旧时月色", "测试信号 III", "flac", 58, (120, 82, 46)),
    ("测试曲 · 茶凉", "测试信号 III", "mp3", 61, (132, 92, 52)),
    ("测试曲 · 长亭", "测试信号 III", "mp3", 56, (104, 72, 40)),
    ("测试曲 · 烟雨", "测试信号 III", "flac", 63, (140, 100, 60)),
    ("测试曲 · 归途", "测试信号 III", "wav", 54, (112, 78, 44)),
    ("测试曲 · 落花", "测试信号 III", "mp3", 60, (126, 86, 50)),
    ("测试曲 · 尾声", "测试信号 III", "flac", 57, (96, 66, 38)),
]
ARTIST = "Archive Test Ensemble"
PENTATONIC = [0, 2, 4, 7, 9, 12, 14]


def synth(seed: int, base_midi: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = SR * SECONDS
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    # sustained pad
    for semis, gain in ((0, 0.10), (7, 0.06), (12, 0.04)):
        f = 440 * 2 ** ((base_midi - 12 + semis - 69) / 12)
        out[:, 0] += gain * np.sin(2 * np.pi * f * t)
        out[:, 1] += gain * np.sin(2 * np.pi * f * 1.002 * t)
    # plucked notes
    step = 0.75
    for i in range(int(SECONDS / step) - 2):
        midi = base_midi + PENTATONIC[rng.integers(len(PENTATONIC))]
        f = 440 * 2 ** ((midi - 69) / 12)
        start = int(i * step * SR)
        length = min(int(3 * SR), n - start)
        tt = np.arange(length) / SR
        note = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 2.2) * 0.22
        note += np.sin(2 * np.pi * f * 2 * tt) * np.exp(-tt * 4) * 0.05
        pan = rng.uniform(0.3, 0.7)
        out[start:start + length, 0] += note * (1 - pan)
        out[start:start + length, 1] += note * pan
    fade = int(SR * 2)
    out[:fade] *= np.linspace(0, 1, fade)[:, None]
    out[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return np.clip(out / max(1e-9, np.abs(out).max()) * 0.8, -1, 1)


def png(rgb: tuple[int, int, int], size: int = 600) -> bytes:
    """Placeholder cover: a soft radial gradient with a thin ring, as raw PNG."""
    y, x = np.mgrid[0:size, 0:size]
    d = np.hypot(x - size * 0.38, y - size * 0.4) / size
    shade = np.clip(1.25 - d * 1.4, 0.25, 1.25)
    img = np.stack([np.clip(c * shade, 0, 255) for c in rgb], axis=-1)
    ring = np.abs(np.hypot(x - size / 2, y - size / 2) - size * 0.32) < 1.2
    img[ring] = np.minimum(img[ring] + 60, 255)
    raw = b"".join(b"\x00" + row.astype(np.uint8).tobytes() for row in img)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def picture(cover: bytes) -> Picture:
    p = Picture()
    p.type, p.mime, p.desc, p.width, p.height, p.depth = 3, "image/png", "Front cover", 600, 600, 24
    p.data = cover
    return p


def id3_tags(tags: ID3, title: str, album: str, num: int, cover: bytes) -> None:
    tags.add(TIT2(encoding=3, text=title))
    tags.add(TPE1(encoding=3, text=ARTIST))
    tags.add(TALB(encoding=3, text=album))
    tags.add(TCOM(encoding=3, text="Generated"))
    tags.add(TRCK(encoding=3, text=str(num)))
    tags.add(TDRC(encoding=3, text="2026"))
    tags.add(APIC(encoding=3, mime="image/png", type=3, desc="Cover", data=cover))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    OUT.mkdir(parents=True, exist_ok=True)
    album_counter: dict[str, int] = {}
    for i, (title, album, fmt, base, rgb) in enumerate(TRACKS, 1):
        num = album_counter[album] = album_counter.get(album, 0) + 1
        audio = synth(i, base)
        cover = png(rgb)
        stem = f"{i:02d} {title}".replace("·", "-").replace("'", "")
        if fmt.startswith("flac"):
            path = OUT / f"{stem}.flac"
            sf.write(path, audio, SR, subtype="PCM_24" if fmt == "flac24" else "PCM_16")
            f = FLAC(path)
            f.update({"title": title, "artist": ARTIST, "album": album, "composer": "Generated",
                      "tracknumber": str(num), "date": "2026"})
            f.add_picture(picture(cover))
            f.save()
        elif fmt == "mp3":
            path = OUT / f"{stem}.mp3"
            enc = lameenc.Encoder()
            enc.set_bit_rate(320)
            enc.set_in_sample_rate(SR)
            enc.set_channels(2)
            enc.set_quality(2)
            pcm = (audio * 32767).astype("<i2").tobytes()
            path.write_bytes(enc.encode(pcm) + enc.flush())
            tags = ID3()
            id3_tags(tags, title, album, num, cover)
            tags.save(path)
        elif fmt == "wav":
            path = OUT / f"{stem}.wav"
            sf.write(path, audio, SR, subtype="PCM_16")
            w = WAVE(path)
            w.add_tags()
            id3_tags(w.tags, title, album, num, cover)
            w.save()
        else:
            path = OUT / f"{stem}.ogg"
            # libsndfile's Vorbis encoder overflows the stack on large single writes (Windows)
            with sf.SoundFile(path, "w", SR, 2, format="OGG", subtype="VORBIS") as fh:
                for start in range(0, len(audio), 4096):
                    fh.write(audio[start:start + 4096])
            o = OggVorbis(path)
            o.update({"title": title, "artist": ARTIST, "album": album, "composer": "Generated",
                      "tracknumber": str(num), "date": "2026"})
            o["metadata_block_picture"] = [base64.b64encode(picture(cover).write()).decode("ascii")]
            o.save()
        print(f"wrote {path.name}")
    print(f"\n{len(TRACKS)} test tracks in {OUT}")


if __name__ == "__main__":
    main()
