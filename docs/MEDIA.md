# LIFEGEN gallery import — 2026-10-14

Source: [LIFEGEN Drive folder](https://drive.google.com/drive/folders/1U5ipH3vXocYHt5VrkodRskvgppdF_dwT).

## Placement

- All **48 JPEGs** from `PHOTOS / LIFEGEN` fill the existing photo deck under Stories & highlights. Similar photos are kept; nothing was discarded as a duplicate.
- The root **LIFEGEN PNG artwork** fills the poster card in the photo deck. It is artwork, not a claimed video still.
- **GRAND CAMPUS HANGOUT.mp4** replaces the previous Facebook reel in the highlight frame. Drive metadata reports 3840 × 2160, 133.06 seconds, and 602,817,546 bytes. The frame retains the correct 16:9 ratio.
- The highlight's **thumbnail** is the video's own title card, the supplied screenshot `GRAND CAMPUS HANGOUT title card.png` (“GRAND CAMPUS HANGOUT 2026 / LIGHT UP THE CAMPUS”). It is cropped to the frame's 16:9 and centred on that existing lettering, then written as the 1280 × 720 `grand-campus-hangout-cover.webp`. Nothing was redrawn, generated or retyped; the deck's poster card keeps the LIFEGEN artwork.
- **JANIME RIVERA TESTIMONYY** fills the first testimony frame under Stories of Grace (`1nz7eS6ge9ezqCHZrUnFyVfj28YfqEnHL0sncocPgZKQ`, 7 min 19 sec). The frame retains the 16:9 ratio and click-to-load embed with an always-visible fallback link. Its thumbnail is the supplied in-video title card featuring the LCF Lifegiver Church of Faith logo lockup on a black background, rendered as the 1280 × 720 `janime-rivera-testimony-cover.webp`. The second testimony slot remains as a "coming soon" placeholder.
- `PHOTOS / CAMPUS MINISTRY` returned no files. No unrelated media or invented testimonies were inserted.

## Quality and loading

- Full-size JPEGs are **byte-identical** to the downloaded originals. SHA-256 checksums and source filenames are recorded in `public/brand/gallery/drive/manifest.json`.
- Full-size artwork is **lossless WebP**, with decoded RGBA pixels verified against the PNG by the import script: 4,372,716 → 2,021,956 bytes (54% smaller).
- Deck previews are at most 512 px, WebP quality 92. These are resized, lossy **display previews**, not replacements for the originals. The deck's roughly 252 CSS-pixel cards get approximately 2× resolution. Whole photos remain visible, without cropping people's faces from landscape groups.
- The 49 previews total **3,040,670 bytes** versus **19,833,282 bytes** for the source images (about **85% less**). They are lazy-loaded; full-size files load only when opened in the lightbox. The separate 1280 × 720 highlight thumbnail (73,346 bytes, WebP quality 92) is not included in that preview total.
- Video remains externally hosted and **was not locally recompressed**: its 603 MB size exceeds the Drive connector's 100 MB download limit. The original is untouched; Drive controls its playback renditions. No claim is made that a Drive rendition is lossless.
- The Drive player mounts only after the visitor presses Play, with fullscreen support and an always-visible “Open video in a new tab” fallback. There is no pre-play request to Drive, and no broadening of the site's content-security policy.
- Drive sharing was already enabled for anyone with the link. Permissions were not modified. The returned public permission allowed editing; the owner should consider changing public access to **Viewer** in Drive.

## Rebuilding

Download the same 48 JPEGs, the root artwork and the title-card screenshot into the ignored `google_drive/` folder. Keep their source filenames; the artwork is named `LIFEGEN` without an extension and the screenshot is named `GRAND CAMPUS HANGOUT title card.png`.

```sh
python -m venv .venv
.venv/bin/pip install Pillow==12.3.0
.venv/bin/python scripts/prepare-gallery.py
npm run build
npm test
```

This writes deployable assets and the manifest, and updates the existing deck's cards in `public/lifegen/index.html`. Python/Pillow are import-time tools only; production needs no new dependencies. Raw downloads, the Python environment, browser tooling and screenshots are excluded from Git and deployment. `npm test` checks completeness, file hashes, image dimensions, preview size savings, the 1280 × 720 highlight thumbnail and highlight placement.

## Verification

Browser smoke checks covered desktop (1440 px), tablet (768 px) and mobile (390 px), all 49 cards, full-resolution loading, previous/next wraparound, Escape, focus trapping/restoration, no horizontal page overflow, and click-to-load Drive iframe creation. No browser JavaScript errors were observed. Actual third-party video playback could not be verified in the network-restricted sandbox; test it in a signed-out browser on the deployed site. Database-backed features are outside this media update.

## Landing-page branding

The same supplied artwork now serves as the landing-page banner. The banner is
rendered as an uncropped image (not a background behind duplicate branding),
with responsive 960 px / 1920 px versions and a matching responsive preload.
Both are lossless WebP encodings of their resized pixels; the full-resolution
artwork remains available in the gallery. The header and footer use a square
crop of the artwork's original emblem, and the favicon uses the same crop.
No generated artwork or alterations to the lettering were used.

Rebuild these assets from the already-imported, lossless artwork with:

```sh
.venv/bin/python scripts/prepare-brand.py
```

Desktop and mobile browser checks verify the banner and logo load, the complete
banner sits behind the navigation, there is one accessible primary heading, and
there is no horizontal page overflow. Grand Campus Hangout stays in its highlight
frame; this branding update does not change the video.

The landing header overlays the actual banner with a fully transparent
background at the top of the page. No separate header strip or side letterboxing
is reserved. After scrolling, the fixed navigation gets a translucent dark
background for readability.

### Keeping the first screen a landing page

The artwork is 16:9. Painted at `100vw` it was already a full screen tall on a
1440 × 900 laptop, so visitors saw nothing but the poster until they scrolled.
It now fills the width edge to edge **and** fits a laptop screen:

- Tablet/laptop (≥ 641 px): the strip is cropped top and bottom to a band —
  `height:min(28.3vw + 144px, 78vh)` with `object-fit:cover`, centred. The
  artwork's emblem is 26.2vw tall and starts 14.1vw down once the artwork spans
  the viewport, so the band keeps the emblem whole with ~75–84 px of clearance
  above it. That clearance is what holds the fixed navigation clear of the logo
  printed in the artwork: the bar pads itself from the viewport height
  (`clamp(6px, 1.4vh, 14px)`) so short screens get a shorter bar, and the header
  logo never reaches the banner logo at any tested size — 22 px of gap at
  1440 × 900, 21 px at 1920 × 1080, still positive at 2560 × 1080 and
  3440 × 1440. `tests/gallery-media.test.mjs` recomputes that gap from the
  stylesheet at 19 viewports and fails if it closes.
  On a 1440 × 900 screen the band is 1440 × 552 (61% of the screen), and the
  page below it — tagline, welcome copy, calls to action and the service
  countdown — is visible without scrolling.
- Phones (≤ 640 px): the artwork is shown whole and uncropped (`height:auto`),
  which is already short there and keeps the address and service time readable.
  The header is compact (30 px logo, 36 px menu button, 4 px bar padding) so it
  clears the logo printed inside the artwork.

There are **no side bars and no matte**: nothing is drawn beside the artwork at
any width. An earlier revision capped the banner's width and matted the leftover
space with a blurred copy of the artwork; that letterboxing is gone, along with
the `lifegen-banner-blur.webp` asset it needed.

Preview and database-warning notices remain visible below the artwork instead
of creating a gap above it. Checks at 320, 390, 768, 962 and 1440 px cover the
cropped banner (it spans the full width at every size, the artwork starts at the
top edge, the mobile menu works, the scrolled navigation is readable and there
is no horizontal overflow); `npm test` locks the band, the full-bleed rule and
the absence of any side matte in place. Because the sandbox has no browser,
those checks combine the served CSS with a pixel-accurate render of the same
rules — re-run them in a real browser before launch.
