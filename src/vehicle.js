import * as THREE from 'three';
import { assets } from './assets.js';
import { CARS, FINISHES, RIMS, TINTS, HEIGHTS } from './data.js';
import { makePerson } from './characters.js';

export const SPIN_TIME = 1.3;
export const WRECK_TIME = 2.8;
const GRAVITY = 24;
const BOOST_EXTRA = 14;
const WALL_WRECK_SPEED = 34; // head-on impact speed that wrecks you
const IDLE = { throttle: false, brake: false, steer: 0, drift: false };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

// One racer's car: model + customisation + driver + arcade physics.
export class Vehicle {
  constructor(scene, cfg) {
    this.cfg = cfg;
    this.spec = CARS[cfg.car];
    this.info = assets.carInfo[cfg.car];
    this.mass = this.spec.mass;
    this.speedScale = 1;
    this.radius = (this.info.size[0] / 2 + this.info.size[2] / 2) / 2 * 0.95;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.heading = 0;
    this.steer = 0;
    this.yawRate = 0;
    this.trackIndex = 0;
    this.onRoad = true;
    this.airTime = 0;
    this.lastGround = 0;
    this.time = Math.random() * 10;
    this.events = [];

    this.drifting = false;
    this.driftDir = 0;
    this.driftTime = 0;
    this.boost = 0;
    this.bump = 0;
    this.spinTime = 0;
    this.invuln = 0;
    this.shield = 0;
    this.wreckTime = 0;
    this.slamTime = 0;
    this.slamCooldown = 0;
    this.slamDir = 0;
    this.ghost = 0;
    this.monster = 0;
    this.rampage = 0;
    this.lastHitBy = null;
    this.lastHitTime = -10;

    this.mesh = new THREE.Group();
    this.body = new THREE.Group();
    this.mesh.add(this.body);
    this.wheels = [];
    this.materials = [];
    this.buildModel();
    scene.add(this.mesh);
    this.scene = scene;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get driftTier() {
    if (!this.drifting) return -1;
    return this.driftTime > 2 ? 2 : this.driftTime > 0.9 ? 1 : 0;
  }

  get wrecked() {
    return this.wreckTime > 0;
  }

  get airborne() {
    return this.airTime > 0.12;
  }

  get topSpeed() {
    return this.spec.topSpeed;
  }

  // --- Model ------------------------------------------------------------------------------
  buildModel() {
    const cfg = this.cfg;
    const info = this.info;
    const finish = FINISHES[cfg.finish] || FINISHES.gloss;
    const model = assets.cars[cfg.car].clone(true);
    model.position.set(0, 0, 0);

    // Per-car materials (cloned so paint/tint/ghosting don't leak to other cars).
    const cache = new Map();
    const own = (m) => {
      if (cache.has(m)) return cache.get(m);
      let c;
      if (m.name.startsWith('Paint')) {
        c = new THREE.MeshPhysicalMaterial({
          color: cfg.paint ?? this.spec.paint, roughness: finish.roughness, metalness: finish.metalness,
          clearcoat: finish.clearcoat, clearcoatRoughness: 0.06, sheen: finish.sheen || 0, sheenColor: 0xffffff, envMapIntensity: 1.2,
        });
        this.paintMat = c;
      } else {
        c = m.clone();
        if (m.name.startsWith('RB1c_Tire')) {
          const rim = RIMS[cfg.rims];
          if (rim?.color !== undefined) c.color.set(rim.color);
          if (rim?.metal) c.metalness = 1;
        }
        if (m.name.includes('Transperent')) {
          const tint = TINTS[cfg.tint] || TINTS.clear;
          c.transparent = true;
          c.opacity = tint.opacity;
          if (tint.color !== undefined) c.color.set(tint.color);
          c.depthWrite = false;
        }
      }
      cache.set(m, c);
      this.materials.push(c);
      return c;
    };

    const wheelNodes = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
      const tag = o.name.split('_wheel_')[1];
      if (tag) wheelNodes.push({ node: o, tag: tag.slice(0, 2) });
    });
    const topOf = new Map(); // multi-material wheels load as a group; use the node under the car root
    for (const { node } of wheelNodes) {
      let n = node;
      while (n.parent && n.parent !== model) n = n.parent;
      topOf.set(node, n);
    }

    // Wheels live outside the body so the body can pitch/roll over them.
    const done = new Set();
    for (const { node, tag } of wheelNodes) {
      const top = topOf.get(node);
      if (done.has(top)) continue;
      done.add(top);
      const base = new THREE.Vector3().fromArray(info.wheels[tag]);
      const pivot = new THREE.Group();
      pivot.position.copy(base);
      const spin = new THREE.Group();
      pivot.add(spin);
      top.removeFromParent();
      top.position.set(0, 0, 0);
      spin.add(top);
      this.mesh.add(pivot);
      this.wheels.push({ pivot, spin, tag, front: tag[0] === 'f', left: base.x > 0, base });
    }
    const lift = HEIGHTS[cfg.height]?.y || 0;
    model.position.y = lift;
    this.body.add(model);
    this.model = model;

    const size = info.size;
    this.length = size[2];
    this.width = size[0];
    this.height = size[1];
    this.wheelRadius = info.wheelRadius || 0.33;
    const wz = this.wheels.map((w) => w.base.z);
    this.wheelbase = Math.max(...wz) - Math.min(...wz) || 2.6;
    this.rearZ = -size[2] / 2 + 0.15;

    // Driver: a full human in racing gear, seated at the real steering wheel, mocap "Driving" loop.
    const steer = info.steering || [0.34, 0.78, 0.3];
    if (cfg.noDriver) {
      this.anim = { play() {}, update() {}, mixer: { stopAllAction() {} } };
    } else {
      const person = makePerson(cfg.look, { lite: !cfg.detailed });
      this.driver = person.root;
      this.driver.position.set(steer[0], steer[1] - 0.86 + lift, steer[2] - 0.62);
      this.body.add(this.driver);
      this.anim = person.anim;
      this.anim.play('drive');
      this.materials.push(...person.materials);
    }

    if (this.spec.siren) {
      const bar = new THREE.Group();
      const mk = (c, x) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.2), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.2 }));
        m.position.x = x;
        bar.add(m);
        return m;
      };
      this.sirens = [mk(0xff2020, 0.24), mk(0x2050ff, -0.24)];
      bar.position.set(0, size[1] + lift + 0.04, steer[2] - 0.55);
      this.body.add(bar);
    }

    // Underglow
    if (cfg.neon) {
      this.neon = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0] * 1.5, size[2] * 1.15).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: glowTexture(), color: cfg.neon, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      this.neon.position.y = 0.06;
      this.mesh.add(this.neon);
    }

    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(size[0], size[2]) * 0.62, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0x5fd8ff, emissive: 0x2a9df4, emissiveIntensity: 0.6, transparent: true, opacity: 0.3, depthWrite: false })
    );
    this.shieldMesh.position.y = size[1] * 0.45;
    this.shieldMesh.visible = false;
    this.mesh.add(this.shieldMesh);

    this.mesh.traverse((o) => {
      if (o.isMesh && o !== this.neon && o !== this.shieldMesh) o.castShadow = true;
    });
  }

  setGhost(on) {
    for (const m of this.materials) {
      m.transparent = on;
      m.opacity = on ? 0.35 : 1;
      m.depthWrite = !on;
    }
  }

  // --- State changes ------------------------------------------------------------------------
  reset(pos, heading, index) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.heading = heading;
    this.steer = 0;
    this.drifting = false;
    this.driftTime = 0;
    this.boost = 0;
    this.spinTime = 0;
    this.wreckTime = 0;
    this.shield = 0;
    this.ghost = 0;
    this.monster = 0;
    this.rampage = 0;
    this.slamTime = 0;
    this.airTime = 0;
    this.lastGround = pos.y;
    this.groundRate = 0;
    this.events.length = 0;
    if (index !== undefined) this.trackIndex = index;
    this.setGhost(false);
    this.mesh.scale.setScalar(1);
    this.anim.play('drive');
    this.sync(0);
  }

  // A weapon or skill hit. kind: 'spin' | 'wreck'. Returns 'blocked' | 'ignored' | 'hit'.
  hit(kind = 'spin', by = null) {
    if (this.wrecked || this.ghost > 0) return 'ignored';
    if (this.shield > 0) {
      this.shield = 0;
      this.invuln = 1;
      return 'blocked';
    }
    if (this.invuln > 0 || this.monster > 0) return 'ignored';
    if (kind === 'wreck') {
      this.wreck(by);
      return 'hit';
    }
    this.spinTime = SPIN_TIME;
    this.invuln = SPIN_TIME + 1;
    this.drifting = false;
    this.driftTime = 0;
    this.boost = 0;
    this.vel.multiplyScalar(0.35);
    this.anim.play('hitHead', { once: true, then: 'drive' });
    return 'hit';
  }

  // Burnout-style crash: the car tumbles, sheds parts, then respawns on the track.
  wreck(by = null) {
    if (this.wrecked || this.ghost > 0 || this.monster > 0) return false;
    this.wreckTime = WRECK_TIME;
    this.drifting = false;
    this.boost = 0;
    this.rampage = 0;
    this.vy = 7 + this.speed * 0.18;
    this.vel.multiplyScalar(0.75);
    this.wreckSpin = new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 12);
    this.wreckRot = new THREE.Euler(0, 0, 0);
    this.anim.play('die', { once: true });
    const attacker = by || (this.time - this.lastHitTime < 1.6 ? this.lastHitBy : null);
    this.events.push({ type: 'wreck', by: attacker });
    return true;
  }

  slam(dir) {
    if (this.slamCooldown > 0 || this.wrecked || this.spinTime > 0 || this.airborne) return false;
    this.slamTime = 0.28;
    this.slamCooldown = 1.6;
    this.slamDir = dir;
    this.events.push({ type: 'slam' });
    return true;
  }

  // --- Simulation ---------------------------------------------------------------------------
  update(dt, input, track) {
    this.time += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.slamCooldown = Math.max(0, this.slamCooldown - dt);
    this.bump = Math.max(0, this.bump - dt * 3);
    if (this.ghost > 0 && (this.ghost -= dt) <= 0) this.setGhost(false);
    if (this.monster > 0) this.monster = Math.max(0, this.monster - dt);
    if (this.rampage > 0) this.rampage = Math.max(0, this.rampage - dt);

    if (this.wrecked) {
      this.updateWreck(dt, track);
      this.anim.update(dt);
      return;
    }
    if (this.spinTime > 0) {
      this.spinTime = Math.max(0, this.spinTime - dt);
      this.vel.multiplyScalar(Math.exp(-1.5 * dt));
      input = IDLE;
    }

    const q = track.nearest(this.pos.x, this.pos.z, this.trackIndex);
    this.trackIndex = q.index;
    this.onShortcut = track.onShortcut(this.pos.x, this.pos.z);
    this.onRoad = q.dist < track.halfWidth + 1.6 || this.onShortcut;
    const grounded = !this.airborne;
    const spec = this.spec;
    const monsterK = this.monster > 0 ? 1.08 : 1;
    const top = (spec.topSpeed * (this.onRoad ? 1 : spec.offroad) + (this.boost > 0 ? BOOST_EXTRA : 0) + (this.rampage > 0 ? 8 : 0)) * this.speedScale * monsterK;

    let fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const fwdSpeed = this.vel.x * fx + this.vel.z * fz;
    this.steer += (input.steer - this.steer) * Math.min(1, dt * 10);

    if (!this.drifting && input.drift && Math.abs(input.steer) > 0.1 && fwdSpeed > 14 && grounded) {
      this.drifting = true;
      this.driftDir = Math.sign(input.steer);
      this.driftTime = 0;
    }
    if (this.drifting) {
      this.driftTime += grounded ? dt : 0;
      if (!input.drift || fwdSpeed < 8) this.endDrift();
    }

    const handling = spec.handling;
    if (this.drifting) {
      this.yawRate = (this.driftDir * 0.62 + this.steer * 0.55) * (2.1 + handling * 0.5);
    } else {
      const k = clamp(Math.abs(fwdSpeed) / 10, 0, 1) * (1 - 0.35 * clamp(Math.abs(fwdSpeed) / spec.topSpeed, 0, 1));
      this.yawRate = this.steer * (1.5 + handling * 0.8) * k * Math.sign(fwdSpeed);
    }
    if (!grounded) this.yawRate *= 0.3;
    this.heading += this.yawRate * dt;

    fx = Math.sin(this.heading);
    fz = Math.cos(this.heading);
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    let vF = this.vel.x * fx + this.vel.z * fz;
    let vL = this.vel.x * rx + this.vel.z * rz;

    if (grounded) {
      // Power falls off near top speed like a real engine.
      const power = spec.accel * (1 - 0.55 * clamp(vF / spec.topSpeed, 0, 1) ** 2);
      if (input.throttle || this.boost > 0 || this.rampage > 0) vF += (this.boost > 0 || this.rampage > 0 ? power + 16 : power) * dt;
      if (input.brake) vF -= (vF > 0.5 ? 40 : 15) * dt;
      this.braking = input.brake && vF > 8;
      if (!input.throttle && !input.brake && this.boost <= 0) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 4 * dt);
      if (!this.onRoad) vF -= vF * (1.1 - spec.offroad) * dt;
      if (this.drifting) vF -= vF * 0.1 * dt;
      const grip = this.drifting ? 1.5 : (this.onRoad ? 7 + handling * 4 : 4.5);
      vL *= Math.exp(-grip * dt);
    }
    if (vF > top) vF += (top - vF) * Math.min(1, 2 * dt);
    vF = Math.max(vF, -14);

    // Side-slam: a quick sideways lunge (Burnout-style shunt).
    if (this.slamTime > 0) {
      this.slamTime -= dt;
      vL = this.slamDir * 15;
    }

    this.vel.set(fx * vF + rx * vL, 0, fz * vF + rz * vL);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.boost = Math.max(0, this.boost - dt);

    this.collideWorld(track);

    // Vertical: follow the ground, launch off crests and ramps, fall with gravity.
    const q2 = track.nearest(this.pos.x, this.pos.z, this.trackIndex);
    const ground = track.surface(this.pos.x, this.pos.z, q2);
    // Smoothed rate the ground rises under us; single-frame steps (curbs, terrain seams) don't count.
    const rawRate = dt > 0 ? (ground - this.lastGround) / dt : 0;
    this.groundRate = (this.groundRate || 0) + (rawRate - (this.groundRate || 0)) * Math.min(1, dt * 20);
    this.lastGround = ground;
    // Only the built jump ramps launch you. Everywhere else (banks, curbs, dunes) take-off is
    // capped low and extra downforce keeps the car planted.
    const N = track.N;
    const rampNow = this.onRoad && track.jumps.some((j) => ((q2.index - j.start + N) % N) <= ((j.end - j.start + N) % N) + 1);
    const onRamp = rampNow || this.wasOnRamp; // the lip frame is already just past the ramp
    this.wasOnRamp = rampNow;
    if (onRamp && this.airTime === 0) this.rampAir = true;
    const maxLaunch = onRamp ? 30 : Math.min(3, Math.abs(vF) * 0.06 + 0.8);
    this.vy -= GRAVITY * (this.rampAir ? 1 : 2.5) * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      const impact = -this.vy;
      if (this.airTime > 0.45 && impact > 6) this.events.push({ type: 'land', air: this.airTime, impact });
      // Fall damage: ramps are built to be landed; big drops anywhere else hurt.
      const limit = this.rampAir ? 26 : 13;
      if (impact > limit && this.ghost <= 0 && this.monster <= 0) {
        this.pos.y = ground;
        this.wreck();
        return;
      } else if (impact > limit * 0.65) {
        this.vel.multiplyScalar(0.75);
        this.bump = Math.max(this.bump, 0.8);
      }
      this.pos.y = ground;
      this.vy = clamp(this.groundRate, -40, maxLaunch);
      this.airTime = 0;
      if (!onRamp) this.rampAir = false;
    } else {
      this.airTime += dt;
    }

    this.fwdSpeed = vF;
    this.groundQ = q2;
    this.track = track;
    this.anim.update(dt);
    this.sync(dt);
  }

  endDrift() {
    if (this.driftTime > 2) { this.boost = 1.5; this.events.push({ type: 'boost2' }); }
    else if (this.driftTime > 0.9) { this.boost = 0.8; this.events.push({ type: 'boost1' }); }
    this.drifting = false;
    this.driftTime = 0;
  }

  collideWorld(track) {
    for (const o of track.obstaclesNear(this.pos.x, this.pos.z)) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
      const min = o.r + this.radius * 0.8;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      this.pushOut(dx / d, dz / d, min - d, true);
    }
    const isl = track.map.island;
    if (isl) {
      const r = Math.hypot(this.pos.x, this.pos.z);
      const maxR = isl + 30;
      if (r > maxR) this.pushOut(-this.pos.x / r, -this.pos.z / r, r - maxR, false);
    }
  }

  pushOut(nx, nz, depth, solid) {
    this.pos.x += nx * depth;
    this.pos.z += nz * depth;
    const vn = this.vel.x * nx + this.vel.z * nz;
    if (vn >= 0) return;
    if (solid && -vn > WALL_WRECK_SPEED && this.ghost <= 0 && this.monster <= 0 && this.rampage <= 0 && this.invuln <= 0) {
      this.wreck();
      return;
    }
    this.vel.x -= nx * vn * 1.4;
    this.vel.z -= nz * vn * 1.4;
    this.vel.multiplyScalar(0.7);
    if (-vn > 4) {
      this.bump = Math.min(1, -vn / 20);
      this.events.push({ type: 'bump', impact: -vn });
    }
    if (this.drifting) { this.drifting = false; this.driftTime = 0; }
  }

  updateWreck(dt, track) {
    this.wreckTime -= dt;
    this.vel.multiplyScalar(Math.exp(-0.9 * dt));
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    const ground = track.heightAt(this.pos.x, this.pos.z, this.trackIndex) + 0.5;
    if (this.pos.y < ground) {
      this.pos.y = ground;
      if (this.vy < -3) this.events.push({ type: 'tumble', impact: -this.vy });
      this.vy = -this.vy * 0.35;
      this.wreckSpin.multiplyScalar(0.6);
      this.vel.multiplyScalar(0.7);
    }
    this.wreckRot.x += this.wreckSpin.x * dt;
    this.wreckRot.y += this.wreckSpin.y * dt;
    this.wreckRot.z += this.wreckSpin.z * dt;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.wreckRot.x, this.heading + this.wreckRot.y, this.wreckRot.z);

    if (this.wreckTime <= 0) {
      const q = track.nearest(this.pos.x, this.pos.z, this.trackIndex);
      const s = track.spawn(q.index - 4);
      this.reset(s.pos, s.heading, s.index);
      this.invuln = 2.2;
      this.events.push({ type: 'respawn' });
    }
  }

  // --- Visuals --------------------------------------------------------------------------
  sync(dt = 0) {
    this.mesh.position.copy(this.pos);
    const sp = this.spinTime > 0 ? 1 - this.spinTime / SPIN_TIME : 0;
    this.slip = (this.slip || 0) + ((this.drifting ? this.driftDir * 0.3 : 0) - (this.slip || 0)) * Math.min(1, dt * 6);
    this.mesh.rotation.set(0, this.heading + this.slip + (1 - (1 - sp) ** 2) * Math.PI * 4, 0);

    const track = this.track;
    const speed = this.fwdSpeed || 0;
    let pitch = 0, roll = 0;
    if (track && this.groundQ && !this.airborne) {
      // Sample the ground under each wheel: real suspension-like pitch/roll.
      const c = Math.cos(this.heading), s = Math.sin(this.heading);
      const h = {};
      for (const w of this.wheels) {
        const wx = this.pos.x + w.base.x * c + w.base.z * s;
        const wz = this.pos.z - w.base.x * s + w.base.z * c;
        h[w.tag] = track.surface(wx, wz, track.project(wx, wz, this.groundQ.index));
      }
      const front = ((h.fl ?? 0) + (h.fr ?? 0)) / 2, back = ((h.bl ?? 0) + (h.br ?? 0)) / 2;
      const left = ((h.fl ?? 0) + (h.bl ?? 0)) / 2, right = ((h.fr ?? 0) + (h.br ?? 0)) / 2;
      pitch = -Math.atan2(front - back, this.wheelbase);
      roll = Math.atan2(left - right, this.width * 0.8);
      for (const w of this.wheels) {
        const target = clamp((h[w.tag] ?? this.pos.y) - this.pos.y, -0.35, 0.35);
        w.pivot.position.y += (w.base.y + target - w.pivot.position.y) * Math.min(1, dt * 20);
      }
    } else if (this.airborne) {
      pitch = clamp(-Math.atan2(this.vy, Math.max(8, Math.abs(speed))) * 0.7, -0.5, 0.5);
      for (const w of this.wheels) w.pivot.position.y += (w.base.y - 0.25 - w.pivot.position.y) * Math.min(1, dt * 8);
    }
    const lean = clamp(this.yawRate * speed * 0.0035, -0.1, 0.1);
    const k = Math.min(1, dt * 10);
    this.body.rotation.x += (pitch - this.body.rotation.x) * k;
    this.body.rotation.z += (roll + lean - this.body.rotation.z) * k;
    const jitter = this.onRoad ? 0 : Math.sin(this.time * 31) * 0.04 * clamp(Math.abs(speed) / 15, 0, 1);
    this.body.position.y = jitter + Math.sin(sp * Math.PI) * 1.2;

    this.spin = (this.spin || 0) + (speed * dt) / this.wheelRadius;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.spin;
      if (w.front) w.pivot.rotation.y = this.steer * 0.45;
    }

    const big = this.monster > 0 ? 1.6 : 1;
    const sc = this.mesh.scale.x + (big - this.mesh.scale.x) * Math.min(1, dt * 4);
    this.mesh.scale.setScalar(sc);

    if (this.sirens) {
      const on = Math.sin(this.time * 14) > 0;
      this.sirens[0].material.emissiveIntensity = on ? 3 : 0.1;
      this.sirens[1].material.emissiveIntensity = on ? 0.1 : 3;
    }
    if (this.neon) this.neon.material.opacity = this.airborne ? 0.3 : 0.75 + Math.sin(this.time * 8) * 0.1;
    this.shieldMesh.visible = this.shield > 0 && (this.shield > 1.5 || Math.sin(this.time * 30) > 0);
    this.shieldMesh.scale.setScalar(1 + Math.sin(this.time * 6) * 0.04);
    if (this.invuln > 0 && !this.shield && this.spinTime <= 0) this.mesh.visible = Math.sin(this.time * 40) > -0.3;
    else this.mesh.visible = true;
  }

  rearWheels() {
    return this.wheels.filter((w) => !w.front).map((w) => w.pivot.getWorldPosition(new THREE.Vector3()).setY(this.pos.y + 0.15));
  }

  exhaust() {
    return this.mesh.localToWorld(new THREE.Vector3(0, 0.7, this.rearZ));
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.anim.mixer.stopAllAction();
  }
}
