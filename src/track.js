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

// Tiling detail for the terrain: a near-white grain map (multiplies the vertex colours) and a
// bump map with wind ripples for sand, or cracked strata for rock.
function groundDetailTexture(kind) {
  const S = 512;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return [c, c.getContext('2d')];
  };
  const [mc, m] = make();
  m.fillStyle = '#f2f2f2';
  m.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const v = Math.random() < 0.5 ? 200 + Math.random() * 30 : 250 + Math.random() * 5;
    m.fillStyle = `rgba(${v},${v},${v},0.55)`;
    const s = 1 + Math.random() * 2;
    // Wrap so the tile has no seams.
    const x = Math.random() * S, y = Math.random() * S;
    for (const [ox, oy] of [[0, 0], [-S, 0], [0, -S], [-S, -S]]) m.fillRect(x + ox, y + oy, s, s);
  }
  const [bc, b] = make();
  const img = b.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2;
      let h;
      if (kind === 'sand') {
        // Wavy ripples: periodic in both directions so they tile.
        const warp = Math.sin(u * 2 + Math.sin(v * 3) * 0.8) * 0.9 + Math.sin(u * 5) * 0.25;
        h = Math.sin(v * 9 + warp) * 0.5 + 0.5;
        h = Math.pow(h, 1.6);
      } else if (kind === 'grass') {
        // Soft tufts: tileable blotches, no stripes.
        h = (Math.sin(u * 7 + Math.sin(v * 5) * 2) * Math.sin(v * 8 + Math.sin(u * 4) * 2)) * 0.25 + 0.5;
      } else {
        h = Math.abs(Math.sin(v * 6 + Math.sin(u * 3) * 0.6)) * 0.6 + Math.abs(Math.sin(u * 11 + v * 4)) * 0.2;
      }
      h = h * 0.8 + Math.random() * 0.2;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = h * 255;
      img.data[i + 3] = 255;
    }
  b.putImageData(img, 0, 0);
  const wrap = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 16;
    return t;
  };
  return { map: wrap(mc), bump: wrap(bc) };
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
    const segs = 256;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const heights = new Float32Array(pos.count);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const q = this.nearest(x, z);
      const h = this.surface(x, z, q);
      const y = q.dist < this.halfWidth + 1.4 ? q.y - 0.35 : h;
      pos.setY(i, y);
      heights[i] = y;
      m.groundColor(c, x, z, h, q.dist, this.halfWidth);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    this.groundGrid = { heights, segs, size }; // rows run along +z, columns along +x
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // A fine tiling grain on top of the vertex colours, and wind ripples on sand maps.
    const kind = m.groundDetail ?? (m.flatGround ? 'rock' : 'sand');
    const detail = groundDetailTexture(kind);
    const repeat = size / (kind === 'sand' ? 9 : 14);
    detail.map.repeat.set(repeat, repeat);
    detail.bump.repeat.set(repeat, repeat);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, map: detail.map, bumpMap: detail.bump, bumpScale: { sand: 1.5, rock: 1.2, grass: 0.8 }[kind], roughness: 0.95, flatShading: !!m.flatGround })
    );
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // Tropical water: turquoise over the shallows, deep blue offshore, foam where it meets the sand,
  // animated waves with sky reflections and sun glints. Depth comes from the ground heights.
  buildWater() {
    const { heights, segs, size } = this.groundGrid;
    const level = this.map.water.level;
    const n = segs + 1;
    const data = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) data[i * 4] = Math.round(Math.min(1, Math.max(0, (level - heights[i]) / 5)) * 255);
    const depth = new THREE.DataTexture(data, n, n);
    depth.magFilter = depth.minFilter = THREE.LinearFilter;
    depth.needsUpdate = true;

    const base = new THREE.Color(this.map.water.color);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 },
      depthMap: { value: null },
      groundSize: { value: size },
      shallow: { value: new THREE.Color(this.map.water.shallow ?? 0x46e6d6) },
      deep: { value: base },
      skyColor: { value: new THREE.Color(this.map.sky.top).lerp(new THREE.Color(this.map.sky.bottom), 0.45) },
      sunDir: { value: new THREE.Vector3(...this.map.sun.dir).normalize() },
      sunColor: { value: new THREE.Color(this.map.sun.color) },
    }]);
    uniforms.depthMap.value = depth;
    const mat = new THREE.ShaderMaterial({
      uniforms,
      fog: true,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float time, groundSize;
        uniform sampler2D depthMap;
        uniform vec3 shallow, deep, skyColor, sunDir, sunColor;
        varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float waves(vec2 p) {
          float h = noise(p * 0.11 + vec2(time * 0.12, time * 0.07)) * 0.6;
          h += noise(p * 0.27 - vec2(time * 0.18, -time * 0.1)) * 0.3;
          h += noise(p * 0.7 + vec2(time * 0.33, time * 0.21)) * 0.12;
          return h;
        }
        void main() {
          vec2 uv = vWorld.xz / groundSize + 0.5;
          float d = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 1.0 : texture2D(depthMap, uv).r;
          float e = 0.6;
          float h0 = waves(vWorld.xz);
          vec3 nrm = normalize(vec3(h0 - waves(vWorld.xz + vec2(e, 0.0)), e * 1.4, h0 - waves(vWorld.xz + vec2(0.0, e))));
          vec3 view = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(nrm, view), 0.0), 4.0);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 0.55, d));
          col *= 0.9 + h0 * 0.25;
          col = mix(col, skyColor, fres * 0.55);
          float spec = pow(max(dot(reflect(-sunDir, nrm), view), 0.0), 220.0);
          col += sunColor * spec * 6.0;
          // Shore foam: a lapping band plus broken streaks just offshore.
          float lap = sin(d * 90.0 - time * 2.2) * 0.5 + 0.5;
          float foam = smoothstep(0.07, 0.0, d) + smoothstep(0.16, 0.04, d) * step(0.72, lap) * 0.7;
          foam *= smoothstep(0.25, 0.6, noise(vWorld.xz * 0.6 + time * 0.3));
          col = mix(col, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.85);
          float alpha = mix(0.55, 0.96, smoothstep(0.0, 0.25, d));
          gl_FragColor = vec4(col, max(alpha, foam));
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.waterMat = mat;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), mat);
    water.position.y = level;
    this.group.add(water);
  }

  roadTexture() {
    const style = this.map.road;
    const S = 1024;
    const k = S / 256; // the layout below was drawn on a 256 grid
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const g = canvas.getContext('2d');
    g.fillStyle = style.base;
    g.fillRect(0, 0, S, S);
    // Large soft patches, then fine grit, so the surface reads at any distance.
    for (let i = 0; i < 90; i++) {
      const r = 20 + Math.random() * 90;
      const x = Math.random() * S, y = Math.random() * S;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = Math.random() < 0.5;
      grad.addColorStop(0, dark ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 60000; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${0.05 + Math.random() * 0.08})` : `rgba(255,255,255,${0.04 + Math.random() * 0.07})`;
      const s = 1 + Math.random() * 2.5;
      g.fillRect(Math.random() * S, Math.random() * S, s, s);
    }
    if (style.ruts) {
      for (const x of [58, 80, 170, 192]) {
        const grad = g.createLinearGradient(x * k, 0, (x + 9) * k, 0);
        grad.addColorStop(0, 'rgba(60,35,15,0)');
        grad.addColorStop(0.5, 'rgba(60,35,15,0.26)');
        grad.addColorStop(1, 'rgba(60,35,15,0)');
        g.fillStyle = grad;
        g.fillRect(x * k, 0, 9 * k, S);
      }
    }
    // Darker, worn edges.
    for (const [x0, x1] of [[0, 24], [S, S - 24]]) {
      const grad = g.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(Math.min(x0, x1), 0, 24, S);
    }
    if (style.lines) {
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.fillRect(8 * k, 0, 6 * k, S);
      g.fillRect(242 * k, 0, 6 * k, S);
      g.fillStyle = 'rgba(255,214,60,0.95)';
      g.fillRect(125 * k, 0, 6 * k, 120 * k);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
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
    if (this.waterMat) this.waterMat.uniforms.time.value = time;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh && !sharedGeometries.has(o.geometry)) o.geometry.dispose();
    });
  }
}
