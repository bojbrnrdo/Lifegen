/**
 * "Find a person" — the phone-first way to answer "who belongs where?".
 *
 * The interactive network map is good on a big screen but heavy on a phone
 * (large bundle, pinch-zoom gestures, tiny tap targets). This module answers
 * the same question with one search box: type a name, get a flat list of
 * people with their Cell, their Cell Leader and their Network, one tap from
 * the Person profile.
 *
 * The query/formatting logic is pure so it can be unit-tested without a DOM.
 */

const lower = (value) => String(value ?? '').toLowerCase();
const nameOf = (person) => [person.first_name, person.last_name].filter(Boolean).join(' ') || person.full_name || '';

/**
 * Split a typed query into words, matching a person when every word appears
 * somewhere in their name, Person ID, Cell, Cell Leader or Network. This makes
 * "james maria" find Maria in James Cell, and a Person ID find its owner.
 */
export function matchesQuery(person, query) {
  const words = lower(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [
    nameOf(person), person.full_name, person.person_code,
    person.cell_name, person.cell_leader_name, person.network_name,
  ].map(lower).join(' ');
  return words.every((word) => haystack.includes(word));
}

export function filterPeople(people, query) {
  return (people || []).filter((person) => matchesQuery(person, query));
}

/** Sort so an exact-name / Person ID hit surfaces first, then alphabetical. */
export function rankPeople(people, query) {
  const q = lower(query).trim();
  const score = (person) => {
    const name = lower(nameOf(person));
    if (!q) return 2;
    if (name === q) return 0;
    if (person.person_code && lower(person.person_code) === q) return 0;
    if (name.startsWith(q)) return 1;
    return 2;
  };
  return [...(people || [])].sort((a, b) => score(a) - score(b) || nameOf(a).localeCompare(nameOf(b)));
}

/**
 * Where a person sits in the tree, in the words the directory uses:
 *   "Cell Leader · James Cell · Network Alpha"
 *   "Member · James Cell · Network Alpha"
 *   "Not in a Cell yet"                       (nobody in the query result set)
 */
export function relationshipLine(person) {
  const parts = [];
  if (person.role === 'cell_leader') parts.push('Cell Leader');
  else if (person.role === 'network_leader') parts.push('Network Leader');
  else if (person.role) parts.push('Member');
  if (person.cell_name) parts.push(person.cell_name);
  if (person.network_name) {
    // Network names often already read "Network Alpha"; never print it twice.
    parts.push(/^networks?\b/i.test(person.network_name) ? person.network_name : 'Network ' + person.network_name);
  }
  return parts.length ? parts.join(' · ') : 'Not in a Cell yet';
}

/**
 * Build the searchable rows from the two lists the Lifegroups page already
 * loads (no extra request): the Cells, and People linked to a Cell Leader.
 * A Cell Leader is the person the Cell is named after; their Cell's members
 * are added by the caller when a row is opened, so the directory stays light.
 */
export function buildPeopleIndex({ groups = [], networks = [] } = {}) {
  const networkName = new Map((networks || []).map((n) => [String(n.id), n.name || '']));
  const rows = [];
  for (const group of groups || []) {
    if (!group.leader_name && !group.leader_person_id) continue;
    rows.push({
      id: group.leader_person_id ?? null,
      first_name: group.leader_name || '',
      cell_id: group.id,
      cell_name: group.name || '',
      network_id: group.network_id ?? null,
      network_name: networkName.get(String(group.network_id)) || group.network || '',
      role: group.leads_network ? 'network_leader' : 'cell_leader',
      member_count: Number(group.member_count || 0),
    });
  }
  return rows;
}

/**
 * Rows for the "Needs a Cell" queue: everyone the tracker says has no Cell yet.
 * Kept as its own function so the queue and the search share one row shape.
 */
export function needsRows(people) {
  return (people || []).map((p) => ({ ...p, role: '', cell_name: '', network_name: '' }));
}
