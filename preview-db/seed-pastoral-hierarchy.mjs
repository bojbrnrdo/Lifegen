// Seeds the real LIFEGEN pastoral hierarchy through the app's own HTTP API.
//
//   Bishop Arsie Borromeo (boys)          Pastora Jane Borromeo (girls)
//     ├─ Roxxane   ─┐                       ├─ (girls' Network Leaders)
//     ├─ Zeff       │  6 Cell Leaders each  │
//     └─ Red       ─┘  and 6 people per Cell┘
//
// Every Network Leader is ALSO a member of their pastor's cell, which is the
// point of the structure: Bishop -> Network Leaders -> Cell Leaders -> Members.
//
// Usage (local app running, demo database seeded):
//   node preview-db/seed-pastoral-hierarchy.mjs
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
const CELL_LEADERS = {
  Roxxane: ['Kai', 'Miguel', 'Tobi'],
  Zeff: ['Marco', 'Jonas', 'Eli'],
  Red: ['Nico', 'Paolo', 'Isko'],
  Grace: ['Mika', 'Trisha', 'Joan'],
  Faith: ['Rica', 'Camille', 'Dana'],
  Hope: ['Nina', 'Bea', 'Liza'],
};
const PER_CELL = 6;

async function person(first, last, sex) {
  const created = await call('createPerson', {
    first_name: first, last_name: last, sex, status: 'member',
    privacy_consent: true, registration_source: 'staff', is_demo: true,
  });
  return created;
}

async function run() {
  await request('/api/auth/login', { method: 'POST', body: { username, password } });
  const existing = await call('networks', { status: 'active' });
  const existingNets = Array.isArray(existing) ? existing : existing.networks || [];
  if (existingNets.some((n) => /Roxxane|Bishop|Pastora/i.test(n.name + ' ' + (n.leader_name || '')))) {
    console.log('Pastoral hierarchy already present — nothing to do.');
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
      const netLeader = await person(name, 'Borromeo', group.gender === 'boys' ? 'male' : 'female');
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
      for (const cellName of CELL_LEADERS[name] || []) {
        const cellLeader = await person(cellName, 'Borromeo', group.gender === 'boys' ? 'male' : 'female');
        const cell = await call('createLifegroup', {
          name: `${cellName} Cell`, gender: group.gender, network_id: Number(net.id),
          network_manual: true, leader_person_id: Number(cellLeader.id), capacity: 12, is_demo: true,
        });
        // A Cell Leader is a member of their Network Leader's cell, too.
        await call('assignLifegroup', Number(leaderCell.lifegroup_id), Number(cellLeader.id), { role: 'member', tier: 'new' });
        await call('setDiscipleshipClassification', Number(cellLeader.id), 'cell_leader', 'Cell Leader');
        for (let i = 0; i < PER_CELL; i += 1) {
          const member = await person(`Friend${i + 1}`, cellName, group.gender === 'boys' ? 'male' : 'female');
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
