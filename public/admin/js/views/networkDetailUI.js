
/**
 * Compact Network detail layout. Reuses the existing, permission-gated action
 * handlers and group/member DOM instead of duplicating backend operations.
 */
export function simplifyNetworkDetail(main, { cells, cal, manage, leaderRegistered = true }) {
  main.classList.add('network-detail');
  const header = main.querySelector('.page-header');
  const stats = main.querySelector('.grid--stats');
  const tree = main.querySelector('.tree');
  const structure = tree?.closest('.card');
  const calendar = main.querySelector('#netCalendar');
  if (!header || !stats || !tree || !structure || !calendar) return;

  header.classList.add('network-detail__header');
  stats.classList.add('network-detail__stats');
  stats.removeAttribute('style');
  // Present only the three roles and an optional attendance metric.
  const [leadersCard, duplicateCellCard, memberCard, attendanceCard, extraCard] = Array.from(stats.children);
  if (leadersCard) {
    leadersCard.querySelector('.stat__label').textContent = 'Cell Leaders';
    leadersCard.querySelector('.stat__value').textContent = String(cells.length);
    leadersCard.querySelector('.small.muted')?.remove();
  }
  duplicateCellCard?.remove();
  if (memberCard) {
    memberCard.querySelector('.stat__label').textContent = 'Members';
    memberCard.querySelector('.small.muted')?.remove();
  }
  if (attendanceCard) {
    attendanceCard.querySelector('.stat__label').textContent = 'Meetings this week';
    const summary = cal?.summary;
    attendanceCard.querySelector('.stat__value').textContent = summary ? String(summary.met_this_week ?? 0) : '—';
    attendanceCard.querySelector('.small.muted')?.remove();
  }
  extraCard?.remove();
  // Reuse existing cell-team records: only the leader and member count are
  // visible until the person opens that group.
  structure.classList.add('network-detail__structure');
  const title = structure.querySelector('.card__header h2');
  if (title) title.textContent = 'Network structure';
  const footer = structure.querySelector('.card__footer');
  if (footer) footer.remove();
  const node = structure.querySelector('.tree__node--root');
  const rootInfo = node?.querySelector('div.small.muted');
  if (rootInfo) rootInfo.remove();
  const extraEdit = node?.querySelector('#editNet2')?.closest('.row.mt-1');
  if (extraEdit) extraEdit.remove();

  const leaderChips = node?.querySelector('#addCellLeader')?.closest('.row') || null;
  const workspace = document.createElement('div');
  workspace.className = 'network-detail__workspace';
  structure.before(workspace);
  workspace.append(structure);

  const aside = document.createElement('aside');
  aside.className = 'card network-detail__actions';
  aside.innerHTML = '<h2>Quick actions</h2>' +
    '<p class="network-detail__secondary">Manage this network in a few clicks.</p>' +
    '<div class="network-detail__action-list" id="netActionList"></div>' +
    '<div id="netMemberChooser" class="network-detail__chooser" hidden></div>' +
    '<div id="netExtras" class="network-detail__extras"></div>';
  workspace.append(aside);
  const actions = aside.querySelector('#netActionList');
  const quickButton = (id, title, symbol, disabled = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = 'network-detail__action';
    button.disabled = disabled;
    button.innerHTML = '<span class="network-detail__action-icon" aria-hidden="true">' + symbol + '</span>' +
      '<span>' + title + '</span><span class="network-detail__action-arrow" aria-hidden="true">›</span>';
    actions.append(button);
    return button;
  };
  if (manage) {
    if (!leaderRegistered) quickButton('netLinkLeader', 'Link / register leader', '↗');
    quickButton('netCreateGroup', 'Add Cell Leader', '+');
    quickButton('netQuickAddMember', 'Add member', '+', !cells.length);
    if (leaderChips) {
      // Older Network Leader team assignments remain accessible without adding
      // a second, confusing Cell Leader button to the primary workflow.
      const leaders = document.createElement('details');
      leaders.className = 'network-detail__extra';
      leaders.innerHTML = '<summary>Existing leader team</summary>';
      leaders.append(leaderChips);
      aside.querySelector('#netExtras').append(leaders);
    }
    const report = header.querySelector('#netReport');
    if (report) {
      report.textContent = 'Report meeting';
      report.classList.add('network-detail__action');
      actions.append(report);
    }
  }
  if (!manage) {
    aside.querySelector('h2').textContent = 'Explore';
    aside.querySelector('.network-detail__secondary').textContent = 'Select a Cell Leader to explore connected members.';
    const link = document.createElement('a');
    link.href = '#/lifegroups';
    link.className = 'network-detail__action';
    link.textContent = 'Browse Cell Leaders →';
    actions.append(link);
  }

  const history = document.createElement('details');
  history.className = 'card network-detail__history';
  history.id = 'netAttendanceHistory';
  history.innerHTML = '<summary><span><strong>Attendance & meeting history</strong>' +
    '<small>Last eight weeks · Open when you need the detailed report</small></span>' +
    '<span class="network-detail__expand-arrow" aria-hidden="true">⌄</span></summary>';
  workspace.after(history);
  calendar.classList.add('network-detail__calendar');
  history.append(calendar);

  if (!cells.length && manage) {
    const note = document.createElement('p');
    note.className = 'network-detail__secondary';
    note.textContent = 'Add a Cell Leader first to assign members.';
    actions.append(note);
  }
  return { history, chooser: aside.querySelector('#netMemberChooser') };
}
