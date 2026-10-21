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

// Suit shader: vertex colour R is a smooth "accent" field from Blender; threshold it for
// crisp stripes and mix the two suit colours.
function suitMaterial(base, primary, accent) {
  const m = base.clone();
  m.vertexColors = false;
  m.color.set(0xffffff);
  m.userData.primary = { value: new THREE.Color(primary) };
  m.userData.accent = { value: new THREE.Color(accent) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.suitPrimary = m.userData.primary;
    shader.uniforms.suitAccent = m.userData.accent;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color_1;\nvarying float vAccent;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAccent = color_1.r;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 suitPrimary;\nuniform vec3 suitAccent;\nvarying float vAccent;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat edge = fwidth(vAccent);\ndiffuseColor.rgb *= mix(suitPrimary, suitAccent, smoothstep(0.5 - edge, 0.5 + edge, vAccent));');
  };
  m.customProgramCacheKey = () => 'suit';
  return m;
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
        o.material.color.set(look.helmetColor ?? look.suit);
      }
    } else if (o.material.name === 'Suit') {
      o.material = suitMaterial(o.material, look.suit, look.accent);
    } else if (n.startsWith('Body') && look.skin && assets.skins[`${look.body}-${look.skin}`]) {
      o.material = o.material.clone();
      o.material.map = assets.skins[`${look.body}-${look.skin}`];
    }
    if (o.visible) materials.push(...(Array.isArray(o.material) ? o.material : [o.material]));
  });
  const anim = new Animator(root);
  return { root, anim, materials };
}
