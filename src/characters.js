import * as THREE from 'three';
import { assets, clonePerson } from './assets.js';
import { HAIRS } from './data.js';

// Friendly names → mocap clips from Quaternius' Universal Animation Library.
const CLIPS = {
  drive: 'Driving_Loop',
  idle: 'Idle_Loop',
  talk: 'Idle_Talking_Loop',
  cheer: 'Dance_Loop',
  die: 'Death01',
  hit: 'Hit_Chest',
  hitHead: 'Hit_Head',
  punch: 'Punch_Cross',
  jab: 'Punch_Jab',
  jump: 'Jump_Start',
  walk: 'Walk_Loop',
  sit: 'Sitting_Idle_Loop',
  cast: 'Spell_Simple_Shoot',
  interact: 'Interact',
};

// Plays the shared mocap clips on any person (they all use the same 65-bone rig).
export class Animator {
  constructor(root) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    this.current = null;
    this.next = null;
  }

  get(name) {
    const clip = assets.clips[CLIPS[name] || name];
    if (!this.actions[name] && clip) this.actions[name] = this.mixer.clipAction(clip);
    return this.actions[name];
  }

  // Loop `name`, or with `once` play it a single time and then return to `then`.
  play(name, { once = false, then = null, fade = 0.25, speed = 1 } = {}) {
    const a = this.get(name);
    if (!a) return;
    if (a === this.current && !once) {
      a.timeScale = speed;
      return;
    }
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.timeScale = speed;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, false);
    a.play();
    this.current = a;
    this.next = once ? then : null;
  }

  update(dt) {
    this.mixer.update(dt);
    if (this.next && this.current && !this.current.isRunning()) {
      const n = this.next;
      this.next = null;
      this.play(n);
    }
  }
}

export const PATTERNS = { stripes: 'Classic', split: 'Split', chevron: 'Chevron', checker: 'Checkered', flames: 'Flames', camo: 'Camo' };
const PATTERN_ID = { stripes: 0, split: 1, chevron: 2, checker: 3, flames: 4, camo: 5 };

// Race number + name for the back and chest of the suit (and the helmet sides).
const decalCache = new Map();
function numberDecal(number, name) {
  const key = number + name;
  if (decalCache.has(key)) return decalCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = 'bold 150px "Arial Black", Arial, sans-serif';
  g.fillText(String(number), 128, 175);
  g.font = 'bold 40px "Arial Black", Arial, sans-serif';
  g.fillText(name.toUpperCase(), 128, 236);
  const t = new THREE.CanvasTexture(c);
  decalCache.set(key, t);
  return t;
}

// Suit shader. Vertex colour R (color_1) is a smooth "panel" field baked in Blender; object-space
// position drives the other patterns, and a number decal is projected on the back and chest.
function suitMaterial(base, look) {
  const m = base.clone();
  m.vertexColors = false;
  m.color.set(0xffffff);
  const u = {
    suitPrimary: { value: new THREE.Color(look.suit) },
    suitAccent: { value: new THREE.Color(look.accent) },
    suitPattern: { value: PATTERN_ID[look.pattern] ?? 0 },
    suitDecal: { value: numberDecal(look.number ?? 7, look.name ?? '') },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color_1;\nvarying float vAccent;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAccent = color_1.r;\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 suitPrimary; uniform vec3 suitAccent; uniform int suitPattern; uniform sampler2D suitDecal;
varying float vAccent; varying vec3 vObj;
float aa(float v) { float e = fwidth(v); return smoothstep(-e, e, v); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float panel = aa(vAccent - 0.5);
float m = panel;
if (suitPattern == 1) m = max(aa(vObj.x) * (1.0 - panel), panel * (1.0 - aa(vObj.x)));
else if (suitPattern == 2) { float c = fract((vObj.y - abs(vObj.x) * 0.9) * 4.0); m = max(panel, aa(c - 0.5) * step(0.85, vObj.y) * step(vObj.y, 1.5)); }
else if (suitPattern == 3) { float k = mod(floor(vObj.x * 14.0) + floor(vObj.y * 14.0) + floor(vObj.z * 14.0), 2.0); m = panel * k + (1.0 - panel) * 0.0; m = max(m, step(vObj.y, 0.35) * k); }
else if (suitPattern == 4) { float f = 0.62 + 0.14 * sin(vObj.x * 31.0 + vObj.z * 23.0) + 0.07 * sin(vObj.x * 67.0 - vObj.z * 41.0); m = max(panel * step(1.1, vObj.y), aa(f - vObj.y)); }
else if (suitPattern == 5) { float n = sin(vObj.x * 9.0) * sin(vObj.y * 7.0 + 1.3) * sin(vObj.z * 11.0 + 2.1) + 0.35 * sin(vObj.x * 23.0 + vObj.y * 19.0); m = aa(n - 0.05); }
vec3 suit = mix(suitPrimary, suitAccent, m);
// Number decal: big on the back, small on the chest.
vec2 duv = vec2(-1.0);
if (vObj.z < -0.04 && abs(vObj.x) < 0.2 && vObj.y > 1.0 && vObj.y < 1.42) duv = vec2(0.5 + vObj.x / 0.4, (vObj.y - 1.0) / 0.42);
if (vObj.z > 0.04 && vObj.x > 0.04 && vObj.x < 0.18 && vObj.y > 1.28 && vObj.y < 1.42) duv = vec2((vObj.x - 0.04) / 0.14, (vObj.y - 1.28) / 0.14);
if (duv.x >= 0.0) { float d = texture2D(suitDecal, duv).a; vec3 ink = dot(suit, vec3(0.33)) > 0.55 ? vec3(0.05) : vec3(0.98); suit = mix(suit, ink, d); }
diffuseColor.rgb *= suit;`);
  };
  m.customProgramCacheKey = () => 'suit2';
  return m;
}

// Painted helmet: base colour, twin racing stripes over the crown, the number on both sides.
const helmetCache = new Map();
function helmetTexture(look) {
  const key = [look.helmetColor ?? look.suit, look.accent, look.number, look.pattern].join();
  if (helmetCache.has(key)) return helmetCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  const base = '#' + new THREE.Color(look.helmetColor ?? look.suit).getHexString();
  const acc = '#' + new THREE.Color(look.accent).getHexString();
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = acc;
  for (const u of [0.25, 0.75]) {
    g.fillRect(u * 512 - 26, 0, 16, 150);
    g.fillRect(u * 512 + 10, 0, 16, 150);
  }
  if (look.pattern === 'flames') {
    for (let x = 0; x < 512; x += 32) {
      g.beginPath();
      g.moveTo(x, 256);
      g.quadraticCurveTo(x + 6, 170, x + 16, 150 + Math.random() * 30);
      g.quadraticCurveTo(x + 26, 190, x + 32, 256);
      g.fill();
    }
  } else if (look.pattern === 'checker') {
    for (let x = 0; x < 512; x += 16) for (let y = 200; y < 256; y += 16) if (((x + y) / 16) % 2) g.fillRect(x, y, 16, 16);
  } else {
    g.fillRect(0, 196, 512, 14);
  }
  g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 6;
  g.font = 'bold 70px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  for (const u of [0, 0.5, 1]) {
    g.strokeText(String(look.number ?? 7), u * 512, 170);
    g.fillText(String(look.number ?? 7), u * 512, 170);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  helmetCache.set(key, t);
  return t;
}

// A racer/spectator: body + racing suit + chosen hair/helmet, animated.
// look: { body, skin, hair, beard, hairColor, suit, accent, helmet, helmetColor }
export function makePerson(look, { lite = false } = {}) {
  const root = clonePerson(look.body, lite);
  const hairNames = Object.keys(HAIRS).filter((h) => h !== 'none');
  const materials = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name;
    const owner = hairNames.find((h) => n.startsWith(h)) || (n.startsWith('Hair_Beard') && 'Hair_Beard');
    if (owner) {
      const wantHair = !look.helmet && owner === look.hair;
      const wantBeard = owner === 'Hair_Beard' && look.beard && look.body === 'male';
      o.visible = wantHair || wantBeard;
      if (o.visible) {
        o.material = o.material.clone();
        o.material.color.set(look.hairColor ?? 0x2b1a10);
      }
    } else if (n.startsWith('Helmet') || n.startsWith('Visor')) {
      o.visible = !!look.helmet;
      if (n.startsWith('Helmet')) {
        o.material = o.material.clone();
        o.material.color.set(0xffffff);
        o.material.map = helmetTexture(look);
      }
    } else if (o.material.name === 'Suit') {
      o.material = suitMaterial(o.material, look);
    } else if (n.startsWith('Body') && look.skin && assets.skins[`${look.body}-${look.skin}`]) {
      o.material = o.material.clone();
      o.material.map = assets.skins[`${look.body}-${look.skin}`];
    }
    if (o.visible) materials.push(...(Array.isArray(o.material) ? o.material : [o.material]));
  });
  const anim = new Animator(root);
  return { root, anim, materials };
}
