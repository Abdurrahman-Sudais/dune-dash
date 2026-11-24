import { smoothstep } from './track.js';
import { variants, assets } from './assets.js';

const noise2 = (x, z) =>
  Math.sin(x * 0.045) * Math.cos(z * 0.038) * 1.6 + Math.sin(x * 0.012 + z * 0.019) * 2.2 + Math.sin(z * 0.09 + x * 0.03) * 0.4;

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
// Realistic Sketchfab props when built, else the Kenney fallback.
const V = (...prefixes) => prefixes.flatMap((p) => variants(p));
const or = (list, fallback) => (list.length ? list : fallback);
const footprint = (name) => {
  const s = assets.manifest.props[name]?.size || [7, 3, 7];
  return Math.max(s[0], s[2]);
};

// --- Shared race-day dressing: grandstands, crowd spots, barriers, billboards ------------
function raceDressing(track, { lamps = null, billboards = true } = {}) {
  const hw = track.halfWidth;
  const N = track.N;
  const rng = track.rng;

  // Grandstands + crowd at the start/finish straight.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const i = (N - 14 + k * 7) % N;
      const p = track.points[i], s = track.sides[i];
      const off = hw + 13;
      const x = p.x + s.x * off * side, z = p.z + s.z * off * side;
      const facing = Math.atan2(-s.x * side, -s.z * side);
      const stand = V('stadium_seats');
      if (stand.length) track.place(stand[0], x, z, { rot: facing + Math.PI / 2, radius: 4.5 }); // long side along the road
      else track.place(k % 2 ? 'grandStandCovered' : 'grandStand', x, z, { rot: facing, scale: 2.4, radius: 4.5 });
      for (let n = 0; n < 2; n++) {
        const along = (n - 0.5) * 4;
        const t = track.tangents[i];
        track.spectatorSpots.push({ x: x + t.x * along - s.x * side * 1.5, z: z + t.z * along - s.z * side * 1.5, y: track.heightAt(x, z) + 2.6, facing });
      }
    }
    const flagSpot = track.points[(N - 18) % N];
    const s = track.sides[(N - 18) % N];
    track.place('flagCheckers', flagSpot.x + s.x * (hw + 4) * side, flagSpot.z + s.z * (hw + 4) * side, { scale: 2, radius: 0.4 });
  }

  // Tyre-barrier walls round the outside of corners.
  for (let i = 0; i < N; i += 3) {
    const a = track.tangents[(i - 6 + N) % N], b = track.tangents[(i + 6) % N];
    const turn = a.x * b.z - a.z * b.x;
    const bend = Math.acos(Math.min(1, a.x * b.x + a.z * b.z));
    if (bend < 0.32 || i < 10 || i > N - 22) continue;
    const outside = turn > 0 ? 1 : -1; // turning right → wall on the left
    const p = track.points[i], s = track.sides[i], t = track.tangents[i];
    const off = hw + 4;
    const x = p.x + s.x * off * outside, z = p.z + s.z * off * outside;
    if (V('barrier_red').length) {
      // Real-size concrete Jersey barriers (3 m each), red/white like a circuit, tyre stacks now and then.
      for (const d of [-1.5, 1.5]) {
        track.place((i / 3) % 2 ? 'barrier_red' : 'barrier_white', x + t.x * d, z + t.z * d, { rot: Math.atan2(t.x, t.z), radius: 0.9 });
      }
      if ((i / 3) % 6 === 0) track.place('tyre_stack', x - s.x * outside * 1.2, z - s.z * outside * 1.2, { radius: 0.6 });
    } else {
      track.place((i / 3) % 2 ? 'barrierRed' : 'barrierWhite', x, z, { rot: Math.atan2(t.x, t.z) + Math.PI / 2, scale: 2.4, radius: 1.3 });
    }
  }

  // Real starting gantry spanning the road just after the line.
  const gantry = V('starting_line')[0];
  if (gantry) {
    const g = track.spawn(5);
    track.place(gantry, g.pos.x, g.pos.z, { rot: g.heading, scale: (track.halfWidth * 2 + 5) / 21, solid: false, y: g.pos.y });
    for (const sd of [-1, 1]) {
      const s5 = track.sides[g.index];
      track.addObstacle(g.pos.x + s5.x * (track.halfWidth + 2.5) * sd, g.pos.z + s5.z * (track.halfWidth + 2.5) * sd, 0.8);
    }
  }

  // Billboards and lamps along straights.
  for (let i = 30; i < N - 20; i += 4) {
    const a = track.tangents[(i - 10 + N) % N], b = track.tangents[(i + 10) % N];
    if (a.x * b.x + a.z * b.z < 0.985) continue;
    if (billboards && i % 120 === 0) {
      const spot = track.spotBeside(12, 14, { index: i });
      const boards = V('road_billboard');
      if (spot && boards.length) track.place(pick(rng, boards), spot.x, spot.z, { rot: spot.facing + Math.PI / 2, radius: 1 });
      else if (spot) track.place(pick(rng, ['billboard', 'billboardDouble_exclusive', 'billboardLow']), spot.x, spot.z, { rot: spot.facing, scale: 2.4 });
    }
    if (lamps && i % 24 === 0) {
      for (const side of [-1, 1]) {
        const p = track.points[i], s = track.sides[i];
        const x = p.x + s.x * (track.halfWidth + 3.5) * side, z = p.z + s.z * (track.halfWidth + 3.5) * side;
        const lamp = V('street_lamp')[0];
        if (lamp) track.place(lamp, x, z, { rot: Math.atan2(-s.x * side, -s.z * side), radius: 0.3 });
        else track.place(lamps, x, z, { rot: Math.atan2(-s.x * side, -s.z * side) + Math.PI / 2, scale: 2.4, radius: 0.4 });
      }
    }
  }

  // Roadside crowds at a few corners.
  for (let n = 0; n < 4; n++) {
    const spot = track.spotBeside(7, 9, { index: Math.floor(((n + 1) / 5) * N) });
    if (!spot) continue;
    const t = track.tangents[spot.i];
    if (V('barrier_concrete').length) {
      for (const d of [-3, 0, 3]) track.place('barrier_concrete', spot.x + t.x * d, spot.z + t.z * d, { rot: Math.atan2(t.x, t.z), radius: 0.9 });
    } else track.place('fenceStraight', spot.x, spot.z, { rot: spot.facing + Math.PI / 2, scale: 2, radius: 1 });
    for (let k = 0; k < 4; k++) {
      const along = (k - 1.5) * 1.6;
      const back = 2.2;
      track.spectatorSpots.push({
        x: spot.x + t.x * along + Math.sin(spot.facing) * -back,
        z: spot.z + t.z * along + Math.cos(spot.facing) * -back,
        facing: spot.facing,
      });
    }
  }
}

function scatter(track, count, names, { min = 6, max = 60, scale = [0.8, 1.2], solid = true, radius, sink = 0 } = {}) {
  for (let n = 0; n < count; n++) {
    const spot = track.spotBeside(min, max);
    if (!spot) continue;
    const s = scale[0] + track.rng() * (scale[1] - scale[0]);
    track.place(pick(track.rng, names), spot.x, spot.z, { scale: s, solid, radius: radius && radius * s, sink });
  }
}

// --- Maps --------------------------------------------------------------------------------
export const MAPS = {
  beach: {
    id: 'beach',
    name: 'Sunset Beach',
    desc: 'Dunes, palms and pirate ships on a sun-baked island. One big dune jump.',
    accent: '#ff7a1a',
    themes: ['beach', 'canyon'],
    seed: 1337,
    scale: 2.1,
    roadWidth: 18,
    groundSize: 1500,
    layout: [
      [0, 1, -120], [70, 1, -115], [120, 3, -80], [130, 7, -20], [100, 9, 20], [50, 6, 30], [30, 4, 70],
      [60, 7, 110], [20, 11, 140], [-50, 9, 135], [-100, 5, 100], [-90, 3, 40], [-130, 2, 0], [-120, 1, -70], [-70, 1, -110],
    ],
    jumps: [{ at: 0.86, height: 3.4, length: 22 }],
    water: { level: -0.6, color: 0x0a78c8, shallow: 0x3fe8d8 },
    road: { base: '#d2a870', ruts: true, curbs: [0xf0402a, 0xfff8ee] },
    island: 420,
    terrain(x, z) {
      const r = Math.hypot(x, z);
      return (noise2(x, z) + 2.6) * 1.1 - Math.max(0, r - this.island) * 0.05;
    },
    groundColor(c, x, z, h) {
      c.setHex(0xf5dca6).lerp({ r: 0.93, g: 0.8, b: 0.56 }, Math.min(1, Math.max(0, 0.5 - h * 0.08 + Math.sin(x * 0.3) * Math.sin(z * 0.27) * 0.15)));
      if (h > 5.5) c.lerp({ r: 0.42, g: 0.72, b: 0.26 }, Math.min(0.55, (h - 5.5) * 0.15));
      if (h < 0.4) c.lerp({ r: 0.8, g: 0.68, b: 0.47 }, Math.min(1, (0.4 - h) / 1.5)); // wet sand
    },
    sky: { top: 0x1f7ff0, bottom: 0xbfe6ff, fog: 0xd6efff, fogNear: 240, fogFar: 950 },
    sun: { color: 0xfff0d8, intensity: 3.1, dir: [60, 55, 35] },
    hemi: { sky: 0xbfe0ff, ground: 0xf0d2a0, intensity: 1.0 },
    decorate(track) {
      const rng = track.rng;
      const R = this.island;
      raceDressing(track, { lamps: null });
      const palms = or(V('coconut_palm', 'palm_trees'), ['palm-detailed-straight', 'palm-detailed-bend', 'palm-straight', 'palm-bend']);
      scatter(track, 120, palms, { min: 11, max: 75, scale: [0.85, 1.2], radius: 0.6 });
      track.scatterInstanced(['grass_large', 'grass_leafsLarge', 'grass_leafs', 'plant_flatTall'], 1100, { min: 3, max: 70, scale: [0.35, 0.7] });
      track.scatterInstanced(['plant_bushLarge', 'plant_bush'], 220, { min: 5, max: 90, scale: [0.6, 1], shadows: true });
      scatter(track, 25, or(V('vegetation'), ['plant_bushLarge']), { min: 6, max: 40, scale: [0.7, 1], solid: false });
      track.scatterInstanced(['flower_yellowA', 'flower_redA', 'flower_purpleB'], 400, { min: 4, max: 70, scale: [0.4, 0.7] });

      // Beach huts and houses with umbrellas round them
      const huts = or(V('beach_hut', 'beachhouse'), ['structure']);
      const umbrella = V('beach_umbrella')[0];
      for (let n = 0; n < 9; n++) {
        const spot = track.spotBeside(22, 45);
        if (!spot) continue;
        track.place(pick(rng, huts), spot.x, spot.z, { rot: spot.facing, radius: 3.5 });
        if (umbrella)
          for (let k = 0; k < 3; k++) {
            const a = rng() * Math.PI * 2;
            track.place(umbrella, spot.x + Math.cos(a) * 9, spot.z + Math.sin(a) * 9, { radius: 0.15 });
          }
      }

      // Shore: rocks, umbrellas on the sand, the lighthouse, a pier with boats, sailboats offshore.
      const shoreRocks = or(V('desert_rocks'), ['rocks-sand-a', 'rocks-sand-b', 'rocks-sand-c']);
      for (let n = 0; n < 30; n++) {
        const a = rng() * Math.PI * 2;
        const r = R + 14 + rng() * 26;
        track.place(pick(rng, shoreRocks), Math.cos(a) * r, Math.sin(a) * r, { scale: 0.35 + rng() * 0.5, solid: false, sink: 0.5 });
      }
      if (umbrella)
        for (let n = 0; n < 24; n++) {
          const a = rng() * Math.PI * 2;
          const r = R - 5 + rng() * 18;
          if (track.terrain(Math.cos(a) * r, Math.sin(a) * r) < this.water.level + 0.3) continue;
          track.place(umbrella, Math.cos(a) * r, Math.sin(a) * r, { solid: false });
        }
      const start = track.points[0];
      const ang = Math.atan2(start.z, start.x);
      const lighthouseA = ang + 0.7;
      track.place(V('lighthouse')[0] || 'tower-complete-large', Math.cos(lighthouseA) * (R + 8), Math.sin(lighthouseA) * (R + 8), { radius: 4 });
      const pierA = ang - 0.25;
      const dir = { x: Math.cos(pierA), z: Math.sin(pierA) };
      const pier = V('pier')[0];
      const pierLen = pier ? footprint(pier) * 0.95 : 7.4;
      for (let k = 0; k < (pier ? Math.ceil(60 / pierLen) : 9); k++) {
        const r = R - 5 + k * pierLen;
        track.place(pier || 'structure-platform-dock-small', dir.x * r, dir.z * r, { rot: -pierA + Math.PI / 2, solid: false, y: this.water.level - (pier ? 0.6 : 1.2) });
      }
      const boats = or(V('fishing_boat'), ['boat-row-small']);
      for (let k = 0; k < 4; k++) {
        const r = R + 18 + k * 12, sd = k % 2 ? 1 : -1;
        track.place(pick(rng, boats), dir.x * r - dir.z * 9 * sd, dir.z * r + dir.x * 9 * sd, { rot: -pierA + rng() * 0.4, scale: 0.55, solid: false, float: true, y: this.water.level - 0.3 });
      }
      const sails = or(V('sailboat', 'fishing_boat'), ['ship-small']);
      for (let n = 0; n < 7; n++) {
        const a = ang + (n - 3) * 0.45 + rng() * 0.2;
        const r = R + 90 + rng() * 200;
        track.place(pick(rng, sails), Math.cos(a) * r, Math.sin(a) * r, { solid: false, float: true, y: this.water.level - 0.3 });
      }
    },
  },

  canyon: {
    id: 'canyon',
    name: 'Canyon Rush',
    desc: 'A deep red-rock valley: big climbs, cliff walls, ancient ruins and two jumps.',
    accent: '#d9480f',
    themes: ['canyon'],
    seed: 4242,
    scale: 1.6,
    roadWidth: 17,
    groundSize: 1500,
    flatGround: true,
    layout: [
      [0, 2, -200], [120, 5, -210], [220, 14, -150], [250, 24, -40], [200, 30, 40], [120, 18, 40], [60, 8, 100],
      [110, 12, 190], [30, 22, 250], [-80, 30, 230], [-160, 34, 150], [-140, 22, 60], [-220, 12, 0], [-230, 6, -110], [-120, 2, -190],
    ],
    jumps: [{ at: 0.3, height: 4, length: 24 }, { at: 0.74, height: 3.6, length: 22 }],
    water: null,
    road: { base: '#a8714a', ruts: true, curbs: [0xffffff, 0xd9480f] },
    terrain(x, z, q) {
      const base = q ? q.y : 0;
      const dist = q ? q.dist : 200;
      const wall = smoothstep(26, 90, dist) * (34 + Math.sin(x * 0.02) * 10 + Math.cos(z * 0.017) * 8);
      const mesa = Math.max(0, Math.sin(x * 0.006 + 1) * Math.cos(z * 0.007) - 0.55) * 120;
      return base * 0.85 + noise2(x, z) * 1.4 + wall + mesa * smoothstep(60, 140, dist);
    },
    groundColor(c, x, z, h, dist, hw) {
      const band = Math.sin(h * 0.55) * 0.5 + 0.5;
      c.setRGB(0.78 + band * 0.1, 0.42 + band * 0.12, 0.25 + band * 0.06);
      if (dist < hw + 30) c.lerp({ r: 0.78, g: 0.56, b: 0.36 }, 1 - smoothstep(hw, hw + 30, dist));
    },
    sky: { top: 0x2a86f0, bottom: 0xd8ecfa, fog: 0xf0dcc2, fogNear: 200, fogFar: 850 },
    sun: { color: 0xfff0d6, intensity: 2.9, dir: [-40, 70, 30] },
    hemi: { sky: 0xd8ecff, ground: 0xc77b4a, intensity: 1.0 },
    decorate(track) {
      const rng = track.rng;
      raceDressing(track, { lamps: null });
      const rocks = or(V('desert_rocks'), ['cliff_block_rock', 'cliff_large_rock', 'cliff_blockSlope_rock']);
      // Cliff walls on the valley sides: the big rock formations scaled up into towering faces.
      const big = rocks.slice(0, 6);
      for (let n = 0; n < 140; n++) {
        const spot = track.spotBeside(20, 55);
        if (!spot) continue;
        track.place(pick(rng, big), spot.x, spot.z, { rot: spot.facing + (rng() - 0.5) * 1.5, scale: 2.5 + rng() * 2.8, sink: 2, solid: spot.side !== undefined });
      }
      scatter(track, 55, rocks, { min: 8, max: 40, scale: [0.6, 1.6], sink: 0.3 });
      scatter(track, 90, or(V('cactus'), ['cactus_tall', 'cactus_short']), { min: 4, max: 45, scale: [0.8, 1.3], radius: 0.4 });
      track.scatterInstanced(['grass_leafs', 'grass', 'plant_flatShort', 'plant_bushTriangle'], 900, { min: 3, max: 60, scale: [0.35, 0.7] });
      track.scatterInstanced(['rock_smallB', 'rock_smallC', 'rock_smallFlatA', 'rock_smallTopA', 'stone_smallA'], 700, { min: 3, max: 90, scale: [0.3, 0.9] });
      // A few spectators on the rocks near the start
      for (let k = 0; k < 4; k++) {
        const spot = track.spotBeside(9, 12, { index: (track.N - 30 + k * 12) % track.N });
        if (spot) track.spectatorSpots.push({ x: spot.x, z: spot.z, facing: spot.facing });
      }
    },
  },

  town: {
    id: 'town',
    name: 'Harbor Town',
    desc: 'Hilly seaside streets lined with houses, gardens and the harbour.',
    accent: '#2a9df4',
    themes: ['town', 'beach'],
    seed: 777,
    scale: 1.7,
    roadWidth: 17,
    groundSize: 1500,
    layout: [
      [0, 2, -180], [100, 3, -185], [190, 7, -130], [200, 12, -40], [150, 17, 30], [170, 21, 120], [100, 24, 190],
      [0, 19, 170], [-60, 12, 110], [-130, 9, 160], [-210, 7, 100], [-200, 5, 0], [-150, 3, -80], [-90, 2, -160],
    ],
    jumps: [{ at: 0.6, height: 3.2, length: 22 }],
    water: { level: -0.6, color: 0x0b6fc0, shallow: 0x36d4d0 },
    groundDetail: 'grass',
    road: { base: '#4a4d55', lines: true, curbs: [0xe8432f, 0xffffff] },
    terrain(x, z) {
      const hills = Math.sin(x * 0.008) * Math.cos(z * 0.01) * 7 + Math.sin(x * 0.02 + z * 0.013) * 3 + 4;
      const shore = smoothstep(-330, -420, z) * 22;
      return hills + noise2(x, z) * 0.4 - shore;
    },
    groundColor(c, x, z, h, dist, hw) {
      const n = Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.5 + 0.5;
      c.setRGB(0.2 + n * 0.08, 0.44 + n * 0.1, 0.12 + n * 0.05);
      if (dist < hw + 4) c.setRGB(0.7, 0.7, 0.68);
      if (h < 1.2) c.lerp({ r: 0.93, g: 0.85, b: 0.64 }, Math.min(1, (1.2 - h) / 1.4));
    },
    sky: { top: 0x3f95ec, bottom: 0xd6efff, fog: 0xd6efff, fogNear: 220, fogFar: 900 },
    sun: { color: 0xfff6e2, intensity: 2.5, dir: [50, 75, -20] },
    hemi: { sky: 0xd4ecff, ground: 0x7aa860, intensity: 1.05 },
    decorate(track) {
      const rng = track.rng;
      const N = track.N;
      raceDressing(track, { lamps: 'lightPostModern' });
      const houses = or(V('suburban_house', 'suburbian_house', 'nyc_homes'), Array.from('abcdefghijklmnopqrstu', (c) => 'building-type-' + c));
      const realHouses = !houses[0].startsWith('building-type');
      for (let i = 24; i < N - 24; i += 13) {
        if (track.jumps.some((j) => Math.abs(i - j.end) < 20)) continue;
        for (const side of [-1, 1]) {
          if (rng() < 0.3) continue;
          const spot = track.spotBeside(15, 19, { index: i, side });
          if (!spot) continue;
          track.place(pick(rng, houses), spot.x, spot.z, { rot: spot.facing + (realHouses ? 0 : Math.PI), scale: realHouses ? 1 : 1.6, radius: 4.6 });
          const t = track.tangents[i];
          const fx = spot.x - Math.sin(spot.facing) * -8, fz = spot.z - Math.cos(spot.facing) * -8;
          if (rng() < 0.8) track.place(pick(rng, or(V('vegetation'), ['plant_bushDetailed'])), fx - t.x * 5, fz - t.z * 5, { solid: false });
          if (rng() < 0.15) track.spectatorSpots.push({ x: fx, z: fz, facing: spot.facing });
        }
      }
      scatter(track, 120, or(V('forest_trees', 'oak'), ['tree_oak', 'tree_default', 'tree_detailed', 'tree_fat']), { min: 24, max: 90, scale: [0.8, 1.2], radius: 0.7 });
      scatter(track, 40, ['plant_bush', 'plant_bushDetailed', 'flower_redA', 'flower_yellowA'], { min: 5, max: 40, scale: [1, 1.4], solid: false });
      track.scatterInstanced(['grass_large', 'grass_leafsLarge', 'grass', 'plant_flatTall'], 1300, { min: 4, max: 75, scale: [0.35, 0.65] });
      track.scatterInstanced(['flower_redB', 'flower_yellowB', 'flower_purpleC'], 700, { min: 6, max: 60, scale: [0.4, 0.7] });

      // Harbour on the south shore: piers, fishing boats, sailboats in the bay
      const pier = V('pier')[0];
      const boats = or(V('fishing_boat'), ['boat-row-large']);
      for (let k = 0; k < 6; k++) {
        const x = -120 + k * 60, z = -420;
        if (pier) for (let d = 0; d < 3; d++) track.place(pier, x, z - d * footprint(pier) * 0.95, { rot: Math.PI / 2, solid: false, y: this.water.level - 0.6 });
        track.place(pick(rng, boats), x + 9, z - 16, { rot: rng() * 0.5, scale: 0.55, solid: false, float: true, y: this.water.level - 0.3 });
      }
      for (let n = 0; n < 6; n++)
        track.place(pick(rng, or(V('sailboat'), ['ship-small'])), -260 + n * 110 + rng() * 40, -520 - rng() * 140, { solid: false, float: true, y: this.water.level - 0.3 });
    },
  },
};
