// DepthCarousel — react-bits, JS-CSS variant.
// Vendored from the @react-bits/DepthCarousel-JS-CSS shadcn registry item.
// Deviations from upstream (all required to fit the LIFEGEN page, keep in
// sync when updating):
//   - 'use client' and the CSS import are stripped (the CSS lives in
//     public/lifegen/styles.css).
//   - The wheel handler only captures horizontal scrolling so the page still
//     scrolls vertically over the carousel.
//   - Card images load lazily like the rest of the site gallery.
//   - Performance adaptations so a 48-card rail stays smooth: the layout loop
//     caches each card's last written styles and skips identical writes,
//     cards outside the visible window are frozen with visibility:hidden
//     instead of being restyled every frame, and pointer/wheel input is
//     coalesced to one layout per animation frame.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';

const DEFAULT_ITEMS = [
  { image: 'https://picsum.photos/seed/depth1/800/1000', alt: 'Slide 1' },
  { image: 'https://picsum.photos/seed/depth2/800/1000', alt: 'Slide 2' },
  { image: 'https://picsum.photos/seed/depth3/800/1000', alt: 'Slide 3' },
  { image: 'https://picsum.photos/seed/depth4/800/1000', alt: 'Slide 4' },
  { image: 'https://picsum.photos/seed/depth5/800/1000', alt: 'Slide 5' },
  { image: 'https://picsum.photos/seed/depth6/800/1000', alt: 'Slide 6' }
];

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const normalizeItem = it => (typeof it === 'string' ? { image: it, alt: '' } : it);

const DepthCarousel = ({
  items = DEFAULT_ITEMS,
  cardWidth = 300,
  cardHeight = 380,
  radius = 18,
  tint = '#05060a',
  depth = 220,
  spread = 90,
  tilt = 22,
  tiltDirection = 'right',
  perspective = 1400,
  visibleCards = 4,
  falloff = 0.2,
  blur = 6,
  duration = 700,
  ease = 'power3.out',
  autoplay = false,
  autoplayDelay = 3200,
  loop = true,
  showControls = true,
  showIndicators = true,
  onChange,
  className = ''
}) => {
  const data = useMemo(() => (Array.isArray(items) ? items : []).map(normalizeItem), [items]);
  const count = data.length;

  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const cardRefs = useRef([]);
  const overlayRefs = useRef([]);

  const posRef = useRef(0);
  const focusRef = useRef(0);
  const tweenRef = useRef(null);
  const scaleRef = useRef(1);
  const cfgRef = useRef({});
  const onChangeRef = useRef(onChange);

  const dragRef = useRef(null);
  const wheelTimerRef = useRef(null);
  const wheelRafRef = useRef(0);
  const wheelPendingRef = useRef(0);
  const autoTimerRef = useRef(null);
  const reducedRef = useRef(false);
  const cardCache = useRef([]);

  const [active, setActive] = useState(0);

  onChangeRef.current = onChange;
  cfgRef.current = {
    count,
    depth,
    spread,
    tilt,
    tiltDirection,
    visibleCards,
    falloff,
    blur,
    duration,
    ease,
    loop,
    cardWidth,
    autoplayDelay
  };

  const layout = useCallback(pos => {
    const cfg = cfgRef.current;
    const n = cfg.count;
    if (!n) return;
    const dir = cfg.tiltDirection === 'left' ? -1 : 1;
    const sc = scaleRef.current;

    for (let i = 0; i < n; i++) {
      const el = cardRefs.current[i];
      if (!el) continue;
      const cache = cardCache.current[i] || (cardCache.current[i] = {});

      let d = i - pos;
      if (cfg.loop && n > 1) {
        d = ((d % n) + n) % n;
        if (d > n / 2) d -= n;
      }

      const back = Math.max(0, d);
      const az = Math.abs(d);
      const shown = az <= cfg.visibleCards + 0.5;

      // Cards parked outside the visible window are already frozen with
      // visibility:hidden — leave them untouched until they return.
      if (!shown && cache.vis === 'hidden') continue;

      const tz = -cfg.depth * d;
      const tx = dir * cfg.spread * d;
      const ry = dir * cfg.tilt * clamp(d, 0, 1);

      let opacity = d < 0 ? Math.max(0, 1 + d) : 1;
      if (!shown) opacity = 0;

      const brightness = Math.max(0.15, 1 - back * cfg.falloff);
      const blurPx = cfg.blur > 0 ? Math.min(cfg.blur, (back / Math.max(1, cfg.visibleCards)) * cfg.blur) : 0;
      const zi = Math.round(2000 - d * 20);

      // Quantize the continuously-animated values, then only touch the DOM
      // when a quantized value actually changes: identical frames cost
      // nothing, and blur/brightness repaint far less often.
      const t = `translate(-50%, -50%) scale(${sc}) translateX(${tx.toFixed(2)}px) translateZ(${tz.toFixed(2)}px) rotateY(${ry.toFixed(3)}deg)`;
      const oq = Math.round(opacity * 250) / 250;
      const o = oq.toFixed(3);
      const b = (Math.round(brightness * 100) / 100).toFixed(2);
      const bl = (Math.round(blurPx * 4) / 4).toFixed(2);

      if (cache.t !== t) { el.style.transform = t; cache.t = t; }
      if (cache.o !== o) { el.style.opacity = o; cache.o = o; }
      if (cache.b !== b || cache.bl !== bl) {
        el.style.filter = `brightness(${b}) blur(${bl}px)`;
        cache.b = b;
        cache.bl = bl;
      }
      if (cache.zi !== zi) { el.style.zIndex = String(zi); cache.zi = zi; }
      const vis = shown ? '' : 'hidden';
      if (cache.vis !== vis) { el.style.visibility = vis; cache.vis = vis; }
      const pe = shown && oq > 0.05 ? 'auto' : 'none';
      if (cache.pe !== pe) { el.style.pointerEvents = pe; cache.pe = pe; }

      const ov = overlayRefs.current[i];
      if (ov) {
        const oo = (Math.round(clamp(back * cfg.falloff * 1.25, 0, 0.86) * 100) / 100).toFixed(2);
        if (cache.oo !== oo) { ov.style.opacity = oo; cache.oo = oo; }
      }
    }
  }, []);

  const notify = useCallback(
    idx => {
      setActive(idx);
      onChangeRef.current?.(idx, data[idx]);
    },
    [data]
  );

  const tweenTo = useCallback(
    (target, animate) => {
      tweenRef.current?.kill();
      const cfg = cfgRef.current;
      const proxy = { p: posRef.current };
      const dur = animate && !reducedRef.current ? cfg.duration / 1000 : 0;
      tweenRef.current = gsap.to(proxy, {
        p: target,
        duration: dur,
        ease: cfg.ease,
        onUpdate: () => {
          posRef.current = proxy.p;
          layout(proxy.p);
        },
        onComplete: () => {
          const n = cfg.count;
          if (n > 0) posRef.current = ((posRef.current % n) + n) % n;
          layout(posRef.current);
        }
      });
    },
    [layout]
  );

  const setFocus = useCallback(
    (rawIndex, animate = true) => {
      const cfg = cfgRef.current;
      const n = cfg.count;
      if (!n) return;
      const idx = cfg.loop ? ((rawIndex % n) + n) % n : clamp(rawIndex, 0, n - 1);
      let delta = idx - posRef.current;
      if (cfg.loop && n > 1) {
        delta = ((delta % n) + n) % n;
        if (delta > n / 2) delta -= n;
      }
      tweenTo(posRef.current + delta, animate);
      if (idx !== focusRef.current) {
        focusRef.current = idx;
        notify(idx);
      }
    },
    [tweenTo, notify]
  );

  const navigateBy = useCallback(step => setFocus(focusRef.current + step, true), [setFocus]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      const cfg = cfgRef.current;
      const needed = cfg.cardWidth + Math.abs(cfg.spread) * 2 + 120;
      scaleRef.current = clamp(w / needed, 0.4, 1);
      layout(posRef.current);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [layout]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = e => {
      const cfg = cfgRef.current;
      if (cfg.count < 2) return;
      // Site adjustment (see file header): only capture horizontal scrolling;
      // vertical wheels keep scrolling the page.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      tweenRef.current?.kill();
      // Coalesce wheel bursts into one layout per frame.
      const raw = e.deltaX;
      wheelPendingRef.current += e.deltaMode === 1 ? raw * 24 : raw;
      if (!wheelRafRef.current) {
        wheelRafRef.current = requestAnimationFrame(() => {
          wheelRafRef.current = 0;
          const step = clamp(wheelPendingRef.current / (cfgRef.current.cardWidth * 0.9), -0.6, 0.6);
          wheelPendingRef.current = 0;
          posRef.current += step;
          layout(posRef.current);
        });
      }
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => setFocus(Math.round(posRef.current), true), 130);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = 0;
      wheelPendingRef.current = 0;
    };
  }, [layout, setFocus]);

  const onPointerDown = useCallback(e => {
    const cfg = cfgRef.current;
    if (cfg.count < 2) return;
    tweenRef.current?.kill();
    dragRef.current = {
      x: e.clientX,
      startPos: posRef.current,
      latestX: e.clientX,
      lastX: e.clientX,
      lastT: performance.now(),
      v: 0,
      moved: false,
      raf: 0,
      id: e.pointerId
    };
  }, []);

  const applyDragFrame = useCallback(
    drag => {
      const cfg = cfgRef.current;
      const stepPx = Math.max(cfg.cardWidth * 0.55 * scaleRef.current, 40);
      const now = performance.now();
      const dt = Math.max(now - drag.lastT, 1);
      drag.v = (drag.latestX - drag.lastX) / dt;
      drag.lastX = drag.latestX;
      drag.lastT = now;
      posRef.current = drag.startPos - (drag.latestX - drag.x) / stepPx;
      layout(posRef.current);
    },
    [layout]
  );

  const onPointerMove = useCallback(
    e => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.latestX = e.clientX;
      if (!drag.moved) {
        if (Math.abs(e.clientX - drag.x) <= 4) return;
        drag.moved = true;
        try {
          rootRef.current?.setPointerCapture(drag.id);
        } catch {}
      }
      // Coalesce fast pointer streams into one layout per animation frame.
      if (!drag.raf) {
        drag.raf = requestAnimationFrame(() => {
          drag.raf = 0;
          if (dragRef.current === drag) applyDragFrame(drag);
        });
      }
    },
    [applyDragFrame]
  );

  const onPointerEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.raf) {
      cancelAnimationFrame(drag.raf);
      drag.raf = 0;
    }
    if (!drag.moved) return;
    applyDragFrame(drag);
    const cfg = cfgRef.current;
    const stepPx = Math.max(cfg.cardWidth * 0.55 * scaleRef.current, 40);
    const projected = posRef.current - (drag.v * 180) / stepPx;
    setFocus(Math.round(projected), true);
  }, [applyDragFrame, setFocus]);

  const onKeyDown = useCallback(
    e => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateBy(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateBy(1);
      }
    },
    [navigateBy]
  );

  const onCardClick = useCallback(
    index => {
      if (dragRef.current?.moved) return;
      setFocus(index, true);
    },
    [setFocus]
  );

  useEffect(() => {
    reducedRef.current = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!autoplay || reducedRef.current || count < 2) return;
    const root = rootRef.current;
    let hovered = false;
    let focused = false;
    const stop = () => {
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    };
    const start = () => {
      stop();
      autoTimerRef.current = window.setInterval(
        () => {
          if (!hovered && !focused) navigateBy(1);
        },
        Math.max(cfgRef.current.autoplayDelay, 600)
      );
    };
    const onEnter = () => {
      hovered = true;
    };
    const onLeave = () => {
      hovered = false;
    };
    const onFocusIn = () => {
      focused = true;
    };
    const onFocusOut = () => {
      focused = false;
    };
    root?.addEventListener('mouseenter', onEnter);
    root?.addEventListener('mouseleave', onLeave);
    root?.addEventListener('focusin', onFocusIn);
    root?.addEventListener('focusout', onFocusOut);
    start();
    return () => {
      stop();
      root?.removeEventListener('mouseenter', onEnter);
      root?.removeEventListener('mouseleave', onLeave);
      root?.removeEventListener('focusin', onFocusIn);
      root?.removeEventListener('focusout', onFocusOut);
    };
  }, [autoplay, autoplayDelay, count, navigateBy]);

  useEffect(() => {
    layout(posRef.current);
  }, [layout, depth, spread, tilt, tiltDirection, visibleCards, falloff, blur, cardWidth, cardHeight, radius, count]);

  useEffect(
    () => () => {
      tweenRef.current?.kill();
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
      const drag = dragRef.current;
      if (drag?.raf) cancelAnimationFrame(drag.raf);
    },
    []
  );

  return (
    <div
      ref={rootRef}
      className={`depth-carousel ${className}`.trim()}
      style={{ '--dc-perspective': `${perspective}px` }}
      role="group"
      aria-roledescription="carousel"
      aria-label="Depth carousel"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      <div className="depth-carousel__stage" ref={stageRef}>
        {data.map((item, i) => (
          <div
            key={i}
            className="depth-carousel__card"
            ref={el => (cardRefs.current[i] = el)}
            style={{ width: cardWidth, height: cardHeight, borderRadius: radius }}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            aria-hidden={active !== i}
            onClick={() => onCardClick(i)}
          >
            <img
              className="depth-carousel__img"
              src={item.image}
              alt={item.alt || ''}
              draggable={false}
              loading="lazy"
              decoding="async"
            />
            <span
              className="depth-carousel__tint"
              ref={el => (overlayRefs.current[i] = el)}
              style={{ background: tint }}
            />
          </div>
        ))}
      </div>

      {showControls && count > 1 && (
        <>
          <button
            type="button"
            className="depth-carousel__arrow depth-carousel__arrow--prev"
            aria-label="Previous slide"
            onClick={() => navigateBy(-1)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="depth-carousel__arrow depth-carousel__arrow--next"
            aria-label="Next slide"
            onClick={() => navigateBy(1)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M9 5l7 7-7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </>
      )}

      {showIndicators && count > 1 && (
        <div className="depth-carousel__dots" role="tablist" aria-label="Slides">
          {data.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active === i}
              aria-label={`Go to slide ${i + 1}`}
              className={`depth-carousel__dot${active === i ? ' is-active' : ''}`}
              onClick={() => setFocus(i, true)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default DepthCarousel;
