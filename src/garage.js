import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Vehicle } from './vehicle.js';
import { makePerson } from './characters.js';
import { driverLook } from './data.js';

// The menu's 3D showroom: your customised car on a turntable, your driver standing beside it.
export class Garage {
  constructor(renderer) {
    this.renderer = renderer;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x141c26);
    scene.fog = new THREE.Fog(0x141c26, 18, 45);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.9;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3a2a1a, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(6, 10, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.normalBias = 0.03;
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9a50, 1.6);
    rim.position.set(-8, 4, -6);
    scene.add(rim);
    const fill = new THREE.PointLight(0x7fb8ff, 30, 20);
    fill.position.set(-3, 3, 5);
    scene.add(fill);

    const floor = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.8, 0.25, 72), new THREE.MeshStandardMaterial({ color: 0x23303f, roughness: 0.25, metalness: 0.4 }));
    floor.position.y = -0.125;
    floor.receiveShadow = true;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.65, 0.04, 8, 128).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    ring.position.y = 0.01;
    scene.add(ring);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x18222e, roughness: 0.9 }));
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    scene.add(ground);

    this.turntable = new THREE.Group();
    scene.add(this.turntable);
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
    this.angle = 0.7;
    this.dragging = false;
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this.dragging = this.active; this.lastX = e.clientX; });
    addEventListener('pointerup', () => { this.dragging = false; });
    addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.angle -= (e.clientX - this.lastX) * 0.01;
      this.lastX = e.clientX;
    });
  }

  show(profile) {
    const look = { ...driverLook(profile), helmet: false };
    const carKey = JSON.stringify({ ...profile, look: null, driver: null, helmet: null, map: null });
    const lookKey = JSON.stringify(look);
    if (carKey !== this.carKey) {
      this.carKey = carKey;
      if (this.car) this.car.dispose();
      this.car = new Vehicle(this.turntable, { ...profile, look, noDriver: true });
      this.car.reset(new THREE.Vector3(-0.4, 0, 0), 0);
    }
    if (lookKey !== this.lookKey) {
      this.lookKey = lookKey;
      if (this.person) this.turntable.remove(this.person.root);
      this.person = makePerson(look);
      this.turntable.add(this.person.root);
      this.person.anim.play('cheer', { once: true, then: 'idle' });
    }
    this.person.root.position.set(this.car.width / 2 + 0.9, 0, 0.9);
    this.person.root.rotation.y = 0.4;
  }

  frame(dt) {
    if (!this.dragging) this.angle += dt * 0.15;
    const r = 8.5;
    this.camera.position.set(Math.sin(this.angle) * r, 2.4, Math.cos(this.angle) * r);
    this.camera.lookAt(0.3, 0.75, 0);
    if (this.car) for (const w of this.car.wheels) w.spin.rotation.x += dt * 0.5;
    this.person?.anim.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
