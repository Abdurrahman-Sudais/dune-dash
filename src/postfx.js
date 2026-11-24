import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Arcade colour grade: punchier saturation and contrast, a warm lift, and a soft vignette.
// Runs in linear HDR before the OutputPass applies tone mapping and sRGB.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.28 },
    contrast: { value: 1.08 },
    warmth: { value: 0.015 },
    vignette: { value: 0.28 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, warmth, vignette;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Vibrance: lift dull colours more than already-saturated ones.
      float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
      c = mix(vec3(l), c, saturation + (1.0 - saturation) * sat * 0.6);
      // Contrast around mid-grey, in a log-ish space so highlights stay intact.
      c = max(c, 0.0);
      c = pow(c, vec3(contrast)) * pow(0.18, 1.0 - contrast);
      c *= vec3(1.0 + warmth, 1.0, 1.0 - warmth);
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(c, tex.a);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // HDR target with 4x MSAA so edges stay clean through the post chain.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.26, 0.5, 0.95);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  // Cheaper path for slow GPUs: no MSAA, half-res bloom.
  lowQuality() {
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      t.samples = 0;
      t.dispose(); // re-created without MSAA on next use
    }
    this.bloom.strength *= 0.8;
    this.bloom.resolution.multiplyScalar(0.5);
    this.setSize(innerWidth, innerHeight);
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
