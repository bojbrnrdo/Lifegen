// Gives the demo placeholders realistic names, so the admin portal can be
// reviewed as if it held real records.
//
//   Friend3 Kai Borromeo   ->  Patricia Tolentino
//   Demo Person 07         ->  Jomar Villanueva
//   Test VIP               ->  Rafael Ocampo
//
// What it does NOT change: person_code, Cell membership, attendance history,
// status or is_demo. Each person keeps their records; only the name moves.
// Names are unique across the church and matched to the person's sex.
//
// Safe to re-run: it only touches people who still have a placeholder name.
//
// Usage (local app running):
//   node preview-db/rename-demo-people.mjs
// Synthetic data only; refuses any non-local BASE_URL.
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const username = process.env.LIFEGEN_DEMO_USERNAME || 'demo@lifegen.local';
const password = process.env.LIFEGEN_DEMO_PASSWORD || 'LifegenDemo2026!';

const host = new URL(base).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error('Refusing to rename: BASE_URL must be a local address.');
  process.exit(1);
}

// Filipino given names and surnames, so a Cell reads like a real small group.
const FEMALE = ['Maria Angelica','Andrea','Patricia','Juliana','Rhea','Kristine','Angeline','Maricris','Jasmine','Lorraine','Bernadette','Charmaine','Dianne','Elaine','Ferdilyn','Grace Ann','Hazel','Ivy','Joanna','Karen','Lovely','Maureen','Nadine','Olivia','Pauline','Queenie','Rochelle','Sheena','Tricia','Venus','Wendy','Yvonne','Abigail','Bianca','Carla','Danica','Erika Mae','Faith','Gillian','Hannah','Isabel','Janice','Katrina','Liza Marie','Michelle','Nikki','Odette','Precious','Rachelle','Samantha','Tanya','Ursula','Veronica','Wilma','Xyza','Yvette','Zara'];
const MALE = ['Mark Anthony','Joshua','Christian','Michael','Jose Mari','Paolo','Ramon','Angelo','Benedict','Carlo','Dominic','Emmanuel','Francis','Gabriel','Harvey','Ian','Jerome','Kevin','Lorenzo','Marvin','Nathaniel','Oliver','Patrick','Quincy','Rafael','Samuel','Timothy','Ulysses','Victor','Wesley','Xander','Yohann','Zachary','Adrian','Bryan','Cedric','Dennis','Edward','Ferdinand','Gerald','Hector','Ivan','Jomar','Kenneth','Leonardo','Melvin','Noel','Oscar','Philip','Rico','Salvador','Tristan','Vincent','Warren','Yasser','Zoren'];
const SURNAMES = ['Reyes','Santos','Cruz','Bautista','Ocampo','Garcia','Mendoza','Torres','Flores','Ramos','Villanueva','Aquino','Castillo','Dela Cruz','Navarro','Salazar','Mercado','Lim','Tan','Pascual','Alvarez','Domingo','Esguerra','Fajardo','Gonzales','Hernandez','Ibarra','Jimenez','Lopez','Magbanua','Nolasco','Ortega','Paredes','Quiambao','Rivera','Soriano','Tolentino','Uy','Valdez','Yap'];

// Deterministic, so two runs on the same data produce the same names.
let seed = 20261116;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

let session = null, csrf = null;
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(new URL(path, base), {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
      ...(session ? { 'X-Lifegen-Preview-Session': session, 'X-CSRF-Token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.message || text.slice(0, 200)}`);
  if (data.csrf_token) csrf = data.csrf_token;
  if (data.preview_session_token) session = data.preview_session_token;
  return data;
}
const call = (method, ...args) => request('/api/tracker/' + method, { method: 'POST', body: { args } });

/**
 * A placeholder is a seeded stand-in rather than somebody's name. The seeder
 * writes three shapes, and all three must be recognised — checking only one
 * leaves the rest behind:
 *   first "Friend1",  last "Kai"          (Cell members)
 *   first "Demo",     last "Person 01"    (seeded demo crowd)
 *   first "Test",     last "VIP"          (QA record)
 */
const isPlaceholder = (p) => {
  const first = String(p.first_name || '').trim();
  const last = String(p.last_name || '').trim();
  const full = `${first} ${last}`.trim();
  return /^Friend\s*\d+$/i.test(first)
    || /^(Demo|Test)\b/i.test(first)
    || /^Person\s*\d+$/i.test(last)
    || /^VIP$/i.test(last)
    || /\b(placeholder|not a real person)\b/i.test(full);
};

async function run() {
  await request('/api/auth/login', { method: 'POST', body: { username, password } });
  const fetched = await call('people', { limit: 2000, status: 'all' });
  const people = Array.isArray(fetched) ? fetched : fetched.people || [];
  const targets = people.filter(isPlaceholder);
  if (!targets.length) {
    console.log('No placeholder names left — nothing to rename.');
    return;
  }

  // Names already in use must not be handed out again.
  const used = new Set(people.filter((p) => !isPlaceholder(p)).map((p) => `${p.first_name} ${p.last_name}`));
  const nameFor = (sex) => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const first = pick(sex === 'female' ? FEMALE : MALE);
      const last = pick(SURNAMES);
      if (!used.has(`${first} ${last}`)) {
        used.add(`${first} ${last}`);
        return { first, last };
      }
    }
    throw new Error('Ran out of unused names.');
  };

  console.log(`Renaming ${targets.length} placeholder record(s)…`);
  let done = 0;
  for (const person of targets) {
    const { first, last } = nameFor(person.sex || 'male');
    // Send only the name fields: everything else on the record stays as it is.
    await call('updatePerson', Number(person.id), { first_name: first, last_name: last });
    done += 1;
    if (done <= 6 || done === targets.length) {
      console.log(`  ${String(person.person_code || person.id).padEnd(14)} ${`${person.first_name} ${person.last_name}`.padEnd(24)} → ${first} ${last}`);
    } else if (done === 7) {
      console.log('  …');
    }
  }
  console.log(`\nDone: ${done} renamed. Codes, Cells, attendance and status untouched.`);
  await request('/api/auth/logout', { method: 'POST', body: {} });
}

run().catch((error) => { console.error('rename failed:', error.message); process.exitCode = 1; });
