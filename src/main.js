import * as THREE from 'three';
import './style.css';
import { loadCore, assets } from './assets.js';
import { Garage } from './garage.js';
import { Race } from './game.js';
import { MAPS } from './maps.js';
import { readInput, anyKeyDown } from './input.js';
import { Sound } from './audio.js';
import {
  CARS, carStats, DRIVERS, SKILLS, PAINTS, FINISHES, RIMS, TINTS, HEIGHTS, NEON, FLAMES, HAIRS, HAIR_COLORS,
  loadProfile, saveProfile, driverLook,
} from './data.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// --- Renderer ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const sound = new Sound();
addEventListener('keydown', () => sound.init());
addEventListener('pointerdown', () => sound.init());

const hud = {
  lap: $('lap'), time: $('time'), best: $('best'), speed: $('speed'), takedowns: $('takedowns'),
  pos: $('pos'), posOf: $('pos-of'), minimap: $('minimap'), countdown: $('countdown'),
  results: $('results'), resultsList: $('results-list'),
  item: $('item'), itemIcon: $('item-icon'), itemName: $('item-name'), warning: $('warning'),
  skill: $('skill'), skillIcon: $('skill-icon'), skillName: $('skill-name'), skillFill: $('skill-fill'),
  drift: $('drift'), driftFill: $('drift-fill'), wrong: $('wrong-way'), toast: $('toast'),
};
let toastTimer = 0;
function toast(text, secs = 1.4) {
  hud.toast.textContent = text;
  hud.toast.classList.add('on');
  toastTimer = secs;
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id || (id === 'pause' && s.id === 'hud'));
}
function setLoading(frac, text) {
  $('load-fill').style.width = `${Math.round(frac * 100)}%`;
  if (text) $('load-text').textContent = text;
}

// --- App state ----------------------------------------------------------------------------
let profile = loadProfile();
let garage = null;
let race = null;
let mode = 'loading'; // loading | menu | race

async function boot() {
  try {
    await loadCore((f) => setLoading(f, 'Loading cars & drivers…'));
    garage = new Garage(renderer);
    await openMenu();
  } catch (err) {
    console.error(err);
    setLoading(1, 'Could not load the game files. Check the console.');
  }
}

// --- Menu -----------------------------------------------------------------------------------
const TABS = ['Car', 'Paint', 'Wheels', 'Extras', 'Driver', 'Style'];
let tab = 'Car';

async function openMenu() {
  mode = 'menu';
  garage.active = true;
  showScreen('menu');
  renderMenu();
  await garage.show(profile);
}

function update(changes) {
  profile = { ...profile, ...changes };
  saveProfile(profile);
  renderMenu();
  garage.show(profile);
}

function opt(label, sub, on, onClick) {
  const b = document.createElement('button');
  b.className = 'opt' + (on ? ' on' : '');
  b.innerHTML = `${label}${sub ? `<small>${sub}</small>` : ''}`;
  b.onclick = onClick;
  return b;
}
function swatch(color, on, onClick) {
  const b = document.createElement('button');
  b.className = 'swatch' + (on ? ' on' : '') + (color == null ? ' none' : '');
  if (color != null) b.style.background = hex(color);
  b.onclick = onClick;
  return b;
}
function section(body, title, cls, items) {
  const h = document.createElement('h3');
  h.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'grid ' + (cls || '');
  items.forEach((i) => grid.appendChild(i));
  body.append(h, grid);
}

function renderMenu() {
  const tabs = $('tabs');
  tabs.innerHTML = '';
  for (const t of TABS) {
    const b = document.createElement('button');
    b.textContent = t.toUpperCase();
    b.className = t === tab ? 'on' : '';
    b.onclick = () => { tab = t; renderMenu(); };
    tabs.appendChild(b);
  }

  const body = $('tab-body');
  body.innerHTML = '';
  const look = driverLook(profile);
  const restyle = (changes) => update({ look: { ...(profile.look || {}), ...changes } });
  if (tab === 'Car') {
    section(body, 'Choose your ride', '', Object.entries(CARS).map(([id, c]) =>
      opt(c.name, `${c.cls} · ${Math.round(c.topSpeed * 3.6)} km/h`, profile.car === id, () => update({ car: id, paint: c.paint }))));
  } else if (tab === 'Paint') {
    section(body, 'Colour', 'swatches', PAINTS.map((c) => swatch(c, profile.paint === c, () => update({ paint: c }))));
    section(body, 'Finish', '', Object.entries(FINISHES).map(([id, f]) => opt(f.name, '', profile.finish === id, () => update({ finish: id }))));
  } else if (tab === 'Wheels') {
    section(body, 'Rims', '', Object.entries(RIMS).map(([id, r]) => opt(r.name, '', profile.rims === id, () => update({ rims: id }))));
    section(body, 'Ride height', '', Object.entries(HEIGHTS).map(([id, h]) => opt(h.name, '', profile.height === id, () => update({ height: id }))));
    section(body, 'Window tint', '', Object.entries(TINTS).map(([id, t]) => opt(t.name, '', profile.tint === id, () => update({ tint: id }))));
  } else if (tab === 'Extras') {
    section(body, 'Underglow', 'swatches', NEON.map((c) => swatch(c, profile.neon === c, () => update({ neon: c }))));
    section(body, 'Boost flame', 'swatches', FLAMES.map((c) => swatch(c, profile.flame === c, () => update({ flame: c }))));
  } else if (tab === 'Driver') {
    section(body, 'Driver & skill', '', DRIVERS.map((d) =>
      opt(`${SKILLS[d.skill].icon} ${d.name}`, SKILLS[d.skill].name, profile.driver === d.id, () => update({ driver: d.id, look: null }))));
  } else if (tab === 'Style') {
    section(body, 'Body', '', ['male', 'female'].map((b) => opt(b === 'male' ? 'Male' : 'Female', '', look.body === b, () => restyle({ body: b }))));
    section(body, 'Skin', '', [['light', 'Light'], ['dark', 'Dark']].map(([k, n]) => opt(n, '', look.skin === k, () => restyle({ skin: k }))));
    section(body, 'Hair', '', Object.entries(HAIRS).map(([k, n]) => opt(n, '', look.hair === k, () => restyle({ hair: k }))));
    section(body, 'Hair colour', 'swatches', HAIR_COLORS.map((c) => swatch(c, look.hairColor === c, () => restyle({ hairColor: c }))));
    if (look.body === 'male') section(body, 'Beard', '', [[true, 'Beard'], [false, 'Clean']].map(([v, n]) => opt(n, '', look.beard === v, () => restyle({ beard: v }))));
    section(body, 'Suit', 'swatches', PAINTS.map((c) => swatch(c, look.suit === c, () => restyle({ suit: c }))));
    section(body, 'Suit stripes', 'swatches', PAINTS.map((c) => swatch(c, look.accent === c, () => restyle({ accent: c }))));
    section(body, 'Helmet in race', '', [[true, 'On'], [false, 'Off']].map(([v, n]) => opt(n, '', profile.helmet === v, () => update({ helmet: v }))));
  }

  const car = CARS[profile.car];
  $('card-name').textContent = car.name;
  $('card-stats').innerHTML = Object.entries(carStats(profile.car))
    .map(([k, v]) => `<div class="stat"><span>${k}</span><div class="bar"><i style="width:${Math.round(Math.min(1, Math.max(0.06, v)) * 100)}%"></i></div></div>`)
    .join('') + `<div class="stat"><span>Top</span>${Math.round(car.topSpeed * 3.6)} km/h</div>`;
  const d = DRIVERS.find((x) => x.id === profile.driver) || DRIVERS[0];
  const sk = SKILLS[d.skill];
  $('card-driver').innerHTML = `<b>${d.name}</b> — ${sk.icon} ${sk.name}<p>${sk.desc}</p>`;

  const maps = $('maps');
  maps.innerHTML = '';
  for (const m of Object.values(MAPS)) {
    const b = document.createElement('button');
    b.className = 'map-card' + (profile.map === m.id ? ' on' : '');
    b.style.borderLeft = `6px solid ${m.accent}`;
    b.innerHTML = `${m.name}<small>${m.desc}</small>`;
    b.onclick = () => update({ map: m.id });
    maps.appendChild(b);
  }
}

// --- Race -------------------------------------------------------------------------------------
async function startRace() {
  if (mode === 'loading') return;
  mode = 'loading';
  garage.active = false;
  showScreen('loading');
  setLoading(0, `Building ${MAPS[profile.map].name}…`);
  if (race) race.dispose();
  race = new Race({ renderer, sound, profile, hud, toast });
  await new Promise((r) => setTimeout(r, 30)); // let the loading screen paint
  await race.load((f) => setLoading(f));
  showScreen('hud');
  $('help').classList.remove('fade');
  helpFaded = false;
  mode = 'race';
}

function quitToGarage() {
  if (race) race.dispose();
  race = null;
  openMenu();
}

$('race-btn').onclick = startRace;
$('again-btn').onclick = () => race && race.startRace();
$('garage-btn').onclick = quitToGarage;
$('resume-btn').onclick = () => togglePause(false);
$('restart-btn').onclick = () => { togglePause(false); race.startRace(); };
$('quit-btn').onclick = () => { togglePause(false); quitToGarage(); };

function togglePause(on = !race.paused) {
  race.paused = on;
  showScreen(on ? 'pause' : 'hud');
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) toast(sound.toggleMute() ? 'SOUND OFF' : 'SOUND ON', 1);
  if (mode === 'menu' && e.code === 'Enter') startRace();
  if (mode !== 'race' || !race) return;
  if (e.code === 'Escape') togglePause();
  if (e.code === 'KeyT' && !e.repeat) {
    profile = { ...profile, autoGas: !profile.autoGas };
    saveProfile(profile);
    toast(profile.autoGas ? 'AUTO-ACCELERATE ON' : 'AUTO-ACCELERATE OFF', 1.2);
  }
  if (race.state === 'finished' && race.podium) {
    if (e.code === 'Enter') race.startRace();
    if (e.code === 'KeyG') quitToGarage();
  }
});

// --- Loop --------------------------------------------------------------------------------------
let helpFaded = false;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (mode === 'race' && race) {
    const input = readInput();
    if (profile.autoGas && !input.brake) input.throttle = true;
    race.frame(dt, input);
    if (!helpFaded && anyKeyDown() && race.clock > 1) {
      helpFaded = true;
      setTimeout(() => $('help').classList.add('fade'), 5000);
    }
  } else if (mode === 'menu' && garage) {
    readInput();
    garage.frame(dt);
  }
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) hud.toast.classList.remove('on');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  garage?.resize();
  race?.resize();
});

boot();

// Dev hook: fast-forward a race without rendering (used for automated testing).
if (import.meta.env.DEV) {
  window.__dd = {
    get race() { return race; },
    get garage() { return garage; },
    assets,
    get profile() { return profile; },
    startRace,
    update,
    simulate(seconds, auto = true) {
      race.autoPlayer = auto;
      for (let t = 0; t < seconds; t += 1 / 60) race.step(1 / 60);
      race.autoPlayer = false;
      return race.standings.map((r) => ({ name: r.name, lap: r.lap, td: r.takedowns, idx: r.car.trackIndex, wrecked: r.car.wrecked }));
    },
  };
}
