// Career mode: arcs of events on each map, each ending in a boss race against a named rival.
// Stars (1–3 per event) unlock later arcs; beating a boss unlocks their driver and a car.

export const STARTER_DRIVERS = ['rex', 'coco', 'blu', 'sunny'];
export const STARTER_CARS = ['kiri', 'sanremo', 'duke'];

// mode: race (finish place) · takedowns (wreck N rivals) · timetrial (beat the clock, no rivals) · boss (1v1, win)
export const ARCS = [
  {
    id: 'rookie', name: 'Sun & Sand', map: 'beach', needStars: 0,
    blurb: 'Learn the island. Win races, wreck a few locals, beat the Tide King.',
    events: [
      { id: 'b1', name: 'Beach Opener', mode: 'race', laps: 2, ai: 0.88 },
      { id: 'b2', name: 'Fender Bender', mode: 'takedowns', laps: 2, ai: 0.88, target: [1, 2, 4] },
      { id: 'b3', name: 'Dune Sprint', mode: 'timetrial', laps: 1, par: 1.0 },
      { id: 'b4', name: 'Island Cup', mode: 'race', laps: 3, ai: 0.92 },
    ],
    boss: { id: 'bboss', driver: 'mango', title: 'The Tide King', car: 'phoenix', ai: 0.98, laps: 3, reward: { driver: 'mango', car: 'phoenix' } },
  },
  {
    id: 'canyon', name: 'Red Rock Outlaws', map: 'canyon', needStars: 10,
    blurb: 'Climbs, cliffs and two big jumps. The Outlaw does not brake.',
    events: [
      { id: 'c1', name: 'Canyon Run', mode: 'race', laps: 2, ai: 0.92 },
      { id: 'c2', name: 'Rock Bottom', mode: 'takedowns', laps: 3, ai: 0.93, target: [2, 3, 5] },
      { id: 'c3', name: 'Mesa Time Attack', mode: 'timetrial', laps: 1, par: 1.0 },
      { id: 'c4', name: 'Gorge Grand Prix', mode: 'race', laps: 3, ai: 0.95 },
    ],
    boss: { id: 'cboss', driver: 'duke', title: 'The Outlaw', car: 'lightbody', ai: 1.0, laps: 3, reward: { driver: 'duke', car: 'lightbody' } },
  },
  {
    id: 'harbor', name: 'Harbor Heat', map: 'town', needStars: 22,
    blurb: 'Tight streets, hills and the harbour. The Harbor Queen owns this town.',
    events: [
      { id: 't1', name: 'Main Street', mode: 'race', laps: 2, ai: 0.95 },
      { id: 't2', name: 'Street Justice', mode: 'takedowns', laps: 3, ai: 0.95, target: [2, 4, 6] },
      { id: 't3', name: 'Harbor Dash', mode: 'timetrial', laps: 1, par: 0.97 },
      { id: 't4', name: 'Town Derby', mode: 'race', laps: 3, ai: 0.97 },
    ],
    boss: { id: 'tboss', driver: 'lola', title: 'The Harbor Queen', car: 'cop', ai: 1.02, laps: 3, reward: { driver: 'lola', car: 'cop' } },
  },
  {
    id: 'legends', name: 'Legends Tour', map: null, needStars: 36,
    blurb: 'Every track, the fastest rivals. Survive the Juggernaut to become champion.',
    events: [
      { id: 'l1', name: 'Beach Legends', mode: 'race', map: 'beach', laps: 3, ai: 1.0 },
      { id: 'l2', name: 'Canyon Carnage', mode: 'takedowns', map: 'canyon', laps: 3, ai: 1.0, target: [3, 5, 7] },
      { id: 'l3', name: 'Harbor Hot Lap', mode: 'timetrial', map: 'town', laps: 1, par: 0.94 },
      { id: 'l4', name: 'Grand Final', mode: 'race', map: 'canyon', laps: 4, ai: 1.03 },
    ],
    boss: { id: 'lboss', driver: 'bruno', title: 'The Juggernaut', car: 'exterminator', map: 'beach', ai: 1.06, laps: 3, reward: { driver: 'bruno', car: 'exterminator' } },
  },
];

for (const a of ARCS) Object.assign(a.boss, { mode: 'boss', name: a.boss.title });

// Small unlocks for total stars (drivers and cars not tied to a boss).
export const STAR_REWARDS = [
  { stars: 5, car: 'tiara' }, { stars: 8, driver: 'kiki' }, { stars: 14, car: 'asti' }, { stars: 18, driver: 'taz' },
  { stars: 26, car: 'saba' }, { stars: 30, driver: 'nova' }, { stars: 40, driver: 'ivy' }, { stars: 45, car: 'exterminator' },
];

const KEY = 'dune-dash-career-v1';

export function loadCareer() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { stars: c.stars || {}, drivers: c.drivers || [...STARTER_DRIVERS], cars: c.cars || [...STARTER_CARS] };
  } catch {
    return { stars: {}, drivers: [...STARTER_DRIVERS], cars: [...STARTER_CARS] };
  }
}

export function saveCareer(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
}

export const totalStars = (c) => Object.values(c.stars).reduce((a, b) => a + b, 0);

export function arcUnlocked(c, arc) {
  return totalStars(c) >= arc.needStars;
}

// Events unlock in order; the boss needs every event in the arc done.
export function eventUnlocked(c, arc, ev) {
  if (!arcUnlocked(c, arc)) return false;
  if (ev === arc.boss) return arc.events.every((e) => (c.stars[e.id] || 0) > 0);
  const i = arc.events.indexOf(ev);
  return i === 0 || (c.stars[arc.events[i - 1].id] || 0) > 0;
}

// Turn a finished race into 0–3 stars.
export function starsFor(ev, result) {
  if (ev.mode === 'boss') return result.place === 1 ? 3 : 0;
  if (ev.mode === 'takedowns') return result.place > 0 ? ev.target.filter((t) => result.takedowns >= t).length : 0;
  if (ev.mode === 'timetrial') {
    const ratio = result.time / result.parTime;
    return ratio <= 0.97 ? 3 : ratio <= 1.03 ? 2 : ratio <= 1.12 ? 1 : 0;
  }
  return result.place === 1 ? 3 : result.place === 2 ? 2 : result.place === 3 ? 1 : 0;
}

// Record a result; returns { stars, best, unlocks: [text] }.
export function recordResult(c, arc, ev, result) {
  const before = totalStars(c);
  const stars = starsFor(ev, result);
  c.stars[ev.id] = Math.max(c.stars[ev.id] || 0, stars);
  const unlocks = [];
  const grant = (kind, id, why) => {
    const list = kind === 'driver' ? c.drivers : c.cars;
    if (id && !list.includes(id)) {
      list.push(id);
      unlocks.push({ kind, id, why });
    }
  };
  if (ev === arc.boss && stars > 0) {
    grant('driver', ev.reward.driver, `Beat ${ev.title}`);
    grant('car', ev.reward.car, `Beat ${ev.title}`);
  }
  const after = totalStars(c);
  for (const r of STAR_REWARDS) if (before < r.stars && after >= r.stars) {
    grant('driver', r.driver, `${r.stars} stars`);
    grant('car', r.car, `${r.stars} stars`);
  }
  for (const a of ARCS) if (before < a.needStars && after >= a.needStars && a.needStars > 0) unlocks.push({ kind: 'arc', id: a.id, why: a.name });
  saveCareer(c);
  return { stars, unlocks, total: after };
}

export function findEvent(id) {
  for (const arc of ARCS) {
    if (arc.boss.id === id) return { arc, ev: arc.boss };
    const ev = arc.events.find((e) => e.id === id);
    if (ev) return { arc, ev };
  }
  return null;
}
