import * as THREE from 'three';

// Tyre marks: a ring buffer of thin quads laid under the rear wheels. Dark rubber streaks on
// tarmac when drifting/braking, deeper ruts on sand and dirt. One draw call for every car.
const MAX = 6000;

function rutTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  for (let x = 0; x < 32; x++) {
    const edge = Math.min(x, 31 - x) / 16; // soft edges across the tyre width
    for (let y = 0; y < 64; y += 2) {
      const tread = (y % 8 < 4 ? 0.85 : 0.6) * (0.7 + Math.random() * 0.3);
      g.fillStyle = `rgba(255,255,255,${Math.min(1, edge * 2) * tread})`;
      g.fillRect(x, y, 1, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Skidmarks {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 4 * 3);
    this.col = new Float32Array(MAX * 4 * 4);
    this.uv = new Float32Array(MAX * 4 * 2);
    const idx = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      map: rutTexture(), vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.next = 0;
    this.last = new Map(); // wheel key → previous point
  }

  // Lay a segment for one wheel. strength 0..1 (alpha), color = rubber/sand tint.
  add(key, p, side, width, strength, color) {
    const prev = this.last.get(key);
    this.last.set(key, { p: p.clone(), side: side.clone(), v: prev ? prev.v + p.distanceTo(prev.p) / 1.2 : 0 });
    if (!prev || strength <= 0.02 || prev.p.distanceToSquared(p) > 9) return;
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const w = width / 2;
    const quad = [
      [prev.p, prev.side, w], [prev.p, prev.side, -w], [p, side, w], [p, side, -w],
    ];
    quad.forEach(([q, s, o], k) => {
      this.pos.set([q.x + s.x * o, q.y + 0.03, q.z + s.z * o], (i * 4 + k) * 3);
      this.col.set([color.r, color.g, color.b, strength], (i * 4 + k) * 4);
    });
    const v0 = prev.v, v1 = v0 + p.distanceTo(prev.p) / 1.2;
    this.uv.set([0, v0, 1, v0, 0, v1, 1, v1], i * 8);
    this.dirty = true;
  }

  lift(key) {
    this.last.delete(key);
  }

  update() {
    if (!this.dirty) return;
    for (const a of ['position', 'color', 'uv']) this.geo.attributes[a].needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.pos.fill(0);
    this.col.fill(0);
    this.last.clear();
    this.dirty = true;
  }
}
