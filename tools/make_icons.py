"""Draw the PWA icons (sound-wave bars) without any imaging library.

Usage (from the project root):
    .venv\\Scripts\\python.exe tools\\make_icons.py
"""
import struct
import zlib
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent.parent / "app" / "icons"
BG = (13, 110, 110)        # teal
FG = (255, 255, 255)
BARS = [0.30, 0.55, 0.80, 0.55, 0.30]   # relative bar heights


def draw(size: int) -> np.ndarray:
    img = np.empty((size, size, 3), dtype=np.uint8)
    img[:] = BG
    # Keep the drawing inside the maskable-icon safe zone (central 80%).
    bar_w = size * 0.09
    gap = size * 0.05
    total_w = len(BARS) * bar_w + (len(BARS) - 1) * gap
    x0 = (size - total_w) / 2
    yy, xx = np.mgrid[0:size, 0:size]
    for i, h in enumerate(BARS):
        left = x0 + i * (bar_w + gap)
        half = size * 0.55 * h / 2
        top, bottom = size / 2 - half, size / 2 + half
        r = bar_w / 2
        cx = left + r
        body = (xx >= left) & (xx < left + bar_w) & (yy >= top + r) & (yy < bottom - r)
        caps = ((xx - cx) ** 2 + (yy - (top + r)) ** 2 <= r * r) | \
               ((xx - cx) ** 2 + (yy - (bottom - r)) ** 2 <= r * r)
        img[body | caps] = FG
    return img


def write_png(path: Path, img: np.ndarray) -> None:
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
        write_png(OUT / name, draw(size))
        print(name)


if __name__ == "__main__":
    main()
