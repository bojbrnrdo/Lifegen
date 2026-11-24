// Seeds the real LIFEGEN pastoral hierarchy through the app's own HTTP API.
//
//   Bishop Arsie Borromeo (boys)          Pastora Jane Borromeo (girls)
//     ├─ Roxxane   ─┐                       ├─ (girls' Network Leaders)
//     ├─ Zeff       │  6 Cell Leaders each  │
//     └─ Red       ─┘  6 people per Cell    │
//                       (the app allows 12)
//
// Every Network Leader is ALSO a member of their pastor's cell, which is the
// point of the structure: Bishop -> Network Leaders -> Cell Leaders -> Members.
// Every Network is under a pastor: the seed creates no Network that sits on its
// own, so the Lifegroups directory never shows a "not under a pastor" card.
//
// Safe to re-run: it tops up any Network Leader who has fewer than six Cells
// and never duplicates an existing Cell.
//
// Usage (local app running, demo database seeded):
//   node preview-db/seed-pastoral-hierarchy.mjs
//   node preview-db/seed-pastoral-hierarchy.mjs --new-leader-names
//     Older seeds created every Cell Leader as "<FirstName> Borromeo", so all
//     of them shared the pastor's surname. The flag gives each Cell Leader their
//     own surname from the same pool. It only touches people who still carry the
//     pastor's surname and are not pastors themselves; the Cell name keeps its
//     leader's first name, so nothing in the tree moves.
// Synthetic data only; refuses any non-local BASE_URL.
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const username = process.env.LIFEGEN_DEMO_USERNAME || 'demo@lifegen.local';
const password = process.env.LIFEGEN_DEMO_PASSWORD || 'LifegenDemo2026!';

const host = new URL(base).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error('Refusing to seed: BASE_URL must be a local address.');
  process.exit(1);
}

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

const STAFF = [
  { gender: 'boys', pastor: ['Arsie', 'Borromeo'], role: 'bishop', leaders: ['Roxxane', 'Zeff', 'Red'] },
  { gender: 'girls', pastor: ['Jane', 'Borromeo'], role: 'pastora', leaders: ['Grace', 'Faith', 'Hope'] },
];
// Six Cell Leaders per Network (the app allows up to 12).
const CELL_LEADERS = {
  Roxxane: ['Kai', 'Miguel', 'Tobi', 'Arvin', 'Dennis', 'Ruel'],
  Zeff: ['Marco', 'Jonas', 'Eli', 'Ferdie', 'Gio', 'Hector'],
  Red: ['Nico', 'Paolo', 'Isko', 'Jomar', 'Kiko', 'Lando'],
  Grace: ['Mika', 'Trisha', 'Joan', 'Aileen', 'Cherry', 'Divine'],
  Faith: ['Rica', 'Camille', 'Dana', 'Erika', 'Faye', 'Geline'],
  Hope: ['Nina', 'Bea', 'Liza', 'Maricel', 'Nadine', 'Odette'],
};
const PER_CELL = 6;
// The pastors' own surname. Cell Leaders must NOT all share it: a real church
// has a variety of surnames, and 44 identical ones make the demo read as fake.
const PASTOR_SURNAME = 'Borromeo';
const NEW_LEADER_NAMES = process.argv.includes('--new-leader-names');

async function person(first, last, sex) {
  const created = await call('createPerson', {
    first_name: first, last_name: last, sex, status: 'member',
    privacy_consent: true, registration_source: 'staff', is_demo: true,
  });
  return created;
}

/**
 * Give every Network Leader six Cell Leaders. Only missing Cells are created, so
 * this is safe to run repeatedly and never renames or duplicates what is there.
 */
async function topUpToSix(existingNets) {
  let added = 0;
  const netsNowRes = await call('networks', { status: 'active' });
  const netsNow = Array.isArray(netsNowRes) ? netsNowRes : netsNowRes.networks || [];
  const allCells = await call('lifegroups', { status: 'all' });
  for (const group of STAFF) {
    const pastorNet = existingNets.find((n) => n.name === `${group.pastor[0]} ${group.pastor[1]}`);
    if (!pastorNet) continue;
    const sex = group.gender === 'boys' ? 'male' : 'female';
    for (const leader of netsNow.filter((n) => String(n.parent_network_id) === String(pastorNet.id))) {
      const firstName = String(leader.leader_name || '').split(' ')[0] || String(leader.name).replace(/ Network$/, '');
      const wanted = CELL_LEADERS[firstName];
      if (!wanted) continue;
      const have = allCells.filter((g) => String(g.network_id) === String(leader.id) && !g.leads_network);
      const haveNames = new Set(have.map((g) => String(g.name).replace(/ Cell$/, '')));
      const missing = wanted.filter((name) => !haveNames.has(name));
      if (!missing.length) continue;
      const leaderCell = await call('ensureNetworkLeaderGroup', Number(leader.id));
      for (const cellName of missing) {
        const cellLeader = await person(cellName, nextName(sex).lastName, sex);
        const cell = await call('createLifegroup', {
          name: `${cellName} Cell`, gender: group.gender, network_id: Number(leader.id),
          network_manual: true, leader_person_id: Number(cellLeader.id), capacity: 12, is_demo: true,
        });
        // A Cell Leader is a member of their Network Leader's cell, too.
        await call('assignLifegroup', Number(leaderCell.lifegroup_id), Number(cellLeader.id), { role: 'member', tier: 'new' });
        await call('setDiscipleshipClassification', Number(cellLeader.id), 'cell_leader', 'Cell Leader');
        for (let i = 0; i < PER_CELL; i += 1) {
          // Real-looking names, so the demo reads like a church rather than
          // a list of stand-ins. Each full name is handed out only once.
          const { firstName, lastName } = nextName(sex);
          const member = await person(firstName, lastName, sex);
          await call('assignLifegroup', Number(cell.id), Number(member.id), { role: 'member', tier: i < 2 ? 'solid' : 'new' });
        }
        added += 1;
        console.log(`    added: ${cell.name} under ${firstName}`);
      }
    }
  }
  return added;
}

// Real-looking names for the people in the Cells. Deterministic, and each full
// name is handed out once, so no two people share a name.
const FIRST_FEMALE = ['Maria Angelica','Andrea','Patricia','Juliana','Rhea','Kristine','Angeline','Maricris','Jasmine','Lorraine','Bernadette','Charmaine','Dianne','Elaine','Ferdilyn','Grace Ann','Hazel','Ivy','Joanna','Karen','Lovely','Maureen','Nadine','Olivia','Pauline','Queenie','Rochelle','Sheena','Tricia','Venus','Wendy','Yvonne','Abigail','Bianca','Carla','Danica','Erika Mae','Faith','Gillian','Hannah','Isabel','Janice','Katrina','Liza Marie','Michelle','Nikki','Odette','Precious','Rachelle','Samantha','Tanya','Ursula','Veronica','Wilma','Xyza','Yvette','Zara'];
const FIRST_MALE = ['Mark Anthony','Joshua','Christian','Michael','Jose Mari','Paolo','Ramon','Angelo','Benedict','Carlo','Dominic','Emmanuel','Francis','Gabriel','Harvey','Ian','Jerome','Kevin','Lorenzo','Marvin','Nathaniel','Oliver','Patrick','Quincy','Rafael','Samuel','Timothy','Ulysses','Victor','Wesley','Xander','Yohann','Zachary','Adrian','Bryan','Cedric','Dennis','Edward','Ferdinand','Gerald','Hector','Ivan','Jomar','Kenneth','Leonardo','Melvin','Noel','Oscar','Philip','Rico','Salvador','Tristan','Vincent','Warren','Yasser','Zoren'];
const SURNAMES = ['Reyes','Santos','Cruz','Bautista','Ocampo','Garcia','Mendoza','Torres','Flores','Ramos','Villanueva','Aquino','Castillo','Dela Cruz','Navarro','Salazar','Mercado','Pascual','Alvarez','Domingo','Esguerra','Fajardo','Gonzales','Hernandez','Ibarra','Jimenez','Lopez','Magbanua','Nolasco','Ortega','Paredes','Quiambao','Rivera','Soriano','Tolentino','Valdez'];
const usedNames = new Set();
let nameSeed = 20261116;
const nameRand = () => { nameSeed = (nameSeed * 1103515245 + 12345) & 0x7fffffff; return nameSeed / 0x7fffffff; };
function nextName(sex) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const pool = sex === 'female' ? FIRST_FEMALE : FIRST_MALE;
    const firstName = pool[Math.floor(nameRand() * pool.length)];
    const lastName = SURNAMES[Math.floor(nameRand() * SURNAMES.length)];
    const full = `${firstName} ${lastName}`;
    if (!usedNames.has(full)) { usedNames.add(full); return { firstName, lastName }; }
  }
  throw new Error('Ran out of unused names.');
}

/**
 * Older seeds created every Cell Leader (and Network Leader) with the pastors'
 * surname. Give each of them a surname of their own. Only people who still carry
 * that surname AND lead a Cell or Network are touched; the two pastors keep it,
 * and nobody's Cell, code, status or membership changes. Idempotent: a leader
 * already renamed no longer matches, so a second run reports nothing to do.
 */
async function giveLeadersTheirOwnSurnames(existingNets) {
  const allCells = await call('lifegroups', { status: 'all' });
  const leaderIds = new Set();
  for (const g of allCells) if (g.is_active && g.leader_person_id) leaderIds.add(Number(g.leader_person_id));
  for (const n of existingNets) if (n.leader_person_id) leaderIds.add(Number(n.leader_person_id));

  const fetched = await call('people', { limit: 5000, status: 'all' });
  const people = Array.isArray(fetched) ? fetched : fetched.people || [];
  const pastors = new Set(STAFF.map((g) => `${g.pastor[0]} ${g.pastor[1]}`));
  const taken = new Set(people.map((p) => `${p.first_name} ${p.last_name}`));
  const targets = people.filter((p) => leaderIds.has(Number(p.id))
    && String(p.last_name || '') === PASTOR_SURNAME
    && !pastors.has(`${p.first_name} ${p.last_name}`));

  if (!targets.length) {
    console.log('\nLeader names: every Cell Leader and Network Leader already has their own surname.');
    return 0;
  }
  let renamed = 0;
  for (const leader of targets) {
    let surname = null;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const candidate = SURNAMES[Math.floor(nameRand() * SURNAMES.length)];
      if (candidate !== PASTOR_SURNAME && !taken.has(`${leader.first_name} ${candidate}`)) { surname = candidate; break; }
    }
    if (!surname) continue;
    taken.add(`${leader.first_name} ${surname}`);
    // Only the surname is sent, so code, sex, status and Cell stay as they are.
    await call('updatePerson', Number(leader.id), { last_name: surname });
    renamed += 1;
  }
  console.log(`\nLeader names: gave ${renamed} Cell/Network Leader(s) their own surname (only the ${pastors.size} pastors keep ${PASTOR_SURNAME}).`);
  return renamed;
}

async function run() {
  await request('/api/auth/login', { method: 'POST', body: { username, password } });
  // Two mutually exclusive paths, so re-running can never build twice:
  //   fresh  — nothing of this hierarchy exists yet, so build it all
  //   topUp  — it exists but a Network Leader has fewer than six Cells
  const EXISTING = await call('networks', { status: 'active' });
  const existingNets = Array.isArray(EXISTING) ? EXISTING : EXISTING.networks || [];
  const alreadyThere = existingNets.some((n) => /Roxxane|Bishop|Pastora/i.test(n.name + ' ' + (n.leader_name || '')));
  if (alreadyThere) {
    const added = await topUpToSix(existingNets);
    console.log(added
      ? `\nAdded ${added} Cell(s) — every Network Leader now has six Cell Leaders.`
      : 'Pastoral hierarchy already complete: six Cell Leaders per Network — nothing to do.');
    if (NEW_LEADER_NAMES) await giveLeadersTheirOwnSurnames(existingNets);
    await request('/api/auth/logout', { method: 'POST', body: {} });
    return;
  }

  for (const group of STAFF) {
    const [first, last] = group.pastor;
    const pastor = await person(first, last, group.gender === 'boys' ? 'male' : 'female');
    const pastorNet = await call('createNetwork', {
      name: `${first} ${last}`, gender: group.gender,
      leader_person_id: Number(pastor.id), is_active: true, is_demo: true,
    });
    const pastorCell = await call('ensureNetworkLeaderGroup', pastorNet.id);
    await call('setDiscipleshipClassification', Number(pastor.id), group.role, 'Pastor Network');
    console.log(`${group.role}: ${first} ${last} (network ${pastorNet.id})`);

    for (const name of group.leaders) {
      const netLeader = await person(name, nextName(group.gender === 'boys' ? 'male' : 'female').lastName, group.gender === 'boys' ? 'male' : 'female');
      const net = await call('createNetwork', {
        name: `${name} Network`, gender: group.gender,
        leader_person_id: Number(netLeader.id), parent_network_id: Number(pastorNet.id),
        is_active: true, is_demo: true,
      });
      // The Network Leader is a member of their pastor's cell — that is the link.
      await call('assignLifegroup', Number(pastorCell.lifegroup_id), Number(netLeader.id), { role: 'member', tier: 'solid' });
      await call('setDiscipleshipClassification', Number(netLeader.id), 'network_leader', 'Network Leader');
      console.log(`  network leader: ${name} → ${net.name} (${net.id})`);

      const leaderCell = await call('ensureNetworkLeaderGroup', Number(net.id));
      const sex = group.gender === 'boys' ? 'male' : 'female';
      for (const cellName of CELL_LEADERS[name] || []) {
        const cellLeader = await person(cellName, nextName(sex).lastName, sex);
        const cell = await call('createLifegroup', {
          name: `${cellName} Cell`, gender: group.gender, network_id: Number(net.id),
          network_manual: true, leader_person_id: Number(cellLeader.id), capacity: 12, is_demo: true,
        });
        // A Cell Leader is a member of their Network Leader's cell, too.
        await call('assignLifegroup', Number(leaderCell.lifegroup_id), Number(cellLeader.id), { role: 'member', tier: 'new' });
        await call('setDiscipleshipClassification', Number(cellLeader.id), 'cell_leader', 'Cell Leader');
        for (let i = 0; i < PER_CELL; i += 1) {
          // Real-looking names, so the demo reads like a church rather than
          // a list of stand-ins. Each full name is handed out only once.
          const { firstName, lastName } = nextName(sex);
          const member = await person(firstName, lastName, sex);
          await call('assignLifegroup', Number(cell.id), Number(member.id), {
            role: 'member', tier: i < 2 ? 'solid' : 'new',
          });
        }
        console.log(`    cell: ${cell.name} — ${PER_CELL} people`);
      }
    }
  }

  const nets = await call('networks', { status: 'active' });
  const list = Array.isArray(nets) ? nets : nets.networks || [];
  console.log('\nNetworks now:');
  for (const n of list) {
    console.log(`  ${n.parent_network_id ? '  └' : '•'} ${n.name} — ${n.leader_name} · ${n.child_count ? n.child_count + ' networks' : n.group_count + ' cells'}, ${n.people_count} people`);
  }
  await request('/api/auth/logout', { method: 'POST', body: {} });
}

run().catch((error) => { console.error('seed failed:', error.message); process.exitCode = 1; });
