// Circular photo carousel for the "This is LIFEGEN" highlights section.
//
// The component is react-bits' CircularCarousel (JS-CSS variant, vendored from
// the shadcn registry item @react-bits/CircularCarousel-JS-CSS) bundled for the
// otherwise vanilla page. It mounts over the static photo deck (#photoDeck),
// reusing the deck's buttons as its data source so the page still works — deck
// plus lightbox — if this bundle never loads. A ring of every card would make
// the circle absurdly large (the radius grows with the item count), so the ring
// shows a window of the photos; the lightbox behind it still holds all 48.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import CircularCarousel from './CircularCarousel.jsx';

function mount() {
    const deck = document.getElementById("photoDeck");
    const wrap = deck ? deck.closest(".deck-wrap") : null;
    if (!deck || !wrap || wrap.querySelector(".photo-carousel")) return;

    const cards = [...deck.querySelectorAll(".deck-card")].filter((card) => (card.dataset.img || "").trim());
    if (!cards.length) return;

    // A readable circle needs a small item count; widen it on larger screens.
    const wide = window.matchMedia("(min-width: 640px)").matches;
    const items = cards.slice(0, wide ? 14 : 8).map((card) => ({
        src: card.dataset.img.trim(),
        title: card.dataset.caption || "LIFEGEN",
        alt: card.dataset.caption || "LIFEGEN photo"
    }));

    const stage = document.createElement("div");
    stage.className = "photo-carousel";
    deck.after(stage);

    // Clicks surface to videos.js, which owns the full-size lightbox; the ring
    // index matches the deck order, so it maps straight onto the lightbox shots.
    const props = {
            items,
            preset: "cylinder",
            intro: "rise",
            cardWidth: 220,
            aspectRatio: 4 / 3,
            gap: 26,
            autoplay: "drift",
            speed: 10,
            direction: "left",
            draggable: true,
            captions: true,
            fadeColor: "#0F351A",
            cornerRadius: 10,
            onItemClick: (item, index) => {
                wrap.dispatchEvent(new CustomEvent("lifegen:open-photo", { detail: { index }, bubbles: true }));
            }
    };

    // Only retire the plain deck once React has accepted the render, so a
    // bundle failure keeps the working horizontal deck instead of a blank panel.
    try {
        createRoot(stage).render(createElement(CircularCarousel, props));
        deck.hidden = true;
    } catch {
        stage.remove();
    }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
else mount();
