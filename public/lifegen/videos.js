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
(() => {
    "use strict";

    function embedFor(raw) {
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
            const start = parseInt(u.searchParams.get("t") || u.searchParams.get("start") || "0", 10);
            return { type: "iframe", provider: "YouTube", src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1&playsinline=1${start > 0 ? "&start=" + start : ""}` };
        }
        // Vimeo
        if (host === "vimeo.com" || host === "player.vimeo.com") {
            const id = (path.match(/(\d{6,})/) || [])[1];
            if (id) return { type: "iframe", provider: "Vimeo", src: `https://player.vimeo.com/video/${id}?dnt=1` };
        }
        // Facebook (videos, reels, watch, fb.watch short links)
        if (host === "facebook.com" || host === "fb.watch" || host === "web.facebook.com") {
            return { type: "iframe", provider: "Facebook", src: `https://www.facebook.com/plugins/video.php?height=314&href=${encodeURIComponent(link)}&show_text=false&width=560&t=0` };
        }
        // Google Drive / Google Docs video
        if (host === "drive.google.com" || host === "docs.google.com") {
            const id = (path.match(/\/(?:file|videos)\/d\/([\w-]+)/) || [])[1] || u.searchParams.get("id");
            if (id) return { type: "iframe", provider: "Google Drive", src: `https://drive.google.com/file/d/${id}/preview` };
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

    function mount(frame) {
        const ratio = /^\d+\/\d+$/.test(frame.dataset.ratio || "") ? frame.dataset.ratio : "16/9";
        frame.style.setProperty("--ratio", ratio.replace("/", " / "));
        if (ratio === "9/16") frame.classList.add("is-vertical");
        const embed = embedFor(frame.dataset.video);
        const label = frame.dataset.label || "LIFEGEN video";
        if (!embed) return placeholder(frame);
        frame.classList.remove("is-empty");
        const immersive = frame.dataset.fullscreen === "true";
        let fallback = null;
        let fullscreenButton = null;

        function restoreFallback() {
            if (!fallback) return;
            const { marker, overflow } = fallback;
            frame.classList.remove("vframe--fullscreen-fallback");
            marker.replaceWith(frame);
            document.body.style.overflow = overflow;
            fallback = null;
            document.removeEventListener("keydown", handleFallbackEscape);
            updateFullscreenButton();
        }

        function handleFallbackEscape(event) {
            if (event.key === "Escape" && fallback) {
                event.preventDefault();
                restoreFallback();
            }
        }

        function updateFullscreenButton() {
            if (!fullscreenButton) return;
            const open = document.fullscreenElement === frame || Boolean(fallback);
            fullscreenButton.setAttribute("aria-label", open ? "Exit fullscreen video" : "Watch video fullscreen");
            fullscreenButton.title = open ? "Exit fullscreen" : "Fullscreen";
            fullscreenButton.innerHTML = open ?
                '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6H3m18 6h-6v6M9 9 3 3m12 12 6 6"/></svg>' :
                '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
        }

        // Fallback for browsers without element fullscreen (including older iOS):
        // relocate the same player to the body instead of creating another embed.
        function expandFallback() {
            if (fallback) return;
            const marker = document.createElement("div");
            marker.className = "vframe-placeholder";
            marker.style.aspectRatio = frame.style.getPropertyValue("--ratio") || "16 / 9";
            frame.before(marker);
            fallback = { marker, overflow: document.body.style.overflow };
            document.body.append(frame);
            document.body.style.overflow = "hidden";
            frame.classList.add("vframe--fullscreen-fallback");
            document.addEventListener("keydown", handleFallbackEscape);
            updateFullscreenButton();
            fullscreenButton?.focus({ preventScroll: true });
        }

        function enterFullscreen() {
            if (fallback) {
                restoreFallback();
                return;
            }
            if (document.fullscreenElement === frame) {
                document.exitFullscreen?.();
                return;
            }
            if (typeof frame.requestFullscreen === "function") {
                try {
                    const request = frame.requestFullscreen();
                    if (request && typeof request.catch === "function") request.catch(expandFallback);
                } catch {
                    expandFallback();
                }
            } else {
                expandFallback();
            }
        }

        function addFullscreenControl() {
            if (!immersive) return;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "vfullscreen-button";
            button.addEventListener("click", enterFullscreen);
            fullscreenButton = button;
            frame.appendChild(button);
            updateFullscreenButton();
            document.addEventListener("fullscreenchange", updateFullscreenButton);
        }

        if (embed.type === "video") {
            const v = document.createElement("video");
            Object.assign(v, { src: embed.src, controls: true, preload: "metadata", playsInline: true });
            v.setAttribute("aria-label", label);
            if (frame.dataset.poster) v.poster = frame.dataset.poster;
            frame.replaceChildren(v);
            addFullscreenControl();
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
                f.width = "560"; f.height = "314";
                f.setAttribute("scrolling", "no");
                f.setAttribute("frameborder", "0");
            }
            if (embed.provider === "Google Drive") {
                frame.classList.add("vframe-gdrive");
            }
            frame.replaceChildren(f);
            addFullscreenControl();
        }

        if (frame.dataset.poster) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "vcover";
            btn.setAttribute("aria-label", (immersive ? "Play fullscreen video: " : "Play video: ") + label);

            const poster = document.createElement("img");
            Object.assign(poster, {
                src: frame.dataset.poster,
                alt: label,
                loading: "lazy",
                decoding: "async",
                className: "vcover-poster"
            });

            const playBtn = document.createElement("span");
            playBtn.className = "vplay-btn";
            playBtn.setAttribute("aria-hidden", "true");
            playBtn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>';

            btn.appendChild(poster);
            btn.appendChild(playBtn);
            btn.addEventListener("click", () => {
                play();
                // Native browser fullscreen requires this call directly inside
                // the user's click. If refused, a full-viewport fallback opens.
                if (immersive) enterFullscreen();
            });
            frame.replaceChildren(btn);
        } else {
            play();
        }
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

    // ---- Lightbox (full-size photo view) ------------------------------
    const lightbox = document.getElementById("lightbox");
    const lbImg = document.getElementById("lbImg");
    const lbCap = document.getElementById("lbCap");
    const lbCount = document.getElementById("lbCount");
    let lbOpen = false, lbIndex = 0, returnFocus = null, previousOverflow = "";

    function showShot(i) {
        if (!shots.length) return;
        lbIndex = (i + shots.length) % shots.length;
        const shot = shots[lbIndex];
        lbImg.src = shot.src;
        lbImg.alt = shot.caption || "LIFEGEN photo";
        lbCap.textContent = shot.caption || "";
        lbCap.hidden = !shot.caption;
        lbCount.textContent = (lbIndex + 1) + " / " + shots.length;
    }
    function openLightbox(i) {
        if (!lightbox || !shots.length) return;
        returnFocus = shots[i]?.card || document.activeElement;
        previousOverflow = document.body.style.overflow;
        showShot(i);
        lightbox.classList.add("open");
        lightbox.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
        lbOpen = true;
        const close = lightbox.querySelector(".lb-close");
        if (close) close.focus({ preventScroll: true });
    }
    function closeLightbox() {
        if (!lightbox || !lbOpen) return;
        lightbox.classList.remove("open");
        lightbox.setAttribute("aria-hidden", "true");
        document.body.style.overflow = previousOverflow;
        lbOpen = false;
        returnFocus?.focus({ preventScroll: true });
    }

    if (lightbox) {
        lightbox.addEventListener("click", (e) => {
            if (e.target.closest("[data-lb-close]") || e.target === lightbox) closeLightbox();
            else if (e.target.closest("[data-lb-prev]")) showShot(lbIndex - 1);
            else if (e.target.closest("[data-lb-next]")) showShot(lbIndex + 1);
        });
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
})();
