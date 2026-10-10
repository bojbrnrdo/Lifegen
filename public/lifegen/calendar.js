// LIFEGEN events calendar (public website): month grid, upcoming list, day details.
// Talks only to same-origin /api/public endpoints; no credentials in the browser.
(() => {
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
    const CATS = {
        service: "Sunday service", worship: "Worship night", prayer: "Prayer gathering",
        youth: "Youth", lifegroup: "Lifegroup", outreach: "Outreach", special: "Special event",
    };

    const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) {} };
    const pad = (n) => String(n).padStart(2, "0");
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fmtTime = (t) => {
        if (!t) return "All day";
        const [h, m] = t.split(":").map(Number);
        const suffix = h >= 12 ? "PM" : "AM";
        const hour = h % 12 || 12;
        return m ? `${hour}:${pad(m)} ${suffix}` : `${hour} ${suffix}`;
    };
    const fmtRange = (e) => (e.all_day || !e.start_time ? "All day" : e.end_time && e.end_time !== e.start_time ? `${fmtTime(e.start_time)} – ${fmtTime(e.end_time)}` : fmtTime(e.start_time));
    const fmtDay = (date) => {
        const [y, m, d] = date.split("-").map(Number);
        return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
    };

    const grid = $("calGrid");
    if (!grid) return; // calendar section not present
    let todayKey = iso(new Date());
    const cache = new Map();
    let view = null; // {y, m}
    let loading = false;

    async function getJson(url) {
        const r = await fetch(url, { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) throw new Error("The calendar could not be loaded right now.");
        return r.json();
    }

    // ---- Month grid -------------------------------------------------------
    async function loadMonth(y, m) {
        const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
        const from = iso(new Date(first.getFullYear(), first.getMonth(), first.getDate() - 7));
        const to = iso(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 8));
        const key = `${y}-${pad(m + 1)}`;
        if (!cache.has(key)) cache.set(key, getJson(`/api/public/calendar-events?from=${from}&to=${to}`));
        return cache.get(key);
    }

    function renderMonth(data, y, m) {
        $("calMonth").textContent = `${MONTHS[m]} ${y}`;
        const byDate = new Map();
        for (const e of data.events) {
            if (!byDate.has(e.date)) byDate.set(e.date, []);
            byDate.get(e.date).push(e);
        }
        todayKey = data.today || todayKey;
        const firstDow = new Date(y, m, 1).getDay();
        const start = new Date(y, m, 1 - firstDow);
        let html = "";
        for (let i = 0; i < 42; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const key = iso(d);
            const out = d.getMonth() !== m;
            const events = byDate.get(key) || [];
            const isToday = key === todayKey;
            const cell = events.length
                ? `<button type="button" class="cal-cell has-events${out ? " is-out" : ""}${isToday ? " is-today" : ""}" data-date="${key}" aria-label="${esc(fmtDay(key))} — ${events.length} event${events.length > 1 ? "s" : ""}">`
                : `<div class="cal-cell${out ? " is-out" : ""}${isToday ? " is-today" : ""}" data-date="${key}">`;
            const chips = events.slice(0, 2).map((e) =>
                `<span class="cal-chip cat-${esc(e.category)}${e.recurring ? " is-weekly" : ""}">${e.all_day || !e.start_time ? "" : `<b>${esc(fmtTime(e.start_time))}</b>`}${esc(e.title)}</span>`).join("");
            const dots = events.slice(0, 4).map((e) => `<i class="cal-dot cat-${esc(e.category)}" aria-hidden="true"></i>`).join("");
            const more = events.length > 2 ? `<span class="cal-more">+${events.length - 2} more</span>` : "";
            html += `${cell}<span class="cal-daynum"${isToday ? ' aria-current="date"' : ""}>${d.getDate()}${isToday ? '<i class="cal-today-dot" aria-hidden="true"></i>' : ""}</span><span class="cal-dots" aria-hidden="true">${dots}</span><span class="cal-chips">${chips}${more}</span>${events.length ? "</button>" : "</div>"}`;
        }
        grid.innerHTML = html;
        grid.classList.add("ready");
        renderLegend();
        icons();
    }

    function renderLegend() {
        const legend = $("calLegend");
        if (legend.childElementCount) return;
        legend.innerHTML = Object.entries(CATS).map(([k, label]) => `<span class="cal-legend-item"><i class="cal-dot cat-${k}"></i>${esc(label)}</span>`).join("");
    }

    // ---- Upcoming side panel ---------------------------------------------
    function renderUpcoming(data) {
        const wrap = $("calUpcoming");
        const events = (data.events || []).slice(0, 6);
        if (!events.length) {
            wrap.innerHTML = `<div class="cal-empty"><i data-lucide="calendar-check"></i><p>Nothing scheduled just yet — the Sunday service is still on!</p></div>`;
        } else {
            wrap.innerHTML = events.map((e) => {
                const [y, m, d] = e.date.split("-").map(Number);
                return `<button type="button" class="cal-up-item" data-date="${e.date}">
          <span class="cal-up-badge cat-${esc(e.category)}"><b>${d}</b><small>${MONTHS_SHORT[m - 1]}</small></span>
          <span class="cal-up-body"><strong>${esc(e.title)}</strong>
          <small><i data-lucide="clock"></i>${esc(fmtRange(e))}${e.location ? ` · <i data-lucide="map-pin"></i>${esc(e.location)}` : ""}</small></span></button>`;
            }).join("");
        }
        icons();
    }

    // ---- Day detail modal --------------------------------------------------
    const modal = $("eventModal"), modalBody = $("eventModalBody");
    function eventCard(e) {
        return `<article class="cal-ev cat-${esc(e.category)}">
      <header><span class="cal-ev-pill cat-${esc(e.category)}">${esc(e.label || CATS[e.category] || "Event")}</span>${e.recurring ? '<span class="cal-ev-weekly"><i data-lucide="refresh-cw"></i>Repeats weekly</span>' : ""}</header>
      <h4>${esc(e.title)}</h4>
      <div class="cal-ev-meta">
        <span><i data-lucide="calendar-days"></i>${esc(fmtDay(e.date))}</span>
        <span><i data-lucide="clock"></i>${esc(fmtRange(e))}</span>
        ${e.location ? `<span><i data-lucide="map-pin"></i>${esc(e.location)}</span>` : ""}
      </div>
      ${e.description ? `<p>${esc(e.description)}</p>` : ""}
      <a class="cal-ev-ics" href="/api/public/event.ics?id=${encodeURIComponent(e.id)}" download="lifegen-event.ics"><i data-lucide="calendar-plus"></i>Add this event to my calendar</a>
    </article>`;
    }
    async function openDay(dateKey, preselect) {
        let data;
        try {
            const [y, m] = dateKey.split("-").map(Number);
            data = await loadMonth(y, m - 1);
        } catch (e) {
            modalBody.innerHTML = `<p class="cal-ev-none">${esc(e.message)}</p>`;
            openModal();
            return;
        }
        const events = (data.events || []).filter((e) => e.date === dateKey);
        modalBody.innerHTML = events.length
            ? `<p class="cal-modal-day">${esc(fmtDay(dateKey))}</p>${events.map(eventCard).join("")}`
            : `<p class="cal-modal-day">${esc(fmtDay(dateKey))}</p><p class="cal-ev-none"><i data-lucide="calendar-check"></i>No events on this day — see you Sunday!</p>`;
        openModal();
    }
    let lastFocus = null;
    function openModal() {
        lastFocus = document.activeElement;
        modal.classList.add("open");
        document.body.style.overflow = "hidden";
        icons();
        modal.querySelector(".modal-close").focus();
    }
    function closeModal() {
        modal.classList.remove("open");
        document.body.style.overflow = "";
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); });

    // ---- Events wiring -----------------------------------------------------
    grid.addEventListener("click", (e) => {
        const cell = e.target.closest("[data-date]");
        if (cell && cell.classList.contains("has-events")) openDay(cell.dataset.date);
    });
    $("calUpcoming").addEventListener("click", (e) => {
        const item = e.target.closest("[data-date]");
        if (item) openDay(item.dataset.date, true);
    });
    const shiftMonth = (delta) => {
        if (loading) return;
        view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
        show();
    };
    $("calPrev").addEventListener("click", () => shiftMonth(-1));
    $("calNext").addEventListener("click", () => shiftMonth(1));
    $("calTodayBtn").addEventListener("click", () => {
        const now = new Date();
        view = new Date(now.getFullYear(), now.getMonth(), 1);
        show();
    });

    function gridMessage(text, retry) {
        grid.innerHTML = `<div class="cal-error"><i data-lucide="wifi-off"></i><p>${esc(text)}</p>${retry ? '<button type="button" class="btn btn-ghost btn-sm2" id="calRetry">Try again</button>' : ""}</div>`;
        icons();
        const btn = $("calRetry");
        if (btn) btn.addEventListener("click", () => { cache.clear(); show(); });
    }

    async function show() {
        if (loading) return;
        loading = true;
        grid.classList.remove("ready");
        grid.innerHTML = '<div class="cal-loading"><span class="cal-spinner" aria-hidden="true"></span>Loading the calendar…</div>';
        try {
            const data = await loadMonth(view.getFullYear(), view.getMonth());
            renderMonth(data, view.getFullYear(), view.getMonth());
        } catch (e) {
            $("calMonth").textContent = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;
            gridMessage(e.message || "The calendar could not be loaded right now.", true);
        } finally {
            loading = false;
        }
    }

    async function loadUpcoming() {
        try {
            renderUpcoming(await getJson("/api/public/calendar-upcoming?days=120&limit=6"));
        } catch {
            $("calUpcoming").innerHTML = '<div class="cal-empty"><p>Upcoming events will appear here.</p></div>';
        }
    }

    const now = new Date();
    view = new Date(now.getFullYear(), now.getMonth(), 1);
    show();
    loadUpcoming();
})();
