#!/usr/bin/env python3
"""Generate Android launcher icons (dark neon) from assets/icon-1024.png."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android/app/src/main/res"
SRC = ROOT / "assets/icon-1024.png"
BG = (5, 8, 20, 255)

art = Image.open(SRC).convert("RGBA")
# Trim the pure-black outer margin so the neon frame sits near the square edges.
art = art.crop((18, 18, art.width - 18, art.height - 18))

# Full-bleed square version (black -> app background colour)
sq = Image.new("RGBA", art.size, BG)
sq.alpha_composite(art)

legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
adaptive = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

def circle_mask(size: int, ss: int = 4) -> Image.Image:
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size * ss - 1, size * ss - 1), fill=255)
    return m.resize((size, size), Image.LANCZOS)

for dpi, size in legacy.items():
    out = RES / f"mipmap-{dpi}"
    out.mkdir(parents=True, exist_ok=True)

    icon = sq.resize((size, size), Image.LANCZOS)
    icon.save(out / "ic_launcher.png")

    round_icon = icon.copy()
    round_icon.putalpha(circle_mask(size))
    round_icon.save(out / "ic_launcher_round.png")

    fg_size = adaptive[dpi]
    fg = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
    inner = int(fg_size * 0.74)
    scaled = sq.resize((inner, inner), Image.LANCZOS)
    off = (fg_size - inner) // 2
    fg.alpha_composite(scaled, (off, off))
    fg.save(out / "ic_launcher_foreground.png")

# Play-store style extras
sq.resize((512, 512), Image.LANCZOS).save(ROOT / "assets/icon-512.png")
print("icons written")
