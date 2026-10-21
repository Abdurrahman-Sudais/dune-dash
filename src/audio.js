// All sounds are synthesized with Web Audio — no audio files needed.

const MUTE_KEY = 'dune-dash-muted';

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = loadMuted();
    this.volume = 0.7;
  }

  // Browsers only allow audio after a user gesture, so this runs on the first key press.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.buildLoops();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  }

  buildLoops() {
    const ctx = this.ctx;
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type, freq, Q = 1) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = Q;
      return f;
    };

    // Engine: saw + square sub through a lowpass.
    this.engineGain = gain();
    this.engineFilter = filter('lowpass', 400, 4);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    const subGain = gain(0.5);
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(subGain).connect(this.engineFilter);
    this.engineOsc.start();
    this.engineSub.start();

    // Tyre screech: narrow band of noise.
    this.screechGain = gain();
    this.screechFilter = filter('bandpass', 2400, 9);
    const screech = this.noiseSource();
    screech.connect(this.screechFilter).connect(this.screechGain).connect(this.master);
    screech.start();

    // Sand rumble when off the road.
    this.sandGain = gain();
    const sand = this.noiseSource();
    sand.connect(filter('lowpass', 450)).connect(this.sandGain).connect(this.master);
    sand.start();

    // Beach waves: soft noise swelling slowly.
    const waves = this.noiseSource();
    const wavesGain = gain(0.035);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoDepth = gain(0.03);
    lfo.connect(lfoDepth).connect(wavesGain.gain);
    waves.connect(filter('lowpass', 700)).connect(wavesGain).connect(this.master);
    waves.start(ctx.currentTime + Math.random());
    lfo.start();
  }

  // Continuous sounds follow the player's car each frame.
  update(car, throttle, running) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const r = Math.min(1.4, car.speed / 34);
    const gears = 4;
    const gear = Math.min(gears - 1, Math.floor(r * gears));
    const inGear = r * gears - gear;
    const spinning = car.spinTime > 0;
    const freq = 42 + gear * 14 + inGear * 70 + (car.boost > 0 ? 25 : 0);
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.06);
    this.engineSub.frequency.setTargetAtTime(freq / 2, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(350 + r * 900 + (throttle ? 400 : 0) + (car.boost > 0 ? 1500 : 0), t, 0.08);
    const engineVol = running ? (spinning ? 0.05 : 0.09 + (throttle ? 0.07 : 0) + (car.boost > 0 ? 0.05 : 0)) : 0.06;
    this.engineGain.gain.setTargetAtTime(engineVol, t, 0.1);

    const tier = car.driftTier;
    this.screechGain.gain.setTargetAtTime(tier >= 0 ? 0.13 + Math.random() * 0.03 : 0, t, 0.05);
    this.screechFilter.frequency.setTargetAtTime([2200, 2700, 3200][Math.max(0, tier)], t, 0.1);

    const sand = !car.onRoad && car.speed > 5 ? Math.min(0.28, car.speed / 70) : 0;
    this.sandGain.gain.setTargetAtTime(sand, t, 0.1);
  }

  tone(type, f0, f1, dur, vol, delay = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise(dur, vol, type, f0, f1, Q = 1, delay = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = Q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  play(name, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || vol < 0.02) return;
    const v = (x) => x * vol;
    switch (name) {
      case 'beep':
        this.tone('square', 440, 440, 0.2, v(0.15));
        break;
      case 'go':
        this.tone('square', 880, 880, 0.45, v(0.18));
        this.tone('square', 1320, 1320, 0.45, v(0.06));
        break;
      case 'pickup':
        [660, 880, 1320].forEach((f, i) => this.tone('square', f, f, 0.09, v(0.09), i * 0.05));
        break;
      case 'tick':
        this.tone('square', 1300, 1250, 0.03, v(0.04));
        break;
      case 'ready':
        this.tone('triangle', 880, 1760, 0.18, v(0.2));
        this.tone('sine', 1320, 1320, 0.25, v(0.1), 0.06);
        break;
      case 'boost':
        this.noise(0.55, v(0.45), 'bandpass', 400, 3200, 1.5);
        this.tone('sawtooth', 110, 440, 0.45, v(0.1));
        break;
      case 'superboost':
        this.noise(0.9, v(0.55), 'bandpass', 300, 4000, 1.5);
        this.tone('sawtooth', 90, 520, 0.7, v(0.12));
        this.tone('square', 660, 1320, 0.3, v(0.06), 0.05);
        break;
      case 'fireball':
        this.noise(0.6, v(0.5), 'lowpass', 3500, 250, 2);
        this.tone('sawtooth', 320, 70, 0.45, v(0.12));
        break;
      case 'missile':
        this.noise(0.9, v(0.4), 'bandpass', 1800, 500, 3);
        this.tone('square', 1000, 180, 0.7, v(0.06));
        break;
      case 'oil':
        this.noise(0.35, v(0.55), 'lowpass', 900, 120, 3);
        this.tone('sine', 220, 55, 0.25, v(0.35));
        break;
      case 'shield':
        this.tone('sine', 400, 1200, 0.5, v(0.2));
        this.tone('triangle', 600, 1800, 0.5, v(0.08), 0.06);
        break;
      case 'explosion':
        this.noise(1, v(0.9), 'lowpass', 2500, 80, 1);
        this.tone('sine', 130, 32, 0.7, v(0.6));
        break;
      case 'blocked':
        this.tone('triangle', 1500, 1400, 0.45, v(0.2));
        this.tone('sine', 2250, 2200, 0.35, v(0.1));
        break;
      case 'bump':
        this.tone('sine', 150, 50, 0.2, v(0.45));
        this.noise(0.14, v(0.3), 'lowpass', 700, 200);
        break;
      case 'crash':
        this.noise(1.4, v(1), 'lowpass', 4000, 90, 1);
        this.noise(0.5, v(0.5), 'highpass', 3000, 6000, 1, 0.05);
        this.tone('sine', 110, 28, 0.9, v(0.7));
        [0.18, 0.35, 0.6].forEach((d) => this.noise(0.12, v(0.35), 'bandpass', 2500, 1200, 4, d));
        break;
      case 'takedown':
        this.noise(0.8, v(0.7), 'lowpass', 3000, 100, 1);
        [523, 784, 1047, 1568].forEach((f, i) => this.tone('square', f, f, 0.14, v(0.12), 0.12 + i * 0.07));
        break;
      case 'land':
        this.tone('sine', 120, 40, 0.25, v(0.55));
        this.noise(0.2, v(0.35), 'lowpass', 900, 150);
        break;
      case 'slam':
        this.noise(0.25, v(0.4), 'bandpass', 600, 2400, 2);
        break;
      case 'skill':
        this.tone('sawtooth', 220, 880, 0.35, v(0.12));
        this.tone('square', 440, 1760, 0.35, v(0.08), 0.08);
        this.noise(0.5, v(0.3), 'bandpass', 800, 4000, 2);
        break;
      case 'shockwave':
        this.tone('sine', 300, 40, 0.8, v(0.6));
        this.noise(0.9, v(0.6), 'lowpass', 1800, 100, 1);
        break;
      case 'thunder':
        this.noise(1.2, v(0.9), 'lowpass', 6000, 200, 0.7);
        this.noise(0.15, v(0.6), 'highpass', 2000, 8000, 1);
        break;
      case 'lap':
        [660, 880].forEach((f, i) => this.tone('square', f, f, 0.14, v(0.12), i * 0.12));
        break;
      case 'final':
        [660, 880, 1100].forEach((f, i) => this.tone('square', f, f, 0.16, v(0.12), i * 0.13));
        break;
      case 'finish':
        [523, 659, 784].forEach((f, i) => this.tone('square', f, f, 0.15, v(0.12), i * 0.14));
        this.tone('square', 1047, 1047, 0.7, v(0.14), 0.42);
        this.tone('triangle', 523, 523, 0.7, v(0.1), 0.42);
        break;
    }
  }
}
