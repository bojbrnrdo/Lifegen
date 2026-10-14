// LIFEGEN events calendar (public website): month grid, type filter, upcoming
// list, day details (modal on larger screens, inline agenda on phones).
// Talks only to same-origin /api/public endpoints; no credentials in the browser.
(() => {
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const DAYS_SHORT = DAYS.map((d) => d.slice(0, 3));
    const CATS = {
        service: "Sunday service", worship: "Worship night", prayer: "Prayer",
        youth: "Youth", lifegroup: "Lifegroup", outreach: "Outreach", special: "Special event",
    };
    const catOf = (e) => (CATS[e.category] ? e.category : "special");

    const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) {} };
    // iOS-safe scroll lock (shared protocol with app.js / videos.js):
    // position:fixed freezes the page; overflow:hidden alone does not on iOS.
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
    const pad = (n) => String(n).padStart(2, "0");
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const parts = (key) => key.split("-").map(Number);
    const dateOf = (key) => { const [y, m, d] = parts(key); return new Date(y, m - 1, d); };
    const dayDiff = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
    const fmtTime = (t) => {
        if (!t) return "All day";
        const [h, m] = t.split(":").map(Number);
        const suffix = h >= 12 ? "PM" : "AM";
        const hour = h % 12 || 12;
        return m ? `${hour}:${pad(m)} ${suffix}` : `${hour} ${suffix}`;
    };
    const isAllDay = (e) => e.all_day || !e.start_time;
    const fmtRange = (e) => (isAllDay(e) ? "All day" : e.end_time && e.end_time !== e.start_time ? `${fmtTime(e.start_time)} – ${fmtTime(e.end_time)}` : fmtTime(e.start_time));
    const fmtDay = (key) => { const d = dateOf(key); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };

    const grid = $("calGrid");
    if (!grid) return; // calendar section not present
    const board = $("calBoard"), agenda = $("calAgenda");
    const phone = window.matchMedia("(max-width:720px)");
    let todayKey = iso(new Date());
    const cache = new Map();
    let view = null;          // first day of the visible month
    let current = null;       // {data, y, m} last rendered
    let activeCat = null;     // type filter (null = all)
    let selectedKey = null;   // phone agenda day
    let loading = false;

    const relLabel = (key) => {
        const n = dayDiff(todayKey, key);
        if (n === 0) return "Today";
        if (n === 1) return "Tomorrow";
        if (n > 1 && n < 7) return `In ${n} days`;
        if (n >= 7 && n < 14) return "Next week";
        if (n >= 14) return `In ${Math.round(n / 7)} weeks`;
        return "";
    };
    // Manila is UTC+8 all year (no daylight saving).
    const manilaStamp = (date, time) => Date.parse(`${date}T${time || "00:00"}:00+08:00`);
    const utcCompact = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    function googleUrl(e) {
        let dates;
        if (isAllDay(e)) {
            const next = dateOf(e.date); next.setDate(next.getDate() + 1);
            dates = `${e.date.replace(/-/g, "")}/${iso(next).replace(/-/g, "")}`;
        } else {
            const start = manilaStamp(e.date, e.start_time);
            const end = e.end_time && e.end_time > e.start_time ? manilaStamp(e.date, e.end_time) : start + 3600000;
            dates = `${utcCompact(start)}/${utcCompact(end)}`;
        }
        const q = new URLSearchParams({ action: "TEMPLATE", text: e.title || "LIFEGEN event", dates, ctz: "Asia/Manila" });
        if (e.description) q.set("details", e.description);
        if (e.location) q.set("location", e.location);
        if (e.recurring) q.set("recur", "RRULE:FREQ=WEEKLY;BYDAY=SU"); // same as the Apple / Outlook file
        return `https://calendar.google.com/calendar/render?${q}`;
    }
    const icsUrl = (e) => `/api/public/event.ics?id=${encodeURIComponent(e.id)}`;

    async function getJson(url) {
        const r = await fetch(url, { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) throw new Error("The calendar could not be loaded right now.");
        return r.json();
    }

    // ---- Data ---------------------------------------------------------------
    function loadMonth(y, m) {
        const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
        const from = iso(new Date(first.getFullYear(), first.getMonth(), first.getDate() - 7));
        const to = iso(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 8));
        const key = `${y}-${pad(m + 1)}`;
        if (!cache.has(key)) {
            const p = getJson(`/api/public/calendar-events?from=${from}&to=${to}`);
            p.catch(() => cache.delete(key));
            cache.set(key, p);
        }
        return cache.get(key);
    }
    const prefetch = (y, m) => { loadMonth(y, m).catch(() => {}); };
    const visible = (e) => !activeCat || catOf(e) === activeCat;
    function groupByDate(events) {
        const byDate = new Map();
        for (const e of events) {
            if (!visible(e)) continue;
            if (!byDate.has(e.date)) byDate.set(e.date, []);
            byDate.get(e.date).push(e);
        }
        return byDate;
    }

    // ---- Month grid -----------------------------------------------------------
    const setTitle = (y, m) => { $("calMonth").innerHTML = `${MONTHS[m]} <em class="cal-year">${y}</em>`; };
    function renderMonth(data, y, m) {
        current = { data, y, m };
        todayKey = data.today || todayKey;
        const monthKey = `${y}-${pad(m + 1)}`;
        const monthEvents = data.events.filter((e) => e.date.startsWith(monthKey));
        setTitle(y, m);
        const ahead = monthEvents.filter((e) => e.date >= todayKey).length;
        $("calSummary").textContent = monthEvents.length
            ? `${monthEvents.length} gathering${monthEvents.length === 1 ? "" : "s"} this month${ahead && ahead < monthEvents.length ? ` · ${ahead} still ahead` : ""}`
            : "A quiet month — the doors are still open every Sunday.";
        renderFilters(monthEvents);
        const byDate = groupByDate(data.events);
        const firstDow = new Date(y, m, 1).getDay();
        const start = new Date(y, m, 1 - firstDow);
        const weeks = Math.ceil((firstDow + new Date(y, m + 1, 0).getDate()) / 7);
        let html = "";
        for (let i = 0; i < weeks * 7; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const key = iso(d);
            const out = d.getMonth() !== m;
            const events = byDate.get(key) || [];
            const isToday = key === todayKey;
            const cls = ["cal-cell", out && "is-out", isToday && "is-today", key < todayKey && "is-past",
                events.length && "has-events", key === selectedKey && "is-selected"].filter(Boolean).join(" ");
            const tag = events.length ? "button" : "div";
            const attrs = events.length
                ? ` type="button" aria-label="${esc(`${fmtDay(key)}${isToday ? " (today)" : ""}: ${events.map((e) => e.title).join(", ")}`)}"`
                : "";
            const max = events.length > 3 ? 2 : 3;
            const chips = events.slice(0, max).map((e) =>
                `<span class="cal-chip cat-${catOf(e)}"><span class="cal-chip-text">${isAllDay(e) ? "" : `<b>${esc(fmtTime(e.start_time))}</b>`}${esc(e.title)}</span></span>`).join("");
            const more = events.length > max ? `<span class="cal-more">${events.length - max} more</span>` : "";
            const dots = events.slice(0, 3).map((e) => `<i class="cal-dot cat-${catOf(e)}"></i>`).join("");
            html += `<${tag} class="${cls}" data-date="${key}"${attrs}><span class="cal-daynum"${isToday ? ' aria-current="date"' : ""}>${d.getDate()}</span><span class="cal-chips">${chips}${more}</span><span class="cal-dots" aria-hidden="true">${dots}</span></${tag}>`;
        }
        grid.innerHTML = html;
        grid.classList.remove("ready");
        void grid.offsetWidth; // restart the fade-in
        grid.classList.add("ready");
        renderAgenda();
        icons();
        prefetch(m === 11 ? y + 1 : y, (m + 1) % 12);
        prefetch(m === 0 ? y - 1 : y, (m + 11) % 12);
    }

    // ---- Type filter (also serves as the colour legend) ---------------------
    function renderFilters(monthEvents) {
        const present = new Set(monthEvents.map(catOf));
        if (activeCat) present.add(activeCat);
        const keys = Object.keys(CATS).filter((k) => present.has(k));
        const legend = $("calLegend");
        legend.hidden = keys.length < 2;
        const btn = (key, label) => {
            const active = (activeCat || "") === key;
            return `<button type="button" class="cal-filter${key ? ` cat-${key}` : ""}${active ? " is-active" : ""}" data-cat="${key}" aria-pressed="${active}">${key ? '<i class="cal-dot"></i>' : ""}${esc(label)}</button>`;
        };
        legend.innerHTML = btn("", "All") + keys.map((k) => btn(k, CATS[k])).join("");
    }
    $("calLegend").addEventListener("click", (e) => {
        const b = e.target.closest("[data-cat]");
        if (!b || !current) return;
        const cat = b.dataset.cat || null;
        activeCat = activeCat === cat ? null : cat;
        renderMonth(current.data, current.y, current.m);
    });

    // ---- Event details (shared by modal + phone agenda) ----------------------
    const eventDetails = (e) => `<article class="cal-ev cat-${catOf(e)}">
        <span class="cal-ev-type"><i class="cal-dot"></i>${esc(CATS[catOf(e)])}${e.recurring ? " · every week" : ""}</span>
        <h4>${esc(e.title)}</h4>
        <p class="cal-ev-meta"><span><i data-lucide="clock"></i>${esc(fmtRange(e))}</span>${e.location ? `<span><i data-lucide="map-pin"></i>${esc(e.location)}</span>` : ""}</p>
        ${e.description ? `<p class="cal-ev-desc">${esc(e.description)}</p>` : ""}
        <div class="cal-ev-actions"><a class="cal-btn is-dark" href="${esc(googleUrl(e))}" target="_blank" rel="noopener"><i data-lucide="calendar-plus"></i>Google Calendar</a><a class="cal-btn" href="${icsUrl(e)}" download="lifegen-event.ics">Apple / Outlook</a></div>
      </article>`;
    const dayHeading = (key, count) => {
        const rel = relLabel(key);
        return `<header class="cal-day-head"><h4>${esc(fmtDay(key))}</h4>${rel ? `<span class="cal-rel">${esc(rel)}</span>` : ""}</header>${count ? "" : `<p class="cal-none">No events this day.</p>`}`;
    };

    // ---- Phone: inline day agenda -------------------------------------------
    function renderAgenda() {
        if (!current) return;
        const { data, y, m } = current;
        const monthKey = `${y}-${pad(m + 1)}`;
        if (!selectedKey || !selectedKey.startsWith(monthKey)) {
            const inMonth = data.events.filter((e) => e.date.startsWith(monthKey) && visible(e));
            selectedKey = todayKey.startsWith(monthKey) ? todayKey
                : (inMonth.find((e) => e.date >= todayKey) || inMonth[0] || { date: `${monthKey}-01` }).date;
            markSelected();
        }
        const events = groupByDate(data.events).get(selectedKey) || [];
        agenda.innerHTML = dayHeading(selectedKey, events.length) + events.map(eventDetails).join("");
        icons();
    }
    function markSelected() {
        grid.querySelectorAll(".is-selected").forEach((c) => c.classList.remove("is-selected"));
        grid.querySelector(`[data-date="${selectedKey}"]`)?.classList.add("is-selected");
    }

    // ---- Day modal (tablet / desktop) ------------------------------------------
    const modal = $("eventModal"), modalBody = $("eventModalBody");
    async function openDay(dateKey) {
        let data;
        try {
            const [y, m] = parts(dateKey);
            data = await loadMonth(y, m - 1);
        } catch (e) {
            modalBody.innerHTML = `<p class="cal-none">${esc(e.message)}</p>`;
            openModal();
            return;
        }
        const events = (data.events || []).filter((e) => e.date === dateKey && (visible(e) || !current));
        modalBody.innerHTML = dayHeading(dateKey, events.length) + events.map(eventDetails).join("");
        openModal();
    }
    let lastFocus = null;
    function openModal() {
        lastFocus = document.activeElement;
        if (modal.classList.contains("open")) { icons(); return; }
        modal.classList.add("open");
        lockBodyScroll();
        icons();
        modal.querySelector(".modal-close").focus();
    }
    function closeModal() {
        if (!modal.classList.contains("open")) return;
        modal.classList.remove("open");
        unlockBodyScroll();
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); });

    // ---- Wiring -----------------------------------------------------------------
    grid.addEventListener("click", (e) => {
        const cell = e.target.closest("[data-date]");
        if (!cell) return;
        if (phone.matches) { selectedKey = cell.dataset.date; markSelected(); renderAgenda(); }
        else if (cell.classList.contains("has-events")) openDay(cell.dataset.date);
    });
    const shiftMonth = (delta) => {
        if (loading) return;
        view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
        show();
    };
    $("calPrev").addEventListener("click", () => shiftMonth(-1));
    $("calNext").addEventListener("click", () => shiftMonth(1));
    $("calTodayBtn").addEventListener("click", () => {
        const [y, m] = parts(todayKey);
        view = new Date(y, m - 1, 1);
        selectedKey = todayKey;
        show();
    });
    // Swipe left/right on the grid to change months (phones).
    let touch = null;
    board.addEventListener("touchstart", (e) => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY }; }, { passive: true });
    board.addEventListener("touchend", (e) => {
        if (!touch) return;
        const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
        touch = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) shiftMonth(dx < 0 ? 1 : -1);
    }, { passive: true });

    function gridMessage(text) {
        grid.innerHTML = `<div class="cal-error"><p>${esc(text)}</p><button type="button" class="cal-btn" id="calRetry">Try again</button></div>`;
        $("calRetry").addEventListener("click", () => { cache.clear(); show(); });
    }

    async function show() {
        if (loading) return;
        loading = true;
        const y = view.getFullYear(), m = view.getMonth();
        const spinner = setTimeout(() => {
            grid.innerHTML = '<div class="cal-loading"><span class="cal-spinner" aria-hidden="true"></span>Loading…</div>';
        }, 160);
        try {
            const data = await loadMonth(y, m);
            clearTimeout(spinner);
            renderMonth(data, y, m);
        } catch (e) {
            clearTimeout(spinner);
            setTitle(y, m);
            $("calSummary").textContent = "";
            gridMessage(e.message || "The calendar could not be loaded right now.");
        } finally {
            loading = false;
        }
    }

    phone.addEventListener?.("change", () => current && renderAgenda());
    const now = new Date();
    view = new Date(now.getFullYear(), now.getMonth(), 1);
    show();
    })();
