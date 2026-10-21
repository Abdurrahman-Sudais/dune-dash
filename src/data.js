// Game content: cars, drivers, skills, customization options and maps.
// Speeds are in m/s (×3.6 for km/h), accel in m/s², mass in tonnes.
// Cars: "Low poly model" series by Daniel Zhabotinsky (CC-BY 4.0, Sketchfab).
// People & animations: Quaternius Universal Base Characters + Animation Library (CC0).

export const CARS = {
  saba: { name: "Saba V12 '95", cls: 'Supercar', topSpeed: 61, accel: 28, handling: 0.9, mass: 1.45, offroad: 0.62, paint: 0xd81e1e },
  exterminator: { name: "Exterminator '00", cls: 'Hypercar', topSpeed: 63, accel: 29, handling: 0.86, mass: 1.4, offroad: 0.6, paint: 0x1a1a1a },
  kiri: { name: "Kiri '86", cls: 'JDM coupé', topSpeed: 54, accel: 25, handling: 0.98, mass: 1.1, offroad: 0.68, paint: 0xf4f4f4 },
  tiara: { name: "Tiara GT '83", cls: 'Tuner', topSpeed: 57, accel: 27, handling: 0.94, mass: 1.2, offroad: 0.66, paint: 0x2a6ff7 },
  phoenix: { name: "Phoenix 455 '71", cls: 'Muscle', topSpeed: 59, accel: 29, handling: 0.72, mass: 1.75, offroad: 0.64, paint: 0x111111 },
  duke: { name: "Duke '69", cls: 'Muscle', topSpeed: 57, accel: 27, handling: 0.7, mass: 1.8, offroad: 0.64, paint: 0xff7a1a },
  sanremo: { name: "Sanremo '70", cls: 'Rally', topSpeed: 53, accel: 26, handling: 0.95, mass: 1.05, offroad: 0.86, paint: 0x1f8f5f },
  asti: { name: "Asti Stradale '89", cls: 'Rally', topSpeed: 56, accel: 27, handling: 0.92, mass: 1.2, offroad: 0.84, paint: 0xffd23f },
  lightbody: { name: "Lightbody Lifted '85", cls: 'Off-road truck', topSpeed: 49, accel: 23, handling: 0.64, mass: 2.6, offroad: 0.96, paint: 0x8a5a33 },
  cop: { name: "Fairheaven Cop '80", cls: 'Interceptor', topSpeed: 55, accel: 25, handling: 0.78, mass: 1.85, offroad: 0.68, paint: 0x101820, siren: true },
};

// Normalised stat bars for the garage.
export function carStats(id) {
  const c = CARS[id];
  return {
    Speed: (c.topSpeed - 45) / 19,
    Accel: (c.accel - 20) / 10,
    Handling: (c.handling - 0.55) / 0.45,
    Strength: (c.mass - 0.9) / 1.8,
    'Off-road': (c.offroad - 0.55) / 0.42,
  };
}

export const SKILLS = {
  nitro: { name: 'Nitro Rampage', icon: '🔥', desc: 'Huge flaming boost — anything you touch gets wrecked.' },
  shockwave: { name: 'Shockwave', icon: '💥', desc: 'Blast the cars around you off the road.' },
  barrage: { name: 'Missile Barrage', icon: '🎯', desc: 'Three homing missiles at the cars ahead.' },
  ghost: { name: 'Phantom', icon: '👻', desc: 'Turn intangible and faster: nothing can touch you.' },
  thunder: { name: 'Thunder Strike', icon: '⚡', desc: 'Lightning hits the three cars ahead of you.' },
  mines: { name: 'Mine Layer', icon: '💣', desc: 'Drops a trail of mines that spin out chasers.' },
  tractor: { name: 'Tractor Beam', icon: '🧲', desc: 'Reel in the car ahead and slam it.' },
  monster: { name: 'Juggernaut', icon: '🦏', desc: 'Become unstoppable and heavy — flatten everyone.' },
};

export const HAIRS = {
  Hair_SimpleParted: 'Parted',
  Hair_Long: 'Long',
  Hair_Buns: 'Buns',
  Hair_Buzzed: 'Buzzed',
  Hair_BuzzedFemale: 'Pixie',
  none: 'Bald',
};
export const HAIR_COLORS = [0x2b1a10, 0x6b3e1f, 0xc8963e, 0xe8d39a, 0x8a1c1c, 0x1a1a1a, 0xd9d9d9, 0x3a6ff7];

// Driver identity = name + skill + default look. The player can restyle any of them.
export const DRIVERS = [
  { id: 'rex', name: 'Rex', skill: 'nitro', look: { body: 'male', skin: 'light', hair: 'Hair_SimpleParted', beard: true, hairColor: 0x2b1a10, suit: 0xd81e1e, accent: 0x111111, pattern: 'flames', number: 1, name: 'Rex', helmetColor: 0xffd23f } },
  { id: 'coco', name: 'Coco', skill: 'ghost', look: { body: 'female', skin: 'dark', hair: 'Hair_Buns', beard: false, hairColor: 0x1a1a1a, suit: 0xf4f4f4, accent: 0x7f5af0, pattern: 'chevron', number: 8, name: 'Coco', helmetColor: 0x7f5af0 } },
  { id: 'blu', name: 'Blu', skill: 'shockwave', look: { body: 'male', skin: 'dark', hair: 'Hair_Buzzed', beard: false, hairColor: 0x1a1a1a, suit: 0x2a6ff7, accent: 0xffffff, pattern: 'split', number: 22, name: 'Blu', helmetColor: 0xffffff } },
  { id: 'sunny', name: 'Sunny', skill: 'thunder', look: { body: 'female', skin: 'light', hair: 'Hair_Long', beard: false, hairColor: 0xe8d39a, suit: 0xffd23f, accent: 0x111111, pattern: 'checker', number: 5, name: 'Sunny', helmetColor: 0x111111 } },
  { id: 'mango', name: 'Mango', skill: 'mines', look: { body: 'male', skin: 'light', hair: 'Hair_Long', beard: true, hairColor: 0x6b3e1f, suit: 0xff7a1a, accent: 0x1f8f5f, pattern: 'camo', number: 44, name: 'Mango', helmetColor: 0x1f8f5f } },
  { id: 'kiki', name: 'Kiki', skill: 'barrage', look: { body: 'female', skin: 'light', hair: 'Hair_BuzzedFemale', beard: false, hairColor: 0x8a1c1c, suit: 0x111111, accent: 0xff2bd6, pattern: 'chevron', number: 13, name: 'Kiki', helmetColor: 0xff2bd6 } },
  { id: 'duke', name: 'Duke', skill: 'monster', look: { body: 'male', skin: 'dark', hair: 'none', beard: true, hairColor: 0x1a1a1a, suit: 0x3a3a3a, accent: 0xffd23f, pattern: 'stripes', number: 99, name: 'Duke', helmetColor: 0xffd23f } },
  { id: 'lola', name: 'Lola', skill: 'tractor', look: { body: 'female', skin: 'dark', hair: 'Hair_Long', beard: false, hairColor: 0x2b1a10, suit: 0xff2bd6, accent: 0xffffff, pattern: 'split', number: 27, name: 'Lola', helmetColor: 0xffffff } },
  { id: 'taz', name: 'Taz', skill: 'barrage', look: { body: 'male', skin: 'light', hair: 'Hair_Buzzed', beard: false, hairColor: 0xc8963e, suit: 0x1f8f5f, accent: 0xffffff, pattern: 'checker', number: 3, name: 'Taz', helmetColor: 0x1f8f5f } },
  { id: 'nova', name: 'Nova', skill: 'nitro', look: { body: 'female', skin: 'light', hair: 'Hair_Buns', beard: false, hairColor: 0xd9d9d9, suit: 0x00b4ff, accent: 0x111111, pattern: 'flames', number: 11, name: 'Nova', helmetColor: 0x00b4ff } },
  { id: 'bruno', name: 'Bruno', skill: 'monster', look: { body: 'male', skin: 'light', hair: 'none', beard: true, hairColor: 0x6b3e1f, suit: 0x8a5a33, accent: 0xff7a1a, pattern: 'camo', number: 66, name: 'Bruno', helmetColor: 0x8a5a33 } },
  { id: 'ivy', name: 'Ivy', skill: 'shockwave', look: { body: 'female', skin: 'dark', hair: 'Hair_BuzzedFemale', beard: false, hairColor: 0x1a1a1a, suit: 0x2ecc71, accent: 0x111111, pattern: 'stripes', number: 17, name: 'Ivy', helmetColor: 0x2ecc71 } },
];

export const PAINTS = [
  0xd81e1e, 0xff7a1a, 0xffd23f, 0x1f8f5f, 0x2ecc71, 0x1fc8b0, 0x2a6ff7, 0x14213d,
  0x7f5af0, 0xff2bd6, 0xf4f4f4, 0xb8bcc2, 0x3a3a3a, 0x111111, 0x8a5a33, 0x6b0f1a,
];

export const FINISHES = {
  gloss: { name: 'Gloss', roughness: 0.28, metalness: 0.2, clearcoat: 1 },
  metallic: { name: 'Metallic', roughness: 0.3, metalness: 0.8, clearcoat: 1 },
  pearl: { name: 'Pearl', roughness: 0.2, metalness: 0.45, clearcoat: 1, sheen: 1 },
  matte: { name: 'Matte', roughness: 0.75, metalness: 0.1, clearcoat: 0 },
  chrome: { name: 'Chrome', roughness: 0.04, metalness: 1, clearcoat: 0 },
};

export const RIMS = { stock: { name: 'Stock' }, black: { name: 'Gloss black', color: 0x2a2a2a }, gold: { name: 'Gold', color: 0xd4a017 }, chrome: { name: 'Chrome', color: 0xffffff, metal: 1 }, red: { name: 'Red', color: 0xc81e1e } };
export const TINTS = { clear: { name: 'Clear', opacity: 0.6 }, smoke: { name: 'Smoked', opacity: 0.82, color: 0x333333 }, limo: { name: 'Limo', opacity: 0.94, color: 0x111111 } };
export const HEIGHTS = { slammed: { name: 'Slammed', y: -0.07 }, stock: { name: 'Stock', y: 0 }, lifted: { name: 'Lifted', y: 0.12 } };
export const NEON = [null, 0x00e5ff, 0xff2bd6, 0x39ff14, 0xffd23f, 0xff3b3b, 0x9b5de5];
export const FLAMES = [0xff8a1a, 0x3fb6ff, 0x39ff14, 0xff2bd6, 0xffffff];

export const DEFAULT_PROFILE = {
  car: 'saba',
  paint: 0xd81e1e,
  finish: 'metallic',
  rims: 'stock',
  tint: 'smoke',
  height: 'stock',
  neon: null,
  flame: 0xff8a1a,
  driver: 'rex',
  look: null, // null = the driver's default look
  helmet: true,
  autoGas: true, // Beach Buggy style: the car accelerates by itself, S brakes
  map: 'beach',
};

const PROFILE_KEY = 'dune-dash-profile-v2';

export function loadProfile() {
  try {
    const p = { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') };
    if (!CARS[p.car]) p.car = DEFAULT_PROFILE.car;
    if (!DRIVERS.some((d) => d.id === p.driver)) p.driver = DEFAULT_PROFILE.driver;
    return p;
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — keep going */
  }
}

export function driverLook(profile) {
  const d = DRIVERS.find((x) => x.id === profile.driver) || DRIVERS[0];
  return { ...d.look, ...(profile.look || {}), helmet: profile.helmet };
}
