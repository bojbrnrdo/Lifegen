// Stories & highlights: video embeds, plus the photo/poster deck and lightbox.
//
// To add a video, put its link in the slot's data-video attribute, e.g.
//   <div class="vframe" data-video="https://youtu.be/abc123" data-ratio="16/9" ...>
// Supported: YouTube (watch, youtu.be, Shorts, live), Facebook videos/reels, Vimeo,
// Google Drive / Google Docs video (file must be shared "Anyone with the link"), or a direct .mp4/.webm file.
// Use data-ratio="9/16" for vertical phone videos (Reels / Shorts).
// Empty slots show a "coming soon" placeholder.
//
// Privacy / legal: third-party players (YouTube, Facebook, Vimeo, Google Drive)
// are click-to-load. Nothing connects to the provider until a visitor taps the
// cover, so no viewing data is transferred without the visitor's action. Only
// embed content the church owns or that the platform explicitly allows embedding.
//
// Facebook sizing note: the facebook.com/plugins/video.php player renders at
// the width/height passed in its own URL, so a 9:16 reel requested at 560x314
// would play squeezed into a landscape box. embedFor() therefore requests a
// matching portrait size (360x640) for vertical slots instead of forcing every
// Facebook video into 16:9. The plugin only offers fixed sizes, so odd ratios
// still letterbox inside the closest of the two.
//
// Google Drive note: the drive.google.com/file/d/…/preview player is embedded
// with ?rm=minimal, which hides its header bar so the video itself fills the
// 16:9 frame edge-to-edge. An earlier top:-56px crop hid the bar but also
// clipped the top of the video on some viewports, so the crop was removed in
// favour of the player's own minimal-chrome mode. Same host, so the CSP
// frame-src is unchanged.
(() => {
    "use strict";

    // YouTube start times: plain seconds ("90", "90s") and h/m/s forms
    // ("1m30s" -> 90, "1h2m3s" -> 3723). parseInt() alone reads "1m30s" as 1.
    function parseYouTubeStart(value) {
        const raw = String(value || "").trim();
        if (!raw) return 0;
        if (/^\d+$/.test(raw)) return parseInt(raw, 10);
        const hms = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
        if (hms && (hms[1] !== undefined || hms[2] !== undefined || hms[3] !== undefined)) {
            return (parseInt(hms[1] || "0", 10) * 3600) +
                (parseInt(hms[2] || "0", 10) * 60) +
                parseInt(hms[3] || "0", 10);
        }
        return 0;
    }

    function isYouTubeShorts(raw) {
        try {
            const u = new URL(String(raw || "").trim(), location.href);
            const host = u.hostname.replace(/^www\.|^m\./, "");
            return /(^|\.)youtube(-nocookie)?\.com$/.test(host) && u.pathname.startsWith("/shorts/");
        } catch { return false; }
    }

    // data-ratio wins when set; YouTube Shorts default to portrait 9/16;
    // everything else defaults to landscape 16/9.
    function resolveRatio(frame, raw) {
        const data = (frame && frame.dataset && frame.dataset.ratio) || "";
        if (/^\d+\/\d+$/.test(data)) return data;
        if (isYouTubeShorts(raw)) return "9/16";
        return "16/9";
    }

    function embedFor(raw, ratio) {
        const link = String(raw || "").trim();
        if (!link) return null;
        let u;
        try { u = new URL(link, location.href); } catch { return null; }
        const host = u.hostname.replace(/^www\.|^m\./, "");
        const path = u.pathname;

        // YouTube
        let yt = null;
        if (host === "youtu.be") yt = path.slice(1).split("/")[0];
        else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
            yt = u.searchParams.get("v") || (path.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/) || [])[1];
        }
        if (yt && /^[\w-]{6,}$/.test(yt)) {
            const start = parseYouTubeStart(u.searchParams.get("t") || u.searchParams.get("start"));
            return { type: "iframe", provider: "YouTube", src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1&playsinline=1${start > 0 ? "&start=" + start : ""}` };
        }
        // Vimeo
        if (host === "vimeo.com" || host === "player.vimeo.com") {
            const id = (path.match(/(\d{6,})/) || [])[1];
            if (id) return { type: "iframe", provider: "Vimeo", src: `https://player.vimeo.com/video/${id}?dnt=1` };
        }
        // Facebook (videos, reels, watch, fb.watch short links)
        if (host === "facebook.com" || host === "fb.watch" || host === "web.facebook.com") {
            const parts = String(ratio || "16/9").split("/").map(Number);
            const portrait = parts.length === 2 && parts[0] > 0 && parts[1] > 0 && parts[0] < parts[1];
            const w = portrait ? 360 : 560, h = portrait ? 640 : 314;
            return { type: "iframe", provider: "Facebook", width: w, height: h, src: `https://www.facebook.com/plugins/video.php?height=${h}&href=${encodeURIComponent(link)}&show_text=false&width=${w}&t=0` };
        }
        // Google Drive / Google Docs video
        if (host === "drive.google.com" || host === "docs.google.com") {
            const id = (path.match(/\/(?:file|videos)\/d\/([\w-]+)/) || [])[1] || u.searchParams.get("id");
            if (id) return { type: "iframe", provider: "Google Drive", src: `https://drive.google.com/file/d/${id}/preview?rm=minimal` };
        }
        // Direct video file
        if (/\.(mp4|webm|mov|m4v)$/i.test(path)) return { type: "video", provider: "self", src: u.href };
        return null;
    }

    function placeholder(frame) {
        frame.classList.add("is-empty");
        frame.innerHTML =
            '<div class="vph" aria-hidden="true">' +
            '<span class="vph-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>' +
            '<span class="vph-tag">Coming soon</span>' +
            '<p class="vph-text">New testimony in preparation</p></div>';
    }

    // A non-empty link no provider matched: keep the video reachable through a
    // direct link instead of pretending it is "coming soon". Not aria-hidden:
    // the link inside must stay focusable.
    function unsupportedFallback(frame, raw, label) {
        console.warn("[LIFEGEN] Video link not supported, showing a direct link instead:", raw);
        frame.classList.add("is-empty");
        frame.textContent = "";
        const box = document.createElement("div");
        box.className = "vph";
        const tag = document.createElement("span");
        tag.className = "vph-tag";
        tag.textContent = "Video link not supported";
        const text = document.createElement("p");
        text.className = "vph-text";
        text.textContent = (label ? label + " · " : "") + "Open it directly: ";
        const a = document.createElement("a");
        a.href = raw;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "vph-link";
        a.textContent = "Open video ↗";
        text.appendChild(a);
        box.append(tag, text);
        frame.appendChild(box);
    }

    function mount(frame) {
        const raw = (frame.dataset.video || "").trim();
        const ratio = resolveRatio(frame, raw);
        frame.style.setProperty("--ratio", ratio.replace("/", " / "));
        if (ratio === "9/16") frame.classList.add("is-vertical");
        const label = frame.dataset.label || "LIFEGEN video";
        if (!raw) return placeholder(frame);
        const embed = embedFor(raw, ratio);
        if (!embed) return unsupportedFallback(frame, raw, label);
        frame.classList.remove("is-empty");
        if (embed.type === "video") {
            const v = document.createElement("video");
            Object.assign(v, { src: embed.src, controls: true, preload: "metadata", playsInline: true });
            v.setAttribute("aria-label", label);
            if (frame.dataset.poster) v.poster = frame.dataset.poster;
            frame.replaceChildren(v);
            return;
        }

        function play() {
            const f = document.createElement("iframe");
            const sep = embed.src.includes("?") ? "&" : "?";
            f.src = embed.src + (embed.provider === "Facebook" ? "" : sep + "autoplay=1");
            f.title = label;
            f.loading = "lazy";
            f.setAttribute("allowfullscreen", "");
            f.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen");
            f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
            if (embed.provider === "Facebook") {
                f.width = String(embed.width || 560);
                f.height = String(embed.height || 314);
                f.setAttribute("scrolling", "no");
                f.setAttribute("frameborder", "0");
            }
            frame.replaceChildren(f);
        }

        // Every third-party player is click-to-load: slots with a poster show
        // it, slots without one show a styled cover with the provider name.
        // The iframe — and its autoplay — is only created after the tap, so no
        // third-party request happens on page load.
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "vcover";
        btn.setAttribute("aria-label", "Play video: " + label);

        if (frame.dataset.poster) {
            const poster = document.createElement("img");
            Object.assign(poster, {
                src: frame.dataset.poster,
                alt: label,
                loading: "lazy",
                decoding: "async",
                className: "vcover-poster"
            });
            btn.appendChild(poster);
        } else {
            btn.classList.add("vcover-fallback");
            const provider = document.createElement("span");
            provider.className = "vcover-provider";
            provider.textContent = embed.provider;
            const sub = document.createElement("span");
            sub.className = "vcover-sub";
            sub.textContent = label;
            btn.append(provider, sub);
        }

        const playBtn = document.createElement("span");
        playBtn.className = "vplay-btn";
        playBtn.setAttribute("aria-hidden", "true");
        playBtn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>';

        btn.appendChild(playBtn);
        btn.addEventListener("click", play);
        frame.replaceChildren(btn);
    }

    // ---- Photo & poster deck (horizontal spread under the highlight) ----
    // Cards are <button class="deck-card" data-img="..." data-caption="...">.
    // A card with an image opens the lightbox; a card without data-img shows
    // a "coming soon" placeholder until a picture or poster is added.
    const escText = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const shots = [];

    function deckPlaceholder(card, caption) {
        const label = caption || "Photo coming soon";
        card.setAttribute("aria-disabled", "true");
        card.innerHTML =
            '<span class="deck-ph" aria-hidden="true"><i data-lucide="image"></i>' +
            "<span>" + escText(label) + "</span></span>" +
            '<span class="deck-cap">' + escText(label) + "</span>";
    }

    document.querySelectorAll("#stories .deck-card").forEach((card) => {
        const src = (card.dataset.img || "").trim();
        const caption = card.dataset.caption || "";
        if (!src) { deckPlaceholder(card, caption); return; }
        // Use the small WebP in the deck, and fetch the untouched full-size
        // JPEG (or lossless artwork) only when this photo is opened.
        const full = (card.dataset.full || src).trim();
        const index = shots.push({ src: full, caption, card }) - 1;
        card.innerHTML =
            '<img class="deck-photo" loading="lazy" decoding="async" src="' + escText(src) +
            '" alt="' + escText(caption || "LIFEGEN photo") + '"/>' +
            '<span class="deck-cap">' + escText(caption || "LIFEGEN photo") + "</span>";
        card.setAttribute("aria-label", "View full size: " + (caption || "LIFEGEN photo"));
        card.addEventListener("click", () => openLightbox(index));
    });

    // ---- iOS-safe scroll lock (shared protocol with app.js / calendar.js) --
    // position:fixed freezes the page where it is; overflow:hidden alone still
    // lets iOS Safari scroll behind overlays. The counter lets the mobile menu,
    // modals and lightbox nest without unlocking each other early.
    function lockBodyScroll() {
        const n = parseInt(document.body.dataset.scrollLock || "0", 10) || 0;
        if (n === 0) {
            const y = window.scrollY || 0;
            document.body.dataset.scrollY = String(y);
            document.body.style.position = "fixed";
            document.body.style.top = "-" + y + "px";
            document.body.style.left = "0";
            document.body.style.right = "0";
        }
        document.body.dataset.scrollLock = String(n + 1);
    }
    function unlockBodyScroll() {
        const n = parseInt(document.body.dataset.scrollLock || "0", 10) || 0;
        if (n <= 1) {
            delete document.body.dataset.scrollLock;
            const y = parseInt(document.body.dataset.scrollY || "0", 10) || 0;
            delete document.body.dataset.scrollY;
            document.body.style.position = "";
            document.body.style.top = "";
            document.body.style.left = "";
            document.body.style.right = "";
            window.scrollTo(0, y);
        } else {
            document.body.dataset.scrollLock = String(n - 1);
        }
    }

    // ---- Lightbox (full-size photo view) ------------------------------
    const lightbox = document.getElementById("lightbox");
    const lbImg = document.getElementById("lbImg");
    const lbCap = document.getElementById("lbCap");
    const lbCount = document.getElementById("lbCount");
    let lbOpen = false, lbIndex = 0, returnFocus = null;

    function showShot(i) {
        if (!shots.length) return;
        lbIndex = (i + shots.length) % shots.length;
        const shot = shots[lbIndex];
        if (lightbox) lightbox.classList.add("is-loading");
        lbImg.src = shot.src;
        lbImg.alt = shot.caption || "LIFEGEN photo";
        lbCap.textContent = shot.caption || "";
        lbCap.hidden = !shot.caption;
        lbCount.textContent = (lbIndex + 1) + " / " + shots.length;
        // Prefetch the neighbours so prev/next is instant.
        for (const j of [lbIndex + 1, lbIndex - 1]) {
            const next = shots[(j + shots.length) % shots.length];
            if (next && next.src !== shot.src) {
                const pre = new Image();
                pre.src = next.src;
            }
        }
    }
    function openLightbox(i) {
        if (!lightbox || !shots.length) return;
        returnFocus = shots[i]?.card || document.activeElement;
        lockBodyScroll();
        showShot(i);
        lightbox.classList.add("open");
        lightbox.setAttribute("aria-hidden", "false");
        lbOpen = true;
        const close = lightbox.querySelector(".lb-close");
        if (close) close.focus({ preventScroll: true });
    }
    function closeLightbox() {
        if (!lightbox || !lbOpen) return;
        lightbox.classList.remove("open");
        lightbox.setAttribute("aria-hidden", "true");
        unlockBodyScroll();
        lbOpen = false;
        returnFocus?.focus({ preventScroll: true });
    }

    if (lightbox) {
        // Loading state: shown from showShot() until the full image arrives.
        lbImg.addEventListener("load", () => lightbox.classList.remove("is-loading"));
        lbImg.addEventListener("error", () => lightbox.classList.remove("is-loading"));
        let swipeX = null, swiped = false;
        lightbox.addEventListener("click", (e) => {
            if (swiped) { swiped = false; return; } // a swipe is not a tap
            if (e.target.closest("[data-lb-close]") || e.target === lightbox) closeLightbox();
            else if (e.target.closest("[data-lb-prev]")) showShot(lbIndex - 1);
            else if (e.target.closest("[data-lb-next]")) showShot(lbIndex + 1);
        });
        // Touch swipe via pointer events: 40px past the start flips the photo.
        lightbox.addEventListener("pointerdown", (e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            if (e.target.closest("button")) { swipeX = null; return; }
            swipeX = e.clientX;
            swiped = false;
        });
        lightbox.addEventListener("pointerup", (e) => {
            if (swipeX === null) return;
            const dx = e.clientX - swipeX;
            swipeX = null;
            if (Math.abs(dx) < 40) return;
            swiped = true;
            showShot(lbIndex + (dx < 0 ? 1 : -1));
        });
        lightbox.addEventListener("pointercancel", () => { swipeX = null; });
        document.addEventListener("keydown", (e) => {
            if (!lbOpen) return;
            if (e.key === "Escape") { e.preventDefault(); closeLightbox(); }
            else if (e.key === "ArrowRight") { e.preventDefault(); showShot(lbIndex + 1); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); showShot(lbIndex - 1); }
            else if (e.key === "Tab") {
                const controls = [...lightbox.querySelectorAll("button")];
                const first = controls[0], last = controls[controls.length - 1];
                if (e.shiftKey && (document.activeElement === first || !lightbox.contains(document.activeElement))) {
                    e.preventDefault(); last?.focus();
                } else if (!e.shiftKey && (document.activeElement === last || !lightbox.contains(document.activeElement))) {
                    e.preventDefault(); first?.focus();
                }
            }
        });
    }

    document.querySelectorAll("#stories .vframe").forEach(mount);
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();

    // Test hook: lets tests exercise the pure helpers without a browser.
    try { globalThis.__LIFEGEN_VIDEOS__ = { embedFor, parseYouTubeStart, isYouTubeShorts, resolveRatio }; } catch {}
})();
