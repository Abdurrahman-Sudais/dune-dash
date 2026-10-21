import * as THREE from 'three';

// Realistic item models (PBR materials, real proportions) for projectiles, hazards, the item
// box and the HUD icons. Built once and cloned.

const metal = (color, rough = 0.3) => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: rough });
const paint = (color, rough = 0.35) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 });
const glow = (color, intensity = 3) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });

function stripeTexture(a, b, stripes = 6) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d');
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect((i * 64) / stripes, 0, 64 / stripes + 1, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shadow(g) {
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

// Homing missile: white airframe, red nose, four swept fins, glowing motor nozzle.
export function makeRocket() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.7, 20).rotateX(Math.PI / 2), paint(0xf2f2f2, 0.25));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.55, 20).rotateX(Math.PI / 2), paint(0xc8102e, 0.2));
  nose.position.z = 1.12;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.12, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: stripeTexture('#111', '#ffd000', 8) }));
  band.position.z = 0.45;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.22, 16, 1, true).rotateX(Math.PI / 2), metal(0x333333, 0.4));
  nozzle.position.z = -0.95;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.position.z = -1.35;
  const finShape = new THREE.Shape().moveTo(0, 0).lineTo(0.32, -0.28).lineTo(0.32, -0.42).lineTo(0, -0.36);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.02, bevelEnabled: false }).rotateY(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    const fin = new THREE.Mesh(finGeo, paint(0xc8102e, 0.3));
    fin.position.set(0.0, 0.15, -0.45);
    pivot.add(fin);
    g.add(pivot);
  }
  g.add(body, nose, band, nozzle, flame);
  g.userData.flame = flame;
  return shadow(g);
}

// Fireball: a white-hot core inside layered translucent flame shells.
export function makeFireball() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 2), glow(0xfff1c0, 4)));
  const layers = [[0.7, 0xffa020, 0.75], [0.95, 0xff5a00, 0.45], [1.2, 0xc81e00, 0.22]];
  for (const [r, c, o] of layers) {
    const geo = new THREE.IcosahedronGeometry(r, 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + (Math.random() - 0.5) * 0.25;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false })));
  }
  return g;
}

// Land mine: dished steel body, rubber seal, pressure plate and a blinking LED.
export function makeMine() {
  const g = new THREE.Group();
  const pts = [[0, 0], [0.55, 0], [0.62, 0.08], [0.6, 0.18], [0.42, 0.24], [0, 0.26]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 28), metal(0x4a5240, 0.55)));
  const seal = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 8, 28).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
  seal.position.y = 0.13;
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 20), metal(0x9a9a8a, 0.35));
  plate.position.y = 0.28;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glow(0xff2020, 2));
  led.position.set(0.32, 0.24, 0);
  g.add(seal, plate, led);
  g.userData.led = led;
  return shadow(g);
}

// Oil drum (blue steel, ribbed) — dropped on its side with the spill.
export function makeDrum() {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 24), metal(0x1d4f9a, 0.45));
  g.add(drum);
  for (const y of [-0.3, 0, 0.3]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.295, 0.018, 6, 24).rotateX(Math.PI / 2), metal(0x15407f, 0.4));
    rib.position.y = y;
    g.add(rib);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 24), metal(0x8a8a8a, 0.35));
  lid.position.y = 0.45;
  g.add(lid);
  return shadow(g);
}

// Glossy black oil with a rainbow sheen.
export function oilMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x050505, roughness: 0.04, metalness: 0.2, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6,
    iridescenceThicknessRange: [200, 600], transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -6,
  });
}

// Nitro bottle (boost) — polished blue cylinder with a valve.
export function makeNitro() {
  const g = new THREE.Group();
  const pts = [[0, 0], [0.16, 0], [0.18, 0.04], [0.18, 0.62], [0.12, 0.74], [0.05, 0.78], [0, 0.78]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 24), paint(0x1a63d8, 0.15)));
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.183, 0.183, 0.18, 24, 1, true), new THREE.MeshStandardMaterial({ map: stripeTexture('#ffffff', '#e8e8e8', 2), roughness: 0.6 }));
  label.position.y = 0.38;
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 12), metal(0xd0d0d0, 0.2));
  valve.position.y = 0.84;
  const knob = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 16), metal(0xc8102e, 0.3));
  knob.position.y = 0.9;
  g.add(label, valve, knob);
  return shadow(g);
}

// Shield emitter: chrome puck with a hex energy dome.
export function makeShieldIcon() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.12, 24), metal(0xcfd6dd, 0.15)));
  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshStandardMaterial({ color: 0x5fd8ff, emissive: 0x2a9df4, emissiveIntensity: 1.2, wireframe: true }));
  dome.position.y = 0.2;
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), new THREE.MeshStandardMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.25, emissive: 0x2a9df4, emissiveIntensity: 0.6 }));
  inner.position.y = 0.2;
  g.add(dome, inner);
  return g;
}

// Item box: a glowing glass cube with a chrome frame and a floating "?" core.
export function makeItemBox() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshPhysicalMaterial({
    color: 0xffd23f, transmission: 0.6, thickness: 0.4, roughness: 0.08, metalness: 0, iridescence: 0.8,
    emissive: 0xff8a00, emissiveIntensity: 0.25, transparent: true, opacity: 0.75,
  })));
  const edge = metal(0xf0f0f0, 0.12);
  const e = new THREE.BoxGeometry(1.6, 0.08, 0.08);
  for (const [x, y, rx, rz] of [[0, 0.76, 0, 0], [0, -0.76, 0, 0]]) {
    for (const z of [-0.76, 0.76]) {
      const m = new THREE.Mesh(e, edge);
      m.position.set(x, y, z);
      g.add(m);
      const m2 = m.clone();
      m2.rotation.y = Math.PI / 2;
      m2.position.set(z, y, 0);
      g.add(m2);
    }
    void rx; void rz;
  }
  for (const x of [-0.76, 0.76])
    for (const z of [-0.76, 0.76]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), edge);
      m.position.set(x, 0, z);
      g.add(m);
    }
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 110px Arial Black, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  const q = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, depthWrite: false, depthTest: false }));
  q.scale.setScalar(1.1);
  q.renderOrder = 10; // drawn after the glass so it shows through
  g.add(q);
  return shadow(g);
}

// Render each item model to a transparent PNG for the HUD (real 3D, not emoji).
export function renderItemIcons(builders) {
  const size = 128;
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(size, size);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(2, 3, 4);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const out = {};
  for (const [name, build] of Object.entries(builders)) {
    const obj = build();
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3()).length();
    obj.position.sub(c);
    const pivot = new THREE.Group();
    pivot.add(obj);
    pivot.rotation.set(0.35, -0.7, 0.15);
    scene.add(pivot);
    cam.position.set(0, 0, s * 1.75);
    cam.lookAt(0, 0, 0);
    r.render(scene, cam);
    out[name] = r.domElement.toDataURL('image/png');
    scene.remove(pivot);
  }
  r.dispose();
  return out;
}
