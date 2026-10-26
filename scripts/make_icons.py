"""Render the app icon (a vinyl record with a walnut label) as PNGs and a Windows .ico.

    python scripts/make_icons.py

Writes into frontend/public/, which Vite copies into the build.
"""
import struct
import zlib
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parents[1] / "frontend" / "public"

BG = np.array([44, 38, 33])        # warm grey, so the black record reads against it
VINYL = np.array([14, 13, 12])
GROOVE = np.array([30, 27, 24])
LABEL = np.array([168, 123, 82])   # walnut-light
LABEL_DARK = np.array([110, 76, 49])


def render(size: int, padding: float) -> np.ndarray:
    """padding: fraction of the canvas left around the record (maskable icons need ~10%)."""
    ss = 4  # supersample for smooth edges
    n = size * ss
    y, x = np.mgrid[0:n, 0:n] + 0.5
    r = np.hypot(x - n / 2, y - n / 2) / (n / 2)  # 0 at centre, 1 at canvas edge
    disc = 1 - padding * 2
    img = np.broadcast_to(BG, (n, n, 3)).astype(float).copy()

    rec = r <= disc
    img[rec] = VINYL
    grooves = rec & (r > disc * 0.42) & (np.sin(r / disc * 70) > 0.55)
    img[grooves] = GROOVE
    rim = rec & (r > disc * 0.97)
    img[rim] = GROOVE
    label = r <= disc * 0.36
    shade = np.clip(1.15 - (np.hypot(x - n * 0.44, y - n * 0.42) / n) * 1.6, 0.75, 1.1)[..., None]
    img[label] = (LABEL * shade)[label]
    ring = label & (np.abs(r - disc * 0.26) < disc * 0.012)
    img[ring] = LABEL_DARK
    img[r <= disc * 0.045] = BG

    img = img.reshape(size, ss, size, ss, 3).mean(axis=(1, 3))
    return np.clip(img, 0, 255).astype(np.uint8)


def png_bytes(img: np.ndarray) -> bytes:
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + row.tobytes() for row in img)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def ico_bytes(images: list[bytes], sizes: list[int]) -> bytes:
    """ICO container holding PNG-compressed images (supported since Windows Vista)."""
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, blobs = b"", b""
    for data, s in zip(images, sizes):
        dim = 0 if s >= 256 else s
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return header + entries + blobs


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        (OUT / f"icon-{size}.png").write_bytes(png_bytes(render(size, 0.03)))
    (OUT / "icon-maskable-512.png").write_bytes(png_bytes(render(512, 0.12)))
    (OUT / "apple-touch-icon.png").write_bytes(png_bytes(render(180, 0.06)))
    ico_sizes = [16, 32, 48, 256]
    (OUT / "icon.ico").write_bytes(ico_bytes([png_bytes(render(s, 0.02)) for s in ico_sizes], ico_sizes))
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
