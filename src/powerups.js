import * as THREE from 'three';
import { makeRocket, makeFireball, makeMine, makeDrum, oilMaterial, makeItemBox } from './itemmodels.js';

export const ITEMS = {
  boost: { icon: '🚀', name: 'Rocket Boost' },
  fireball: { icon: '🔥', name: 'Fireball' },
  missile: { icon: '🎯', name: 'Homing Missile' },
  oil: { icon: '🛢️', name: 'Oil Slick' },
  shield: { icon: '🛡️', name: 'Shield' },
  mine: { icon: '💣', name: 'Mine' },
};

const BOX_ROWS = [0.12, 0.38, 0.62, 0.86]; // fraction of the lap
const BOX_LANES = [-6, -2, 2, 6];
const BOX_RESPAWN = 3;
const PICKUP_RADIUS = 2.8;
const HIT_RADIUS = 2.6;
const OIL_RADIUS = 2.8;
const MINE_RADIUS = 2.4;
const FIREBALL_SPEED = 70;
const MISSILE_SPEED = 64;

const FIRE = new THREE.Color(0xff8a1a);
const SMOKE = new THREE.Color(0xff5533);
const BOX_SPARK = new THREE.Color(0xffe066);

function boxTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#ff5fa2');
  grad.addColorStop(0.5, '#ffb03a');
  grad.addColorStop(1, '#3fc8ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 120, 120);
  g.font = 'bold 84px "Lilita One", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Where `other` sits relative to `car`: metres ahead, metres to the left, distance.
export function relative(car, other) {
  const dx = other.pos.x - car.pos.x, dz = other.pos.z - car.pos.z;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  return { ahead: dx * fx + dz * fz, side: dx * fz - dz * fx, dist: Math.hypot(dx, dz) };
}

export class PowerUps {
  constructor(scene, track, racers, sparks, onEvent) {
    this.scene = scene;
    this.track = track;
    this.racers = racers;
    this.sparks = sparks;
    this.onEvent = onEvent;
    this.N = track.N;
    this.step = track.step;
    this.projectiles = [];
    this.hazards = [];
    this.tmp = new THREE.Vector3();
    this.time = 0;

    const boxTemplate = makeItemBox();
    this.boxes = [];
    for (const row of BOX_ROWS) {
      let s = Math.round(row * this.N);
      if (track.jumps.some((j) => Math.abs(s - j.end) < 30)) s += 40;
      for (const lane of BOX_LANES) {
        const mesh = boxTemplate.clone();
        const pos = this.trackPos(s, lane, new THREE.Vector3());
        pos.y += 1.6;
        mesh.position.copy(pos);
        scene.add(mesh);
        this.boxes.push({ mesh, pos, hidden: 0, phase: Math.random() * 6 });
      }
    }

    this.fireTemplate = makeFireball();
    this.missileTemplate = makeRocket();
    this.mineTemplate = makeMine();
    this.drumTemplate = makeDrum();
    this.oilMat = oilMaterial();

    this.reset();
  }

  reset() {
    for (const p of [...this.projectiles, ...this.hazards]) this.scene.remove(p.mesh);
    this.projectiles = [];
    this.hazards = [];
    for (const b of this.boxes) b.hidden = 0;
    for (const r of this.racers) {
      r.item = null;
      r.pending = null;
      r.rolling = 0;
      r.held = 0;
      r.patience = 1 + Math.random() * 2;
    }
  }

  dispose() {
    for (const p of [...this.projectiles, ...this.hazards]) this.scene.remove(p.mesh);
    for (const b of this.boxes) this.scene.remove(b.mesh);
  }

  // Point on the track at fractional sample `s`, `lane` metres left of centre (y = road surface).
  trackPos(s, lane, out) {
    const N = this.N;
    const i0 = ((Math.floor(s) % N) + N) % N;
    const i1 = (i0 + 1) % N;
    const f = s - Math.floor(s);
    const a = this.track.points[i0], b = this.track.points[i1];
    const side = this.track.sides[i0];
    return out.set(a.x + (b.x - a.x) * f + side.x * lane, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f + side.z * lane);
  }

  // Weighted roll: leaders get defensive items, stragglers get the good stuff.
  roll(place, total) {
    const t = total > 1 ? (place - 1) / (total - 1) : 0;
    const weights = {
      boost: 1 + 2 * t,
      fireball: 2,
      missile: place === 1 ? 0 : 0.5 + 3 * t,
      oil: 2.2 - 1.4 * t,
      shield: 1.5 - 0.5 * t,
      mine: 1.4 - 0.8 * t,
    };
    let pick = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
    for (const [item, w] of Object.entries(weights)) if ((pick -= w) <= 0) return item;
    return 'boost';
  }

  canUse(r) {
    return r.item && r.rolling <= 0 && r.car.spinTime <= 0 && !r.car.wrecked;
  }

  launchMissile(owner, target) {
    const car = owner.car;
    const mesh = this.missileTemplate.clone();
    mesh.position.copy(car.pos).add(new THREE.Vector3(0, 2.2, 0));
    this.scene.add(mesh);
    this.projectiles.push({
      type: 'missile', mesh, owner, target, age: 0, life: target ? 7 : 3,
      vel: car.forward.multiplyScalar(MISSILE_SPEED),
    });
  }

  addMine(owner, x, z) {
    const mesh = this.mineTemplate.clone();
    mesh.userData.led = mesh.children.find((c) => c.position.x > 0.3);
    mesh.userData.led.material = mesh.userData.led.material.clone();
    mesh.position.set(x, this.track.heightAt(x, z, owner.car.trackIndex) + 0.02, z);
    mesh.rotation.y = Math.random() * 6;
    this.scene.add(mesh);
    this.hazards.push({ type: 'mine', mesh, owner, age: 0, life: 30 });
  }

  use(r, standings) {
    if (!this.canUse(r)) return;
    const car = r.car;
    const item = r.item;
    r.item = null;
    const f = car.forward;
    if (item === 'boost') {
      car.boost = Math.max(car.boost, 1.4);
    } else if (item === 'shield') {
      car.shield = 8;
    } else if (item === 'oil') {
      const mesh = new THREE.Mesh(this.oilGeometry(), this.oilMat);
      const x = car.pos.x - f.x * (car.length * 0.7), z = car.pos.z - f.z * (car.length * 0.7);
      mesh.position.set(x, this.track.heightAt(x, z, car.trackIndex) + 0.05, z);
      mesh.scale.setScalar(0.01);
      // The tipped-over drum it poured out of.
      const drum = this.drumTemplate.clone();
      drum.rotation.set(Math.PI / 2, 0, Math.random() * 6);
      drum.position.set(0.6, 0.29, 0.3);
      mesh.add(drum);
      this.scene.add(mesh);
      this.hazards.push({ type: 'oil', mesh, owner: r, age: 0, life: 25 });
    } else if (item === 'mine') {
      this.addMine(r, car.pos.x - f.x * car.length * 0.8, car.pos.z - f.z * car.length * 0.8);
    } else if (item === 'fireball') {
      const idx = car.trackIndex;
      const p = this.track.points[idx], side = this.track.sides[idx];
      const lane = (car.pos.x - p.x) * side.x + (car.pos.z - p.z) * side.z;
      const mesh = this.fireTemplate.clone();
      this.scene.add(mesh);
      this.projectiles.push({
        type: 'fireball', mesh, owner: r, age: 0, life: 2.6,
        s: idx + (car.length * 0.8) / this.step, lane, speed: Math.max(FIREBALL_SPEED, car.speed + 24),
      });
    } else if (item === 'missile') {
      const place = standings.indexOf(r);
      this.launchMissile(r, place > 0 ? standings[place - 1] : null);
    }
    this.onEvent({ type: 'use', racer: r, item });
  }

  oilGeometry() {
    const geo = new THREE.CircleGeometry(OIL_RADIUS, 48).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
    for (let i = 1; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const k = 0.82 + Math.sin(a * 3 + ph[0]) * 0.1 + Math.sin(a * 5 + ph[1]) * 0.06 + Math.sin(a * 9 + ph[2]) * 0.03; // smooth splash outline
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    return geo;
  }

  hit(victim, attacker, item) {
    const kind = item === 'missile' ? 'wreck' : 'spin';
    const result = victim.car.hit(kind, attacker?.car);
    if (result === 'ignored') return;
    victim.car.bump = Math.max(victim.car.bump, 0.8);
    this.onEvent({ type: result, victim, attacker, item, kind });
    for (let i = 0; i < 20; i++) {
      this.tmp.set((Math.random() - 0.5) * 14, 3 + Math.random() * 8, (Math.random() - 0.5) * 14);
      this.sparks.emit(victim.car.pos.clone().setY(victim.car.pos.y + 1), this.tmp, result === 'blocked' ? BOX_SPARK : FIRE, 0.5);
    }
  }

  update(dt, standings, racing) {
    this.time += dt;
    const total = this.racers.length;

    for (const b of this.boxes) {
      if (b.hidden > 0) {
        b.hidden -= dt;
        b.mesh.scale.setScalar(b.hidden > 0 ? 0.001 : 0.2);
        continue;
      }
      b.mesh.scale.setScalar(Math.min(1, b.mesh.scale.x + dt * 3));
      b.mesh.rotation.set(0.5, this.time * 1.5 + b.phase, 0.3);
      b.mesh.position.y = b.pos.y + Math.sin(this.time * 2.5 + b.phase) * 0.25;
      if (!racing) continue;
      for (const r of this.racers) {
        if (r.car.wrecked) continue;
        const dx = r.car.pos.x - b.pos.x, dz = r.car.pos.z - b.pos.z;
        if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS || Math.abs(r.car.pos.y + 1 - b.pos.y) > 4) continue;
        b.hidden = BOX_RESPAWN;
        for (let i = 0; i < 14; i++) {
          this.tmp.set((Math.random() - 0.5) * 10, 2 + Math.random() * 6, (Math.random() - 0.5) * 10);
          this.sparks.emit(b.pos, this.tmp, BOX_SPARK, 0.5);
        }
        if (!r.item && r.rolling <= 0) {
          r.pending = this.roll(standings.indexOf(r) + 1, total);
          r.rolling = r.isPlayer ? 1.1 : 0.5;
          this.onEvent({ type: 'pickup', racer: r });
        }
        break;
      }
    }

    for (const r of this.racers) {
      if (r.rolling > 0 && (r.rolling -= dt) <= 0) {
        r.item = r.pending;
        r.pending = null;
        r.held = 0;
        r.patience = 1 + Math.random() * 2;
        this.onEvent({ type: 'got', racer: r, item: r.item });
      }
      if (r.item && r.rolling <= 0) r.held += dt;
      const aiControlled = !r.isPlayer || r.finished || this.autoPlayer;
      if (racing && aiControlled && this.wantsToUse(r)) this.use(r, standings);
    }

    this.updateProjectiles(dt);
    this.updateHazards(dt);
  }

  wantsToUse(r) {
    if (!this.canUse(r) || r.held < 0.4) return false;
    const car = r.car;
    const others = this.racers.filter((o) => o !== r).map((o) => relative(car, o.car));
    switch (r.item) {
      case 'boost':
        return r.held > r.patience && car.onRoad && car.speed > 15;
      case 'shield':
        return r.held > r.patience * 0.5 || this.projectiles.some((p) => p.target === r);
      case 'fireball':
        return others.some((o) => o.ahead > 4 && o.ahead < 60 && Math.abs(o.side) < 4) || r.held > 8;
      case 'missile':
        return r.held > r.patience + 0.5;
      case 'oil':
      case 'mine':
        return others.some((o) => o.ahead < -2 && o.ahead > -30 && Math.abs(o.side) < 5) || r.held > 10;
    }
    return false;
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      p.age += dt;
      const pos = p.mesh.position;
      if (p.type === 'fireball') {
        p.s += (p.speed * dt) / this.step;
        this.trackPos(p.s, p.lane, pos);
        pos.y += 1.1 + Math.abs(Math.sin(p.age * 9)) * 0.7;
        p.mesh.rotation.x += dt * 10;
        this.tmp.set((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2);
        this.sparks.emit(pos, this.tmp, FIRE, 0.35);
      } else {
        if (p.target && !p.target.finished && !p.target.car.wrecked) {
          const t = p.target.car.pos;
          const desired = this.tmp.set(t.x - pos.x, t.y + 1 - pos.y, t.z - pos.z).normalize().multiplyScalar(MISSILE_SPEED);
          p.vel.lerp(desired, 1 - Math.exp(-(2 + p.age * 3) * dt)).setLength(MISSILE_SPEED);
        }
        pos.addScaledVector(p.vel, dt);
        pos.y = Math.max(pos.y, this.track.heightAt(pos.x, pos.z) + 1);
        p.mesh.lookAt(this.tmp.copy(pos).add(p.vel));
        this.tmp.copy(p.vel).multiplyScalar(-0.15);
        this.sparks.emit(pos, this.tmp, SMOKE, 0.3);
      }

      for (const r of this.racers) {
        if (r === p.owner || r.car.wrecked) continue;
        if (p.type === 'missile' && p.target && r !== p.target) continue;
        const c = r.car.pos;
        const d2 = (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2;
        if (d2 < HIT_RADIUS * HIT_RADIUS && Math.abs(c.y + 1 - pos.y) < 3) {
          this.hit(r, p.owner, p.type);
          p.age = p.life;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => {
      if (p.age < p.life) return true;
      this.scene.remove(p.mesh);
      return false;
    });
  }

  updateHazards(dt) {
    for (const h of this.hazards) {
      h.age += dt;
      if (h.type === 'oil') {
        const grow = Math.min(1, h.age / 0.3);
        const fade = Math.min(1, (h.life - h.age) / 1);
        h.mesh.scale.setScalar(Math.max(0.01, grow * fade));
      } else {
        h.mesh.userData.led.material.emissiveIntensity = Math.sin(h.age * 8) > 0 ? 5 : 0.2;
      }
      const R = h.type === 'oil' ? OIL_RADIUS : MINE_RADIUS;
      for (const r of this.racers) {
        if (r === h.owner && h.age < 1.5) continue;
        if (r.car.spinTime > 0 || r.car.invuln > 0 || r.car.wrecked) continue;
        const dx = r.car.pos.x - h.mesh.position.x, dz = r.car.pos.z - h.mesh.position.z;
        if (dx * dx + dz * dz < R * R && Math.abs(r.car.pos.y - h.mesh.position.y) < 3) {
          this.hit(r, h.owner, h.type);
          if (h.type === 'mine') h.age = h.life;
        }
      }
    }
    this.hazards = this.hazards.filter((h) => {
      if (h.age < h.life) return true;
      this.scene.remove(h.mesh);
      if (h.type === 'oil') h.mesh.geometry.dispose();
      return false;
    });
  }
}
