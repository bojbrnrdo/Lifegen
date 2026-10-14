
/**
 * Compact Network detail layout. Reuses the existing, permission-gated action
 * handlers and group/member DOM instead of duplicating backend operations.
 */
export function simplifyNetworkDetail(main, { cells, cal, manage }) {
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
  const statCards = Array.from(stats.children);
  if (statCards[2]) statCards[2].querySelector('.stat__label').textContent = 'Members';
  if (statCards[3]) {
    const label = statCards[3].querySelector('.stat__label');
    const value = statCards[3].querySelector('.stat__value');
    label.textContent = 'Meetings this week';
    const summary = cal?.summary;
    value.textContent = summary ? String(summary.met_this_week ?? 0) + ' / ' + String(summary.groups ?? 0) : '—';
    const desc = statCards[3].querySelector('.small.muted');
    if (desc) desc.remove();
  }
  if (statCards[4]) statCards[4].remove();

  // Reuse each existing Lifegroup detail: only leader and member count are
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
  const notes = structure.querySelector('.tree__root > .small.muted');
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
    quickButton('netCreateGroup', 'Add Lifegroup', '+');
    quickButton('netQuickAddMember', 'Add member', '+', !cells.length);
    if (leaderChips) {
      const leaderButton = leaderChips.querySelector('#addCellLeader');
      if (leaderButton) {
        leaderButton.classList.add('network-detail__action');
        leaderButton.textContent = '＋ Add Cell Leader';
        actions.append(leaderButton);
      }
      const leaders = document.createElement('details');
      leaders.className = 'network-detail__extra';
      leaders.innerHTML = '<summary>Cell leader assignments</summary>';
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
    aside.querySelector('.network-detail__secondary').textContent = 'Select a Lifegroup to explore its members and activity.';
    const link = document.createElement('a');
    link.href = '#/lifegroups';
    link.className = 'network-detail__action';
    link.textContent = 'Browse Lifegroups →';
    actions.append(link);
  }
  if (notes?.textContent?.trim()) {
    const details = document.createElement('details');
    details.className = 'network-detail__extra';
    details.innerHTML = '<summary>Network notes</summary>';
    details.append(notes);
    aside.querySelector('#netExtras').append(details);
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
    note.textContent = 'Create a Lifegroup first to add members.';
    actions.append(note);
  }
  return { history, chooser: aside.querySelector('#netMemberChooser') };
}
