#!/usr/bin/env python3
"""Derive the landing banner and emblem from the imported LIFEGEN artwork.
Run with Pillow==12.3.0. No generative edits or JPEG re-encoding are involved.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public/brand'
with Image.open(DEST / 'gallery/drive/lifegen-artwork.webp') as artwork:
    for width in (960, 1920):
        banner = artwork.resize((width, round(artwork.height * width / artwork.width)), Image.Resampling.LANCZOS)
        banner.save(DEST / f'lifegen-banner-{width}.webp', lossless=True, method=6, exact=True)
    # Square emblem, including its white border and LIFE GENERATION lettering.
    # Coordinates refer to the 4269 × 2400 original, not the video-cover preview.
    emblem = artwork.crop((474, 603, 1594, 1723))
    for name, size in [('lifegen-emblem.webp', 320), ('lifegen-icon.webp', 64)]:
        image = emblem.resize((size, size), Image.Resampling.LANCZOS)
        image.save(DEST / name, lossless=True, method=6, exact=True)
        with Image.open(DEST / name) as decoded:
            assert decoded.convert('RGBA').tobytes() == image.convert('RGBA').tobytes()
for path in sorted(DEST.glob('lifegen-*.webp')):
    print(path.name, path.stat().st_size, 'bytes')
