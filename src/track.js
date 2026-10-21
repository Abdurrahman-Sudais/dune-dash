import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cloneProp, assets, sharedGeometries } from './assets.js';

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const CELL = 32;
const CHUNK = 140;
const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

export class Track {
  constructor(scene, map) {
    this.map = map;
    this.scene = scene;
    this.halfWidth = map.roadWidth / 2;
    this.rng = mulberry32(map.seed || 1337);
    this.group = new THREE.Group();
    this.staticGroup = new THREE.Group(); // merged into chunks at the end
    this.floaters = []; // props that bob on water
    this.spectatorSpots = [];
    scene.add(this.group);

    const pts = map.layout.map(([x, y, z]) => new THREE.Vector3(x * map.scale, y, z * map.scale));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    const N = (this.N = Math.round(this.length / 2));
    this.points = [];
    this.tangents = [];
    this.sides = [];
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      this.points.push(p);
      const flat = new THREE.Vector3(tan.x, 0, tan.z).normalize();
      this.tangents.push(flat);
      this.sides.push(new THREE.Vector3(flat.z, 0, -flat.x)); // driver's left
    }
    this.step = this.length / N;
    this.applyJumps();

    this.grid = new Map();
    this.points.forEach((p, i) => {
      const k = cellKey(p.x, p.z);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });
    this.obstacles = [];
    this.obstacleGrid = new Map();
    this.buildShortcuts();

    this.buildGround();
    if (map.water) this.buildWater();
    this.buildRoad();
    this.buildShortcutRoads();
    this.buildStartLine();
  }

  // Ramps: road rises over `length` metres then drops off a lip.
  applyJumps() {
    this.jumps = [];
    for (const j of this.map.jumps || []) {
      const rise = Math.round(j.length / this.step);
      // Put the ramp on the straightest stretch near the requested spot (a ramp on a bend throws you off).
      const bendAt = (e) => {
        let b = 0;
        for (let k = -rise - 10; k <= 30; k += 2) {
          const t0 = this.tangents[(e + k + this.N) % this.N], t1 = this.tangents[(e + k + 2 + this.N) % this.N];
          b += Math.acos(Math.min(1, t0.dot(t1)));
        }
        return b;
      };
      let end = Math.round(j.at * this.N), best = Infinity;
      for (let d = -Math.round(this.N * 0.08); d <= Math.round(this.N * 0.08); d += 2) {
        const e = (Math.round(j.at * this.N) + d + this.N) % this.N;
        const b = bendAt(e) + Math.abs(d) * 0.0004;
        if (b < best) { best = b; end = e; }
      }
      for (let k = 0; k <= rise; k++) {
        const i = (end - rise + k + this.N) % this.N;
        const t = k / rise;
        this.points[i].y += j.height * t * t;
      }
      this.jumps.push({ start: (end - rise + this.N) % this.N, end, height: j.height });
    }
  }

  // Nearest centreline point. `hint` (last known index) makes this a cheap local search.
  nearest(x, z, hint = -1) {
    const N = this.N;
    let best = Infinity;
    let index = 0;
    const test = (i) => {
      const p = this.points[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) { best = d; index = i; }
    };
    if (hint >= 0) {
      for (let k = -14; k <= 14; k++) test((hint + k + N) % N);
    }
    if (hint < 0 || best > (this.halfWidth + 40) ** 2) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let r = 1; r <= 4 && best === Infinity; r++) {
        for (let gx = cx - r; gx <= cx + r; gx++)
          for (let gz = cz - r; gz <= cz + r; gz++) {
            const cell = this.grid.get(`${gx},${gz}`);
            if (cell) for (const i of cell) test(i);
          }
      }
      if (best === Infinity) for (let i = 0; i < N; i++) test(i);
    }
    return this.project(x, z, index);
  }

  // Refine onto the neighbouring segment for a smooth height and lateral offset.
  project(x, z, i) {
    const N = this.N;
    let bestD = Infinity, out = null;
    for (const [a, b] of [[(i - 1 + N) % N, i], [i, (i + 1) % N]]) {
      const pa = this.points[a], pb = this.points[b];
      const dx = pb.x - pa.x, dz = pb.z - pa.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - pa.x) * dx + (z - pa.z) * dz) / len2));
      const px = pa.x + dx * t, pz = pa.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) {
        bestD = d;
        const s = this.sides[i];
        out = { index: i, dist: d, y: pa.y + (pb.y - pa.y) * t, lateral: (x - px) * s.x + (z - pz) * s.z };
      }
    }
    return out;
  }

  terrain(x, z, q) {
    return this.map.terrain(x, z, q ?? this.nearest(x, z));
  }

  // Ground height anywhere: road surface near the track, blending into terrain further out.
  surface(x, z, q) {
    if (q.dist < this.halfWidth + 1.4) return q.y;
    const k = smoothstep(this.halfWidth + 1.4, this.halfWidth + 26, q.dist);
    // Off the tarmac the ground is rough: ruts and lumps you feel through the suspension.
    const rough = (Math.sin(x * 0.35) * Math.cos(z * 0.31) * 0.22 + Math.sin(x * 0.11 + z * 0.13) * 0.3) * smoothstep(this.halfWidth + 1.4, this.halfWidth + 6, q.dist);
    let h = q.y * (1 - k) + this.terrain(x, z, q) * k + rough; // continuous at the road edge: no lip to launch off
    const sc = this.shortcutAt(x, z);
    if (sc) {
      const w = 1 - smoothstep(sc.hw, sc.hw + 10, sc.dist);
      h = h * (1 - w) + (sc.y + (sc.dist < sc.hw ? rough * 0.5 : 0)) * w;
    }
    return h;
  }

  // Dirt shortcuts: chords cutting across the tightest corners.
  buildShortcuts() {
    this.shortcuts = [];
    const N = this.N, span = Math.round(100 / this.step);
    const cands = [];
    for (let i = 0; i < N; i += 4) {
      const a = (i - span + N) % N, b = (i + span) % N;
      const pa = this.points[a], pb = this.points[b];
      const chord = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      cands.push({ a, b, gain: span * 2 * this.step - chord, chord, i });
    }
    cands.sort((x, y) => y.gain - x.gain);
    for (const c of cands) {
      if (this.shortcuts.length >= (this.map.shortcuts ?? 2)) break;
      if (c.gain < 18 || c.i < 40 || c.i > N - 40) continue;
      if (this.shortcuts.some((s) => Math.abs(s.i - c.i) < span * 3)) continue;
      if (this.jumps.some((j) => Math.abs(j.end - c.i) < span * 2)) continue;
      const pa = this.points[c.a], pb = this.points[c.b];
      const pts = [];
      const n = Math.max(8, Math.round(c.chord / 2));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        // A gentle S so it reads as a trail, not a ruler line.
        const off = Math.sin(t * Math.PI * 2) * 4;
        const dx = pb.x - pa.x, dz = pb.z - pa.z, L = Math.hypot(dx, dz);
        pts.push(new THREE.Vector3(pa.x + dx * t - (dz / L) * off, pa.y + (pb.y - pa.y) * t, pa.z + dz * t + (dx / L) * off));
      }
      // Skip if the chord runs over water or through the track elsewhere.
      if (this.map.water && pts.some((p) => this.map.terrain(p.x, p.z, this.nearest(p.x, p.z)) < this.map.water.level + 0.5)) continue;
      this.shortcuts.push({ i: c.i, pts, hw: 4.5 });
    }
  }

  shortcutAt(x, z) {
    let best = null;
    for (const s of this.shortcuts || []) {
      for (let k = 0; k < s.pts.length - 1; k++) {
        const a = s.pts[k], b = s.pts[k + 1];
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
        if (d < s.hw + 10 && (!best || d < best.dist)) best = { dist: d, y: a.y + (b.y - a.y) * t, hw: s.hw };
      }
    }
    return best;
  }

  buildShortcutRoads() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const s of this.shortcuts) {
      const pos = [], idx = [];
      s.pts.forEach((p, k) => {
        const q = s.pts[Math.min(k + 1, s.pts.length - 1)], r = s.pts[Math.max(k - 1, 0)];
        const dx = q.x - r.x, dz = q.z - r.z, L = Math.hypot(dx, dz) || 1;
        const sx = -dz / L, sz = dx / L;
        for (const sd of [1, -1]) {
          const x = p.x + sx * s.hw * sd, z = p.z + sz * s.hw * sd;
          pos.push(x, this.heightAt(x, z) + 0.04, z);
        }
        if (k) idx.push(k * 2 - 2, k * 2 - 1, k * 2, k * 2 - 1, k * 2 + 1, k * 2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.group.add(m);
      // Marker posts at the entry so players spot it.
      const e = s.pts[0], post = new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0x553300 });
      for (const sd of [-1, 1]) {
        const d = s.pts[1];
        const dx = d.x - e.x, dz = d.z - e.z, L = Math.hypot(dx, dz) || 1;
        const px = e.x - (dz / L) * (s.hw + 0.6) * sd, pz = e.z + (dx / L) * (s.hw + 0.6) * sd;
        const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 8), post);
        pm.position.set(px, this.heightAt(px, pz) + 0.7, pz);
        this.group.add(pm);
      }
    }
  }

  onShortcut(x, z) {
    const s = this.shortcutAt(x, z);
    return !!s && s.dist < s.hw + 0.5;
  }

  heightAt(x, z, hint = -1) {
    return this.surface(x, z, this.nearest(x, z, hint));
  }

  // Back-compat for code that asks with a distance only.
  groundHeight(x, z) {
    return this.heightAt(x, z);
  }

  spawn(index, lateral = 0) {
    const i = ((Math.round(index) % this.N) + this.N) % this.N;
    const p = this.points[i];
    const t = this.tangents[i];
    const pos = p.clone().addScaledVector(this.sides[i], lateral);
    return { pos, heading: Math.atan2(t.x, t.z), index: i };
  }

  addObstacle(x, z, r) {
    const o = { x, z, r };
    this.obstacles.push(o);
    const span = Math.ceil(r / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let gx = cx - span; gx <= cx + span; gx++)
      for (let gz = cz - span; gz <= cz + span; gz++) {
        const k = `${gx},${gz}`;
        if (!this.obstacleGrid.has(k)) this.obstacleGrid.set(k, []);
        this.obstacleGrid.get(k).push(o);
      }
  }

  obstaclesNear(x, z) {
    return this.obstacleGrid.get(cellKey(x, z)) || [];
  }

  // --- Building ---------------------------------------------------------------

  buildGround() {
    const m = this.map;
    const size = m.groundSize;
    const segs = 170;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const q = this.nearest(x, z);
      const h = this.surface(x, z, q);
      pos.setY(i, q.dist < this.halfWidth + 1.4 ? q.y - 0.35 : h);
      m.groundColor(c, x, z, h, q.dist, this.halfWidth);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: !!m.flatGround }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildWater() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(160,220,235,${0.25 + Math.random() * 0.35})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 10, 1.5);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(160, 160);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.waterTex = tex;
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: this.map.water.color, map: tex, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.9 })
    );
    water.position.y = this.map.water.level;
    this.group.add(water);
  }

  roadTexture() {
    const style = this.map.road;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const g = canvas.getContext('2d');
    g.fillStyle = style.base;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    if (style.ruts) {
      g.fillStyle = 'rgba(60,35,15,0.18)';
      for (const x of [58, 80, 170, 192]) g.fillRect(x, 0, 9, 256);
    }
    if (style.lines) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(8, 0, 6, 256);
      g.fillRect(242, 0, 6, 256);
      g.fillStyle = 'rgba(255,214,60,0.95)';
      g.fillRect(125, 0, 6, 120);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  ribbon(from, to, inner, outer, y, uvScale = 12) {
    const positions = [], uvs = [], index = [];
    const count = to - from;
    for (let k = 0; k <= count; k++) {
      const i = (from + k) % this.N;
      const p = this.points[i];
      const s = this.sides[i];
      positions.push(p.x + s.x * outer, p.y + y, p.z + s.z * outer, p.x + s.x * inner, p.y + y, p.z + s.z * inner);
      const v = (k * this.step) / uvScale;
      uvs.push(0, v, 1, v);
    }
    for (let k = 0; k < count; k++) {
      const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
      index.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }

  buildRoad() {
    const hw = this.halfWidth;
    const road = new THREE.Mesh(this.ribbon(0, this.N, -hw, hw, 0.03), new THREE.MeshStandardMaterial({ map: this.roadTexture(), roughness: 0.9 }));
    road.receiveShadow = true;
    this.group.add(road);

    // Curbs
    const cpos = [], ccol = [];
    const [ca, cb] = this.map.road.curbs.map((c) => new THREE.Color(c));
    const at = (i, off, y) => {
      const p = this.points[i % this.N], s = this.sides[i % this.N];
      return [p.x + s.x * off, p.y + y, p.z + s.z * off];
    };
    const W = 1.5;
    for (let i = 0; i < this.N; i++) {
      const col = Math.floor(i / 2) % 2 ? ca : cb;
      for (const [o0, o1] of [[hw + W, hw], [-hw, -hw - W]]) {
        const l0 = at(i, o0, 0.07), r0 = at(i, o1, 0.07), l1 = at(i + 1, o0, 0.07), r1 = at(i + 1, o1, 0.07);
        for (const v of [l0, r0, l1, r0, r1, l1]) {
          cpos.push(...v);
          ccol.push(col.r, col.g, col.b);
        }
      }
    }
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    cgeo.setAttribute('color', new THREE.Float32BufferAttribute(ccol, 3));
    cgeo.computeVertexNormals();
    const curbs = new THREE.Mesh(cgeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    curbs.receiveShadow = true;
    this.group.add(curbs);

    // Jump ramps: chevron-painted deck plus a solid face under the lip.
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#222';
    for (let k = -1; k < 3; k++) {
      g.beginPath();
      g.moveTo(0, k * 64);
      g.lineTo(64, k * 64 + 40);
      g.lineTo(128, k * 64);
      g.lineTo(128, k * 64 + 24);
      g.lineTo(64, k * 64 + 64);
      g.lineTo(0, k * 64 + 24);
      g.fill();
    }
    const rampTex = new THREE.CanvasTexture(c);
    rampTex.wrapT = THREE.RepeatWrapping;
    rampTex.colorSpace = THREE.SRGBColorSpace;
    const rampMat = new THREE.MeshStandardMaterial({ map: rampTex, roughness: 0.6 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    for (const j of this.jumps) {
      const span = (j.end - j.start + this.N) % this.N;
      const deck = new THREE.Mesh(this.ribbon(j.start, j.start + span, -hw * 0.75, hw * 0.75, 0.06, 6), rampMat);
      deck.receiveShadow = deck.castShadow = true;
      this.group.add(deck);
      const p = this.points[j.end], s = this.sides[j.end], t = this.tangents[j.end];
      const face = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.5, j.height, 0.6), faceMat);
      face.position.set(p.x + t.x * 0.3, p.y - j.height / 2 + 0.05, p.z + t.z * 0.3);
      face.rotation.y = Math.atan2(t.x, t.z);
      face.castShadow = true;
      this.group.add(face);
      void s;
    }
  }

  buildStartLine() {
    const { pos, heading } = this.spawn(0);
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = heading;
    this.group.add(g);
    const W = this.map.roadWidth;

    const checker = (w, h, cell) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      for (let y = 0; y < h / cell; y++)
        for (let x = 0; x < w / cell; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      return ctx;
    };
    const lineTex = new THREE.CanvasTexture(checker(256, 32, 16).canvas);
    lineTex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 2.4).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: lineTex, polygonOffset: true, polygonOffsetFactor: -4 })
    );
    line.position.y = 0.06;
    line.receiveShadow = true;
    g.add(line);

    const bctx = checker(512, 128, 16);
    bctx.fillStyle = this.map.accent;
    bctx.fillRect(0, 22, 512, 84);
    bctx.font = 'bold 60px "Lilita One", system-ui, sans-serif';
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.fillStyle = '#fff';
    bctx.fillText(this.map.name.toUpperCase(), 256, 66);
    const bannerTex = new THREE.CanvasTexture(bctx.canvas);
    bannerTex.colorSpace = THREE.SRGBColorSpace;
    const span = W + 8;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(span, 2.8, 0.4), new THREE.MeshStandardMaterial({ map: bannerTex }));
    banner.position.y = 9;
    banner.castShadow = true;
    g.add(banner);
    for (const sx of [-1, 1]) {
      const tower = cloneProp('bannerTowerRed');
      if (tower) {
        tower.scale.setScalar(2.1);
        tower.position.set((sx * span) / 2, 0, 0);
        g.add(tower);
      }
      const wp = new THREE.Vector3((sx * span) / 2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading).add(pos);
      this.addObstacle(wp.x, wp.z, 1.4);
    }
  }

  // Place a prop from the loaded libraries. Returns the object (or null if missing).
  place(name, x, z, { rot = this.rng() * Math.PI * 2, scale = 1, solid = true, radius, y, float = false, sink = 0 } = {}) {
    const obj = cloneProp(name);
    if (!obj) return null;
    const info = assets.manifest.props[name];
    obj.scale.setScalar(scale);
    obj.rotation.y = rot;
    obj.position.set(x, (y ?? this.heightAt(x, z)) - sink, z);
    if (float) {
      this.floaters.push({ obj, baseY: obj.position.y, phase: this.rng() * 6 });
      this.group.add(obj);
    } else {
      this.staticGroup.add(obj);
    }
    if (solid && info) {
      const r = radius ?? (Math.min(info.size[0], info.size[2]) / 2) * scale * 0.85;
      this.addObstacle(x, z, r);
    }
    return obj;
  }

  // Random point beside the track, at least `min` metres from the road edge.
  spotBeside(min, max, { side, index } = {}) {
    for (let tries = 0; tries < 30; tries++) {
      const i = index ?? Math.floor(this.rng() * this.N);
      const sd = side ?? (this.rng() < 0.5 ? -1 : 1);
      const off = this.halfWidth + min + this.rng() * (max - min);
      const p = this.points[i], s = this.sides[i];
      const x = p.x + s.x * off * sd, z = p.z + s.z * off * sd;
      const q = this.nearest(x, z);
      if (q.dist < this.halfWidth + min - 1) continue;
      const sc = this.shortcutAt(x, z);
      if (sc && sc.dist < sc.hw + 10) continue;
      if (this.map.water && this.terrain(x, z, q) < this.map.water.level + 0.4) continue;
      if (this.obstaclesNear(x, z).some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 3)) continue;
      return { x, z, i, side: sd, facing: Math.atan2(-s.x * sd, -s.z * sd) };
    }
    return null;
  }

  // Dense ground cover (grass, flowers, pebbles): thousands of instances, one draw call per
  // mesh per area chunk, no collisions.
  scatterInstanced(names, count, { min = 4, max = 80, scale = [0.8, 1.2], shadows = false } = {}) {
    names = names.filter((n) => assets.props[n]);
    if (!names.length) return;
    const chunks = new Map();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let n = 0; n < count; n++) {
      const spot = this.spotBeside(min, max);
      if (!spot) continue;
      const name = names[Math.floor(this.rng() * names.length)];
      const s = scale[0] + this.rng() * (scale[1] - scale[0]);
      p.set(spot.x, this.heightAt(spot.x, spot.z, spot.i) - 0.05, spot.z);
      q.setFromAxisAngle(up, this.rng() * Math.PI * 2);
      m.compose(p, q, sc.setScalar(s));
      const key = `${name}|${Math.floor(spot.x / CHUNK)},${Math.floor(spot.z / CHUNK)}`;
      if (!chunks.has(key)) chunks.set(key, { name, list: [] });
      chunks.get(key).list.push(m.clone());
    }
    for (const { name, list } of chunks.values()) {
      const tpl = assets.props[name];
      tpl.updateMatrixWorld(true);
      const rootInv = tpl.matrixWorld.clone().invert();
      tpl.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const local = rootInv.clone().multiply(mesh.matrixWorld);
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
        list.forEach((mat, i) => im.setMatrixAt(i, mat.clone().multiply(local)));
        im.computeBoundingSphere();
        im.castShadow = shadows;
        im.receiveShadow = true;
        this.group.add(im);
      });
    }
  }

  // Merge static props per material and per area so they draw in few calls but still get culled.
  finalize() {
    // Nothing may block a shortcut trail.
    const blocks = (x, z, r = 0) => { const sc = this.shortcutAt(x, z); return sc && sc.dist < sc.hw + 1 + r; };
    for (const o of [...this.staticGroup.children]) if (blocks(o.position.x, o.position.z, 1.5)) this.staticGroup.remove(o);
    this.obstacles = this.obstacles.filter((o) => !blocks(o.x, o.z, o.r));
    for (const [k, list] of this.obstacleGrid) this.obstacleGrid.set(k, list.filter((o) => !blocks(o.x, o.z, o.r)));
    this.staticGroup.updateMatrixWorld(true);
    const buckets = new Map();
    this.staticGroup.traverse((o) => {
      if (!o.isMesh) return;
      const e = o.matrixWorld.elements;
      const key = [
        o.material.uuid,
        Object.keys(o.geometry.attributes).sort().join(),
        o.geometry.index ? 1 : 0,
        Math.floor(e[12] / CHUNK),
        Math.floor(e[14] / CHUNK),
      ].join('|');
      if (!buckets.has(key)) buckets.set(key, { material: o.material, geos: [] });
      buckets.get(key).geos.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
    });
    for (const { material, geos } of buckets.values()) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.staticGroup.clear();
  }

  update(dt, time) {
    for (const f of this.floaters) {
      f.obj.position.y = f.baseY + Math.sin(time * 1.2 + f.phase) * 0.35;
      f.obj.rotation.z = Math.sin(time * 0.9 + f.phase) * 0.04;
      f.obj.rotation.x = Math.sin(time * 0.7 + f.phase * 2) * 0.03;
    }
    if (this.waterTex) this.waterTex.offset.set(time * 0.004, time * 0.0025);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh && !sharedGeometries.has(o.geometry)) o.geometry.dispose();
    });
  }
}
