const $ = id => document.getElementById(id),
    esc = s => String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    } [c])),
    qs = (sel, root) => (root || document).querySelector(sel),
    qsa = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel)),
    safeParse = (k, fb) => {
        try {
            return JSON.parse(localStorage.getItem(k)) ?? fb
        } catch {
            return fb
        }
    },
    renderIcons = () => {
        window.lucide && lucide.createIcons()
    };
renderIcons();
var REDUCED_MOTION = !1;
try {
    REDUCED_MOTION = !(!window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
} catch (e) {}

function toast(msg, icon = "check") {
    const t = document.createElement("div");
    t.className = "toast", t.innerHTML = `<i data-lucide="${icon}"></i><span>${esc(msg)}</span>`, $("toasts").appendChild(t), renderIcons(), setTimeout(() => {
        t.classList.add("out"), setTimeout(() => t.remove(), 380)
    }, 4200)
}

function lsGetJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (null === raw) return fallback;
        const val = JSON.parse(raw);
        return null == val ? fallback : val
    } catch (e) {
        return console.error("[LIFEGEN] read failed:", key, e), fallback
    }
}

function lsSetJSON(key, value) {
    try {
        return localStorage.setItem(key, JSON.stringify(value)), !0
    } catch (e) {
        return console.error("[LIFEGEN] save failed:", key, e), toast("Sorry, your device could not save this data (storage may be full).", "alert-triangle"), !1
    }
}

function lsRemove(key) {
    try {
        localStorage.removeItem(key)
    } catch (e) {}
}

const getDevice=()=>Lifegen.getDevice(),setDevice=()=>Lifegen.setDevice(),getChurchNow=()=>Lifegen.churchNow(),churchUTCNow=()=>Lifegen.utcNow();
const makeToken=()=>crypto.randomUUID();
const DB=Lifegen.DB;
const VERSES = [{
        ref: "Philippians 4:13",
        text: "I can do all this through him who gives me strength.",
        hi: "him who gives me strength"
    }, {
        ref: "Jeremiah 29:11",
        text: "For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.",
        hi: "plans to give you hope and a future"
    }, {
        ref: "Psalm 23:1",
        text: "The Lord is my shepherd, I lack nothing.",
        hi: "my shepherd"
    }, {
        ref: "Isaiah 41:10",
        text: "So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand.",
        hi: "I am with you"
    }, {
        ref: "Matthew 11:28",
        text: "Come to me, all you who are weary and burdened, and I will give you rest.",
        hi: "I will give you rest"
    }, {
        ref: "Romans 8:28",
        text: "And we know that in all things God works for the good of those who love him, who have been called according to his purpose.",
        hi: "God works for the good"
    }, {
        ref: "Psalm 46:1",
        text: "God is our refuge and strength, an ever-present help in trouble.",
        hi: "refuge and strength"
    }, {
        ref: "Proverbs 3:5-6",
        text: "Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.",
        hi: "Trust in the Lord"
    }, {
        ref: "Joshua 1:9",
        text: "Have I not commanded you? Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.",
        hi: "Be strong and courageous"
    }, {
        ref: "2 Corinthians 5:17",
        text: "Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!",
        hi: "the new creation has come"
    }, {
        ref: "Psalm 119:105",
        text: "Your word is a lamp for my feet, a light on my path.",
        hi: "a lamp for my feet"
    }, {
        ref: "Galatians 5:22-23",
        text: "But the fruit of the Spirit is love, joy, peace, forbearance, kindness, goodness, faithfulness, gentleness and self-control.",
        hi: "the fruit of the Spirit"
    }, {
        ref: "Hebrews 11:1",
        text: "Now faith is confidence in what we hope for and assurance about what we do not see.",
        hi: "confidence in what we hope for"
    }, {
        ref: "James 1:2-3",
        text: "Consider it pure joy, my brothers and sisters, whenever you face trials of many kinds, because you know that the testing of your faith produces perseverance.",
        hi: "pure joy"
    }, {
        ref: "1 Peter 5:7",
        text: "Cast all your anxiety on him because he cares for you.",
        hi: "he cares for you"
    }, {
        ref: "Colossians 3:23",
        text: "Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.",
        hi: "with all your heart"
    }, {
        ref: "Ephesians 2:8",
        text: "For it is by grace you have been saved, through faith—and this is not from yourselves, it is the gift of God.",
        hi: "by grace you have been saved"
    }, {
        ref: "Psalm 37:4",
        text: "Take delight in the Lord and he will give you the desires of your heart.",
        hi: "delight in the Lord"
    }, {
        ref: "Matthew 6:33",
        text: "But seek first his kingdom and his righteousness, and all these things will be given to you as well.",
        hi: "seek first his kingdom"
    }, {
        ref: "Isaiah 40:31",
        text: "But those who hope in the Lord will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.",
        hi: "renew their strength"
    }, {
        ref: "2 Timothy 1:7",
        text: "For the Spirit God gave us does not make us timid, but gives us power, love and self-discipline.",
        hi: "power, love and self-discipline"
    }, {
        ref: "Psalm 27:1",
        text: "The Lord is my light and my salvation—whom shall I fear? The Lord is the stronghold of my life—of whom shall I be afraid?",
        hi: "my light and my salvation"
    }, {
        ref: "John 14:27",
        text: "Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled and do not be afraid.",
        hi: "my peace I give you"
    }, {
        ref: "Romans 12:2",
        text: "Do not conform to the pattern of this world, but be transformed by the renewing of your mind.",
        hi: "renewing of your mind"
    }, {
        ref: "Psalm 91:1",
        text: "Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty.",
        hi: "shelter of the Most High"
    }, {
        ref: "1 Corinthians 16:14",
        text: "Do everything in love.",
        hi: "in love"
    }, {
        ref: "Micah 6:8",
        text: "He has shown you, O mortal, what is good. And what does the Lord require of you? To act justly and to love mercy and to walk humbly with your God.",
        hi: "act justly and to love mercy"
    }, {
        ref: "John 3:16",
        text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
        hi: "God so loved the world"
    }, {
        ref: "Romans 15:13",
        text: "May the God of hope fill you with all joy and peace as you trust in him, so that you may overflow with hope by the power of the Holy Spirit.",
        hi: "overflow with hope"
    }, {
        ref: "Psalm 19:14",
        text: "May these words of my mouth and this meditation of my heart be pleasing in your sight, Lord, my Rock and my Redeemer.",
        hi: "my Rock and my Redeemer"
    }, {
        ref: "Matthew 5:16",
        text: "In the same way, let your light shine before others, that they may see your good deeds and glorify your Father in heaven.",
        hi: "let your light shine"
    }],
    MIN_OFF = -6;
let verseOffset = 0;

function verseFor(offset) {
    const base = getChurchNow();
    base.setHours(0, 0, 0, 0);
    const date = new Date(base);
    date.setDate(date.getDate() + offset);
    const doy = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 864e5);
    return {
        date: date,
        v: VERSES[(doy % VERSES.length + VERSES.length) % VERSES.length]
    }
}

function renderVerse(animate = !0) {
    const {
        date: date,
        v: v
    } = verseFor(verseOffset), main = $("vpMain"), apply = () => {
        $("verseDate").textContent = date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric"
        }), $("verseRef").textContent = v.ref + " · NIV";
        const t = v.text,
            i = v.hi ? t.toLowerCase().indexOf(v.hi.toLowerCase()) : -1;
        $("verseText").innerHTML = i >= 0 ? esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + v.hi.length)) + "</mark>" + esc(t.slice(i + v.hi.length)) : esc(t), $("verseInitial").textContent = t.trim().charAt(0);
        $("prevLabel").textContent = 0 === verseOffset ? "Yesterday" : verseFor(verseOffset - 1).date.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric"
        }), $("prevVerse").disabled = verseOffset <= -6, main.classList.remove("vp-fading")
    };
    animate ? (main.classList.add("vp-fading"), setTimeout(apply, 240)) : apply()
}
renderVerse(!1), $("prevVerse").addEventListener("click", () => {
    verseOffset = Math.max(-6, verseOffset - 1), renderVerse()
}), $("todayVerse").addEventListener("click", () => {
    verseOffset = 0, renderVerse()
}), $("copyVerse").addEventListener("click", async () => {
    const {
        v: v
    } = verseFor(verseOffset), str = `"${v.text}" — ${v.ref} (NIV)`;
    try {
        await navigator.clipboard.writeText(str)
    } catch {
        const ta = document.createElement("textarea");
        ta.value = str, document.body.appendChild(ta), ta.select(), document.execCommand("copy"), ta.remove()
    }
    toast("Verse copied to your clipboard.", "copy")
}), $("shareVerse").addEventListener("click", async () => {
    const {
        v: v
    } = verseFor(verseOffset), data = {
        title: "Verse of the Day — LIFEGEN",
        text: `"${v.text}" — ${v.ref} (NIV)`,
        url: location.href
    };
    if (navigator.share) try {
        await navigator.share(data)
    } catch {} else {
        try {
            await navigator.clipboard.writeText(data.text + " — " + data.url)
        } catch {}
        toast("Verse copied — ready to paste and share.", "share-2")
    }
});
const vPanel = $("versePanel");
vPanel.addEventListener("mousemove", e => {
    const r = vPanel.getBoundingClientRect();
    vPanel.style.setProperty("--mx", e.clientX - r.left + "px"), vPanel.style.setProperty("--my", e.clientY - r.top + "px")
}), $("year").textContent = (new Date).getFullYear();
const nav = $("nav"),
    onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 30);
window.addEventListener("scroll", onScroll, {
    passive: !0
}), onScroll();
const mm = $("mobileMenu");
$("burger").addEventListener("click", () => {
    mm.classList.add("open"), document.body.style.overflow = "hidden"
});
const closeMM = () => {
    mm.classList.remove("open"), document.body.style.overflow = ""
};
$("mmClose").addEventListener("click", closeMM), mm.querySelectorAll("a").forEach(a => a.addEventListener("click", closeMM));
const spy = new IntersectionObserver(es => {
    es.forEach(e => {
        e.isIntersecting && qsa(".nav-links a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id))
    })
}, {
    rootMargin: "-45% 0px -50% 0px"
});
qsa("main section[id]").forEach(s => spy.observe(s));
const io = new IntersectionObserver(es => {
    es.forEach(e => {
        e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))
    })
}, {
    threshold: .1,
    rootMargin: "0px 0px -40px 0px"
});

function nextService() {
    const now = getChurchNow();
    for (let add = 0; add < 8; add++) {
        const calendar=new Date(now.getFullYear(),now.getMonth(),now.getDate()+add,13,0,0); const d=new Date(localDateKey(calendar)+'T13:00:00+08:00');
        if (0 === calendar.getDay() && d > churchUTCNow()) return d
    }
}

function tickCountdown() {
    const target = nextService();
    let diff = Math.max(0, target - churchUTCNow());
    const d = Math.floor(diff / 864e5);
    diff -= 864e5 * d;
    const h = Math.floor(diff / 36e5);
    diff -= 36e5 * h;
    const m = Math.floor(diff / 6e4);
    diff -= 6e4 * m;
    const s = Math.floor(diff / 1e3);
    $("countdown").innerHTML = [
        ["days", d],
        ["hrs", h],
        ["min", m],
        ["sec", s]
    ].map(([l, v]) => `<div class="cd-unit"><span>${v}</span><small>${l}</small></div>`).join('<span class="cd-sep">:</span>');
    const now = getChurchNow();
    $("cdSub").textContent = 0 === now.getDay() && now.getHours() >= 13 && now.getHours() < 15 ? "Service in progress — welcome in! · Lifegiver Church of Faith — Central" : "Sunday · 1:00 PM · Lifegiver Church of Faith — Central"
}
qsa(".reveal").forEach(el => io.observe(el)), tickCountdown(), setInterval(tickCountdown, 1e3);
const prayers = {
    vip: [{
        title: "Personal Prayer for VIP (Visitors & Newcomers)",
        content: "<p>Heavenly Father,</p><p>Thank You for bringing me here today. I believe that this moment is not an accident, but part of Your plan for my life. Lord, I open my heart to You now. If there are doubts, fears, or questions inside me, I surrender them to You. Please help me feel Your presence and Your love right where I am.</p><p>Show me who You are, Lord. Teach me to know You personally and not just hear about You. Help me understand Your Word and guide me as I begin this journey of faith. I ask You to forgive me for my sins and cleanse my heart. Change me from the inside out and lead me in the right path.</p><p>Lord, I want to grow closer to You each day. Give me a willing heart that seeks You, trusts You, and follows You. Surround me with people who will help me grow in faith and encourage me to continue. Let my life be filled with Your peace, Your joy, and Your purpose.</p><p>In Jesus' name, Amen.</p>"
    }],
    regular: [{
        title: "Personal Prayer for Regular Attendees (Leaders & Committed Members)",
        content: "<p>Lord God,</p><p>I come before You with gratitude because You have called me to know You and serve You. Today, I surrender my whole life to You again—my plans, my dreams, my strengths, and even my weaknesses. Teach me to depend on You daily and to seek Your will above my own.</p><p>Father, deepen my love for You. Let my passion for You grow stronger and never fade. Search my heart and remove anything that does not please You. Shape my character so that my thoughts, words, and actions reflect Your goodness. Help me remain humble, faithful, and obedient in every season of my life.</p><p>Use me, Lord, as Your instrument. Help me lead others with love, serve with joy, and speak with wisdom. Strengthen me when I am tired, guide me when I am unsure, and remind me that Your grace is always enough. Draw me closer to You every day so that my life will bring glory to Your name.</p><p>In Jesus' name, Amen.</p>"
    }]
};
let currentType = "vip";

function renderPrayer(type) {
    currentType = type;
    const prayerData = prayers[type] ? prayers[type][0] : prayers.regular[0],
        label = $("prayer-label");
    "vip" === type ? (label.className = "prayer-pill vip", label.textContent = "VIP") : (label.className = "prayer-pill regular", label.textContent = "Regular Attendee"), $("prayer-title-display").textContent = prayerData.title, $("prayer-text").innerHTML = prayerData.content;
    const segV = $("praySegVip"),
        segR = $("praySegRegular");
    segV && segR && (segV.classList.toggle("active", "vip" === type), segR.classList.toggle("active", "vip" !== type))
}

function openPrayerModal(type) {
    renderPrayer(type), $("prayerModal").classList.add("open"), document.body.style.overflow = "hidden"
}
$("praySegVip").addEventListener("click", () => renderPrayer("vip")), $("praySegRegular").addEventListener("click", () => renderPrayer("regular")), $("readVipPrayer").addEventListener("click", () => openPrayerModal("vip")), $("newPrayer").addEventListener("click", () => {
    renderPrayer(currentType), toast("Prayer refreshed. Take a fresh moment with the Lord.", "book-open")
}), $("sharePrayer").addEventListener("click", () => {
    const shareText = $("prayer-title-display").textContent + "\n\n" + $("prayer-text").innerText + "\n\n- From LIFEGEN";
    navigator.share ? navigator.share({
        title: $("prayer-title-display").textContent,
        text: shareText,
        url: window.location.href
    }).catch(err => {
        err && "AbortError" !== err.name && console.log("Error sharing:", err)
    }) : navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(shareText).then(() => toast("Prayer copied to clipboard!", "copy")).catch(() => toast("Unable to copy. Please select and copy the text manually.", "alert-triangle")) : toast("Sharing is not supported on this device. Please copy the text manually.", "alert-triangle")
});
const modals = [$("storyModal"), $("prayerModal")];

function setFieldError(input, message) {
    if (!input) return;
    const f = input.closest(".field");
    if (f) {
        f.classList.add("invalid");
        const err = f.querySelector(".err");
        err && (err.textContent = message)
    }
    input.setAttribute("aria-invalid", "true")
}

function clearFieldError(input) {
    if (!input) return;
    const f = input.closest(".field");
    if (f) {
        f.classList.remove("invalid");
        const err = f.querySelector(".err");
        err && (err.textContent = "")
    }
    input.removeAttribute("aria-invalid")
}

function clearLiveValidation(formId) {
    const form = $(formId);
    form && qsa("input, textarea", form).forEach(input => {
        clearFieldError(input), input.addEventListener("input", function handler() {
            clearFieldError(input), input.removeEventListener("input", handler)
        })
    })
}
async function updatePrize() {
    const prizeInput = $("prize-input"),
        prizeDisplay = $("current-prize-display");
    if (!prizeInput) return;
    const newPrize = prizeInput.value.trim();
    if (!newPrize) return toast("Please enter a prize description first.", "alert-triangle"), void prizeInput.focus();
    try {
        await DB.setPrize(newPrize), prizeDisplay && (prizeDisplay.textContent = newPrize), prizeInput.value = "", toast("Prize updated! VIPs will now see this prize.", "trophy")
    } catch (e) {
        toast("Could not save the prize: " + e.message, "alert-triangle")
    }
}
async function loadPrizeInVipSection() {
    $("vip-prize-value").textContent = await DB.getPrize()
}
qsa("[data-story]").forEach(b => b.addEventListener("click", e => {
    e.preventDefault(), $("storyModal").classList.add("open"), document.body.style.overflow = "hidden"
})), modals.forEach(modal => {
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => {
        modal.classList.remove("open"), document.body.style.overflow = ""
    }))
}), document.addEventListener("keydown", e => {
    "Escape" === e.key && (modals.forEach(m => m.classList.remove("open")), closeMM(), document.body.style.overflow = "")
});
function syncVipDashboardState() {
    const signup = $("vip-signup-form-container"),
        dash = $("vip-attendance-dashboard"),
        device = getDevice();
    device && device.token && device.name ? (signup.hidden = !0, dash.hidden = !1, $("vip-welcome-name").textContent = device.name, loadVipAttendance(), loadPrizeInVipSection()) : (signup.hidden = !1, dash.hidden = !0, clearLiveValidation("vip-signup-form"))
}

function validateVipForm() {
    const nameInput = $("vip-name"),
        ageInput = $("vip-age"),
        schoolInput = $("vip-school"),
        inviterInput = $("vip-inviter"),
        contactInput = $("vip-contact");
    [nameInput, ageInput, schoolInput, inviterInput, contactInput].forEach(clearFieldError);
    let firstInvalid = null;
    const fail = (input, msg) => {
            setFieldError(input, msg), firstInvalid || (firstInvalid = input)
        },
        name = nameInput.value.trim();
    name.length < 2 && fail(nameInput, "Please enter your full name (at least 2 characters).");
    const age = ageInput.value.trim(),
        ageNum = parseInt(age, 10);
    (!age || isNaN(ageNum) || ageNum < 1 || ageNum > 120) && fail(ageInput, "Please enter a valid age between 1 and 120."), schoolInput.value.trim().length < 2 && fail(schoolInput, "Please enter your school or institution."), inviterInput.value.trim().length < 2 && fail(inviterInput, "Please tell us who invited you.");
    const contact = contactInput.value.trim();
    return contact && !/^[0-9+\-() ]{7,20}$/.test(contact) && fail(contactInput, "Please enter a valid contact number, or leave this blank."), firstInvalid ? (firstInvalid.focus(), toast("Please check the highlighted fields.", "alert-triangle"), null) : {
        name: name,
        age: ageNum,
        school: schoolInput.value.trim(),
        inviter: inviterInput.value.trim(),
        contact: contact || null
    }
}

function getSundaysInMonth(year, month) {
    const sundays = [],
        date = new Date(year, month, 1);
    for (; 0 !== date.getDay();) date.setDate(date.getDate() + 1);
    for (; date.getMonth() === month;) sundays.push(new Date(date)), date.setDate(date.getDate() + 7);
    return sundays
}

function localDateKey(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0")
}

function isTodaySunday() {
    return 0 === getChurchNow().getDay()
}

function getNextSunday() {
    const today = getChurchNow(),
        next = new Date(today);
    return next.setDate(today.getDate() + (7 - today.getDay())), next
}
async function loadVipAttendance() {
    const device = getDevice();
    if (device && device.token) try {
        const entries = await DB.listCheckinsFor(device.token),
            now = getChurchNow(),
            sundays = getSundaysInMonth(now.getFullYear(), now.getMonth()),
            attendedCount = new Set(entries.filter(d=>"valid"===d.status && d.date_key.startsWith(localDateKey(now).slice(0,7))).map(d=>d.date_key)).size,
            totalSundays = sundays.length,
            percentage = totalSundays > 0 ? attendedCount / totalSundays * 100 : 0,
            progressBar = $("progress-bar");
        progressBar.style.width = percentage + "%", progressBar.textContent = attendedCount > 0 ? attendedCount + "/" + totalSundays + " Sundays" : "", progressBar.parentElement.setAttribute("aria-valuenow", attendedCount), progressBar.parentElement.setAttribute("aria-valuemax", totalSundays);
        $("attendance-status").textContent = attendedCount === totalSundays && totalSundays > 0 ? "Prize unlocked!" : attendedCount + " of " + totalSundays + " Sundays", updatePrizeProgress(attendedCount, totalSundays);
        const grid = $("sundays-grid");
        if (grid.innerHTML = "", sundays.forEach((sunday, index) => {
                const key = localDateKey(sunday),
                    entry = entries.find(d => d.date_key === key),
                    isPresent = entry && "valid" === entry.status,
                    isPending = entry && "pending" === entry.status,
                    isToday = key === localDateKey(getChurchNow()),
                    item = document.createElement("div");
                let statusText;
                item.className = "sunday-item" + (isPresent ? " present" : "") + (isPending ? " pending" : ""), item.setAttribute("role", "listitem"), statusText = isPresent ? "Present" : isPending ? "Pending" : isToday ? "Today" : key < localDateKey(getChurchNow()) ? "Missed" : "Upcoming", item.innerHTML = `<div class="sunday-date">${sunday.getDate()}</div><div class="sunday-status">${statusText}</div>`, grid.appendChild(item)
            }), isTodaySunday()) {
            $("sunday-checkin-container").hidden = !1, $("not-sunday-container").hidden = !0;
            const todayKey = localDateKey(getChurchNow()),
                todayEntry = entries.find(d => d.date_key === todayKey),
                already = !!todayEntry,
                btn = $("checkin-btn");
            already ? (btn.disabled = !0, btn.textContent = "pending" === todayEntry.status ? "Awaiting validation" : "valid" === todayEntry.status ? "Already checked in" : "Check-in invalidated") : (btn.disabled = !1, btn.textContent = "Check in for today's service"), $("checkin-status-text").textContent = already ? "Check-in submitted" : "Sunday check-in available!"
        } else {
            $("sunday-checkin-container").hidden = !0, $("not-sunday-container").hidden = !1;
            const str = getNextSunday().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric"
            });
            $("not-sunday-container").querySelector("h4").textContent = "See you " + str + "!", $("not-sunday-container").querySelector("p").textContent = "Attendance check-in is only available on Sundays. We look forward to seeing you at our next service on " + str + "!"
        }
    } catch (e) {
        console.error("loadVipAttendance failed:", e), toast("Could not load your attendance: " + e.message, "alert-triangle")
    }
}

function updatePrizeProgress(current, total) {
    const progressText = $("progress-text"),
        bar = $("prize-progress-bar");
    if (0 === total) return progressText.textContent = "No Sundays this month", bar.style.width = "0%", void(bar.textContent = "");
    const percentage = Math.round(current / total * 100),
        remaining = total - current;
    current >= total ? (progressText.textContent = "Congratulations! You've earned the monthly prize!", bar.style.width = "100%", bar.textContent = "100%") : (progressText.textContent = "Attend " + remaining + " more Sunday" + (1 !== remaining ? "s" : "") + " to win the prize!", bar.style.width = percentage + "%", bar.textContent = percentage > 0 ? percentage + "%" : "")
}
$("vip-signup-form").addEventListener("submit", async e => {
    e.preventDefault();
    const data = validateVipForm();
    if (!data) return;
    if (getDevice() && getDevice().token) return toast("You are already registered on this device — opening your portal.", "info"), void syncVipDashboardState();
    const token = makeToken(),
        reg = {
            vip_token: token,
            full_name: data.name,
            age: data.age,
            school: data.school,
            inviter: data.inviter,
            contact: data.contact
        };
    try {
        await DB.addRegistration(reg)
    } catch (err) {
        return void toast("Registration failed: " + err.message, "alert-triangle")
    }
    setDevice({
        token: token,
        name: data.name
    }), toast("Welcome to LIFEGEN, " + data.name + "! Your registration has been recorded.", "sparkles"), e.target.reset(), syncVipDashboardState()
}), $("checkin-btn").addEventListener("click", async () => {
    if (!isTodaySunday()) return void toast("Attendance check-in is only available on Sundays.", "alert-triangle");
    const device = getDevice();
    if (!device || !device.token) return toast("Please register as a VIP first.", "alert-triangle"), void syncVipDashboardState();
    try {
        const entries = await DB.listCheckinsFor(device.token),
            todayKey = localDateKey(getChurchNow()),
            existing = entries.find(d => d.date_key === todayKey);
        if (existing) return "pending" === existing.status ? toast("You have already checked in today! Awaiting admin validation.", "info") : "valid" === existing.status ? toast("You have already been validated for today!", "check") : toast("Your check-in was invalidated. Please contact an admin if this is an error.", "alert-triangle"), void await loadVipAttendance();
        await DB.addCheckin(device.token, todayKey), toast("Check-in submitted! Your attendance is pending admin validation.", "check"), await loadVipAttendance()
    } catch (e) {
        toast("Check-in failed: " + e.message, "alert-triangle")
    }
});
const TYPE_META = {
    prayer: {
        label: "Prayer request",
        icon: "heart"
    },
    testimony: {
        label: "Testimony",
        icon: "message-circle"
    },
    praise: {
        label: "Praise",
        icon: "sparkles"
    }
};
let posts = [],
    filter = "all";
const voted = new Set(safeParse("lifegen_voted", [])),
    amens = lsGetJSON("lifegen_amens", {});

function timeAgo(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    const s = Math.floor((Date.now() - d.getTime()) / 1e3);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const days = Math.floor(h / 24);
    return days < 7 ? days + "d ago" : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
    })
}

function postHTML(p, i) {
    const meta = TYPE_META[p.type] || TYPE_META.prayer,
        rot = ["rot-0", "rot-1", "rot-2", "rot-3", "rot-4"][i % 5],
        tape = i % 2 == 0 ? '<span class="tape" aria-hidden="true"></span>' : "",
        id = String(p.id || p.created_at + (p.author || "")),
        isVoted = p.prayed || voted.has(id),
        amenCount = p.prayer_count || 0,
        name = (void 0 === p.is_anonymous ? p.isAnonymous : p.is_anonymous) ? '<span class="post-name anon-name">— anonymous</span>' : `<span class="post-name">— ${esc(p.author)}</span>`;
    return `<article class="post ${rot} ${p.fresh?"post-new":""}" data-id="${esc(id)}" data-type="${esc(p.type)}">\n    ${tape}\n    <div class="post-head">\n      <span class="badge badge-${"prayer"===p.type?"request":p.type}"><i data-lucide="${meta.icon}"></i>${meta.label}</span>\n      <span class="post-time">${timeAgo(p.created_at)}</span>\n    </div>\n    <p class="post-text">${esc(p.content).replace(/\n/g,"<br>")}</p>\n    <div class="post-foot">\n      ${name}\n      <button class="amen-btn ${isVoted?"voted":""}" data-amen="${esc(id)}" aria-label="I prayed for this">\n        <i data-lucide="heart-handshake"></i><span>${isVoted?"Amen":"Pray"}</span><b>${amenCount}</b>\n      </button>\n    </div>\n  </article>`
}

function renderWall() {
    const wall = $("prayerWall"),
        list = posts.filter(p => "all" === filter || p.type === filter);
    $("countAll").textContent = posts.length, ["prayer", "testimony", "praise"].forEach(t => {
        $("count-" + t).textContent = posts.filter(p => p.type === t).length
    }), wall.innerHTML = list.length ? list.map((p, i) => postHTML(p, i)).join("") : '<div class="wall-empty"><i data-lucide="leaf"></i><p>Nothing here yet — your word could be the first.</p></div>', posts.forEach(p => p.fresh = !1), renderIcons()
}
async function loadPosts() {
    try {
        posts = await DB.listPosts()
    } catch (e) {
        return console.error("loadPosts failed:", e), void toast("Could not load community posts: " + e.message, "alert-triangle")
    }
    renderWall()
}
const form = $("prayerForm"),
    pfText = $("pfText"),
    pfName = $("pfName"),
    anonToggle = $("anonToggle");
let curType = "prayer";
const PLACEHOLDERS = {
    prayer: "Ask for prayer — big or small…",
    testimony: "What has God done in your life lately?",
    praise: "Shout it out — God deserves the credit…"
};

function debounceFn(fn, wait) {
    let t = null;
    return function() {
        clearTimeout(t), t = setTimeout(fn, wait)
    }
}
const saveDraft = debounceFn(() => {
    try {
        localStorage.setItem("lifegen_draft_post", pfText.value), pfName.disabled || localStorage.setItem("lifegen_draft_name", pfName.value)
    } catch (e) {}
}, 400);

function restoreDraft() {
    try {
        const dp = localStorage.getItem("lifegen_draft_post"),
            dn = localStorage.getItem("lifegen_draft_name");
        dp && (pfText.value = dp, $("pfCount").textContent = pfText.value.length + " / 1000"), dn && (pfName.value = dn)
    } catch (e) {}
}

function clearDraft() {
    try {
        localStorage.removeItem("lifegen_draft_post"), localStorage.removeItem("lifegen_draft_name")
    } catch (e) {}
}

function scheduleMidnightRefresh() {
    const now = new Date,
        nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    setTimeout(() => {
        renderVerse(!1), getDevice() && getDevice().token && loadVipAttendance(), scheduleMidnightRefresh()
    }, nextMidnight.getTime() - now.getTime())
}
qsa(".seg-btn").forEach(b => b.addEventListener("click", () => {
    qsa(".seg-btn").forEach(x => x.classList.remove("active")), b.classList.add("active"), curType = b.dataset.type, pfText.placeholder = PLACEHOLDERS[curType]
})), anonToggle.addEventListener("change", () => {form.classList.toggle("is-anon",anonToggle.checked);if(anonToggle.checked){pfName.value="";try{localStorage.removeItem("lifegen_draft_name");}catch{}}}), pfText.addEventListener("input", () => {
    $("pfCount").textContent = pfText.value.length + " / 1000", saveDraft()
}), pfName.addEventListener("input", saveDraft), form.addEventListener("submit", async e => {
    e.preventDefault();
    const text = pfText.value.trim(),
        name = pfName.value.trim();
    if (text.length < 3) return toast("Write a few words first — even a short prayer counts.", "pen-line"), void pfText.focus();
    name || (anonToggle.checked = !0, form.classList.add("is-anon"));
    const post = {
        id: makeToken(),
        type: curType,
        author: anonToggle.checked ? null : name || "Anonymous",
        isAnonymous: anonToggle.checked || !name,
        content: text,
        fresh: !0
    };
    try {
        await DB.addPost(post)
    } catch (err) {
        return void toast("Could not share your post: " + err.message, "alert-triangle")
    }
    form.reset(), anonToggle.checked = !1, form.classList.remove("is-anon"), $("pfCount").textContent = "0 / 1000", clearDraft(), await loadPosts(), filter = curType, qsa(".wf").forEach(x => x.classList.toggle("active", x.dataset.filter === filter)), renderWall();
    toast({
        prayer: "Your prayer request is on the wall. We’re praying.",
        testimony: "Your testimony is on the wall — thank you for sharing.",
        praise: "Your praise is on the wall. Let heaven rejoice."
    } [curType], "send")
}), qsa(".wf").forEach(b => b.addEventListener("click", () => {
    qsa(".wf").forEach(x => x.classList.remove("active")), b.classList.add("active"), filter = b.dataset.filter, renderWall()
})), $("prayerWall").addEventListener("click", async e => {
 const btn=e.target.closest('.amen-btn');if(!btn||btn.classList.contains('voted'))return;
 btn.disabled=true;try{const r=await Lifegen.request('/api/public/posts/'+encodeURIComponent(btn.dataset.amen)+'/pray',{});btn.querySelector('b').textContent=r.prayer_count;btn.querySelector('span').textContent='Amen';btn.classList.add('voted');voted.add(btn.dataset.amen);toast('Amen — we’re praying with you.','heart-handshake');}catch(err){toast(err.message,'alert-triangle');}finally{btn.disabled=false;}
}), setInterval(() => {
    qsa(".post").forEach(el => {
        const p = posts.find(x => (x.id || x.created_at + (x.author || "")) === el.dataset.id),
            t = el.querySelector(".post-time");
        p && t && (t.textContent = timeAgo(p.created_at))
    })
}, 6e4), qsa(".g-bell").forEach(b=>b.addEventListener("click",()=>{
 const a=document.createElement('a');a.href='/api/public/service.ics';a.download='lifegen-sunday-service.ics';a.click();b.innerHTML='<i data-lucide="calendar-check"></i>Calendar file downloaded';renderIcons();toast('Open the calendar file to add your Sunday reminder.','calendar');
})), document.addEventListener("visibilitychange", () => {
    "visible" === document.visibilityState && (getDevice() && getDevice().token && !$("vip-attendance-dashboard").hidden && loadVipAttendance(), loadPosts())
}), restoreDraft(), syncVipDashboardState(), loadPosts(), scheduleMidnightRefresh();
try {
    window.history.replaceState({
        view: "home"
    }, "", window.location.pathname+window.location.search+window.location.hash)
} catch (e) {}
window.addEventListener("error", e => console.error("[LIFEGEN] Unexpected error:", e.message));
Lifegen.initialize({sync:syncVipDashboardState,verse:renderVerse,toast,reducedMotion:REDUCED_MOTION});
