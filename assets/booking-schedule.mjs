export const TEAM = ['Jonathan', 'Juan', 'Missy'];
export const TYPES = {
  discovery: { label: 'Discovery', capacity: 1, duration: 30 },
  virtual: { label: 'Virtual Selection', capacity: 2, duration: 150 },
  final: { label: 'Final', capacity: 2, duration: 150 }
};
export const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const timeValue = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
export const weekday = date => new Date(`${date}T12:00:00`).getDay();
export function ruleMatchesDate(rule, date) {
  if (rule.recurrence === 'once') return Boolean(rule.startDate) && rule.startDate === date;
  return Number(rule.weekday) === weekday(date) && (!rule.startDate || date >= rule.startDate) && (!rule.endDate || date <= rule.endDate);
}
export function baseSlots(type, date) {
  const day = weekday(date);
  if (!Number.isInteger(day) || day < 2 || !TYPES[type]) return [];
  if (type === 'discovery') return day === 6 ? [] : ['11:00', '12:30', '14:00', '15:30', '17:00'];
  if (type === 'virtual' && day === 6) return [];
  return day === 6 ? ['09:00', '14:00'] : ['10:00', '15:00'];
}
export const interval = item => ({ start: minutes(item.time), end: minutes(item.time) + TYPES[item.type].duration });
const ruleInterval = rule => ({ start: rule.startTime ? minutes(rule.startTime) : 0, end: rule.endTime ? minutes(rule.endTime) : 1440 });
export const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const appliesToPerson = (rule, person) => !rule.person || rule.person === person;
function eligible(person, item, rules) {
  if (item.assignedTo && item.assignedTo !== person) return false;
  return !rules.some(rule => appliesToPerson(rule, person) && overlaps(interval(item), ruleInterval(rule)) &&
    (rule.kind === 'off' || rule.kind === 'meeting' || (rule.kind === 'virtual' && item.type === 'final')));
}

// A person stays with an appointment for its full duration. Discoveries may be
// handled by the front-desk person; long appointments may not consume that person.
export function assignAppointments(items, rules, date) {
  const activeRules = rules.filter(rule => ruleMatchesDate(rule, date));
  const choices = items.map(item => TEAM.filter(person => eligible(person, item, activeRules)));
  const order = items.map((_, i) => i).sort((a, b) => choices[a].length - choices[b].length || minutes(items[a].time) - minutes(items[b].time));
  const assigned = Array(items.length).fill(null);
  const boundaries = [...new Set(items.flatMap(item => Object.values(interval(item))).concat(activeRules.flatMap(rule => Object.values(ruleInterval(rule)))))].sort((a, b) => a - b);
  function frontDeskCovered() {
    return boundaries.every(time => {
      const longAppointments = items.filter((item, i) => assigned[i] && item.type !== 'discovery' && interval(item).start <= time && interval(item).end > time);
      if (!longAppointments.length) return true;
      return TEAM.some(person => {
        const busy = items.some((item, i) => assigned[i] === person && item.type !== 'discovery' && interval(item).start <= time && interval(item).end > time);
        const unavailable = activeRules.some(rule => appliesToPerson(rule, person) && ['off', 'meeting', 'virtual'].includes(rule.kind) && ruleInterval(rule).start <= time && ruleInterval(rule).end > time);
        return !busy && !unavailable;
      });
    });
  }
  function place(depth) {
    if (depth === order.length) return true;
    const i = order[depth];
    for (const person of choices[i]) {
      if (items.some((item, j) => assigned[j] === person && overlaps(interval(items[i]), interval(item)))) continue;
      assigned[i] = person;
      if (frontDeskCovered() && place(depth + 1)) return true;
      assigned[i] = null;
    }
    return false;
  }
  return place(0) ? assigned : null;
}

export function availability(type, date, requests, rules) {
  if (!TYPES[type]) return [];
  const active = requests.filter(item => item.date === date && item.status !== 'declined' && TYPES[item.type]);
  return baseSlots(type, date).flatMap(time => {
    const candidate = { type, time, date };
    // Only the connected overlap group can affect this slot. An old conflict
    // elsewhere in the day must not prevent an otherwise valid booking.
    let relevant = [];
    let span = interval(candidate);
    while (true) {
      const next = active.filter(item => overlaps(interval(item), span));
      if (next.length === relevant.length) break;
      relevant = next;
      span = { start: Math.min(span.start, ...next.map(item => interval(item).start)), end: Math.max(span.end, ...next.map(item => interval(item).end)) };
    }
    const samePool = item => (item.type === 'discovery') === (type === 'discovery');
    const used = relevant.filter(item => samePool(item) && overlaps(interval(item), interval(candidate))).length;
    let remaining = 0;
    for (let count = 1; count <= TYPES[type].capacity - used; count++) {
      if (!assignAppointments([...relevant, ...Array.from({ length: count }, () => ({ ...candidate }))], rules, date)) break;
      remaining = count;
    }
    return remaining ? [{ time, capacity: used + remaining, used, remaining,
      availablePeople: TEAM.filter(person => assignAppointments([...relevant, { ...candidate, assignedTo: person }], rules, date)) }] : [];
  });
}
