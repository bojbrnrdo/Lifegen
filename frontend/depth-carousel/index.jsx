// Depth photo carousel for the "This is LIFEGEN" highlights section.
//
// The component is react-bits' DepthCarousel (JS-CSS variant, vendored from
// the shadcn registry item @react-bits/DepthCarousel-JS-CSS) bundled for the
// otherwise vanilla page. It mounts over the static photo deck (#photoDeck),
// reusing the deck's buttons as its data source so the page still works —
// deck plus lightbox — if this bundle never loads.
//
// Every photo in the deck becomes a card on the depth rail (the component
// keeps the hidden ones faded out via visibleCards), so all 48 photos are
// reachable by dragging, the arrows, the indicators, or autoplay — not just
// the subset the previous ring carousel showed.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import DepthCarousel from './DepthCarousel.jsx';

function mount() {
    const deck = document.getElementById("photoDeck");
    const wrap = deck ? deck.closest(".deck-wrap") : null;
    if (!deck || !wrap || wrap.querySelector(".photo-carousel")) return;

    const cards = [...deck.querySelectorAll(".deck-card")].filter((card) => (card.dataset.img || "").trim());
    if (!cards.length) return;

    const wide = window.matchMedia("(min-width: 900px)").matches;
    const items = cards.map((card) => ({
        image: card.dataset.img.trim(),
        alt: card.dataset.caption || "LIFEGEN photo"
    }));

    const stage = document.createElement("div");
    stage.className = "photo-carousel";
    deck.after(stage);

    // Clicks surface to videos.js, which owns the full-size lightbox; the rail
    // order matches the deck order, so the index maps straight onto the shots.
    const openShot = (index) => {
        wrap.dispatchEvent(new CustomEvent("lifegen:open-photo", { detail: { index }, bubbles: true }));
    };

    let activeIndex = 0;
    let downAt = null;
    stage.addEventListener("pointerdown", (e) => {
        downAt = { x: e.clientX, y: e.clientY };
    });
    stage.addEventListener("click", (e) => {
        const card = e.target.closest(".depth-carousel__card");
        if (!card || !downAt) return;
        // A drag (or a drag-release click, which retargets to the root) is the
        // component's navigation, not a photo selection.
        if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) return;
        const index = [...card.parentElement.children].indexOf(card);
        // Background cards are brought to the front by the component itself;
        // the front card opens at full size in the lightbox.
        if (index === activeIndex) openShot(index);
    });

    const props = {
        items,
        cardWidth: 320,
        cardHeight: 240,
        radius: 14,
        tint: "#0C2B16",
        depth: 230,
        spread: 95,
        tilt: 22,
        tiltDirection: "right",
        perspective: 1400,
        visibleCards: wide ? 5 : 4,
        falloff: 0.2,
        blur: 6,
        duration: 850,
        ease: "power2.out",
        autoplay: true,
        autoplayDelay: 3600,
        loop: true,
        showControls: true,
        // 48 dots would wrap on phones; keep them for pointer + wide screens.
        showIndicators: wide,
        onChange: (index) => {
            activeIndex = index;
        }
    };

    // Only retire the plain deck once React has accepted the render, so a
    // bundle failure keeps the working horizontal deck instead of a blank panel.
    try {
        createRoot(stage).render(createElement(DepthCarousel, props));
        deck.hidden = true;
    } catch {
        stage.remove();
    }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
else mount();
