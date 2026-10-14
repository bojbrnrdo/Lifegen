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
            '<span class="vph-play"><i data-lucide="play"></i></span>' +
            '<span class="vph-text">Video coming soon</span></div>';
    }

    function mount(frame) {
        const ratio = /^\d+\/\d+$/.test(frame.dataset.ratio || "") ? frame.dataset.ratio : "16/9";
        frame.style.setProperty("--ratio", ratio.replace("/", " / "));
        if (ratio === "9/16") frame.classList.add("is-vertical");
        const embed = embedFor(frame.dataset.video);
        const label = frame.dataset.label || "LIFEGEN video";
        if (!embed) return placeholder(frame);
        frame.classList.remove("is-empty");
        if (embed.type === "video") {
            const v = document.createElement("video");
            Object.assign(v, { src: embed.src, controls: true, preload: "metadata", playsInline: true });
            v.setAttribute("aria-label", label);
            frame.replaceChildren(v);
            return;
        }
        // Click-to-load: the third-party player only connects after a tap, so no
        // viewing data goes to the provider until the visitor chooses to play.
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "vcover";
        btn.setAttribute("aria-label", "Play video: " + label);
        btn.innerHTML =
            '<span class="vph-play" aria-hidden="true"><i data-lucide="play"></i></span>' +
            '<span class="vph-text">Tap to play</span>';
        if (frame.dataset.poster) {
            const poster = document.createElement("img");
            Object.assign(poster, { src: frame.dataset.poster, alt: "", loading: "lazy", decoding: "async", className: "vcover-poster" });
            btn.classList.add("has-poster");
            btn.prepend(poster);
        }
        btn.addEventListener("click", () => {
            const f = document.createElement("iframe");
            // Keep Facebook's iframe query identical to its official embed code;
            // the Facebook player handles its own play control after loading.
            f.src = embed.src + (["Google Drive", "Facebook"].includes(embed.provider) ? "" : "&autoplay=1");
            f.title = label;
            if (embed.provider === "Facebook") {
                f.width = "560"; f.height = "314";
                f.setAttribute("scrolling", "no");
                f.setAttribute("frameborder", "0");
            }
            f.setAttribute("allowfullscreen", "");
            f.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen");
            // YouTube refuses to play embeds when no referrer is sent (the site default is no-referrer).
            f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
            frame.replaceChildren(f);
        });
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
