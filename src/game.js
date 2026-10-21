import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Track } from './track.js';
import { MAPS } from './maps.js';
import { Vehicle } from './vehicle.js';
import { Racer, AIDriver, LAPS, setLaps } from './race.js';
import { PowerUps, ITEMS } from './powerups.js';
import { Skills, CHARGE } from './skills.js';
import { Particles } from './effects.js';
import { Skidmarks } from './skidmarks.js';
import { renderItemIcons, makeNitro, makeFireball, makeRocket, makeDrum, makeShieldIcon, makeMine } from './itemmodels.js';

// Real 3D renders of each item for the HUD slot (made once).
let itemIcons = null;
const iconFor = (key) => {
  itemIcons ??= renderItemIcons({ boost: makeNitro, fireball: makeFireball, missile: makeRocket, oil: makeDrum, shield: makeShieldIcon, mine: makeMine });
  return itemIcons[key];
};
import { assets, loadTheme } from './assets.js';
import { makePerson } from './characters.js';
import { CARS, DRIVERS, PAINTS, SKILLS, NEON, FLAMES, FINISHES, RIMS, TINTS, HEIGHTS, driverLook } from './data.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th');
const fmt = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const IDLE = { throttle: false, brake: false, steer: 0, drift: false };
const COUNTDOWN = 3;
const OPPONENTS = 5;

export class Race {
  constructor({ renderer, sound, profile, hud, toast, event = null, onFinish = null }) {
    this.renderer = renderer;
    this.sound = sound;
    this.profile = profile;
    this.event = event; // career event, or null for a quick race
    this.onFinish = onFinish;
    this.map = MAPS[event?.map || profile.map] || MAPS.beach;
    this.hud = hud;
    this.toast = toast;
    this.clock = 0;
    this.state = 'loading';
    this.timeScale = 1;
    this.slowmo = 0;
    this.stats = { use: 0, hit: 0, blocked: 0, takedowns: 0, wrecks: 0, skills: 0 };
  }

  async load(progress = () => {}) {
    const map = this.map;
    const playerDriver = DRIVERS.find((d) => d.id === this.profile.driver) || DRIVERS[0];
    const ev = this.event;
    setLaps(ev?.laps ?? 3);
    let rivals = DRIVERS.filter((d) => d !== playerDriver && d.id !== ev?.driver).sort(() => Math.random() - 0.5).slice(0, OPPONENTS);
    if (ev?.mode === 'timetrial') rivals = [];
    if (ev?.mode === 'boss') rivals = [DRIVERS.find((d) => d.id === ev.driver)];
    this.roster = [playerDriver, ...rivals];
    await Promise.all(map.themes.map(loadTheme));
    progress(0.5);

    const scene = (this.scene = new THREE.Scene());
    this.buildSky();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.track = new Track(scene, map);
    map.decorate(this.track);
    this.track.finalize();
    progress(0.8);

    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, map.sky.fogFar + 150);
    this.dust = new Particles(scene, { max: 900, size: 2.2, opacity: 0.5 });
    this.sparks = new Particles(scene, { max: 900, size: 0.5, additive: true });
    this.smoke = new Particles(scene, { max: 300, size: 4, opacity: 0.35 });
    this.skids = new Skidmarks(scene);

    this.buildRacers();
    this.buildSpectators();
    this.debris = [];

    this.powerups = new PowerUps(scene, this.track, this.racers, this.sparks, (e) => this.onItemEvent(e));
    this.skills = new Skills({ scene, track: this.track, racers: this.racers, powerups: this.powerups, onEvent: (e) => this.onItemEvent(e) });
    this.startRace();
    // Time-trial target: a clean lap at ~78% of the car's top speed, scaled by the event's par.
    this.parTime = (this.track.length * LAPS) / (CARS[this.profile.car].topSpeed * 0.78) * (this.event?.par ?? 1) + 2;
    progress(1);
  }

  buildSky() {
    const m = this.map;
    const scene = this.scene;
    const horizon = new THREE.Color(m.sky.bottom);
    scene.background = horizon;
    scene.fog = new THREE.Fog(m.sky.fog, m.sky.fogNear, m.sky.fogFar);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(m.sky.fogFar + 50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        uniforms: { top: { value: new THREE.Color(m.sky.top) }, bottom: { value: horizon }, sunDir: { value: new THREE.Vector3(...m.sun.dir).normalize() } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 bottom;
          uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            float h = pow(max(vDir.y, 0.0), 0.55);
            vec3 col = mix(bottom, top, h);
            float sun = max(dot(normalize(vDir), sunDir), 0.0);
            col += vec3(1.0, 0.85, 0.6) * (pow(sun, 400.0) * 2.0 + pow(sun, 12.0) * 0.25);
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    scene.add(this.sky);

    scene.add(new THREE.HemisphereLight(m.hemi.sky, m.hemi.ground, m.hemi.intensity));
    const sun = (this.sun = new THREE.DirectionalLight(m.sun.color, m.sun.intensity));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 400 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sunOffset = new THREE.Vector3(...m.sun.dir).normalize().multiplyScalar(160);

    // Low-poly clouds drifting overhead.
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, fog: false, emissive: 0xffffff, emissiveIntensity: 0.25 });
    const puff = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 18; i++) {
      const cloud = new THREE.Group();
      const n = 4 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const p = new THREE.Mesh(puff, cloudMat);
        p.scale.set(14 + Math.random() * 14, 8 + Math.random() * 6, 12 + Math.random() * 10);
        p.position.set(k * 16 - n * 8, Math.random() * 6, (Math.random() - 0.5) * 14);
        cloud.add(p);
      }
      const a = Math.random() * Math.PI * 2, r = 250 + Math.random() * 450;
      cloud.position.set(Math.cos(a) * r, 150 + Math.random() * 90, Math.sin(a) * r);
      cloud.rotation.y = Math.random() * Math.PI;
      this.clouds.add(cloud);
    }
    scene.add(this.clouds);
  }

  buildRacers() {
    const p = this.profile;
    const carIds = Object.keys(CARS);
    this.racers = this.roster.map((driver, i) => {
      const isPlayer = i === 0;
      const boss = !isPlayer && this.event?.mode === 'boss';
      const cfg = isPlayer
        ? { ...p, look: driverLook(p), detailed: true }
        : {
            car: boss ? this.event.car : pick(carIds),
            paint: Math.random() < 0.5 ? undefined : pick(PAINTS),
            finish: pick(['gloss', 'metallic', 'metallic', 'pearl', 'matte']),
            rims: pick(Object.keys(RIMS)),
            tint: pick(Object.keys(TINTS)),
            height: pick(Object.keys(HEIGHTS)),
            neon: Math.random() < 0.3 ? pick(NEON) : null,
            flame: pick(FLAMES),
            look: { ...driver.look, helmet: Math.random() < 0.7, helmetColor: driver.look.accent },
          };
      const car = new Vehicle(this.scene, cfg);
      const racer = new Racer(car, isPlayer ? 'YOU' : driver.name, { isPlayer });
      car.racer = racer;
      racer.driver = driver;
      racer.skill = driver.skill;
      racer.color = cfg.paint ?? CARS[cfg.car].paint;
      racer.flame = new THREE.Color(cfg.flame || 0xff8a1a);
      racer.takedowns = 0;
      const base = this.event?.ai ?? 0.945;
      racer.aiSkill = isPlayer ? 0.97 : boss ? base : base + (Math.random() - 0.5) * 0.06;
      racer.ai = new AIDriver(car, { skill: racer.aiSkill, lane: ((i % 3) - 1) * 3, phase: i * 1.7, aggression: boss ? 1 : 0.3 + Math.random() * 0.7 });
      if (boss) racer.name = `${driver.name} · ${this.event.title}`;
      return racer;
    });
    this.player = this.racers[0];
    this.car = this.player.car;
    this.cars = this.racers.map((r) => r.car);
  }

  buildSpectators() {
    this.crowd = [];
    // A handful of real people near the start; distant crowds are implied by the stands.
    const spots = this.track.spectatorSpots.slice(0, 14);
    const casual = [0xf4f4f4, 0x2a6ff7, 0xd81e1e, 0xffd23f, 0x1f8f5f, 0x111111, 0xff7a1a, 0x7f5af0];
    for (const s of spots) {
      const look = { ...pick(DRIVERS).look, helmet: false, suit: pick(casual), accent: pick(casual) };
      const { root, anim } = makePerson(look, { lite: true });
      const y = s.y ?? this.track.heightAt(s.x, s.z);
      root.position.set(s.x, y, s.z);
      root.rotation.y = s.facing + (Math.random() - 0.5) * 0.5;
      this.scene.add(root);
      const idle = pick(['idle', 'idle', 'talk', 'cheer']);
      anim.play(idle, { speed: 0.8 + Math.random() * 0.4 });
      anim.mixer.update(Math.random() * 3);
      this.crowd.push({ root, anim, idle, cooldown: 0 });
    }
  }

  startRace() {
    const N = this.track.N;
    this.racers.forEach((r, i) => {
      const slot = this.racers.length - 1 - i; // player starts at the back, like Beach Buggy
      const row = Math.floor(slot / 2);
      const s = this.track.spawn(N - 8 - row * 6, slot % 2 ? -3.8 : 3.8);
      r.car.reset(s.pos, s.heading, s.index);
      r.reset(s.index);
      r.takedowns = 0;
    });
    this.powerups.reset();
    this.skids?.clear();
    this.skills.reset();
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris = [];
    this.removePodium();
    this.state = 'countdown';
    this.countdown = COUNTDOWN;
    this.standings = this.racers;
    this.wrongTime = 0;
    this.camMode = 'chase';
    this.timeScale = 1;
    this.slowmo = 0;
    this.camPos = null;
    this.hud.results.classList.remove('on');
    this.placeCamera(0, true);
  }

  // --- Events --------------------------------------------------------------------------------
  near(pos) {
    return Math.max(0, 1 - pos.distanceTo(this.car.pos) / 140) ** 1.5;
  }

  onItemEvent(e) {
    if (e.type in this.stats) this.stats[e.type]++;
    const who = e.racer || e.victim;
    const vol = who.isPlayer ? 1 : this.near(who.car.pos);
    const s = this.sound;
    if (e.type === 'pickup') s.play('pickup', who.isPlayer ? 1 : vol * 0.4);
    if (e.type === 'got' && who.isPlayer) s.play('ready');
    if (e.type === 'use') s.play(e.item, e.racer.isPlayer ? 1 : vol * 0.8);
    if (e.type === 'skill') {
      this.stats.skills++;
      s.play('skill', vol);
      if (e.skill === 'shockwave') s.play('shockwave', vol);
      if (e.skill === 'thunder') s.play('thunder', Math.max(vol, 0.6));
      if (e.racer.isPlayer) this.toast(`${SKILLS[e.skill].icon} ${SKILLS[e.skill].name.toUpperCase()}!`, 1.4);
      else if (vol > 0.3) this.toast(`${e.racer.name}: ${SKILLS[e.skill].name}!`, 1.2);
    }
    if (e.type === 'hit') {
      if (e.kind !== 'wreck') s.play(e.item === 'oil' ? 'oil' : 'explosion', e.victim.isPlayer ? 1 : vol);
      if (e.attacker && e.attacker !== e.victim) this.skills.charge(e.attacker, CHARGE.itemHit);
      const what = ITEMS[e.item]?.name || SKILLS[e.item]?.name || e.item;
      if (e.victim.isPlayer && e.kind !== 'wreck') this.toast(e.attacker?.isPlayer ? 'OOPS!' : `${e.attacker?.name}'s ${what} got you!`, 1.6);
      else if (e.attacker?.isPlayer && e.kind !== 'wreck') this.toast(`HIT ${e.victim.name.toUpperCase()}!`, 1.2);
    } else if (e.type === 'blocked') {
      s.play('blocked', vol);
      if (e.victim.isPlayer) this.toast('SHIELD BLOCKED IT!', 1.2);
    }
  }

  onCarEvents(r) {
    const car = r.car;
    const vol = r.isPlayer ? 1 : this.near(car.pos);
    for (const e of car.events.splice(0)) {
      switch (e.type) {
        case 'boost1':
          if (r.isPlayer) { this.toast('BOOST!', 0.8); this.sound.play('boost'); }
          break;
        case 'boost2':
          if (r.isPlayer) { this.toast('SUPER BOOST!', 1); this.sound.play('superboost'); }
          break;
        case 'bump':
          if (r.isPlayer) this.sound.play('bump', Math.min(1, e.impact / 15));
          break;
        case 'slam':
          this.sound.play('slam', vol);
          break;
        case 'land':
          this.sound.play('land', vol * Math.min(1, e.impact / 12));
          if (r.isPlayer && e.air > 0.9) {
            this.toast(`BIG AIR! ${e.air.toFixed(1)}s`, 1.2);
            car.boost = Math.max(car.boost, 0.6);
          }
          break;
        case 'tumble':
          this.sound.play('bump', vol * Math.min(1, e.impact / 10));
          this.burst(car.pos, 10, true);
          break;
        case 'wreck':
          this.onWreck(r, e.by?.racer);
          break;
        case 'respawn':
          r.lastIndex = car.trackIndex;
          if (r.isPlayer) this.camMode = 'chase';
          break;
      }
    }
  }

  onWreck(victim, attacker) {
    this.stats.wrecks++;
    this.sound.play('crash', victim.isPlayer ? 1 : Math.max(0.15, this.near(victim.car.pos)));
    this.spawnDebris(victim.car);
    this.burst(victim.car.pos, 40, false);
    if (attacker && attacker !== victim) {
      attacker.takedowns++;
      this.stats.takedowns++;
      this.skills.charge(attacker, CHARGE.takedown);
      attacker.car.boost = Math.max(attacker.car.boost, 1.5);
      attacker.car.anim.play('punch', { once: true, then: 'drive', speed: 1.3 });
      if (attacker.isPlayer) {
        this.sound.play('takedown');
        this.toast(`💥 TAKEDOWN! ${victim.name.toUpperCase()}`, 1.8);
        this.slowmo = Math.max(this.slowmo, 0.6);
      } else if (victim.isPlayer) {
        this.toast(`WRECKED BY ${attacker.name.toUpperCase()}!`, 2);
      }
    } else if (victim.isPlayer) {
      this.toast('WRECKED!', 1.6);
    }
    if (victim.isPlayer) {
      this.camMode = 'crash';
      this.crashAngle = Math.atan2(this.camera.position.x - victim.car.pos.x, this.camera.position.z - victim.car.pos.z);
      this.slowmo = Math.max(this.slowmo, 1.2);
    }
  }

  // A wrecked car sheds one of its real wheels plus shards of paint and glass.
  spawnDebris(car) {
    this.shardGeo ??= new THREE.TetrahedronGeometry(0.22, 0);
    this.glassMat ??= new THREE.MeshStandardMaterial({ color: 0xcfe8ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.7 });
    const wheel = car.wheels[Math.floor(Math.random() * car.wheels.length)];
    const parts = [wheel.spin.clone(true)];
    for (let i = 0; i < 9; i++) {
      const shard = new THREE.Mesh(this.shardGeo, i % 3 ? car.paintMat : this.glassMat);
      shard.scale.set(0.5 + Math.random() * 1.6, 0.15 + Math.random() * 0.4, 0.5 + Math.random() * 1.4);
      parts.push(shard);
    }
    for (const mesh of parts) {
      if (this.debris.length > 60) this.scene.remove(this.debris.shift().mesh);
      mesh.castShadow = true;
      mesh.position.copy(car.pos).setY(car.pos.y + 0.8);
      this.scene.add(mesh);
      this.debris.push({
        mesh, life: 4,
        vel: new THREE.Vector3((Math.random() - 0.5) * 18, 6 + Math.random() * 10, (Math.random() - 0.5) * 18).addScaledVector(car.vel, 0.5),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
      });
    }
  }

  burst(pos, n, dustOnly) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set((Math.random() - 0.5) * 12, 2 + Math.random() * 6, (Math.random() - 0.5) * 12);
      this.dust.emit(pos, v, this.map.id === 'town' ? new THREE.Color(0xbbbbbb) : new THREE.Color(0xe8cf9c), 1.2);
      if (!dustOnly) {
        this.sparks.emit(pos, v.clone().multiplyScalar(1.6), new THREE.Color(0xffb02e), 0.6);
        if (i % 3 === 0) this.smoke.emit(pos, v.clone().multiplyScalar(0.3).setY(3), new THREE.Color(0x444444), 2.5);
      }
    }
  }

  // --- Simulation ---------------------------------------------------------------------------
  collideCars() {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++)
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (a.wrecked || b.wrecked || a.ghost > 0 || b.ghost > 0) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 2.5) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius * a.mesh.scale.x + b.radius * b.mesh.scale.x;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, nz = dz / d;
        const ma = a.mass * (a.monster > 0 ? 4 : 1), mb = b.mass * (b.monster > 0 ? 4 : 1);
        const pen = min - d;
        a.pos.x -= nx * pen * (mb / (ma + mb)); a.pos.z -= nz * pen * (mb / (ma + mb));
        b.pos.x += nx * pen * (ma / (ma + mb)); b.pos.z += nz * pen * (ma / (ma + mb));
        const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
        if (rel >= 0) continue;
        const jImp = (-(1.3) * rel) / (1 / ma + 1 / mb);
        const dva = jImp / ma, dvb = jImp / mb;
        a.vel.x -= nx * dva; a.vel.z -= nz * dva;
        b.vel.x += nx * dvb; b.vel.z += nz * dvb;
        a.lastHitBy = b; a.lastHitTime = a.time;
        b.lastHitBy = a; b.lastHitTime = b.time;
        const brutal = (c) => c.rampage > 0 || c.monster > 0;
        const settled = this.state !== 'countdown' && this.clock - this.raceStart > 4; // no grid pile-ups
        if (!settled) { /* bump only */ }
        else if (brutal(a)) b.wreck(a);
        else if (brutal(b)) a.wreck(b);
        else {
          // Only brutal hits wreck: a big T-bone/rear-end or a committed side-slam.
          if (dvb > 21 || (a.slamTime > 0 && dvb > 11)) b.wreck(a);
          if (dva > 21 || (b.slamTime > 0 && dva > 11)) a.wreck(b);
        }
        if (-rel > 5) {
          for (const c of [a, b]) c.bump = Math.max(c.bump, Math.min(0.7, -rel / 22));
          if (a === this.car || b === this.car) this.sound.play('bump', Math.min(1, -rel / 15));
          const mid = new THREE.Vector3((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2 + 0.8, (a.pos.z + b.pos.z) / 2);
          for (let k = 0; k < 8; k++) this.sparks.emit(mid, new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10), new THREE.Color(0xffe08a), 0.4);
        }
      }
  }

  step(dt, playerInput = IDLE) {
    this.clock += dt;
    const N = this.track.N;
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.raceStart = this.clock;
        const ev = this.event;
        const goal = !ev ? 'GO!' : ev.mode === 'boss' ? `BEAT ${ev.title.toUpperCase()}!` : ev.mode === 'takedowns' ? `GO! WRECK ${ev.target.join(' / ')} RIVALS` : ev.mode === 'timetrial' ? `GO! TARGET ${fmt(this.parTime)}` : 'GO! FINISH TOP 3';
        this.toast(goal, 2);
        this.sound.play('go');
      } else if (Math.ceil(this.countdown) !== before) {
        this.sound.play('beep');
      }
    }
    const go = this.state !== 'countdown';
    const auto = this.autoPlayer;
    const inputs = this.racers.map((r) => {
      if (!go) return IDLE;
      if (r.isPlayer && !r.finished && !auto) return playerInput;
      return r.ai.input(this.track, this.cars, this.clock);
    });

    // Rubber-banding keeps the pack together.
    const pp = this.player.progress(N);
    for (const r of this.racers) {
      if (r.isPlayer) continue;
      const gap = this.player.finished ? 0 : (r.progress(N) - pp) / N;
      r.car.speedScale = r.aiSkill + clamp(-gap * 0.3, -0.07, 0.1);
    }

    // Slams
    this.racers.forEach((r, i) => {
      const inp = inputs[i];
      if (!inp.slam) return;
      let dir = r.isPlayer ? Math.sign(inp.steer) : inp.slam;
      if (r.isPlayer && !dir) {
        // Aim at the nearest rival beside us.
        let best = Infinity;
        for (const o of this.cars) {
          if (o === r.car) continue;
          const dx = o.pos.x - r.car.pos.x, dz = o.pos.z - r.car.pos.z;
          const side = dx * Math.cos(r.car.heading) - dz * Math.sin(r.car.heading);
          const dd = Math.hypot(dx, dz);
          if (dd < best && dd < 12) { best = dd; dir = Math.sign(side) || 1; }
        }
      }
      r.car.slam(dir || 1);
    });

    const steps = Math.ceil(dt / (1 / 120));
    for (let s = 0; s < steps; s++) {
      this.racers.forEach((r, i) => r.car.update(dt / steps, inputs[i], this.track));
      this.collideCars();
    }

    for (const r of this.racers) {
      this.onCarEvents(r);
      const ev = r.update(N, this.clock);
      if (r.isPlayer) {
        if (ev?.type === 'lap') {
          this.toast(r.lap === LAPS ? 'FINAL LAP!' : ev.best ? `BEST LAP ${fmt(ev.time)}` : `LAP ${fmt(ev.time)}`, 2);
          this.sound.play(r.lap === LAPS ? 'final' : 'lap');
        }
        if (ev?.type === 'finish') {
          this.state = 'finished';
          const place = this.racers.filter((o) => o.finished).length;
          this.toast(`${ordinal(place)} PLACE!`, 3);
          this.sound.play('finish');
          this.finishTimer = 2.2;
          this.result = { place, takedowns: r.takedowns, time: this.clock - this.raceStart, parTime: this.parTime };
          this.onFinish?.(this.result);
        }
      } else if (!r.car.wrecked) {
        const lost = r.car.speed < 2 || this.track.nearest(r.car.pos.x, r.car.pos.z, r.car.trackIndex).dist > 30;
        r.stuck = go && lost ? r.stuck + dt : 0;
        if (r.stuck > 2.5) {
          const s = this.track.spawn(r.car.trackIndex);
          r.car.reset(s.pos, s.heading, s.index);
          r.lastIndex = s.index;
          r.stuck = 0;
        }
      }
    }
    this.standings = [...this.racers].sort((a, b) => b.progress(N) - a.progress(N));

    if (playerInput.use && this.state === 'racing') this.powerups.use(this.player, this.standings);
    if (playerInput.skill && this.state === 'racing') this.skills.use(this.player, this.standings);
    this.powerups.autoPlayer = this.skills.autoPlayer = auto;
    this.powerups.update(dt, this.standings, go);
    this.skills.update(dt, this.standings, go);

    const along = this.car.vel.dot(this.track.tangents[this.car.trackIndex]);
    this.wrongTime = go && along < -3 && !this.car.wrecked ? this.wrongTime + dt : 0;

    if (this.state === 'finished' && this.finishTimer > 0 && (this.finishTimer -= dt) <= 0) this.showPodium();
  }

  // --- Camera ---------------------------------------------------------------------------------
  placeCamera(dt, snap = false) {
    const car = this.car;
    const cam = this.camera;
    if (this.podium) {
      const p = this.podium;
      const a = this.clock * 0.15;
      cam.position.set(p.center.x + Math.sin(a) * 16, p.center.y + 6, p.center.z + Math.cos(a) * 16);
      cam.lookAt(p.center.x, p.center.y + 2.5, p.center.z);
      return;
    }
    if (this.camMode === 'crash') {
      this.crashAngle += dt * 0.7;
      const target = car.pos;
      cam.position.set(target.x + Math.sin(this.crashAngle) * 14, target.y + 5, target.z + Math.cos(this.crashAngle) * 14);
      cam.position.y = Math.max(cam.position.y, this.track.heightAt(cam.position.x, cam.position.z) + 2);
      cam.lookAt(target.x, target.y + 1, target.z);
      return;
    }
    const f = car.forward;
    const speedK = Math.min(1, car.speed / car.topSpeed);
    // Beach Buggy-style: tight and low behind the car, pulling back a little with speed.
    const back = car.length * 0.85 + 1.4 + speedK * 1.6;
    const up = 0.9 + car.height * 0.55 + speedK * 0.2;
    const desired = car.pos.clone().addScaledVector(f, -back);
    desired.y += up;
    const look = car.pos.clone().addScaledVector(f, 4.5);
    look.y += 0.75;
    if (!this.camPos || snap) {
      this.camPos = desired.clone();
      this.camLook = look.clone();
    }
    this.camPos.lerp(desired, 1 - Math.exp(-7 * dt));
    this.camLook.lerp(look, 1 - Math.exp(-12 * dt));
    this.camPos.y = Math.max(this.camPos.y, this.track.heightAt(this.camPos.x, this.camPos.z, car.trackIndex) + 1.6);
    this.shake = Math.max(this.shake || 0, car.bump);
    cam.position.copy(this.camPos);
    if (this.shake > 0.01) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0));
    this.shake *= Math.exp(-8 * dt);
    cam.lookAt(this.camLook);
    const fov = 66 + speedK * 14 + (car.boost > 0 || car.rampage > 0 ? 8 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
  }

  // --- Effects ----------------------------------------------------------------------------------
  spawnEffects(dt) {
    const tmp = new THREE.Vector3();
    const SPARK = [new THREE.Color(0xfff2b0), new THREE.Color(0x3fb6ff), new THREE.Color(0xff7a1a)];
    const dustCol = this.map.id === 'town' ? new THREE.Color(0xcfcfcf) : this.map.id === 'canyon' ? new THREE.Color(0xd9a070) : new THREE.Color(0xe8cf9c);
    for (const r of this.racers) {
      const c = r.car;
      if (c.wrecked) {
        if (Math.random() < dt * 20) this.smoke.emit(c.pos, tmp.set((Math.random() - 0.5) * 2, 4, (Math.random() - 0.5) * 2), new THREE.Color(0x333333), 2);
        continue;
      }
      if (c.pos.distanceToSquared(this.car.pos) > 160 * 160) continue;
      const tier = c.driftTier;
      const kicked = (c.drifting || (!c.onRoad && c.speed > 8)) && !c.airborne;
      const boosting = c.boost > 0 || c.rampage > 0;
      if (!kicked && tier < 0 && !boosting) continue;
      const wheels = c.rearWheels();
      if (kicked && Math.random() < dt * 40) {
        for (const w of wheels) {
          tmp.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3).addScaledVector(c.vel, -0.15);
          this.dust.emit(w, tmp, dustCol, 0.9 + Math.random() * 0.5);
        }
      }
      if (tier >= 0 && !c.airborne) {
        const n = tier === 0 ? 1 : 3;
        for (let i = 0; i < n; i++)
          for (const w of wheels) {
            tmp.set((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6);
            this.sparks.emit(w, tmp, SPARK[tier], 0.25 + Math.random() * 0.2);
          }
      }
      if (boosting) {
        const ex = c.exhaust();
        for (let i = 0; i < (c.rampage > 0 ? 6 : 3); i++) {
          tmp.copy(c.forward).multiplyScalar(-6 - Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2));
          this.sparks.emit(ex, tmp, r.flame, 0.2 + Math.random() * 0.15);
        }
      }
    }
    this.layTyreMarks();
    this.dust.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);

    for (const d of this.debris) {
      d.life -= dt;
      d.vel.y -= 24 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      const g = this.track.heightAt(d.mesh.position.x, d.mesh.position.z) + 0.2;
      if (d.mesh.position.y < g) {
        d.mesh.position.y = g;
        d.vel.multiplyScalar(0.5);
        d.vel.y = Math.abs(d.vel.y) * 0.3;
        d.spin.multiplyScalar(0.5);
      }
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.life < 0.5) d.mesh.scale.setScalar(Math.max(0.01, d.life * 2));
    }
    this.debris = this.debris.filter((d) => {
      if (d.life > 0) return true;
      this.scene.remove(d.mesh);
      return false;
    });
  }

  layTyreMarks() {
    const rubber = new THREE.Color(0x0b0b0b);
    const soil = this.map.id === 'town' ? new THREE.Color(0x3a2e1c) : this.map.id === 'canyon' ? new THREE.Color(0x6e3f22) : new THREE.Color(0x8a6a40);
    for (const r of this.racers) {
      const c = r.car;
      const side = new THREE.Vector3(Math.cos(c.heading), 0, -Math.sin(c.heading));
      const offRoad = !c.onRoad || c.onShortcut;
      let strength = 0, color = rubber;
      if (!c.wrecked && !c.airborne && c.speed > 4) {
        if (offRoad) { strength = 0.55; color = soil; }
        else if (c.drifting) strength = 0.5 + c.driftTime * 0.1;
        else if (c.braking || c.spinTime > 0) strength = 0.45;
      }
      c.rearWheels().forEach((w, k) => {
        const key = r.name + k;
        if (strength > 0) this.skids.add(key, w.setY(this.track.heightAt(w.x, w.z, c.trackIndex)), side, offRoad ? 0.42 : 0.3, Math.min(0.85, strength), color);
        else this.skids.lift(key);
      });
    }
    this.skids.update();
  }

  updateCrowd(dt) {
    const camPos = this.camera.position;
    for (const c of this.crowd) {
      const d2 = c.root.position.distanceToSquared(camPos);
      if (d2 > 260 * 260) continue;
      c.cooldown -= dt;
      if (c.cooldown <= 0) {
        // Cheer when a car flies past.
        for (const car of this.cars) {
          if (car.speed > 15 && car.pos.distanceToSquared(c.root.position) < 30 * 30) {
            c.anim.play(Math.random() < 0.5 ? 'jump' : 'cheer', { once: true, then: c.idle, speed: 1.1 });
            c.cooldown = 3 + Math.random() * 2;
            break;
          }
        }
      }
      c.anim.update(dt);
    }
  }

  // --- Podium ------------------------------------------------------------------------------------
  showPodium() {
    const spot = this.track.spotBeside(26, 30, { index: 4, side: -1 }) || this.track.spotBeside(30, 50);
    if (!spot) return;
    const g = new THREE.Group();
    const y = this.track.heightAt(spot.x, spot.z);
    g.position.set(spot.x, y, spot.z);
    g.rotation.y = spot.facing;
    const order = [1, 0, 2];
    const heights = [2.2, 1.5, 1.0];
    const colors = [0xffd23f, 0xd9d9d9, 0xcd7f32];
    const finishers = [...this.standings];
    order.forEach((place, k) => {
      const r = finishers[place];
      if (!r) return;
      const block = new THREE.Mesh(new THREE.BoxGeometry(3.2, heights[place], 3.2), new THREE.MeshStandardMaterial({ color: colors[place], metalness: 0.4, roughness: 0.35 }));
      block.position.set((k - 1) * 3.4, heights[place] / 2, 0);
      block.castShadow = block.receiveShadow = true;
      g.add(block);
      const look = r.isPlayer ? { ...driverLook(this.profile), helmet: false } : { ...r.driver.look, helmet: false };
      const { root, anim } = makePerson(look);
      root.position.set((k - 1) * 3.4, heights[place], 0);
      g.add(root);
      anim.play(place === 0 ? 'cheer' : 'talk', { speed: place === 0 ? 1 : 0.9 });
      this.crowd.push({ root, anim, idle: place === 0 ? 'cheer' : 'talk', cooldown: 999 });
    });
    this.scene.add(g);
    this.podium = { group: g, center: new THREE.Vector3(spot.x, y, spot.z) };
    this.podiumConfetti = 6;
    this.hud.results.classList.add('on');
  }

  removePodium() {
    if (!this.podium) return;
    this.scene.remove(this.podium.group);
    this.crowd = this.crowd.filter((c) => c.cooldown !== 999);
    this.podium = null;
  }

  // --- Frame ---------------------------------------------------------------------------------------
  // Auto quality: if the first seconds of racing run slow, drop to cheaper shadows and resolution.
  adaptQuality(realDt) {
    if (this.qualityChecked || this.state !== 'racing') return;
    this.fpsSamples = (this.fpsSamples || 0) + 1;
    this.fpsTime = (this.fpsTime || 0) + realDt;
    if (this.fpsTime < 3) return;
    this.qualityChecked = true;
    const fps = this.fpsSamples / this.fpsTime;
    if (fps < 45) {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.sun.shadow.mapSize.set(1024, 1024);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.scene.fog.far *= 0.8;
      this.camera.far = this.scene.fog.far + 150;
      this.lowQuality = true;
    }
  }

  frame(realDt, input) {
    this.adaptQuality(realDt);
    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.slowmo > 0) {
      this.slowmo -= realDt;
      this.timeScale += (0.3 - this.timeScale) * Math.min(1, realDt * 10);
    } else {
      this.timeScale += (1 - this.timeScale) * Math.min(1, realDt * 4);
    }
    const dt = realDt * this.timeScale;
    if (input.reset && this.state === 'racing' && !this.player.finished && !this.car.wrecked) {
      const s = this.track.spawn(this.car.trackIndex);
      this.car.reset(s.pos, s.heading, s.index);
      this.player.lastIndex = s.index;
      this.placeCamera(0, true);
    }
    this.step(dt, input);
    this.spawnEffects(dt);
    this.updateCrowd(dt);
    this.track.update(dt, this.clock);
    this.placeCamera(dt);
    if (this.podium && this.podiumConfetti > 0) {
      this.podiumConfetti -= dt;
      const c = this.podium.center;
      for (let i = 0; i < 4; i++)
        this.sparks.emit(new THREE.Vector3(c.x + (Math.random() - 0.5) * 8, c.y + 9, c.z + (Math.random() - 0.5) * 8),
          new THREE.Vector3((Math.random() - 0.5) * 4, -2, (Math.random() - 0.5) * 4), new THREE.Color().setHSL(Math.random(), 0.9, 0.6), 2);
    }

    this.sky.position.copy(this.camera.position);
    this.clouds.rotation.y += dt * 0.004;
    const focus = this.podium ? this.podium.center : this.car.pos;
    this.sun.position.copy(focus).add(this.sunOffset);
    this.sun.target.position.copy(focus);
    this.sound.update(this.car, this.player.finished ? this.car.speed > 5 : input.throttle, this.state !== 'countdown');
    this.updateHud(realDt);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(dt) {
    const h = this.hud;
    const p = this.player;
    const car = this.car;
    h.speed.textContent = Math.round(car.speed * 3.6);
    if (h.speedFill) h.speedFill.style.width = `${Math.min(100, (car.speed / (car.topSpeed + 14)) * 100)}%`;
    h.lap.textContent = `${clamp(p.lap, 1, LAPS)}/${LAPS}`;
    h.time.textContent = fmt(p.finished || p.lap === 0 ? 0 : this.clock - p.lapStart);
    h.best.textContent = p.best < Infinity ? fmt(p.best) : '--';
    h.takedowns.textContent = p.takedowns;
    const place = this.standings.indexOf(p) + 1;
    h.pos.textContent = place;
    if (h.posSuffix) h.posSuffix.textContent = ordinal(place).slice(String(place).length).toUpperCase();
    h.posOf.textContent = `/ ${this.racers.length}`;

    const tier = car.driftTier;
    h.drift.classList.toggle('on', tier >= 0);
    if (tier >= 0) {
      h.driftFill.style.width = `${Math.min(1, car.driftTime / 2) * 100}%`;
      h.driftFill.style.background = ['#fff', '#3fb6ff', '#ff7a1a'][tier];
    }
    h.wrong.classList.toggle('on', this.wrongTime > 1.2);

    const ICONS = Object.keys(ITEMS);
    const tick = Math.floor(this.clock * 14);
    const shownKey = p.rolling > 0 ? ICONS[tick % ICONS.length] : p.item;
    const shown = shownKey ? ITEMS[shownKey] : null;
    if (p.rolling > 0 && tick !== this.lastTick) this.sound.play('tick');
    this.lastTick = tick;
    if (this.iconKey !== shownKey) {
      this.iconKey = shownKey;
      h.itemIcon.innerHTML = shownKey ? `<img src="${iconFor(shownKey)}" alt="">` : '';
    }
    h.itemName.textContent = p.rolling > 0 ? '…' : shown ? shown.name : 'No item';
    h.item.classList.toggle('ready', this.powerups.canUse(p) && !p.finished);
    h.item.classList.toggle('empty', !shown);
    h.warning.classList.toggle('on', this.powerups.projectiles.some((pr) => pr.type === 'missile' && pr.target === p));

    const sk = SKILLS[p.skill];
    h.skillIcon.textContent = sk.icon;
    h.skillName.textContent = sk.name;
    h.skillFill.style.width = `${(p.skillCharge || 0) * 100}%`;
    h.skill.classList.toggle('ready', this.skills.ready(p) && !p.finished);

    const n = Math.ceil(this.countdown);
    h.countdown.textContent = this.state === 'countdown' && n <= COUNTDOWN ? n : '';

    if (this.state === 'finished') {
      const pl = this.standings.indexOf(this.player) + 1;
      h.resultsTitle.textContent = this.player.finished ? `${ordinal(pl).toUpperCase()} PLACE` : 'RESULTS';
      h.resultsEvent.textContent = this.event ? `${this.event.name} · ${this.map.name}` : `Quick race · ${this.map.name}`;
      h.resultsList.innerHTML = this.standings
        .map((r, i) => {
          const time = r.finished ? fmt(r.finishTime - this.raceStart) : 'racing…';
          return `<li class="${r.isPlayer ? 'me' : ''}"><span>${ordinal(i + 1)}</span><i style="background:${hex(r.color)}"></i><b>${r.isPlayer ? 'YOU' : r.name}</b><small>💥${r.takedowns}</small><em>${time}</em></li>`;
        })
        .join('');
    }
    this.drawMinimap();
  }

  drawMinimap() {
    const canvas = this.hud.minimap;
    const g = canvas.getContext('2d');
    if (!this.mm) {
      const b = this.track.points.reduce(
        (a, p) => ({ minX: Math.min(a.minX, p.x), maxX: Math.max(a.maxX, p.x), minZ: Math.min(a.minZ, p.z), maxZ: Math.max(a.maxZ, p.z) }),
        { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
      );
      const scale = (canvas.width - 24) / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
      this.mm = { b, scale };
    }
    const { b, scale } = this.mm;
    const X = (x) => canvas.width - 12 - (x - b.minX) * scale;
    const Y = (z) => canvas.height - 12 - (z - b.minZ) * scale;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.lineJoin = 'round';
    g.beginPath();
    this.track.points.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z))));
    g.closePath();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 6;
    g.stroke();
    for (const r of [...this.racers].sort((a, c) => a.isPlayer - c.isPlayer)) {
      g.beginPath();
      g.arc(X(r.car.pos.x), Y(r.car.pos.z), r.isPlayer ? 6 : 4.5, 0, Math.PI * 2);
      g.fillStyle = r.car.wrecked ? '#555' : hex(r.color);
      g.fill();
      g.strokeStyle = r.isPlayer ? '#fff' : 'rgba(0,0,0,0.5)';
      g.lineWidth = 2;
      g.stroke();
    }
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.powerups.dispose();
    for (const c of this.cars) c.dispose();
    this.track.dispose();
    this.scene.traverse((o) => {
      if (o.isMesh && o.geometry && !o.geometry.userData?.keep) {
        /* template geometries are shared; leave them */
      }
    });
    this.scene.environment?.dispose();
  }
}
