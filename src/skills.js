import * as THREE from 'three';
import { relative } from './powerups.js';

// Charge sources (fraction of a full meter).
export const CHARGE = { perSecond: 0.012, drift: 0.07, air: 0.14, takedown: 0.4, itemHit: 0.15 };

// Special skills, one per driver (see data.js). Visual effects are short-lived meshes.
export class Skills {
  constructor({ scene, track, racers, powerups, onEvent }) {
    this.scene = scene;
    this.track = track;
    this.racers = racers;
    this.powerups = powerups;
    this.onEvent = onEvent;
    this.effects = [];
    this.tractors = [];
    this.mineDrops = [];
    this.ringGeo = new THREE.TorusGeometry(1, 0.35, 8, 48).rotateX(Math.PI / 2);
    this.boltMat = new THREE.LineBasicMaterial({ color: 0xbfe9ff });
  }

  reset() {
    for (const e of this.effects) this.scene.remove(e.mesh);
    this.effects = [];
    this.tractors = [];
    this.mineDrops = [];
    for (const r of this.racers) {
      r.skillCharge = 0;
      r.skillWait = 0;
    }
  }

  charge(r, amount) {
    if (r.finished) return;
    r.skillCharge = Math.min(1, (r.skillCharge || 0) + amount);
  }

  ready(r) {
    return r.skillCharge >= 1 && !r.car.wrecked && r.car.spinTime <= 0;
  }

  use(r, standings) {
    if (!this.ready(r)) return false;
    r.skillCharge = 0;
    const car = r.car;
    const place = standings.indexOf(r);
    const ahead = (n) => standings.slice(Math.max(0, place - n), place).filter((o) => !o.car.wrecked);

    switch (r.skill) {
      case 'nitro':
        car.rampage = 3.5;
        car.boost = 3.5;
        break;
      case 'ghost':
        car.ghost = 4;
        car.boost = Math.max(car.boost, 2);
        car.setGhost(true);
        break;
      case 'monster':
        car.monster = 5;
        break;
      case 'shockwave': {
        this.ring(car.pos, 0x7fd8ff, 30);
        for (const o of this.racers) {
          if (o === r) continue;
          const d = o.car.pos.distanceTo(car.pos);
          if (d < 6) this.strike(o, r, 'wreck', 'shockwave');
          else if (d < 30) this.strike(o, r, 'spin', 'shockwave');
        }
        break;
      }
      case 'barrage': {
        const targets = place > 0 ? ahead(3) : standings.slice(1, 3);
        if (!targets.length) targets.push(null);
        targets.forEach((t, i) => setTimeout(() => this.powerups.launchMissile(r, t), i * 180));
        break;
      }
      case 'thunder': {
        const targets = place > 0 ? ahead(3) : [];
        for (const t of targets) {
          this.bolt(t.car.pos);
          this.strike(t, r, 'spin', 'thunder');
        }
        if (!targets.length) this.bolt(car.pos.clone().add(car.forward.multiplyScalar(30)));
        break;
      }
      case 'mines':
        this.mineDrops.push({ racer: r, left: 5, timer: 0 });
        break;
      case 'tractor': {
        const target = ahead(1)[0];
        if (target) this.tractors.push({ racer: r, target, time: 3, line: this.beam() });
        else car.boost = 2;
        break;
      }
    }
    car.anim.play('cast', { once: true, then: 'drive', speed: 1.4 });
    this.onEvent({ type: 'skill', racer: r, skill: r.skill });
    return true;
  }

  strike(victim, attacker, kind, skill) {
    const res = victim.car.hit(kind, attacker.car);
    if (res !== 'ignored') this.onEvent({ type: res, victim, attacker, item: skill, kind, skill: true });
  }

  ring(pos, color, radius) {
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.copy(pos).setY(pos.y + 1);
    this.scene.add(mesh);
    this.effects.push({ mesh, age: 0, life: 0.6, update: (e) => {
      const k = e.age / e.life;
      mesh.scale.setScalar(1 + k * radius);
      mesh.material.opacity = 0.8 * (1 - k);
    } });
  }

  bolt(pos) {
    const pts = [];
    let x = pos.x, z = pos.z;
    for (let y = 60; y >= 0; y -= 6) {
      pts.push(new THREE.Vector3(x, pos.y + y, z));
      x += (Math.random() - 0.5) * 4;
      z += (Math.random() - 0.5) * 4;
    }
    pts.push(pos.clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.boltMat);
    this.scene.add(line);
    this.effects.push({ mesh: line, age: 0, life: 0.35, update: (e) => { line.visible = Math.sin(e.age * 60) > -0.5; } });
    this.ring(pos, 0xbfe9ff, 6);
  }

  beam() {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xff2bd6 }));
    this.scene.add(line);
    return line;
  }

  update(dt, standings, racing) {
    for (const e of this.effects) {
      e.age += dt;
      e.update(e);
    }
    this.effects = this.effects.filter((e) => {
      if (e.age < e.life) return true;
      this.scene.remove(e.mesh);
      return false;
    });

    for (const m of this.mineDrops) {
      m.timer -= dt;
      if (m.timer <= 0 && m.left > 0) {
        const c = m.racer.car, f = c.forward;
        this.powerups.addMine(m.racer, c.pos.x - f.x * c.length * 0.8, c.pos.z - f.z * c.length * 0.8);
        m.left--;
        m.timer = 0.4;
      }
    }
    this.mineDrops = this.mineDrops.filter((m) => m.left > 0);

    for (const t of this.tractors) {
      t.time -= dt;
      const a = t.racer.car, b = t.target.car;
      const pts = t.line.geometry.attributes.position;
      pts.setXYZ(0, a.pos.x, a.pos.y + 1.2, a.pos.z);
      pts.setXYZ(1, b.pos.x, b.pos.y + 1.2, b.pos.z);
      pts.needsUpdate = true;
      const dir = new THREE.Vector3().subVectors(b.pos, a.pos).setY(0);
      const d = dir.length();
      if (!a.wrecked && !b.wrecked && d > 0.1) a.vel.addScaledVector(dir.normalize(), 40 * dt);
      if (d < a.radius + b.radius + 1.5 && !b.wrecked) {
        this.strike(t.target, t.racer, 'wreck', 'tractor');
        t.time = 0;
      }
      if (t.time <= 0 || b.wrecked || a.wrecked) this.scene.remove(t.line);
    }
    this.tractors = this.tractors.filter((t) => t.time > 0 && !t.target.car.wrecked && !t.racer.car.wrecked);

    if (!racing) return;
    for (const r of this.racers) {
      this.charge(r, CHARGE.perSecond * dt);
      if (r.car.drifting) this.charge(r, CHARGE.drift * dt);
      if (r.car.airborne) this.charge(r, CHARGE.air * dt);
      if ((!r.isPlayer || r.finished || this.autoPlayer) && this.aiWants(r, standings, dt)) this.use(r, standings);
    }
  }

  aiWants(r, standings, dt) {
    if (!this.ready(r)) return false;
    r.skillWait = (r.skillWait || 0) + dt;
    const car = r.car;
    const rel = this.racers.filter((o) => o !== r && !o.car.wrecked).map((o) => relative(car, o.car));
    const place = standings.indexOf(r);
    switch (r.skill) {
      case 'shockwave':
        return rel.some((o) => o.dist < 18) || r.skillWait > 8;
      case 'mines':
        return rel.some((o) => o.ahead < -5 && o.ahead > -50) || r.skillWait > 8;
      case 'tractor':
        return (place > 0 && rel.some((o) => o.ahead > 10 && o.ahead < 90)) || r.skillWait > 10;
      case 'barrage':
      case 'thunder':
        return place > 0 || r.skillWait > 6;
      default:
        return car.onRoad && car.speed > 20;
    }
  }
}
