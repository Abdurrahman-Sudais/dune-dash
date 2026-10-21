export const LAPS = 3;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Lap and position bookkeeping for one car.
export class Racer {
  constructor(car, name, { isPlayer = false } = {}) {
    this.car = car;
    this.name = name;
    this.isPlayer = isPlayer;
    this.ai = null;
    this.reset(0);
  }

  reset(index) {
    this.lap = 0; // 0 = still behind the start line
    this.halfway = false;
    this.lastIndex = index;
    this.finished = false;
    this.finishTime = 0;
    this.lapStart = 0;
    this.best = Infinity;
    this.stuck = 0;
  }

  // Returns { type: 'lap' | 'finish', time, best } when a lap completes.
  update(N, clock) {
    const idx = this.car.trackIndex;
    if (idx > N * 0.45 && idx < N * 0.55) this.halfway = true;
    let event = null;
    if (this.lastIndex > N * 0.9 && idx < N * 0.1) {
      if (this.lap === 0) {
        this.lap = 1;
        this.lapStart = clock;
      } else if (this.halfway && !this.finished) {
        const time = clock - this.lapStart;
        event = { type: 'lap', time, best: time < this.best };
        this.best = Math.min(this.best, time);
        this.lap++;
        this.lapStart = clock;
        if (this.lap > LAPS) {
          this.finished = true;
          this.finishTime = clock;
          event.type = 'finish';
        }
      }
      this.halfway = false;
    }
    this.lastIndex = idx;
    return event;
  }

  progress(N) {
    if (this.finished) return 1e9 - this.finishTime;
    const idx = this.car.trackIndex;
    const rel = this.lap === 0 && idx > N / 2 ? idx - N : idx;
    return this.lap * N + rel;
  }
}

// Steers a car along the racing line, slowing for bends and dodging cars ahead.
export class AIDriver {
  constructor(car, { skill = 0.95, lane = 0, phase = 0, aggression = 0.5 } = {}) {
    this.car = car;
    this.skill = skill;
    this.aggression = aggression;
    this.lane = lane;
    this.phase = phase;
  }

  input(track, cars, time) {
    const car = this.car;
    const N = track.points.length;
    const idx = car.trackIndex;
    const speed = car.speed;

    const ti = (idx + Math.round(5 + speed * 0.28)) % N;
    const p = track.points[ti];
    const s = track.sides[ti];

    let lane = this.lane + Math.sin(time * 0.3 + this.phase) * 2;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    let slam = 0;
    for (const o of cars) {
      if (o === car || o.wrecked) continue;
      const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
      const ahead = dx * fx + dz * fz;
      const side = dx * fz - dz * fx; // + = other car is on our left
      if (ahead > 0 && ahead < 16 && Math.abs(side) < 3) lane += side > 0 ? -4 : 4;
      // Rival right alongside? Shunt it (Burnout-style), more often for aggressive drivers.
      if (Math.abs(ahead) < 2.5 && Math.abs(side) > 2 && Math.abs(side) < 5.5 && Math.random() < this.aggression * 0.01) slam = Math.sign(side);
    }
    const maxLane = track.halfWidth - 2.8;
    lane = clamp(lane, -maxLane, maxLane);

    const tx = p.x + s.x * lane, tz = p.z + s.z * lane;
    const diff = wrapAngle(Math.atan2(tx - car.pos.x, tz - car.pos.z) - car.heading);
    const steer = clamp(diff * 2.2, -1, 1);

    // How much the track bends over the next stretch → safe corner speed.
    const t0 = track.tangents[idx];
    const t1 = track.tangents[(idx + 20 + Math.round(speed * 0.4)) % N];
    const bend = Math.acos(clamp(t0.dot(t1), -1, 1));
    const top = car.topSpeed;
    const cornerSpeed = clamp(top * 1.08 - bend * 22, 16, top + 6) * this.skill;
    const sharp = bend > 0.55 && speed > 22;

    return {
      throttle: speed < cornerSpeed,
      brake: speed > cornerSpeed + 6,
      steer,
      drift: sharp && Math.abs(steer) > 0.4,
      slam,
    };
  }
}
