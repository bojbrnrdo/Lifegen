// Synthetic Lifegroup demo data for the disposable local preview database.
//
// The public demo seed only creates People, services and attendance; it leaves
// the Lifegroup Tracker empty, so the Lifegroups pages have nothing to show and
// cannot be reviewed by hand or by an automated UI pass.
//
// This script fills that gap with clearly synthetic records through the same
// HTTP API the Admin portal uses (no direct SQL, no production credentials):
//
//   * 2 Networks (boys / girls) with registered leaders
//   * 2 Cell Leaders per Network, and the Network Leader's own Cell
//   * 6 Members per Cell, two of them already marked as Closed-cell members
//   * 2 spare people with no Cell, for "Find a Cell" / "Add member"
//
// Every person it creates is named "QA …", so the data is obviously synthetic
// and can be told apart from the plain demo People rows.
//
// Usage (with the local Express app running and the demo database seeded):
//
//   node preview-db/seed-lifegroup-demo.mjs
//   BASE_URL=http://localhost:3000 LIFEGEN_DEMO_PASSWORD='…' node preview-db/seed-lifegroup-demo.mjs
//
// It refuses to run against a non-local BASE_URL.
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const password = process.env.LIFEGEN_DEMO_PASSWORD || 'LifegenDemo2026!';
const username = process.env.LIFEGEN_DEMO_USERNAME || 'demo@lifegen.local';

const host = new URL(base).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error('Refusing to write demo Lifegroups: BASE_URL must be a local address.');
  process.exit(2);
}

let session = null;
let csrf = null;
const request = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
      ...(session ? { 'X-Lifegen-Preview-Session': session, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${method} ${path}: ${data.message || response.status}`);
    error.status = response.status;
    throw error;
  }
  if (data.csrf_token) csrf = data.csrf_token;
  if (data.preview_session_token) session = data.preview_session_token;
  return data;
};
const call = (method, ...args) => request('/api/tracker/' + method, { method: 'POST', body: { args } });

// Reuse the existing local demo password check so this stays a preview-only tool.
const existing = await request('/api/auth/status');
if (existing.hosted_preview || !existing.preview) {
  console.error('Refusing to run: this is not the local preview (LOCAL_DEMO) environment.');
  process.exit(2);
}
let login;
try {
  login = await request('/api/auth/login', { method: 'POST', body: { username, password } });
} catch (error) {
  console.error('Sign in failed: ' + error.message);
  console.error('Set LIFEGEN_DEMO_PASSWORD to the local preview Admin password.');
  process.exit(2);
}
if (!login.user?.permissions?.includes('lifegroups:manage')) {
  console.error('The signed-in account cannot manage Lifegroups.');
  process.exit(2);
}

const people = await call('people', { status: 'all', limit: 2000 });
if (!people.length) {
  console.error('No People records found. Run preview-db/seed-demo.mjs first.');
  process.exit(2);
}
const unassigned = await call('lifegroupNeeds', {});
if (!unassigned.length) {
  console.log('Everyone already has a Cell — nothing to seed.');
  process.exit(0);
}

const stamp = String(Date.now()).slice(-5);
const createPerson = async (first, last, sex) => {
  const person = await call('createPerson', {
    first_name: first, last_name: last, sex, status: 'member',
    privacy_consent: true, registration_source: 'staff', is_demo: true,
  });
  return Number(person.id);
};

// ---------------------------------------------------------------------------
console.log('Seeding Lifegroup demo data into ' + base);

const person = async (first, last, sex, status = 'member') => Number((await call('createPerson', {
  first_name: first, last_name: last, sex, status, privacy_consent: true, registration_source: 'staff',
})).id);

// Networks: the boys side and the girls side never mix.
const alphaLeader = await person('QA' + stamp, 'Alpha Leader', 'male', 'leader');
const betaLeader = await person('QA' + stamp, 'Beta Leader', 'female', 'leader');
const alpha = await call('createNetwork', { name: 'QA Network Alpha', gender: 'boys', leader_person_id: alphaLeader });
const beta = await call('createNetwork', { name: 'QA Network Beta', gender: 'girls', leader_person_id: betaLeader });
console.log(`  networks: ${alpha.name} / ${beta.name}`);

// Cell Leaders, each with their own Cell inside their Network.
const cells = [];
for (const [network, sex, names] of [
  [alpha, 'male', ['James', 'Paul']],
  [beta, 'female', ['Ruth', 'Esther']],
]) {
  for (const name of names) {
    const leader = await person('QA' + stamp, name + ' Leader', sex, 'leader');
    const group = await call('createLifegroup', {
      name: `QA ${name} Cell`, gender: sex === 'male' ? 'boys' : 'girls', network_id: network.id,
      network_manual: true, leader_person_id: leader, capacity: 12,
    });
    // The Network Leader's own Cell holds the Cell Leaders for reporting.
    const team = (await call('lifegroups', { status: 'active' }))
      .find((g) => g.network_id === network.id && g.leads_network);
    if (team) await call('assignLifegroup', team.id, leader, { role: 'leader', sex });
    cells.push({ group, network, sex, name });
  }
}
console.log(`  cells: ${cells.map((c) => c.group.name).join(', ')}`);

// Members: six per Cell so the six-member Closed-cell target can be reviewed,
// with two of them already marked as Closed-cell members.
let memberIndex = 0;
for (const cell of cells) {
  for (let i = 0; i < 6; i++) {
    memberIndex++;
    const id = await person('QA' + stamp, `Member ${String(memberIndex).padStart(2, '0')}`, cell.sex);
    await call('assignLifegroup', cell.group.id, id, {
      role: 'member',
      tier: i < 2 ? 'solid' : 'new',
      sex: cell.sex,
    });
  }
}
console.log(`  members assigned: ${memberIndex}`);

// Two spare people who are not in any Cell, for the "Find a Cell" and
// "Add member" workflows.
await person('QA' + stamp, 'Spare 01', 'male');
await person('QA' + stamp, 'Spare 02', 'female');
console.log('  spare people (no Cell): 2');

const groups = (await call('lifegroups', { status: 'all' })).filter((g) => g.name.startsWith('QA '));
console.log('Seeded Lifegroups:');
for (const group of groups) {
  console.log(`  ${group.name}: ${group.member_count} members (${group.solid_count} closed cell)`);
}
console.log('done');
