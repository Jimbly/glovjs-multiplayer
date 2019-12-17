// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const engine = require('./engine.js');
const fs = require('fs');
const mat4LookAt = require('gl-mat4/lookat');
const { max, PI, tan } = Math;
const shaders = require('./shaders.js');
const sprites = require('./sprites.js');
const textures = require('./textures.js');
const {
  mat4,
  vec3, v3addScale,
  vec4, v4copy,
  zaxis,
} = require('./vmath.js');

export let OFFSET_GOLDEN = vec3(-1/1.618, -1, 1/1.618/1.618);
let snapshot_shader;

let viewport_save = vec4();
let view_mat = mat4();
let target_pos = vec3();
let camera_pos = vec3();
let capture_uvs = vec4(0,1,1,0);
const FOV = 15 / 180 * PI;
const DIST_SCALE = 0.5 / tan(FOV/2) * 1.1;
let last_snapshot_idx = 0;
// returns sprite
// { w, h, pos, size, draw(), [sprite] }
export function snapshot(param) {
  assert(!engine.had_3d_this_frame); // must be before general 3D init

  let camera_offset = param.camera_offset || OFFSET_GOLDEN;

  let name = param.name || `snapshot_${++last_snapshot_idx}`;
  let texs = param.sprite && param.sprite.texs || [
    textures.createForCapture(`${name}(0)`),
    textures.createForCapture(`${name}(1)`)
  ];

  v4copy(viewport_save, engine.viewport);

  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);

  engine.setViewport([0,0,param.w,param.h]);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, param.w, param.h);
  engine.setupProjection(FOV, param.w, param.h, 0.1, 100);
  let max_dim = max(param.size[0], param.size[2]);
  let dist = max_dim * DIST_SCALE + param.size[1]/2;
  v3addScale(target_pos, param.pos, param.size, 0.5);
  v3addScale(camera_pos, target_pos, camera_offset, dist);
  mat4LookAt(view_mat, camera_pos, target_pos, zaxis);
  engine.setGlobalMatrices(view_mat);

  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  param.draw();
  engine.captureFramebuffer(texs[0], param.w, param.h, true, false);

  gl.clearColor(1,1,1,0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  param.draw();
  // PERFTODO: we only need to capture the red channel, does that speed things up and use less mem?
  engine.captureFramebuffer(texs[1], param.w, param.h, true, false);

  gl.disable(gl.SCISSOR_TEST);
  engine.setViewport(viewport_save);

  if (!param.sprite) {
    param.sprite = sprites.create({
      texs,
      shader: snapshot_shader,
      uvs: capture_uvs,
    });
  }
  return param.sprite;
}

export function snapshotStartup() {
  snapshot_shader = shaders.create(gl.FRAGMENT_SHADER, 'snapshot.fp',
    fs.readFileSync(`${__dirname}/shaders/snapshot.fp`,'utf8'));
}
