#!/usr/bin/env python3
"""Prepare the Drive gallery: pip install Pillow==12.3.0, then run this script.
Full JPEGs remain byte-identical. Artwork uses lossless WebP; small previews use high-quality WebP.
Raw downloads stay in the ignored google_drive/ directory, never in deployments.
"""
import hashlib
import json
import re
import shutil
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'google_drive'
DEST = ROOT / 'public/brand/gallery/drive'
DEST.mkdir(parents=True, exist_ok=True)
photos = sorted(SOURCE.glob('*_n.jpg'))
if len(photos) != 48 or not (SOURCE / 'LIFEGEN').exists():
    raise SystemExit('Expected all 48 LIFEGEN JPEGs and the LIFEGEN PNG artwork in google_drive/.')
entries = []
# The artwork fills the poster frame; the photos fill the LIFEGEN photo deck.
for index, source in enumerate([SOURCE / 'LIFEGEN', *photos]):
    slug = 'lifegen-artwork' if index == 0 else f'lifegen-photo-{index:02}'
    caption = 'LIFEGEN — Every Sunday, 1–3 PM' if index == 0 else f'LIFEGEN family — photo {index:02}'
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        width, height = image.size
        full = DEST / (slug + ('.webp' if index == 0 else '.jpg'))
        if index == 0:
            image.save(full, 'WEBP', lossless=True, method=6, exact=True)
            with Image.open(full) as decoded:
                assert decoded.convert('RGBA').tobytes() == image.convert('RGBA').tobytes()
        else:
            shutil.copyfile(source, full)  # Never re-encode already-compressed JPEGs.
            assert source.read_bytes() == full.read_bytes()
        if index == 0:
            cover = image.copy()
            cover.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
            cover.save(DEST / 'lifegen-highlight-cover.webp', 'WEBP', quality=92, method=6)
        thumb = image.copy()
        thumb.thumbnail((512, 512), Image.Resampling.LANCZOS)
        preview = DEST / (slug + '-preview.webp')
        thumb.save(preview, 'WEBP', quality=92, method=6)
        entries.append(dict(source=source.name, caption=caption, width=width, height=height,
                            full='/brand/gallery/drive/' + full.name,
                            preview='/brand/gallery/drive/' + preview.name,
                            sourceBytes=source.stat().st_size, fullBytes=full.stat().st_size,
                            previewBytes=preview.stat().st_size,
                            sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                            fullSha256=hashlib.sha256(full.read_bytes()).hexdigest()))
manifest = dict(sourceFolder='https://drive.google.com/drive/folders/1U5ipH3vXocYHt5VrkodRskvgppdF_dwT',
                importedOn='2026-10-14', items=entries)
(DEST / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
cards = '\n'.join(
    f'<button class="deck-card" type="button" data-img="{e["preview"]}" data-full="{e["full"]}" '
    f'data-caption="{e["caption"]}"></button>' for e in entries)
page = ROOT / 'public/lifegen/index.html'
html = page.read_text()
html, count = re.subn(r'(<div class="deck" id="photoDeck"[^>]*>).*?(</div>)',
                     lambda m: m[1] + '\n' + cards + '\n' + m[2], html, count=1, flags=re.S)
assert count == 1
page.write_text(html)
print(json.dumps({key: sum(e[key] for e in entries) for key in ['sourceBytes', 'fullBytes', 'previewBytes']}, indent=2))
