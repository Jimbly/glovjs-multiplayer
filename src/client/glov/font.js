/* eslint no-bitwise:off */
/* eslint complexity:off */
/* eslint no-shadow:off */
/*global assert: true */
/*global VMath: false */

const fs = require('fs');
let VMathArrayConstructor = VMath.F32Array;

/*

font_style = glov_font.style(null, {
  color: 0xFFFFFFff,
  outline_width: 0,
  outline_color: 0x00000000,
  glow_xoffs: 0,
  glow_yoffs: 0,
  glow_inner: 0,
  glow_outer: 0,
  glow_color: 0x000000ff,
});

 */

// typedef struct FontCharInfo {
//   int c;
//   float x0;
//   float y0;
//   int w;
//   int h;
//   int imgIdx;
// } FontCharInfo;

// typedef struct FontInfo {
//   AS_NAME(CharInfo) FontCharInfo **char_infos;
//   int font_size;
//   float x0;
//   float y0;
//   int imageW;
//   int imageH;
//   int spread;
// } FontInfo;

export const COLOR_MODE = {
  SINGLE: 0,
  GRADIENT: 1,
};

export const ALIGN = {
  HLEFT: 0,
  HCENTER: 1,
  HRIGHT: 2,
  HMASK: 3,

  VTOP: 0 << 2,
  VCENTER: 1 << 2,
  VBOTTOM: 2 << 2,
  VMASK: 3 << 2,

  HFIT: 1 << 4,
  HWRAP: 1 << 5, // only for glovMarkup*, not drawSizedAligned below, use drawSizedWrapped below instead

  HCENTERFIT: 1 | (1 << 4),
  HVCENTER: 1 | (1 << 2), // to avoid doing bitwise ops elsewhere
  HVCENTERFIT: 1 | (1 << 2) | (1 << 4), // to avoid doing bitwise ops elsewhere
};


// typedef struct GlovFontStyle
// {
//   // These members will never be changed (safe to initialize with GlovFontStyle foo = {1.0, 0xfff, etc};
//   float outline_width;
//   U32 outline_color;
//   // Glow: can be used for a dropshadow as well
//   //   inner can be negative to have the glow be less opaque (can also just change the alpha of the glow color)
//   //   a glow would be e.g. (0, 0, -1, 5)
//   //   a dropshadow would be e.g. (3.25, 3.25, -2.5, 5)
//   float glow_xoffs;
//   float glow_yoffs;
//   float glow_inner;
//   float glow_outer;
//   U32 glow_color;
//   U32 color; // upper left, or single color
//   U32 colorUR; // upper right
//   U32 colorLR; // lower right
//   U32 colorLL; // lower left
//   GlovFontColorMode color_mode;
// } GlovFontStyle;

/* Default GlovFontStyle:
  font_style = {
    outline_width: 0, outline_color: 0x00000000,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 0, glow_color: 0x00000000,
    color: 0xFFFFFFff
  };

  font_style = {
    outline_width: 0, outline_color: 0x00000000,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 0, glow_color: 0x00000000,
    // Color gradient: UL, UR, LR, LL
    color: 0xFFFFFFff, colorUR: 0xFFFFFFff, colorLR: 0x000000ff, colorLL: 0x000000ff,
    color_mode: glov_font.COLOR_MODE.GRADIENT,
  };
*/

function GlovFontDefaultStyle() {
  // Empty constructor
}
GlovFontDefaultStyle.prototype.outline_width = 0;
GlovFontDefaultStyle.prototype.outline_color = 0x00000000;
GlovFontDefaultStyle.prototype.glow_xoffs = 0;
GlovFontDefaultStyle.prototype.glow_yoffs = 0;
GlovFontDefaultStyle.prototype.glow_inner = 0;
GlovFontDefaultStyle.prototype.glow_outer = 0;
GlovFontDefaultStyle.prototype.glow_color = 0x00000000;
GlovFontDefaultStyle.prototype.color = 0xFFFFFFff;
GlovFontDefaultStyle.prototype.colorUR = 0;
GlovFontDefaultStyle.prototype.colorLR = 0;
GlovFontDefaultStyle.prototype.colorLL = 0;
GlovFontDefaultStyle.prototype.color_mode = COLOR_MODE.SINGLE;

class GlovFontStyle extends GlovFontDefaultStyle {
}

function vec4ColorFromIntColor(v, c) {
  v[0] = ((c >> 24) & 0xFF) / 255;
  v[1] = ((c >> 16) & 0xFF) / 255;
  v[2] = ((c >> 8) & 0xFF) / 255;
  v[3] = (c & 0xFF) / 255;
}

function buildVec4ColorFromIntColor(c) {
  return VMath.v4Build(
    ((c >> 24) & 0xFF) / 255,
    ((c >> 16) & 0xFF) / 255,
    ((c >> 8) & 0xFF) / 255,
    (c & 0xFF) / 255
  );
}

export const glov_font_default_style = new GlovFontStyle();

export function style(font_style, fields) {
  let ret = new GlovFontStyle();
  if (font_style) {
    for (let f in font_style) {
      ret[f] = font_style[f];
    }
  }
  for (let f in fields) {
    ret[f] = fields[f];
  }
  return ret;
}

export function styleColored(font_style, color) {
  return style(font_style, {
    color
  });
}

let gd_params = null;
let tech_params = null;
let tech_params_dirty = false;
let temp_color = null;

function createTechniqueParameters(draw_2d) {
  if (tech_params) {
    return;
  }

  tech_params = {
    clipSpace: draw_2d.clipSpace,
    param0: new VMathArrayConstructor(4),
    outlineColor: new VMathArrayConstructor(4),
    glowColor: new VMathArrayConstructor(4),
    glowParams: new VMathArrayConstructor(4),
    tex0: null
  };
  if (!temp_color) {
    temp_color = new VMathArrayConstructor(4);
  }
}

function techParamsSet(param, value) {
  let tpv = tech_params[param];
  // not dirty, if anything changes, we need a new object!
  if (!tech_params_dirty) {
    if (tpv[0] !== value[0] || tpv[1] !== value[1] || tpv[2] !== value[2] || tpv[3] !== value[3]) {
      // clone
      tech_params = {
        clipSpace: tech_params.clipSpace,
        param0: new VMathArrayConstructor(tech_params.param0),
        outlineColor: new VMathArrayConstructor(tech_params.outlineColor),
        glowColor: new VMathArrayConstructor(tech_params.glowColor),
        glowParams: new VMathArrayConstructor(tech_params.glowParams),
        tex0: tech_params.tex0,
      };
      tech_params_dirty = true;
      tpv = tech_params[param];
    } else {
      // identical, do nothing
      return;
    }
  }
  if (tech_params_dirty) {
    // just set
    tpv[0] = value[0];
    tpv[1] = value[1];
    tpv[2] = value[2];
    tpv[3] = value[3];
    // return;
  }
}

function techParamsGet() {
  tech_params_dirty = false;
  return tech_params;
}

class GlovFont {
  constructor(draw_list, font_info, texture) {
    assert(gd_params);
    assert(font_info.font_size!==0); // Got lost somewhere

    this.texture = texture;
    this.font_info = font_info;
    this.blend_mode = 'font_aa';
    this.draw_2d = draw_list.draw_2d;
    this.draw_list = draw_list;
    this.camera = this.draw_list.camera;

    // build lookup
    this.char_infos = [];
    for (let ii = 0; ii < font_info.char_infos.length; ++ii) {
      let char_info = font_info.char_infos[ii];
      this.char_infos[font_info.char_infos[ii].c] = char_info;
      char_info.xpad = char_info.xpad || 0;
      char_info.yoffs = char_info.yoffs || 0;
    }

    this.default_style = new GlovFontStyle();
    this.applied_style = new GlovFontStyle();

    createTechniqueParameters(this.draw_2d);
  }

  // General draw functions return width
  // Pass NULL for style to use default style
  // If the function takes a color, this overrides the color on the style
  drawSizedColor(style, x, y, z, size, color, text) {
    return this.drawSized(styleColored(style, color), x, y, z, size, text);
  }
  drawSized(style, x, y, z, size, text) {
    return this.drawScaled(style, x, y, z, size / this.font_info.font_size, size / this.font_info.font_size, text);
  }

  drawSizedAligned(style, _x, _y, z, size, align, w, h, text) {
    let x_size = size;
    let y_size = size;
    let width = this.getStringWidth(style, x_size, text);
    if ((align & ALIGN.HFIT) && width > w) {
      let scale = w / width;
      x_size *= scale;
      width = w;
      // Additionally, if we're really squishing things horizontally, shrink the font size
      // and offset to be centered.
      if (scale < 0.5) {
        if ((align & ALIGN.VMASK) !== ALIGN.VCENTER && (align & ALIGN.VMASK) !== ALIGN.VBOTTOM) {
          // Offset to be roughly centered in the original line bounds
          _y += (y_size - (y_size * scale * 2)) / 2;
        }
        y_size *= scale * 2;
      }
    }
    let height = y_size;
    let x;
    let y;
    switch (align & ALIGN.HMASK) {
      case ALIGN.HCENTER:
        x = _x + (w - width) / 2;
        break;
      case ALIGN.HRIGHT:
        x = _x + w - width;
        break;
      case ALIGN.HLEFT:
        x = _x;
        break;
      default:
        x = _x;
    }
    switch (align & ALIGN.VMASK) {
      case ALIGN.VCENTER:
        y = _y + (h - height) / 2;
        break;
      case ALIGN.VBOTTOM:
        y = _y + h - height;
        break;
      case ALIGN.VTOP:
        y = _y;
        break;
      default:
        y = _y;
    }

    return this.drawScaled(style, x, y, z, x_size / this.font_info.font_size, y_size / this.font_info.font_size, text);
  }

  // returns height
  drawSizedColorWrapped(style, x, y, z, w, indent, size, color, text) {
    return this.drawScaledWrapped(styleColored(style, color), x, y, z, w,
      indent, size / this.font_info.font_size, size / this.font_info.font_size, text);
  }
  drawSizedWrapped(style, x, y, z, w, indent, size, text) {
    return this.drawScaledWrapped(style, x, y, z, w,
      indent, size / this.font_info.font_size, size / this.font_info.font_size, text);
  }

  wrapLines(w, indent, size, text, word_cb /*(x, int linenum, const char *word)*/) {
    return this.wrapLinesScaled(w, indent, size / this.font_info.font_size, text, word_cb);
  }

  infoFromChar(c) {
    let ret = this.char_infos[c];
    if (ret) {
      return ret;
    }
    if (c > 127) {
      // no char info, and non-ascii, non-control code
      return this.char_infos[63]; //['?'];
    }
    return null;
  }

  getCharacterWidth(style, x_size, c) {
    assert(typeof c === 'number');
    this.applyStyle(style);
    let char_info = this.infoFromChar(c);
    let xsc = x_size / this.font_info.font_size;
    let x_advance = this.calcXAdvance(xsc);
    if (char_info) {
      return (char_info.w + char_info.xpad) * xsc + x_advance;
    }
    return 0;
  }

  getStringWidth(style, x_size, text) {
    this.applyStyle(style);
    let ret=0;
    let xsc = x_size / this.font_info.font_size;
    let x_advance = this.calcXAdvance(xsc);
    for (let ii = 0; ii < text.length; ++ii) {
      let c = text.charCodeAt(ii);
      let char_info = this.infoFromChar(c);
      if (!char_info) {
        char_info = this.infoFromChar(13);
      }
      if (char_info) {
        ret += (char_info.w + char_info.xpad) * xsc + x_advance;
      }
    }
    return ret;
  }

  wrapLinesScaled(w, indent, xsc, text, word_cb /* word_cb(x, int linenum, const char *word) */) {
    let len = text.length;
    let s = 0;
    let word_start = 0;
    let word_x0 = 0;
    let x = word_x0;
    let linenum = 0;
    let space_info = this.infoFromChar(32); // ' '
    let space_size = (space_info.w + space_info.xpad) * xsc;
    let hard_wrap = false;
    let x_advance = this.calcXAdvance(xsc);

    do {
      let c = s < len ? text.charCodeAt(s) : 0;
      let newx = x;
      let char_w;
      if (c === 9) { // '\t') {
        let tabsize = xsc * this.font_info.font_size * 4;
        newx = (Math.floor(x / tabsize) + 1) * tabsize;
        char_w = tabsize;
      } else {
        let char_info = this.infoFromChar(c);
        if (!char_info) {
          char_info = this.infoFromChar(10);
        }
        if (char_info) {
          char_w = (char_info.w + char_info.xpad) * xsc + x_advance;
          newx = x + char_w;
        }
      }
      if (newx >= w && hard_wrap) {
        // flush the word so far!
        if (word_cb) {
          word_cb(word_x0, linenum, text.slice(word_start, s));
        }
        word_start = s;
        word_x0 = indent;
        x = word_x0 + char_w;
        linenum++;
      } else {
        x = newx;
      }
      if (!(c === 32 /*' '*/ || c === 0 || c === 10 /*'\n'*/)) {
        s++;
        c = s < len ? text.charCodeAt(s) : 0;
      }
      if (c === 32 /*' '*/ || c === 0 || c === 10 /*'\n'*/) {
        hard_wrap = false;
        // draw word until s
        if (x > w) {
          // maybe wrap
          let word_width = x - word_x0;
          if (word_width > w) {
            // not going to fit, split it up!
            hard_wrap = true;
            // recover and restart at word start
            s = word_start;
            x = word_x0;
            continue;
          } else {
            word_x0 = indent;
            x = word_x0 + word_width;
            linenum++;
          }
        }
        if (word_cb) {
          word_cb(word_x0, linenum, text.slice(word_start, s));
        }
        word_start = s+1;
        if (c === 10 /*'\n'*/) {
          x = indent;
          linenum++;
        } else {
          x += space_size;
        }
        word_x0 = x;
        if (c === 32 /*' '*/ || c === 10 /*'\n'*/) {
          s++; // advance past space
        }
      }
    } while (s < len);
    ++linenum;
    return linenum;
  }

  drawScaledWrapped(style, x, y, z, w, indent, xsc, ysc, text) {
    if (text === null || text === undefined) {
      text = '(null)';
    }
    this.applyStyle(style);
    let num_lines = this.wrapLinesScaled(w, indent, xsc, text, (xoffs, linenum, word) => {
      let y2 = y + this.font_info.font_size * ysc * linenum;
      let x2 = x + xoffs;
      this.drawScaled(style, x2, y2, z, xsc, ysc, word);
    });
    return num_lines * this.font_info.font_size * ysc;
  }

  calcXAdvance(xsc) {
    // Assume called: applyStyle(style);

    // scale all supplied values by this so that if we swap in a font with twice the resolution (and twice the spread)
    //   things look almost identical, just crisper
    let font_texel_scale = this.font_info.font_size / 32;
    // As a compromise, -2 bias here seems to work well
    let x_advance = xsc * font_texel_scale * Math.max(this.applied_style.outline_width - 2, 0);
    // As a compromise, there's a -3 bias in there, so it only kicks in under extreme circumstances
    x_advance = Math.max(x_advance, xsc * font_texel_scale *
      Math.max(this.applied_style.glow_outer - this.applied_style.glow_xoffs - 3, 0));
    return x_advance;
  }

  //////////////////////////////////////////////////////////////////////////
  // Main implementation

  drawScaled(style, _x, y, z, xsc, ysc, text) {

    let x = _x;
    let font_info = this.font_info;
    // Debug: show expect area of glyphs
    // require('./engine.js').glov_ui.drawRect(_x, y,
    //   _x + xsc * font_info.font_size * 20, y + ysc * font_info.font_size,
    //   1000, [1, 0, 1, 0.5]);
    y += (font_info.y_offset || 0) * ysc;
    let tex = this.texture.getTexture();
    if (text === null || text === undefined) {
      text = '(null)';
    }
    const len = text.length;
    if (xsc === 0 || ysc === 0) {
      return 0;
    }

    this.applyStyle(style);

    const avg_scale_font = (xsc + ysc) * 0.5;
    const camera_xscale = this.camera.data[4];
    const camera_yscale = this.camera.data[5];
    let avg_scale_combined = (xsc * camera_xscale + ysc * camera_yscale) * 0.5;
    // avg_scale_combined *= glov_settings.render_scale;

    // scale all supplied values by this so that if we swap in a font with twice the resolution (and twice the spread)
    //   things look almost identical, just crisper
    let font_texel_scale = font_info.font_size / 32;
    let x_advance = this.calcXAdvance(xsc);

    let applied_style = this.applied_style;

    // Calculate anti-aliasing values
    let delta_per_source_pixel = 0.5 / font_info.spread;
    let delta_per_dest_pixel = delta_per_source_pixel / avg_scale_combined;
    let value = [
      1 / delta_per_dest_pixel, // AA Mult and Outline Mult
      -0.5 / delta_per_dest_pixel + 0.5, // AA Add
      // Outline Add
      -0.5 / delta_per_dest_pixel + 0.5 + applied_style.outline_width*font_texel_scale*avg_scale_combined,
      0, // Unused
    ];
    if (value[2] > 0) {
      value[2] = 0;
    }
    let padding1 = Math.max(1, applied_style.outline_width*font_texel_scale*avg_scale_combined);
    let padding4 = [padding1, padding1, padding1, padding1];

    techParamsSet('param0', value);
    let value2 = [
      -applied_style.glow_xoffs * font_texel_scale / tex.width,
      -applied_style.glow_yoffs * font_texel_scale / tex.height,
      // Glow mult
      1 / ((applied_style.glow_outer - applied_style.glow_inner) * delta_per_source_pixel * font_texel_scale),
      -(0.5 - applied_style.glow_outer * delta_per_source_pixel * font_texel_scale) / ((applied_style.glow_outer -
        applied_style.glow_inner) * delta_per_source_pixel * font_texel_scale)
    ];
    if (value2[3] > 0) {
      value2[3] = 0;
    }
    const outer_scaled = applied_style.glow_outer*font_texel_scale;
    padding4[0] = Math.max(outer_scaled*xsc - applied_style.glow_xoffs*font_texel_scale*xsc, padding4[0]);
    padding4[2] = Math.max(outer_scaled*xsc + applied_style.glow_xoffs*font_texel_scale*xsc, padding4[2]);
    padding4[1] = Math.max(outer_scaled*ysc - applied_style.glow_yoffs*font_texel_scale*ysc, padding4[1]);
    padding4[3] = Math.max(outer_scaled*ysc + applied_style.glow_yoffs*font_texel_scale*ysc, padding4[3]);
    techParamsSet('glowParams', value2);

    // Choose appropriate z advance so that character are drawn left to right (or RTL if the glow is on the other side)
    const z_advance = applied_style.glow_xoffs < 0 ? -0.0001 : 0.0001;

    let padding_in_font_space = VMath.v4ScalarMul(padding4, 1 / avg_scale_font);
    for (let ii = 0; ii < 4; ++ii) {
      if (padding_in_font_space[ii] > font_info.spread) {
        // Not enough buffer
        let sc = font_info.spread / padding_in_font_space[ii];
        padding4[ii] *= sc;
        padding_in_font_space[ii] *= sc;
      }
    }

    // For non-1:1 aspect ration rendering, need to scale our coordinates' padding differently in each axis
    let rel_x_scale = xsc / avg_scale_font;
    let rel_y_scale = ysc / avg_scale_font;

    for (let i=0; i<len; i++) {
      const c = text.charCodeAt(i);
      if (c === 9) { // '\t'.charCodeAt(0)) {
        let tabsize = xsc * font_info.font_size * 4;
        x = ((((x - _x) / tabsize) | 0) + 1) * tabsize + _x;
      } else {
        let char_info = this.infoFromChar(c);
        if (!char_info) {
          char_info = this.infoFromChar(13);
        }
        if (char_info) {
          let tile_width = tex.width;
          let tile_height = tex.height;
          let u0 = (char_info.x0 - padding_in_font_space[0]) / tile_width;
          let u1 = (char_info.x0 + char_info.w + padding_in_font_space[2]) / tile_width;
          let v0 = (char_info.y0 - padding_in_font_space[1]) / tile_height;
          let v1 = (char_info.y0 + char_info.h + padding_in_font_space[3]) / tile_height;

          let w = char_info.w * xsc + (padding4[0] + padding4[2]) * rel_x_scale;
          let h = char_info.h * ysc + (padding4[1] + padding4[3]) * rel_y_scale;

          let elem = this.draw_list.queueraw(
            tex,
            x - rel_x_scale * padding4[0], y - rel_y_scale * padding4[2] + char_info.yoffs * ysc,
            z + z_advance * i, w, h,
            u0, v0, u1, v1,
            buildVec4ColorFromIntColor(applied_style.color), 0, this.blend_mode);
          elem.tech_params = techParamsGet();

          x += (char_info.w + char_info.xpad) * xsc + x_advance;
        }
      }
    }
    return x - _x;
  }

  determineShader() {
    let outline = this.applied_style.outline_width && (this.applied_style.outline_color & 0xff);
    let glow = this.applied_style.glow_outer > 0 && (this.applied_style.glow_color & 0xff);
    if (outline) {
      if (glow) {
        this.blend_mode = 'font_aa_outline_glow';
      } else {
        this.blend_mode = 'font_aa_outline';
      }
    } else if (glow) {
      this.blend_mode = 'font_aa_glow';
    } else {
      this.blend_mode = 'font_aa';
    }
    if (this.font_info.noFilter) {
      this.blend_mode += '_nearest';
    }
  }

  applyStyle(style) {
    if (!style) {
      style = this.default_style;
    }
    // outline
    vec4ColorFromIntColor(temp_color, style.outline_color);
    techParamsSet('outlineColor', temp_color);

    // glow
    vec4ColorFromIntColor(temp_color, style.glow_color);
    techParamsSet('glowColor', temp_color);

    // everything else
    this.applied_style.outline_width = style.outline_width;
    this.applied_style.outline_color = style.outline_color;
    this.applied_style.glow_xoffs = style.glow_xoffs;
    this.applied_style.glow_yoffs = style.glow_yoffs;
    this.applied_style.glow_inner = style.glow_inner;
    this.applied_style.glow_outer = style.glow_outer;
    this.applied_style.glow_color = style.glow_color;
    this.applied_style.color = style.color;
    this.applied_style.colorUR = style.colorUR;
    this.applied_style.colorLR = style.colorLR;
    this.applied_style.colorLL = style.colorLL;
    this.applied_style.color_mode = style.color_mode;

    if (this.applied_style.color_mode === COLOR_MODE.SINGLE) {
      this.applied_style.colorUR = this.applied_style.colorLL = this.applied_style.colorLR = this.applied_style.color;
    }

    this.determineShader();
  }
}

export function populateDraw2DParams(params) {
  assert(!gd_params);
  gd_params = params;

  // Set up embedded default shader

  if (params.shaders) {
    // Check for name conflicts
    assert(!params.shaders.font_aa);
    assert(!params.shaders.font_aa_glow);
    assert(!params.shaders.font_aa_outline);
    assert(!params.shaders.font_aa_outline_glow);
  } else {
    params.shaders = {};
  }
  params.shaders.font_aa = {
    fp: fs.readFileSync(`${__dirname}/shaders/font_aa.fp`, 'utf8'),
  };
  params.shaders.font_aa_glow = {
    fp: fs.readFileSync(`${__dirname}/shaders/font_aa_glow.fp`, 'utf8'),
  };
  params.shaders.font_aa_outline = {
    fp: fs.readFileSync(`${__dirname}/shaders/font_aa_outline.fp`, 'utf8'),
  };
  params.shaders.font_aa_outline_glow = {
    fp: fs.readFileSync(`${__dirname}/shaders/font_aa_outline_glow.fp`, 'utf8'),
  };
}

export function create(...args) {
  return new GlovFont(...args);
}
