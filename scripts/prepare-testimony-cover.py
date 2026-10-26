#!/usr/bin/env python3
"""Give the Carlo Yarte testimony the same LCF title-card thumbnail Janime has.

Run with Pillow==12.3.0:  python3 scripts/prepare-testimony-cover.py

Why this exists: Janime's testimony card already carried the church's own
in-video title card (the LCF Lifegiver Church of Faith lockup on black), while
Carlo's card pointed at a blank black 1920 x 1080 file, so the video looked
broken in Stories of Grace. This script takes the lockup from the supplied
title card that is already committed as Janime's cover -- nothing is redrawn,
retyped, generated or re-coloured -- and composites it onto a fresh pure-black
1280 x 720 canvas at the exact same scale and position. Both testimonies then
show the identical title card, which is what the pair of cards is meant to look
like next to each other.

The source cover is read, not overwritten: only
public/brand/gallery/drive/carlo-yarte-testimony-cover.webp is written.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
COVERS = ROOT / 'public/brand/gallery/drive'
TITLE_CARD = COVERS / 'janime-rivera-testimony-cover.webp'   # supplied LCF title card
TARGET = COVERS / 'carlo-yarte-testimony-cover.webp'
SIZE = (1280, 720)          # the 16:9 frame every Stories of Grace cover uses
# A pixel counts as part of the lockup once any channel is brighter than this.
# The card's background is pure #000, so the threshold only trims black.
LUMINANCE_FLOOR = 24

with Image.open(TITLE_CARD) as card:
    card = card.convert('RGB')
    if card.size != SIZE:
        raise SystemExit(f'{TITLE_CARD.name} is {card.size}, expected {SIZE}.')
    # Measure where the lockup actually sits, instead of hard-coding numbers
    # that a future replacement title card would silently invalidate.
    grey = card.convert('L')
    left, top, right, bottom = grey.point(
        lambda value: 255 if value > LUMINANCE_FLOOR else 0
    ).getbbox()
    lockup = card.crop((left, top, right, bottom))

    cover = Image.new('RGB', SIZE, (0, 0, 0))
    cover.paste(lockup, (left, top))
    cover.save(TARGET, 'WEBP', lossless=True, method=6, exact=True)

    # Lossless WebP must decode back to exactly what was composited.
    with Image.open(TARGET) as decoded:
        assert decoded.size == SIZE
        assert decoded.convert('RGB').tobytes() == cover.tobytes()

print(f'{TARGET.relative_to(ROOT)}  {TARGET.stat().st_size} bytes  '
      f'lockup {lockup.width} x {lockup.height} at ({left}, {top})')
