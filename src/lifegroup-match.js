// Pure, deterministic matching logic; assignment itself is handled by the database transaction.
export function recommendEligibleCells(groups, prefs = {}) {
  const value = x => String(x ?? '').trim().toLowerCase();
  const wantedDay = value(prefs.day || prefs.preferred_day);
  const wantedArea = value(prefs.area || prefs.preferred_area);
  const wantedCategory = value(prefs.category || prefs.preferred_category);
  return groups.filter(g => g.is_active && !g.leads_network && g.leader_person_id &&
      Number(g.slots) > 0 && !g.is_demo).map(g => {
    const reasons = [];
    if (wantedDay && value(g.schedule_day) === wantedDay) reasons.push('day');
    if (wantedArea && value(g.area) === wantedArea) reasons.push('area');
    if (wantedCategory && value(g.category) === wantedCategory) reasons.push('category');
    return { ...g, score: reasons.length, reasons };
  }).sort((a,b)=>b.score-a.score || Number(b.slots)-Number(a.slots) || Number(a.id)-Number(b.id));
}
