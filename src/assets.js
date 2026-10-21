import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Built by the Blender scripts in tools/ (build_cars + merge_cars, build_people, build_assets).
const BASE = '/models/';
const loader = new GLTFLoader();
const load = (url) => new Promise((resolve, reject) => loader.load(BASE + url, resolve, undefined, reject));
const texLoader = new THREE.TextureLoader();

// Geometries owned by loaded templates; never dispose these when tearing down a race.
export const sharedGeometries = new WeakSet();

export const assets = {
  manifest: null, // props
  carInfo: null, // per-car wheel positions, size, steering wheel
  cars: {},
  props: {},
  people: {}, // male, female, male-lite, female-lite
  skins: {}, // 'male-light' → texture
  clips: {},
};

function markShared(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      sharedGeometries.add(o.geometry);
    }
  });
}

// Root nodes are named "<kind>_<id>" by the build scripts.
function collect(scene, prefix, into) {
  for (const child of scene.children) {
    if (!child.name.startsWith(prefix)) continue;
    child.updateMatrixWorld(true);
    into[child.name.slice(prefix.length)] = child;
    markShared(child);
  }
}

export async function loadCore(onProgress = () => {}) {
  const jobs = [
    fetch(BASE + 'manifest.json').then((r) => r.json()).then((m) => (assets.manifest = m)),
    fetch(BASE + 'cars/manifest.json').then((r) => r.json()).then((m) => (assets.carInfo = m)),
    load('cars/cars.glb').then((g) => collect(g.scene, 'car_', assets.cars)),
    load('people/anims.glb').then((g) => {
      for (const clip of g.animations) assets.clips[clip.name] = clip;
    }),
    ...['male', 'female', 'male-lite', 'female-lite'].map((k) =>
      load(`people/${k}.glb`).then((g) => {
        g.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.frustumCulled = false; // skinned bounds don't follow the animation
            sharedGeometries.add(o.geometry);
          }
        });
        assets.people[k] = g.scene;
      })
    ),
    ...['male', 'female'].flatMap((b) =>
      ['light', 'dark'].map((tone) =>
        texLoader.loadAsync(`${BASE}people/skin-${b}-${tone}.jpg`).then((t) => {
          t.flipY = false;
          t.colorSpace = THREE.SRGBColorSpace;
          assets.skins[`${b}-${tone}`] = t;
        })
      )
    ),
    load('props-race.glb').then((g) => collect(g.scene, 'prop_', assets.props)),
  ];
  let done = 0;
  await Promise.all(jobs.map((p) => p.then(() => onProgress(++done / jobs.length))));
}

// Realistic scenery (Sketchfab, built by tools/build_scenery.py) plus Kenney ground cover.
let sceneryInfo = null;
async function loadSceneryInfo() {
  sceneryInfo ??= fetch(BASE + 'scenery.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const info = await sceneryInfo;
  Object.assign(assets.manifest.props, info);
}

const themeLoads = {};
export function loadTheme(theme) {
  const optional = (url) => load(url).then((g) => collect(g.scene, 'prop_', assets.props)).catch(() => {});
  themeLoads[theme] ??= Promise.all([
    loadSceneryInfo(),
    optional(`props-${theme}.glb`),
    optional(`scenery-${theme}.glb`),
    optional('scenery-common.glb'),
  ]);
  return themeLoads[theme];
}

// All props from one source pack, e.g. variants('desert_rocks') → desert_rocks_0, desert_rocks_1…
export function variants(prefix) {
  return Object.keys(assets.props).filter((k) => k === prefix || (k.startsWith(prefix + '_') && /^\d+$/.test(k.slice(prefix.length + 1))));
}

export function clonePerson(body, lite = false) {
  return cloneSkinned(assets.people[body + (lite ? '-lite' : '')]);
}

export function cloneProp(name) {
  const p = assets.props[name];
  if (!p) return null;
  const c = p.clone();
  c.position.set(0, 0, 0);
  return c;
}
