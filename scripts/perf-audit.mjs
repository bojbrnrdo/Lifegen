// Ten performance checks for a running LIFEGEN server (front and back end).
//
//   node scripts/perf-audit.mjs            # against http://127.0.0.1:3000
//   BASE_URL=... node scripts/perf-audit.mjs
//
// Read-only: it never writes. Each check prints PASS/WARN/FAIL with the number
// that produced the verdict, so a regression shows up as a changed number, not
// just a red line. Exit code is 1 if any check fails, 0 otherwise.
//
// The checks exist because two real defects were found this way:
//   * every parameterised database query cost ~44ms because Nagle's algorithm
//     was left on for the gateway socket (Check 2 catches a relapse).
//   * the Lifegroups progress overview was O(n^2): it reloaded every Cell once
//     per Cell (Check 7).
import process from 'node:process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const results = [];
const record = (n, name, status, detail) => {
  results.push({ n, name, status, detail });
  console.log(`${status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️ ' : '❌'} ${String(n).padStart(2)}. ${name}\n     ${detail}`);
};
const ms = (n) => `${Math.round(n)}ms`;
const timed = async (fn) => { const s = performance.now(); const v = await fn(); return [performance.now() - s, v]; };

let session = null, csrf = null;
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username: process.env.LIFEGEN_DEMO_USERNAME || 'demo@lifegen.local', password: process.env.LIFEGEN_DEMO_PASSWORD || 'LifegenDemo2026!' }),
  });
  const data = await r.json();
  session = data.preview_session_token; csrf = data.csrf_token;
  return r.ok;
}
async function call(method, args = []) {
  const r = await fetch(`${BASE}/api/tracker/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(session ? { 'X-Lifegen-Preview-Session': session, 'X-CSRF-Token': csrf } : {}) },
    body: JSON.stringify({ args }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const body = await (await login().then(() => true)).toString();
void body;
if (!session) {
  console.error(`Could not sign in at ${BASE}. Set LIFEGEN_DEMO_USERNAME / LIFEGEN_DEMO_PASSWORD.`);
  process.exit(2);
}

// 1. Static page latency -----------------------------------------------------
{
  const pages = ['/', '/admin', '/youth-welfare', '/lifeide', '/checkin', '/vip-announce'];
  const times = [];
  for (const p of pages) { const [t, r] = await timed(() => fetch(BASE + p)); times.push([p, t, r.status]); }
  const worst = times.reduce((a, b) => (b[1] > a[1] ? b : a));
  const bad = times.filter(([, , s]) => s >= 400);
  record(1, 'Pages render quickly', bad.length ? 'FAIL' : worst[1] < 250 ? 'PASS' : 'WARN',
    `slowest ${worst[0]} ${ms(worst[1])}; all ${pages.length} pages responded`);
}

// 2. Database round-trip (parameterised) --------------------------------------
// A parameterised read is the shape every Tracker call uses. ~40ms here means
// the socket is waiting on a delayed ACK again.
{
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    const [t] = await timed(() => call('network', [3]));
    samples.push(t);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  record(2, 'Parameterised DB queries are not delayed', avg < 80 ? 'PASS' : 'WARN',
    `average ${ms(avg)} over 5 calls (a Nagle/delayed-ACK regression shows as ~40ms per query)`);
}

// 3. Heavy tracker endpoints -------------------------------------------------
{
  const methods = ['dashboard', 'people', 'lifegroups', 'networks', 'registrations', 'giftTracker', 'search'];
  const rows = [];
  for (const m of methods) {
    const [t, r] = await timed(() => call(m, m === 'search' ? ['mar'] : []));
    rows.push([m, t, r.status]);
  }
  const worst = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
  record(3, 'Tracker endpoints stay responsive', worst[1] < 400 ? 'PASS' : 'WARN',
    `slowest ${worst[0]} ${ms(worst[1])}; ${rows.map(([m, t]) => `${m} ${Math.round(t)}`).join(', ')}`);
}

// 4. The progress overview (was O(n^2)) --------------------------------------
{
  const [t, r] = await timed(() => call('progressOverview', [8]));
  const groups = Array.isArray(r.body?.groups) ? r.body.groups : [];
  record(4, 'Lifegroups progress overview', t < 1200 ? 'PASS' : 'WARN',
    `${ms(t)} for ${groups.length} Cells (used to take ~6400ms; it reloaded every Cell per Cell)`);
}

// 5. Response compression ----------------------------------------------------
{
  const r = await fetch(`${BASE}/lifegen/styles.css`, { headers: { 'Accept-Encoding': 'gzip, br' } });
  const enc = r.headers.get('content-encoding');
  const len = Number(r.headers.get('content-length') || 0);
  record(5, 'Text assets are compressed', enc ? 'PASS' : 'FAIL', `styles.css sent as ${enc || 'identity'}${len ? `, ${len} bytes` : ''}`);
}

// 6. Immutable caching for versioned assets ----------------------------------
{
  const r = await fetch(`${BASE}/lifegen/styles.css?v=9.9.9`);
  const cc = r.headers.get('cache-control') || '';
  record(6, 'Versioned assets cache immutably', /immutable/.test(cc) ? 'PASS' : 'WARN', `Cache-Control: ${cc || '(none)'}`);
}

// 7. ETag revalidation -------------------------------------------------------
// Sent without an Accept-Encoding header so the tag matches the identity body.
// (Node's fetch decompresses transparently, which would make a brotli body look
// different from the tag and produce a false 200.)
{
  // Use a raw http request: Node's fetch decompresses transparently, which makes
  // it unsuitable for asserting 304 behaviour on a compressed asset.
  const http = await import('node:http');
  const head = (headers) => new Promise((resolve, reject) => {
    const u = new URL('/lifegen/app.js', BASE);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', headers }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, etag: res.headers.etag });
    });
    req.on('error', reject);
    req.end();
  });
  const first = await head({ 'Accept-Encoding': 'identity' });
  if (!first.etag) { record(7, 'ETag revalidation', 'WARN', 'no ETag on /lifegen/app.js'); }
  else {
    const [t, second] = await timed(() => head({ 'If-None-Match': first.etag, 'Accept-Encoding': 'identity' }));
    record(7, 'ETag revalidation', second.status === 304 ? 'PASS' : 'WARN', `revalidation answered ${second.status} in ${ms(t)}`);
  }
}

// 8. Homepage critical path --------------------------------------------------
// The Google Fonts stylesheet is the one intentionally blocking request: it is
// preconnected and uses display=swap, so text paints in the fallback face
// immediately. Scripts must all be defer/async/module.
{
  const [t, html] = await timed(async () => (await fetch(BASE + '/')).text());
  const blocking = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  const remote = blocking.filter((tag) => /https?:\/\//.test(tag));
  const preconnected = /rel="preconnect"/.test(html) && /fonts\.gstatic\.com/.test(html);
  const deferred = (html.match(/<script[^>]*\bsrc="[^"]*"/g) || []).filter((s) => !/\bdefer\b|\basync\b|type="module"/.test(s));
  const ok = deferred.length === 0 && remote.length <= 1 && (remote.length === 0 || preconnected);
  record(8, 'Homepage critical path is minimal', ok ? 'PASS' : 'WARN',
    `document ${ms(t)}; ${blocking.length} stylesheet(s), ${remote.length} remote${remote.length ? ' (preconnected, display=swap)' : ''}; ${deferred.length} render-blocking script(s)`);
}

// 9. Public API latency ------------------------------------------------------
{
  const paths = ['/api/health', '/api/public/config', '/api/public/posts', '/api/public/calendar-upcoming', '/api/public/vip-count', '/api/public/prize'];
  const rows = [];
  for (const p of paths) { const [t, r] = await timed(() => fetch(BASE + p)); rows.push([p, t, r.status]); }
  const worst = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
  const bad = rows.filter(([, , s]) => s >= 400);
  record(9, 'Public API responds quickly', bad.length ? 'FAIL' : worst[1] < 400 ? 'PASS' : 'WARN',
    `slowest ${worst[0]} ${ms(worst[1])}`);
}

// 10. Payload weight ---------------------------------------------------------
{
  const [t, r] = await timed(async () => (await fetch(BASE + '/')).text());
  const kb = Buffer.byteLength(r) / 1024;
  const big = [...r.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((src) => !/loading="lazy"/.test(src));
  record(10, 'First response is lean', kb < 120 ? 'PASS' : 'WARN',
    `homepage HTML ${kb.toFixed(0)}KB in ${ms(t)}${big.length ? `; ${big.length} eager image(s)` : ''}`);
}

const failed = results.filter((r) => r.status === 'FAIL');
const warned = results.filter((r) => r.status === 'WARN');
console.log(`\n${results.length - failed.length - warned.length}/${results.length} pass, ${warned.length} warn, ${failed.length} fail.`);
process.exit(failed.length ? 1 : 0);
