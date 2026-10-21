import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const tex = dotTexture();

export class Particles {
  constructor(scene, { max = 500, size = 1, opacity = 1, additive = false } = {}) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3).fill(-9999);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.gravity = additive ? -6 : 1.5;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size,
        map: tex,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p, v, color, life) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
  }

  update(dt) {
    const damp = Math.exp(-2 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -9999;
        continue;
      }
      this.vel[j] *= damp;
      this.vel[j + 2] *= damp;
      this.vel[j + 1] += this.gravity * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
