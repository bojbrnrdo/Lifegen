# LIFEGEN gallery import — 2026-10-14

Source: [LIFEGEN Drive folder](https://drive.google.com/drive/folders/1U5ipH3vXocYHt5VrkodRskvgppdF_dwT).

## Placement

- All **48 JPEGs** from `PHOTOS / LIFEGEN` fill the existing photo deck under Stories & highlights. Similar photos are kept; nothing was discarded as a duplicate.
- The root **LIFEGEN PNG artwork** fills the poster card in the photo deck. It is artwork, not a claimed video still.
- **GRAND CAMPUS HANGOUT.mp4** replaces the previous Facebook reel in the highlight frame. Drive metadata reports 3840 × 2160, 133.06 seconds, and 602,817,546 bytes. The frame retains the correct 16:9 ratio.
- The highlight's **thumbnail** is the video's own title card, the supplied screenshot `GRAND CAMPUS HANGOUT title card.png` (“GRAND CAMPUS HANGOUT 2026 / LIGHT UP THE CAMPUS”). It is cropped to the frame's 16:9 and centred on that existing lettering, then written as the 1280 × 720 `grand-campus-hangout-cover.webp`. Nothing was redrawn, generated or retyped; the deck's poster card keeps the LIFEGEN artwork.
- **JANIME RIVERA TESTIMONYY** fills the first testimony frame under Stories of Grace (`1nz7eS6ge9ezqCHZrUnFyVfj28YfqEnHL0sncocPgZKQ`, 7 min 19 sec). The frame retains the 16:9 ratio and plays the first-party MP4 directly on LIFEGEN; it does not expose the original Google Vids editor link. Its thumbnail is the supplied in-video title card featuring the LCF Lifegiver Church of Faith logo lockup on a black background, rendered as the 1280 × 720 `janime-rivera-testimony-cover.webp`.
- **CARLO YARTE** fills the second testimony frame under Stories of Grace (`10U72AgV_Od68he2tcLSZX9-zK3r8uKQh`, 3 min 11 sec) with the church's own copy at `public/brand/videos/carlo-yarte-testimony.mp4` (1920 × 1080, H.264 + AAC, 64.5 MB). Its thumbnail is the **same LCF title card Janime's card shows** — the Lifegiver Church of Faith lockup on black — rendered as the 1280 × 720 lossless `carlo-yarte-testimony-cover.webp`. `scripts/prepare-testimony-cover.py` builds it by taking the lockup from the supplied title card already committed as Janime's cover and pasting it, unaltered and at the same scale and position, onto a pure-black 1280 × 720 canvas; nothing is redrawn, retyped, recoloured or generated. The previous file was a blank black frame, which made the card look like a broken video. `tests/gallery-media.test.mjs` now pins the poster's path, its 16:9 1280 × 720 shape and that it is not empty.
- `PHOTOS / CAMPUS MINISTRY` returned no files. No unrelated media or invented testimonies were inserted.

## Highlight framing

The Grand Campus Hangout highlight uses the same unboxed framing as the
testimony videos: the 16:9 video is **not** wrapped in a card container — no
border, radius, card background or shadow — and it keeps the site's standard
Drive presentation, so the provider player fills the frame instead of sitting
inside a box. Only the descriptive text below the video is presented in a card
(`vmeta--text-card`). The block keeps its centred 960 px highlight width.

Both cards carry `data-unboxed-video="true"` and are styled by
`#stories .vcard[data-unboxed-video="true"]` plus a
`#stories .vcard-feature[data-unboxed-video="true"]` variant in
`public/lifegen/styles.css`. `tests/campus-hangout-unboxed-frame.test.mjs`
locks the highlight framing in place; the testimonies' own markup is untouched.

## First-party playback

The highlight slot names the church's own copy of the video in
`data-native-src`, e.g.

```html
<div class="vframe"
     data-video="https://drive.google.com/file/d/FILE_ID/view"
     data-native-src="/brand/videos/grand-campus-hangout.mp4"
     data-ratio="16/9" data-label="Grand Campus Hangout"
     data-poster="/brand/gallery/drive/grand-campus-hangout-cover.webp"></div>
```

`public/brand/videos/grand-campus-hangout.mp4` is that copy: 62 MB, 3840 ×
2160, H.264 High @ 5.1 with AAC stereo, faststart (the `moov` box precedes
`mdat`, so it starts playing while it downloads). Its 2 min 13 sec running time
is the same one the caption on the page shows.

### Why this file is kept at 3840 × 2160

The page renders the highlight 960 px wide, so the 4K frame is downscaled 4×
on screen — which is exactly what makes it look clean, because that averaging
hides the source's compression blocking. Measured against a reference rendered
at the displayed size (960 × 540), the committed file scores **VMAF 99.9**.

Re-encoding was tested rather than assumed, and it loses:

| candidate | VMAF at displayed size | full-size file |
| --- | --- | --- |
| **committed 4K file** | **99.9** | 62 MB |
| rebuild 1080p, 5 Mbps | 95.7 | ~79 MB |
| rebuild 720p, 5 Mbps | 96.4 | ~79 MB |
| rebuild 1080p, 7 Mbps | 98.0 | 111 MB (over GitHub's limit) |

The source is an upscale — downscaling it to 1080p *triples* measured
sharpness (73 → 212) and cuts 16-px blocking by a third — so no re-encode can
recover detail that was never in the file, while every candidate either scores
lower or is too large to publish. Playback was verified in a browser: 235/235
frames decoded, 0 dropped, first frame 378 ms after the tap, no black frames
on seek. `preload="auto"` is set once the visitor taps the cover so the
pipeline stays fed.

If a better master ever exists (the source was uploaded as
`GRAND_CAMPUS_HANGOUT-compressed.mp4`), replacing this file with it is the only
change that would genuinely raise clarity — re-run `npm run video:add` and keep
the caption's running time in step.

Putting a new video there is one command — it checks the file really is an MP4,
reads its true duration and picture size straight out of the MP4, refuses
anything GitHub would reject, and copies it into place:

```bash
npm run video:add -- ~/Downloads/GRAND-CAMPUS-HANGOUT.mp4 --as grand-campus-hangout.mp4
```

If that command reports a different running time than the caption, update the
caption: the numbers a visitor reads have to describe the file that plays.

`public/lifegen/videos.js` then probes that file once with a same-origin `HEAD`
request when the visitor taps the cover. If the file is on the site, the video
is played in the same first-party player the testimony videos use (real
`<video controls>`, 16:9, transparent surround, no provider chrome and no
second play button); if it is not deployed yet, or the file turns out to be
unplayable, the slot falls back to `data-video` and the provider player, and
the "Open video in a new tab" link stays available either way.

While the provider is the one playing, the card says so (`Plays on Google
Drive.`). The moment the site's own file plays, that note is rewritten from its
`data-play-note` value (`Plays on LIFEGEN.`), so the caption never claims the
wrong player. The testimony cards carry no such note and are not touched.

**Google Drive's player draws its own black surround and its own play button
inside whatever frame it is given, and that cannot be styled from this page.**
That is why the highlight uses the site's own file: the black bar and the
second play button under the video are the provider's presentation, not a card
left over from `styles.css`. Drive stays wired up as the fallback for any slot
whose file is missing, and
`tests/highlight-first-party-video.test.mjs` locks both paths in — including
that the committed file is decodable (H.264 + AAC) and that its running time
still equals the caption.

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
