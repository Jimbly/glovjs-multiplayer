//////////////////////////////////////////////////////////////////////////
// Particle System Spec

if (0) {
  /*global glov_engine:false  */
  /*global Z:false  */
// Definitions
// value = number or
// value = [base, add_max] -> generates a number in the range [base, base + add_max)
let def_fire = {
  particles: {
    fire: {
      bucket: 'additive',
      texture: 'fire.png',
      color: [1,1,1,1], // multiplied by animation track, default 1,1,1,1, can be omitted
      color_track: [ // just values, NOT random range
        { t: 0.0, v: [1,0.4,0.4,1] },
        { t: 0.7, v: [1,0,0,1] },
        { t: 0.9, v: [0.2,0,0,1] },
        { t: 1.0, v: [0,0,0,1] },
      ],
      size: [[32,16], [32,16]], // multiplied by animation track
      size_track: [ // just values, NOT random range
        { t: 0.0, v: [1,1] },
        { t: 0.4, v: [0.5,0.5] },
        { t: 0.7, v: [1,1] },
        { t: 1.0, v: [1.5,1.5] },
      ],
      accel: [0,0],
      rot: [0,360], // degrees
      rot_vel: [10,2], // degrees per second
      lifespan: [450,0], // milliseconds
      kill_time_accel: 5,
    },
  },
  emitters: {
    fire: {
      particle: 'fire',
      // Random ranges affect each emitted particle:
      pos: [[0,28], [0,28]],
      vel: [0,0],
      emit_rate: [60,20], // emissions per second
      // Random ranges only calculated upon instantiation:
      emit_time: [0,Infinity],
      emit_initial: 10,
    },
  },
  system_lifespan: Infinity, // must be manually killed
};

// Usage
let system = glov_engine.glov_particles.createSystem(def_fire, [50, 50, Z.PARTICLES]);
system.updatePos(75, 75);
system.killSoft(); // stops emitting and speeds up particles by kill_time_accel
system.killHard(); // immediately stops drawing

}

//////////////////////////////////////////////////////////////////////////
// Implementation
/*global assert: false */
/*global VMath: false */

// Expect all values to be a pair of [base, add_max]
function normalizeValue(v) {
  if (v instanceof Float32Array && v.length >= 2) {
    return v;
  } else if (typeof v === 'number') {
    return VMath.v2Build(v, 0);
  } else if (Array.isArray(v) || v instanceof Float32Array) {
    // already an array, convert to Vec2
    return VMath.v2Build(v[0] || 0, v[1] || 0);
  } else {
    assert(false);
  }
}

function normalizeValueVec(vec, length) {
  assert(length);
  assert(Array.isArray(vec));
  let ret = new Array(length);
  for (let ii = 0; ii < length; ++ii) {
    ret[ii] = normalizeValue(vec[ii]);
  }
  return ret;
}

function normalizeParticle(def, particle_manager) {
  if (!def.normalized) {
    let norm = def.normalized = {
      bucket: def.bucket || 'alpha',
      texture: particle_manager.glov_sprite.loadTexture(def.texture || 'img/glov/util_circle.png'),
      color: normalizeValueVec(def.color || [1,1,1,1], 4),
      color_track: null,
      size: normalizeValueVec(def.size || [1,1], 2),
      size_track: null,
      accel: normalizeValueVec(def.accel || [0,0,0], 3),
      rot: normalizeValue(def.rot || 0),
      rot_vel: normalizeValue(def.rot || 0),
      lifespan: normalizeValue(def.lifespan || 1000),
      kill_time_accel: normalizeValue(def.kill_time_accel || 1),
    };
    assert(norm.kill_time_accel[0] >= 1); // cannot slow down on kill!
    if (def.color_track && def.color_track.length) {
      assert(def.color_track.length > 1);
      norm.color_track = [];
      for (let ii = 0; ii < def.color_track.length; ++ii) {
        let e = def.color_track[ii];
        assert(typeof e.t === 'number');
        let arr = new Float32Array(5);
        arr[0] = e.v[0];
        arr[1] = e.v[1];
        arr[2] = e.v[2];
        arr[3] = e.v[3];
        arr[4] = e.t;
        norm.color_track.push(arr);
      }
    }
    if (def.size_track && def.size_track.length) {
      assert(def.size_track.length > 1);
      norm.size_track = [];
      for (let ii = 0; ii < def.size_track.length; ++ii) {
        let e = def.size_track[ii];
        assert(typeof e.t === 'number');
        let arr = new Float32Array(3);
        arr[0] = e.v[0];
        arr[1] = e.v[1];
        arr[2] = e.t;
        norm.size_track.push(arr);
      }
    }
  }
  return def.normalized;
}

function findParticle(particles, name) {
  assert(particles[name] !== undefined);
  return particles[name];
}

function normalizeEmitter(def, part_map) {
  if (!def.normalized) {
    def.normalized = {
      part_idx: findParticle(part_map, def.particle),
      pos: normalizeValueVec(def.pos || [0,0,0], 3),
      vel: normalizeValueVec(def.vel || [0,0,0], 3),
      emit_rate: normalizeValue(def.emit_rate || 10),
      emit_time: normalizeValueVec(def.emit_time || [0,Infinity], 2),
      emit_initial: normalizeValue(def.emit_initial || 1),
    };
    // convert particles per second to ms per emission
    let min = def.normalized.emit_rate[0];
    let max = def.normalized.emit_rate[0] + def.normalized.emit_rate[1];
    def.normalized.emit_rate[0] = 1000 / max;
    def.normalized.emit_rate[1] = 1000 / min;
    assert(def.normalized.emit_rate[0] > 1); // Not more than 1000 per second, that's ridic'.
  }
  return def.normalized;
}

function normalizeDef(def, particle_manager) {
  if (!def.normalized) {
    let norm = def.normalized = {
      system_lifespan: normalizeValue(def.system_lifespan || Infinity),
      particles: [],
      emitters: [],
    };
    let part_map = {};
    for (let key in def.particles) {
      part_map[key] = norm.particles.length;
      norm.particles.push(normalizeParticle(def.particles[key], particle_manager));
    }
    for (let key in def.emitters) {
      norm.emitters.push(normalizeEmitter(def.emitters[key], part_map));
    }
  }
  return def.normalized;
}

function instValue(v) {
  return v[0] + Math.random() * v[1];
}
function instValueVec(v) {
  let ret = new Float32Array(v.length);
  for (let ii = 0; ii < v.length; ++ii) {
    ret[ii] = instValue(v[ii]);
  }
  return ret;
}

let temp_color = VMath.v4BuildZero();
let temp_color2 = VMath.v4BuildZero();
let temp_size = VMath.v2BuildZero();
let temp_size2 = VMath.v2BuildZero();
// let temp_pos = VMath.v3BuildZero();

class ParticleSystem {
  constructor(parent, def, pos) {
    assert(pos.length === 3);
    this.parent = parent;
    this.def = normalizeDef(def, parent);
    this.system_lifespan = instValue(this.def.system_lifespan);
    assert(this.system_lifespan > 0);
    this.age = 0;
    this.kill_hard = false;
    this.kill_soft = false;
    this.pos = VMath.v3Build(pos[0], pos[1], pos[2]);
    this.part_sets = [];
    for (let ii = 0; ii < this.def.particles.length; ++ii) {
      let def = this.def.particles[ii];
      let part_set = {
        def,
        parts: [],
      };
      this.part_sets.push(part_set);
    }
    this.emitters = [];
    // Instantiate emitters
    for (let ii = 0; ii < this.def.emitters.length; ++ii) {
      let def = this.def.emitters[ii];
      let emitter = {
        def,
        emit_time: instValueVec(def.emit_time),
        countdown: 0,
        started: false,
        stopped: false,
      };
      this.emitters.push(emitter);
    }
    // do initial tick for things that have an emit_time[0] of 0 and have an emit_initial
    this.tick(0);
  }

  tickParticle(part, dt) {
    let def = part.def;
    part.age += dt;
    let age_norm = part.age / part.lifespan;
    if (age_norm >= 1) {
      return true;
    }

    // Pos, vel - incrementally computed
    let dts = dt / 1000;
    part.pos[0] += part.vel[0] * dts;
    part.pos[1] += part.vel[1] * dts;
    part.pos[2] += part.vel[2] * dts;
    part.vel[0] += part.accel[0] * dts;
    part.vel[1] += part.accel[1] * dts;
    part.vel[2] += part.accel[2] * dts;

    // Color, size, rot - explicitly computed
    VMath.v4Copy(part.color, temp_color);
    if (def.color_track) {
      if (age_norm < def.color_track[0][4]) {
        VMath.v4Mul(temp_color, def.color_track[0], temp_color);
      } else if (age_norm >= def.color_track[def.color_track.length - 1][4]) {
        VMath.v4Mul(temp_color, def.color_track[def.color_track.length - 1], temp_color);
      } else {
        for (let ii = 0; ii < def.color_track.length - 1; ++ii) {
          if (age_norm >= def.color_track[ii][4] && age_norm < def.color_track[ii + 1][4]) {
            let weight = (age_norm - def.color_track[ii][4]) / (def.color_track[ii + 1][4] - def.color_track[ii][4]);
            VMath.v4Lerp(def.color_track[ii], def.color_track[ii + 1], weight, temp_color2);
            VMath.v4Mul(temp_color, temp_color2, temp_color);
            break;
          }
        }
      }
    }

    VMath.v2Copy(part.size, temp_size);
    if (def.size_track) {
      if (age_norm < def.size_track[0][4]) {
        VMath.v2Mul(temp_size, def.size_track[0], temp_size);
      } else if (age_norm >= def.size_track[def.size_track.length - 1][4]) {
        VMath.v2Mul(temp_size, def.size_track[def.size_track.length - 1], temp_size);
      } else {
        for (let ii = 0; ii < def.size_track.length - 1; ++ii) {
          if (age_norm >= def.size_track[ii][4] && age_norm < def.size_track[ii + 1][4]) {
            let weight = (age_norm - def.size_track[ii][4]) / (def.size_track[ii + 1][4] - def.size_track[ii][4]);
            VMath.v2Lerp(def.size_track[ii], def.size_track[ii + 1], weight, temp_size2);
            VMath.v2Mul(temp_size, temp_size2, temp_size);
            break;
          }
        }
      }
    }

    // TODO: let rot = part.rot + part.age * part.rot_vel;

    // TODO: draw using:
    //   rot
    let w = part.size[0];
    let h = part.size[1];
    let x = part.pos[0] - w/2;
    let y = part.pos[1] - h/2;
    let z = part.pos[2];
    this.parent.draw_list.queueraw4(def.texture.texture,
      x, y, x + w, y, x + w, y + h, x, y + h, z, 0, 0, 1, 1,
      temp_color, def.bucket, null);

    return false;
  }

  tickPartSet(dt_orig, part_set) {
    //let def = part_set.def;
    let parts = part_set.parts;
    for (let ii = parts.length - 1; ii >= 0; --ii) {
      let part = parts[ii];
      let dt = this.kill_soft ? dt_orig * part.kill_time_accel : dt_orig;
      if (this.tickParticle(part, dt)) {
        parts[ii] = parts[parts.length - 1];
        parts.pop();
      }
    }
  }

  emitParticle(init_dt, emitter) {
    let emitter_def = emitter.def;
    let part_set = this.part_sets[emitter_def.part_idx];
    let def = part_set.def;
    let pos = instValueVec(emitter_def.pos, 3);
    VMath.v3Add(pos, this.pos, pos);
    // PERFTODO: Make the whole Particle just a data[] Float32Array
    let part = {
      def,
      pos,
      color: instValueVec(def.color, 4),
      size: instValueVec(def.size, 4),
      vel: instValueVec(emitter_def.vel, 3),
      accel: instValueVec(def.accel, 3),
      rot: instValue(def.rot),
      rot_vel: instValue(def.rot_vel),
      lifespan: instValue(def.lifespan),
      kill_time_accel: instValue(def.kill_time_accel),
      age: 0,
    };
    if (!this.tickParticle(part, init_dt)) {
      part_set.parts.push(part);
    }
  }

  tickEmitter(dt, emitter) {
    let def = emitter.def;
    // check for initial emission
    if (!emitter.started && this.age >= emitter.emit_time[0]) {
      emitter.started = true;
      // ignore time before we started emitting
      dt = this.age - emitter.emit_time[0];
      let num = instValue(def.emit_initial);
      for (let ii = 0; ii < num; ++ii) {
        this.emitParticle(dt, emitter);
      }
      emitter.countdown = instValue(def.emit_rate);
    }
    if (emitter.started && !emitter.stopped) {
      // should we stop?
      let remaining_dt = dt;
      let emit_dt = dt;
      if (this.age >= emitter.emit_time[1]) {
        emitter.stopped = true;
        // Do not emit during time after we stopped
        emit_dt -= this.age - emitter.emit_time[1];
      }
      // Emit dt's worth of particles
      while (emit_dt >= emitter.countdown) {
        emit_dt -= emitter.countdown;
        remaining_dt -= emitter.countdown;
        emitter.countdown = instValue(def.emit_rate);
        this.emitParticle(remaining_dt, emitter);
      }
      emitter.countdown -= emit_dt;
    }
  }

  tick(dt) {
    if (this.kill_hard) {
      return true;
    }
    // tick existing particles
    for (let ii = this.part_sets.length - 1; ii >= 0; --ii) {
      this.tickPartSet(dt, this.part_sets[ii]);
    }
    // advance time and spawn new ones (with partial ticks)
    this.age += dt;
    for (let ii = 0; ii < this.emitters.length; ++ii) {
      this.tickEmitter(dt, this.emitters[ii]);
    }

    return (this.age >= this.system_lifespan); // kill if past lifespan
  }
}

class ParticleManager {
  constructor(draw_list, glov_sprite) {
    this.draw_list = draw_list;
    this.glov_sprite = glov_sprite;
    this.systems = [];
  }

  createSystem(def, pos) {
    let system = new ParticleSystem(this, def, pos);
    this.systems.push(system);
    return system;
  }

  tick(dt) {
    for (let ii = this.systems.length - 1; ii >= 0; --ii) {
      if (this.systems[ii].tick(dt)) {
        this.systems[ii] = this.systems[this.systems.length - 1];
        this.systems.pop();
      }
    }
  }
}

export function create() {
  let args = Array.prototype.slice.call(arguments, 0);
  args.splice(0,0, null);
  return new (Function.prototype.bind.apply(ParticleManager, args))();
}
