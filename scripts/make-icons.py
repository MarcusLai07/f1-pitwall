"""Draw the extension icons (a tiny timing tower) without any image libraries."""
import struct, sys, zlib
from pathlib import Path

def png(size: int) -> bytes:
    ss = 4  # supersampling
    n = size * ss
    bars = [(0.22, 0.30, 0.78, (225, 6, 0)), (0.45, 0.30, 0.64, (240, 240, 240)), (0.68, 0.30, 0.52, (240, 240, 240))]
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    x = (px * ss + sx + 0.5) / n
                    y = (py * ss + sy + 0.5) / n
                    r = 0.2  # corner radius
                    cx = min(max(x, r), 1 - r); cy = min(max(y, r), 1 - r)
                    if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                        continue
                    col = (14, 14, 18)
                    for top, left, right, c in bars:
                        if top <= y <= top + 0.13 and left <= x <= right:
                            col = c
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            k = ss * ss
            row += bytes([acc[0] // k, acc[1] // k, acc[2] // k, acc[3] // k]) if acc[3] else bytes(4)
        rows.append(bytes(row))
    raw = b"".join(rows)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

out = Path(sys.argv[1])
for s in (16, 32, 48, 128):
    (out / f"icon-{s}.png").write_bytes(png(s))
