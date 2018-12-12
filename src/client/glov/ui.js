/* eslint-env jquery */
/* eslint no-underscore-dangle:off */
/*global VMath: false */
/*global assert: false */
/*global Z: false */

window.Z = window.Z || {};
Z.BORDERS = Z.BORDERS || 90;
Z.UI = Z.UI || 100;
Z.MODAL = Z.MODAL || 1000;
Z.TOOLTIP = Z.TOOLTIP || 2000;
Z.DEBUG = Z.DEBUG || 9800;

// very high, but can still add integers
Z.TRANSITION_FINAL = Z.TRANSITION_FINAL || 9900;
// how much Z range can be used for rendering transitions - the capture happens at z + Z_TRANSITION_RANGE
Z.TRANSITION_RANGE = Z.TRANSITION_RANGE || 10;

Z.FPSMETER = Z.FPSMETER || 10000;

const glov_engine = require('./engine.js');
const glov_font = require('./font.js');
const glov_edit_box = require('./edit_box.js');
const { clone, lerp } = require('../../common/util.js');

const { max, min } = Math;
const { m43BuildIdentity, m43Mul, v2Build, v4Build, v4ScalarMul } = VMath;

const MODAL_DARKEN = 0.75;
let glov_input;
let glov_sprite;
let key_codes;
let pad_codes;

export function focuslog(...args) {
  // console.log(`focuslog(${glov_engine.getFrameIndex()}): `, ...args);
}

function doBlurEffect(factor) {
  glov_engine.effects.applyGaussianBlur({
    source: glov_engine.captureFramebuffer(),
    blur: lerp(factor, 0.125, 0.865),
    // min_size: 128,
  });
}

let desaturate_xform = m43BuildIdentity();
let desaturate_tmp = m43BuildIdentity();
function doDesaturateEffect(factor) {
  m43BuildIdentity(desaturate_xform);

  glov_engine.effects.saturationMatrix(lerp(factor, 0.5, 0.1), desaturate_tmp);
  m43Mul(desaturate_xform, desaturate_tmp, desaturate_xform);

  glov_engine.effects.brightnessScaleMatrix(lerp(factor, 1, 1 - MODAL_DARKEN), desaturate_tmp);
  m43Mul(desaturate_xform, desaturate_tmp, desaturate_xform);

  // if ((hue % (Math.PI * 2)) !== 0) {
  //   glov_engine.effects.hueMatrix(hue, tmp);
  //   m43Mul(xform, tmp, xform);
  // }
  // if (contrast !== 1) {
  //   glov_engine.effects.contrastMatrix(contrast, tmp);
  //   m43Mul(xform, tmp, xform);
  // }
  // if (brightness !== 0) {
  //   glov_engine.effects.brightnessMatrix(brightness, tmp);
  //   m43Mul(xform, tmp, xform);
  // }
  // if (additiveRGB[0] !== 0 || additiveRGB[1] !== 0 || additiveRGB[2] !== 0) {
  //   glov_engine.effects.additiveMatrix(additiveRGB, tmp);
  //   m43Mul(xform, tmp, xform);
  // }
  // if (grayscale) {
  //   glov_engine.effects.grayScaleMatrix(tmp);
  //   m43Mul(xform, tmp, xform);
  // }
  // if (negative) {
  //   glov_engine.effects.negativeMatrix(tmp);
  //   m43Mul(xform, tmp, xform);
  // }
  // if (sepia) {
  //   glov_engine.effects.sepiaMatrix(tmp);
  //   m43Mul(xform, tmp, xform);
  // }
  glov_engine.effects.applyColorMatrix({
    colorMatrix: desaturate_xform,
    source: glov_engine.captureFramebuffer(),
  });
}

export function makeColorSet(color) {
  let ret = {
    regular: v4ScalarMul(color, 1),
    rollover: v4ScalarMul(color, 0.8),
    down: v4ScalarMul(color, 0.7),
    disabled: v4ScalarMul(color, 0.4),
  };
  for (let field in ret) {
    ret[field][3] = color[3];
  }
  return ret;
}

class GlovUI {

  constructor(font, draw_list, ui_sprites) {
    ui_sprites = ui_sprites || {};
    glov_input = glov_engine.glov_input;
    glov_sprite = glov_engine.glov_sprite;
    assert(glov_input);
    assert(glov_sprite);
    this.font = font;
    this.draw_list = draw_list;
    this.camera = glov_input.camera;
    key_codes = glov_input.key_codes;
    pad_codes = glov_input.pad_codes;

    this.color_button = makeColorSet([1,1,1,1]);
    this.color_panel = v4Build(1, 1, 0.75, 1);
    this.color_modal_darken = v4Build(0, 0, 0, MODAL_DARKEN);

    this.modal_font_style = glov_font.styleColored(null, 0x000000ff);

    let sprites = this.sprites = {};
    function loadUISprite(name, ws, hs, only_override) {
      let override = ui_sprites[name];
      if (override) {
        sprites[name] = glov_sprite.createSpriteSimple(override[0], override[1], override[2], glov_sprite.origin_0_0);
      } else if (!only_override) {
        sprites[name] = glov_sprite.createSpriteSimple(`ui/${name}.png`, ws, hs, glov_sprite.origin_0_0);
      }
    }

    loadUISprite('button', [4, 5, 4], [13]);
    sprites.button_regular = sprites.button;
    loadUISprite('button_rollover', [4, 5, 4], [13], true);
    loadUISprite('button_down', [4, 5, 4], [13]);
    loadUISprite('button_disabled', [4, 5, 4], [13]);
    loadUISprite('panel', [3, 2, 3], [3, 10, 3]);
    loadUISprite('menu_entry', [4, 5, 4], [13]);
    loadUISprite('menu_selected', [4, 5, 4], [13]);
    loadUISprite('menu_down', [4, 5, 4], [13]);
    loadUISprite('menu_header', [4, 5, 12], [13]);

    sprites.white = glov_sprite.createSpriteSimple('white', 1, 1, glov_sprite.origin_0_0);
    ['circle', 'cone', 'hollow_circle', 'line'].forEach((key) => {
      let size = key === 'hollow_circle' ? 128 : 32;
      sprites[key] = glov_sprite.createSpriteSimple(`glov/util_${key}.png`, size, size);
    });

    this.sounds = {};

    this.button_mouseover = false; // for callers to poll the very last button
    this.button_focused = false; // for callers to poll the very last button
    this.touch_changed_focus = false; // did a touch even this frame change focus?
    // For tracking global mouseover state
    this.last_frame_button_mouseover = false;
    this.frame_button_mouseover = false;

    this.modal_dialog = null;
    this.modal_stealing_focus = false;
    this.menu_up = false; // Boolean to be set by app to impact behavior, similar to a modal
    this.menu_up_time = 0;

    this.this_frame_edit_boxes = [];
    this.last_frame_edit_boxes = [];
    this.dom_elems = [];
    this.dom_elems_issued = 0;

    // for modal dialogs
    this.button_keys = {
      ok: { key: [], pad: [pad_codes.X] },
      cancel: { key: [key_codes.ESCAPE], pad: [pad_codes.B, pad_codes.Y] },
    };
    this.button_keys.yes = clone(this.button_keys.ok);
    this.button_keys.yes.key.push(key_codes.Y);
    this.button_keys.no = clone(this.button_keys.cancel);
    this.button_keys.no.key.push(key_codes.N);
  }

  getElem() {
    if (this.modal_dialog) {
      return null;
    }
    if (this.dom_elems_issued >= this.dom_elems.length) {
      let elem = $('<div class="glovui_dynamic"></div>');
      $('#dynamic_text').append(elem);
      this.dom_elems.push(elem);
    }
    let elem = this.dom_elems[this.dom_elems_issued];
    this.dom_elems_issued++;
    return elem;
  }

  bindSounds(sound_manager, sounds) {
    this.sound_manager = sound_manager;
    this.sounds = sounds;
    for (let key in sounds) {
      sound_manager.loadSound(sounds[key]);
    }
  }

  drawHBox(coords, s, color) {
    let uidata = s.uidata;
    let ws = [uidata.wh[0] * coords.h, 0, uidata.wh[2] * coords.h];
    let x = coords.x;
    ws[1] = max(0, coords.w - ws[0] - ws[2]);
    for (let ii = 0; ii < ws.length; ++ii) {
      let my_w = ws[ii];
      this.draw_list.queue(s, x, coords.y, coords.z, color, [my_w, coords.h, 1, 1], uidata.rects[ii]);
      x += my_w;
    }
  }

  drawBox(coords, s, pixel_scale, color) {
    let uidata = s.uidata;
    let scale = pixel_scale;
    let ws = [uidata.widths[0] * scale, 0, uidata.widths[2] * scale];
    ws[1] = max(0, coords.w - ws[0] - ws[2]);
    let hs = [uidata.heights[0] * scale, 0, uidata.heights[2] * scale];
    hs[1] = max(0, coords.h - hs[0] - hs[2]);
    let x = coords.x;
    for (let ii = 0; ii < ws.length; ++ii) {
      let my_w = ws[ii];
      if (my_w) {
        let y = coords.y;
        for (let jj = 0; jj < hs.length; ++jj) {
          let my_h = hs[jj];
          if (my_h) {
            this.draw_list.queue(s, x, y, coords.z, color, [my_w, my_h, 1, 1], uidata.rects[jj * 3 + ii]);
            y += my_h;
          }
        }
        x += my_w;
      }
    }
  }

  playUISound(name) {
    if (name === 'select') {
      name = 'button_click';
    }
    if (this.sounds[name]) {
      this.sound_manager.play(this.sounds[name]);
    }
  }

  setMouseOver(key) {
    if (this.last_frame_button_mouseover !== key && this.frame_button_mouseover !== key) {
      this.playUISound('rollover');
    }
    this.frame_button_mouseover = key;
    this.button_mouseover = true;
  }

  drawTooltip(param) {
    assert(typeof param.x === 'number');
    assert(typeof param.y === 'number');
    assert(typeof param.tooltip === 'string');

    let tooltip_w = param.tooltip_width || this.tooltip_width;
    let x = param.x;
    if (x + tooltip_w > this.camera.x1()) {
      x = this.camera.x1() - tooltip_w;
    }
    let z = param.z || Z.TOOLTIP;
    let tooltip_y0 = param.y;
    let tooltip_pad = param.tooltip_pad || this.tooltip_pad;
    let y = tooltip_y0 + tooltip_pad;
    y += this.font.drawSizedWrapped(this.modal_font_style,
      x + tooltip_pad, y, z+1, tooltip_w - tooltip_pad * 2, 0, this.font_height,
      param.tooltip);
    y += tooltip_pad;

    this.panel({
      x,
      y: tooltip_y0,
      z,
      w: tooltip_w,
      h: y - tooltip_y0,
    });
  }

  buttonShared(param) {
    let state = 'regular';
    let ret = false;
    let key = param.key || `${param.x}_${param.y}`;
    let focused = !param.disabled && !param.no_focus && this.focusCheck(key);
    this.button_mouseover = false;
    if (param.disabled) {
      state = 'disabled';
    } else if (glov_input.clickHit(param)) {
      if (!param.no_touch_mouseover || !glov_input.mousePosIsTouch()) {
        this.setMouseOver(key);
      }
      if (param.touch_twice && glov_input.mousePosIsTouch() && !focused) {
        // Just focus, show tooltip
        this.touch_changed_focus = true;
      } else {
        ret = true;
      }
      if (!param.no_focus) {
        this.focusSteal(key);
        focused = true;
      }
    } else if (glov_input.isMouseOver(param)) {
      if (param.no_touch_mouseover && glov_input.mousePosIsTouch()) {
        // do not set mouseover
      } else if (param.touch_twice && !focused && glov_input.mousePosIsTouch()) {
        // do not set mouseover
      } else {
        this.setMouseOver(key);
        state = glov_input.isMouseDown() ? 'down' : 'rollover';
      }
    }
    this.button_focused = focused;
    if (focused) {
      if (glov_input.keyDownHit(key_codes.SPACE) || glov_input.keyDownHit(key_codes.RETURN) ||
        glov_input.padDownHit(pad_codes.A)
      ) {
        ret = true;
      }
    }
    if (ret) {
      state = 'down';
      this.playUISound('button_click');
    }
    if (this.button_mouseover && param.tooltip) {
      this.drawTooltip({
        x: param.x,
        y: param.tooltip_above ? param.y - this.font_height * 2 - 16 : param.y + param.h + 2,
        tooltip: param.tooltip,
        tooltip_width: param.tooltip_width,
      });
    }
    return { ret, state, focused };
  }

  buttonText(param) {
    // required params
    assert(typeof param.x === 'number');
    assert(typeof param.y === 'number');
    assert(typeof param.text === 'string');
    // optional params
    param.z = param.z || Z.UI;
    param.w = param.w || this.button_width;
    param.h = param.h || this.button_height;
    param.font_height = param.font_height || this.font_height;

    let { ret, state, focused } = this.buttonShared(param);
    let colors = param.colors || this.color_button;
    let color = colors[state];
    let sprite_name = `button_${state}`;
    let sprite = this.sprites[sprite_name];
    if (sprite) { // specific sprite, use regular colors
      color = colors.regular;
    } else {
      sprite = this.sprites.button;
    }

    this.drawHBox(param, sprite, color);
    this.font.drawSizedAligned(
      focused ? this.font_style_focused : this.font_style_normal,
      param.x, param.y, param.z + 0.1,
      // eslint-disable-next-line no-bitwise
      param.font_height, glov_font.ALIGN.HCENTERFIT | glov_font.ALIGN.VCENTER, param.w, param.h, param.text);
    return ret;
  }

  buttonImage(param) {
    // required params
    assert(typeof param.x === 'number');
    assert(typeof param.y === 'number');
    assert(param.img && param.img.getWidth); // should be a sprite
    // optional params
    param.z = param.z || Z.UI;
    param.w = param.w || this.button_img_size;
    param.h = param.h || param.w || this.button_img_size;
    //param.img_rect; null -> full image

    let { ret, state } = this.buttonShared(param);
    let colors = param.colors || this.color_button;
    let color = colors[state];

    this.drawHBox(param, this.sprites.button, color);
    let img_w = param.img.getWidth();
    let img_h = param.img.getHeight();
    let img_origin = param.img.getOrigin();
    let img_scale = 1;
    img_scale = min(img_scale, (param.w * 0.75) / img_w);
    img_scale = min(img_scale, (param.h * 0.75) / img_h);
    img_w *= img_scale;
    img_h *= img_scale;
    if (param.color1) {
      this.draw_list.queueDualTint(param.img,
        param.x + (param.w - img_w) / 2 + img_origin[0] * img_scale,
        param.y + (param.h - img_h) / 2 + img_origin[1] * img_scale,
        param.z + 0.1,
        color, param.color1,
        [img_scale, img_scale, 1, 1], param.img_rect,
        param.rotation, param.bucket);
    } else {
      this.draw_list.queue(param.img,
        param.x + (param.w - img_w) / 2 + img_origin[0] * img_scale,
        param.y + (param.h - img_h) / 2 + img_origin[1] * img_scale,
        param.z + 0.1,
        color, [img_scale, img_scale, 1, 1], param.img_rect,
        param.rotation, param.bucket);
    }
    return ret;
  }

  print(style, x, y, z, text) {
    return this.font.drawSized(style, x, y, z, this.font_height, text);
  }

  panel(param) {
    assert(typeof param.x === 'number');
    assert(typeof param.y === 'number');
    assert(typeof param.w === 'number');
    assert(typeof param.h === 'number');
    param.z = param.z || (Z.UI - 1);
    let color = param.color || this.color_panel;
    this.drawBox(param, this.sprites.panel, this.panel_pixel_scale, color);
    glov_input.clickHit(param);
    glov_input.isMouseOver(param);
  }

  // Note: modal dialogs not really compatible with HTML overlay on top of the canvas!
  modalDialog(params) {
    assert(!params.title || typeof params.title === 'string');
    assert(!params.text || typeof params.text === 'string');
    assert(typeof params.buttons === 'object');
    assert(Object.keys(params.buttons).length);

    this.modal_dialog = params;
  }

  modalDialogRun(modal_dialog) {
    const button_width = modal_dialog.button_width || this.button_width / 2;
    const game_width = this.camera.x1() - this.camera.x0();
    const pad = this.pad;
    const text_w = this.modal_width - pad * 2;
    const x0 = this.camera.x0() + (game_width - this.modal_width) / 2;
    let x = x0 + pad;
    const y0 = this.modal_y0;
    let y = y0 + pad;
    let font_height = modal_dialog.font_height || this.font_height;

    if (modal_dialog.title) {
      y += this.font.drawSizedWrapped(this.modal_font_style,
        x, y, Z.MODAL, text_w, 0, font_height * this.modal_title_scale,
        modal_dialog.title);
      y += pad * 1.5;
    }

    if (modal_dialog.text) {
      y += this.font.drawSizedWrapped(this.modal_font_style, x, y, Z.MODAL, text_w, 0, font_height,
        modal_dialog.text);
      y += pad;
    }

    let keys = Object.keys(modal_dialog.buttons);
    x = x0 + this.modal_width - pad - button_width - (pad + button_width) * (keys.length - 1);
    for (let ii = 0; ii < keys.length; ++ii) {
      let key = keys[ii];
      let button_keys = this.button_keys[key.toLowerCase()];
      let pressed = false;
      if (button_keys) {
        for (let jj = 0; jj < button_keys.key.length; ++jj) {
          pressed = pressed || glov_input.keyDownHit(button_keys.key[jj]);
        }
        for (let jj = 0; jj < button_keys.pad.length; ++jj) {
          pressed = pressed || glov_input.padDownHit(button_keys.pad[jj]);
        }
      }
      if (pressed) {
        this.playUISound('button_click');
      }
      if (this.buttonText({
        x: x,
        y,
        z: Z.MODAL,
        w: button_width,
        h: this.button_height,
        text: key
      }) || pressed
      ) {
        this.modal_dialog = null;
        if (modal_dialog.buttons[key]) {
          modal_dialog.buttons[key]();
        }
      }
      x += pad + button_width;
    }
    y += this.button_height;
    y += pad * 2;
    this.panel({
      x: x0,
      y: y0,
      z: Z.MODAL - 1,
      w: this.modal_width,
      h: y - y0,
    });

    glov_input.eatAllInput();
    this.modal_stealing_focus = true;
  }

  htmlPos(x, y) {
    const ymin = this.camera.y0();
    const ymax = this.camera.y1();
    const xmin = this.camera.x0();
    const xmax = this.camera.x1();
    return [100 * (x - xmin) / (xmax - xmin), 100 * (y - ymin) / (ymax - ymin)];
  }
  htmlSize(w, h) {
    const ymin = this.camera.y0();
    const ymax = this.camera.y1();
    const xmin = this.camera.x0();
    const xmax = this.camera.x1();
    return [100 * w / (xmax - xmin), 100 * h / (ymax - ymin)];
  }

  // eslint-disable-next-line class-methods-use-this
  createEditBox(params) {
    return glov_edit_box.create(params);
  }

  tick(dt) {
    this.last_frame_button_mouseover = this.frame_button_mouseover;
    this.frame_button_mouseover = false;
    this.focused_last_frame = this.focused_this_frame;
    this.focused_this_frame = false;
    this.focused_key_not = null;
    this.modal_stealing_focus = false;
    this.touch_changed_focus = false;

    for (let ii = 0; ii < this.last_frame_edit_boxes.length; ++ii) {
      let edit_box = this.last_frame_edit_boxes[ii];
      let idx = this.this_frame_edit_boxes.indexOf(edit_box);
      if (idx === -1) {
        edit_box.unrun();
      }
    }
    this.last_frame_edit_boxes = this.this_frame_edit_boxes;
    this.this_frame_edit_boxes = [];

    while (this.dom_elems_issued < this.dom_elems.length) {
      let elem = this.dom_elems.pop();
      elem.remove();
    }
    this.dom_elems_issued = 0;

    let pp_this_frame = false;
    if (this.modal_dialog || this.menu_up) {
      this.menu_up_time += dt;
      // Effects during modal dialogs, may need option to disable or customize these
      if (glov_engine.postprocessing) {
        let factor = min(this.menu_up_time / 500, 1);
        this.draw_list.queuefn(Z.MODAL - 2, doBlurEffect.bind(this, factor));
        this.draw_list.queuefn(Z.MODAL - 1, doDesaturateEffect.bind(this, factor));
        pp_this_frame = true;
      } else {
        // Just darken
        this.draw_list.queue(this.sprites.white, this.camera.x0(), this.camera.y0(), Z.MODAL - 2,
          this.color_modal_darken,
          [this.camera.x1() - this.camera.x0(), this.camera.y1() - this.camera.y0(), 1, 1]);
      }
    } else {
      this.menu_up_time = 0;
    }
    this.menu_up = false;

    if (!glov_engine.is_loading && glov_engine.getFrameDtActual() > 250 && pp_this_frame) {
      this.bad_frames = (this.bad_frames || 0) + 1;
      if (this.bad_frames >= 3) { // 3 in a row, disable superfluous postprocessing
        glov_engine.postprocessingAllow(false);
      }
    } else if (this.bad_frames) {
      this.bad_frames = 0;
    }

    if (this.modal_dialog) {
      this.modalDialogRun(this.modal_dialog);
    }
  }

  endFrame() {
    // allow focusing the canvas, in case there's only one edit box/UI element
    this.focusCheck('canvas');
    if (glov_input.clickHit({
      x: -Infinity, y: -Infinity,
      w: Infinity, h: Infinity,
    })) {
      this.focusSteal('canvas');
    }
  }

  menuUp() {
    this.menu_up = true;
    this.modal_stealing_focus = true;
    glov_input.eatAllInput();
  }

  focusSteal(key) {
    if (key !== this.focused_key) {
      focuslog('focusSteal ', key);
    }
    this.focused_this_frame = true;
    this.focused_key = key;
  }

  focusCanvas() {
    this.focusSteal('canvas');
  }

  isFocusedPeek(key) {
    return this.focused_key === key;
  }
  isFocused(key) {
    if (key !== this.focused_key_prev2) {
      this.focused_key_prev1 = this.focused_key_prev2;
      this.focused_key_prev2 = key;
    }
    if (key === this.focused_key || key !== this.focused_key_not && !this.focused_this_frame &&
      !this.focused_last_frame
    ) {
      if (key !== this.focused_key) {
        focuslog('isFocused->focusSteal');
      }
      this.focusSteal(key);
      return true;
    }
    return false;
  }

  focusNext(key) {
    focuslog('focusNext ', key);
    this.playUISound('rollover');
    this.focused_key = null;
    this.focused_last_frame = this.focused_this_frame = false;
    this.focused_key_not = key;
    // Eat input events so a pair of keys (e.g. SDLK_DOWN and SDLK_CONTROLLER_DOWN)
    // don't get consumed by two separate widgets
    glov_input.eatAllInput();
  }

  focusPrev(key) {
    focuslog('focusPrev ', key);
    this.playUISound('rollover');
    if (key === this.focused_key_prev2) {
      this.focusSteal(this.focused_key_prev1);
    } else {
      this.focusSteal(this.focused_key_prev2);
    }
    glov_input.eatAllInput();
  }

  focusCheck(key) {
    if (this.modal_stealing_focus) {
      // hidden by modal, etc
      return false;
    }
    // Returns true even if focusing previous element, since for this frame, we are still effectively focused!
    let focused = this.isFocused(key);
    if (focused) {
      if (glov_input.keyDownHit(key_codes.TAB)) {
        if (glov_input.isKeyDown(key_codes.SHIFT)) {
          this.focusPrev(key);
        } else {
          this.focusNext(key);
          focused = false;
        }
      }
      if (glov_input.padDownHit(pad_codes.RIGHT_SHOULDER)) {
        this.focusNext(key);
        focused = false;
      }
      if (glov_input.padDownHit(pad_codes.LEFT_SHOULDER)) {
        this.focusPrev(key);
      }
    }
    return focused;
  }


  drawRect(x0, y0, x1, y1, z, color) {
    let mx = min(x0, x1);
    let my = min(y0, y1);
    let Mx = max(x0, x1);
    let My = max(y0, y1);
    this.draw_list.queue(this.sprites.white, mx, my, z, color, v2Build(Mx - mx, My - my));
  }

  _spreadTechParams(spread) {
    // spread=0 -> 1
    // spread=0.5 -> 2
    // spread=0.75 -> 4
    // spread=1 -> large enough to AA
    spread = min(max(spread, 0), 0.99);

    let tech_params = {
      clipSpace: this.draw_list.draw_2d.clipSpace,
      param0: v4Build(0,0,0,0),
      texture: null
    };

    tech_params.param0[0] = 1 / (1 - spread);
    tech_params.param0[1] = -0.5 * tech_params.param0[0] + 0.5;
    return tech_params;
  }

  _drawCircleInternal(sprite, x, y, z, r, spread, tu1, tv1, tu2, tv2, color) {
    let x0 = x - r * 2 + r * 4 * tu1;
    let x1 = x - r * 2 + r * 4 * tu2;
    let y0 = y - r * 2 + r * 4 * tv1;
    let y1 = y - r * 2 + r * 4 * tv2;
    let elem = this.draw_list.queueraw(sprite._textures[0],
      x0, y0, z, x1 - x0, y1 - y0,
      tu1, tv1, tu2, tv2,
      color, 0, 'font_aa');
    elem.tech_params = this._spreadTechParams(spread);
  }

  drawCircle(x, y, z, r, spread, color) {
    this._drawCircleInternal(this.sprites.circle, x, y, z, r, spread, 0, 0, 1, 1, color);
  }

  drawHollowCircle(x, y, z, r, spread, color) {
    this._drawCircleInternal(this.sprites.hollow_circle, x, y, z, r, spread, 0, 0, 1, 1, color);
  }

  drawLine(x0, y0, x1, y1, z, w, spread, color) {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let length = Math.sqrt(dx*dx + dy*dy);
    dx /= length;
    dy /= length;
    let tangx = -dy * w;
    let tangy = dx * w;

    this.draw_list.queueraw4(this.sprites.line._textures[0],
      x0 + tangx, y0 + tangy,
      x0 - tangx, y0 - tangy,
      x1 - tangx, y1 - tangy,
      x1 + tangx, y1 + tangy,
      z,
      0, 0, 1, 1,
      color, 'font_aa', this._spreadTechParams(spread));
  }

  drawCone(x0, y0, x1, y1, z, w0, w1, spread, color) {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let length = Math.sqrt(dx*dx + dy*dy);
    dx /= length;
    dy /= length;
    let tangx = -dy;
    let tangy = dx;
    this.draw_list.queueraw4(this.sprites.cone._textures[0],
      x0 - tangx*w0, y0 - tangy*w0,
      x1 - tangx*w1, y1 - tangy*w1,
      x1 + tangx*w1, y1 + tangy*w1,
      x0 + tangx*w0, y0 + tangy*w0,
      z,
      0, 0, 1, 1,
      color, 'font_aa', this._spreadTechParams(spread));
  }

  scaleSizes(scale) {
    this.button_height *= scale;
    this.font_height *= scale;
    this.button_width *= scale;
    this.button_img_size *= scale;
    this.modal_width *= scale;
    this.modal_y0 *= scale;
    this.modal_title_scale *= scale;
    this.pad *= scale;
    this.panel_pixel_scale = this.button_height / 13; // button_height / button pixel resolution
    this.tooltip_width *= scale;
    this.tooltip_pad *= scale;
  }
}


// overrideable default parameters
GlovUI.prototype.button_height = 32;
GlovUI.prototype.font_height = 24;
GlovUI.prototype.button_width = 200;
GlovUI.prototype.button_img_size = GlovUI.prototype.button_height;
GlovUI.prototype.modal_width = 600;
GlovUI.prototype.modal_y0 = 200;
GlovUI.prototype.modal_title_scale = 1.2;
GlovUI.prototype.pad = 16;
GlovUI.prototype.panel_pixel_scale = 32 / 13; // button_height / button pixel resolution
GlovUI.prototype.tooltip_width = 400;
GlovUI.prototype.tooltip_pad = 8;

GlovUI.prototype.font_style_focused = glov_font.style(null, {
  color: 0x000000ff,
  outline_width: 2,
  outline_color: 0xFFFFFFff,
});
GlovUI.prototype.font_style_normal = glov_font.styleColored(null, 0x000000ff);


export function create(...args) {
  return new GlovUI(...args);
}
