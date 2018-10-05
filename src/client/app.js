/*jshint noempty:false*/

/*global $: false */
/*global math_device: false */
/*global assert: false */
/*global Z: false */

const cmd_parse = require('../common/cmd_parse.js').create();
const local_storage = require('./local_storage.js');
const particle_data = require('./particle_data.js');
const net = require('./net.js');

local_storage.storage_prefix = 'dsproto';

window.Z = window.Z || {};
Z.BACKGROUND = 0;
Z.SPRITES = 10;
Z.PARTICLES = 20;
Z.BORDERS = 90;
Z.UI = 100;
Z.CHAT = 500;

let app = exports;

// Virtual viewport for our game logic
export const game_width = 1280;
export const game_height = 960;

export function main(canvas)
{
  net.init();
  const glov_engine = require('./glov/engine.js');
  const glov_font = require('./glov/font.js');

  glov_engine.startup({
    canvas,
    game_width,
    game_height,
    pixely: false,
  });

  const sound_manager = glov_engine.sound_manager;
  const glov_camera = glov_engine.glov_camera;
  const glov_input = glov_engine.glov_input;
  const glov_sprite = glov_engine.glov_sprite;
  const glov_ui = glov_engine.glov_ui;
  const draw_list = glov_engine.draw_list;
  // const font = glov_engine.font;


  const loadTexture = glov_sprite.loadTexture.bind(glov_sprite);
  const createSprite = glov_sprite.createSprite.bind(glov_sprite);
  const createAnimation = glov_sprite.createAnimation.bind(glov_sprite);

  glov_ui.bindSounds(sound_manager, {
    button_click: 'button_click',
    rollover: 'rollover',
  });


  app.account_ui = require('./account_ui.js').create();
  app.chat_ui = require('./chat_ui.js').create(cmd_parse);

  const color_white = math_device.v4Build(1, 1, 1, 1);
  const color_gray = math_device.v4Build(0.5, 0.5, 0.5, 1);
  const color_red = math_device.v4Build(1, 0, 0, 1);
  const color_yellow = math_device.v4Build(1, 1, 0, 1);

  // Cache key_codes
  const key_codes = glov_input.key_codes;
  const pad_codes = glov_input.pad_codes;

  let sprites = {};
  const sprite_size = 64;
  function initGraphics() {
    if (sprites.white) {
      return;
    }

    // Preload all referenced particle textures
    for (let key in particle_data.defs) {
      let def = particle_data.defs[key];
      for (let part_name in def.particles) {
        let part_def = def.particles[part_name];
        loadTexture(part_def.texture);
      }
    }

    sound_manager.loadSound('test');

    const origin_0_0 = { origin: math_device.v2Build(0, 0) };

    function loadSprite(file, u, v, params) {
      params = params || {};
      return createSprite(file, {
        width: params.width || 1,
        height: params.height || 1,
        rotation: params.rotation || 0,
        color: params.color || color_white,
        origin: params.origin || undefined,
        u: u,
        v: v,
      });
    }

    sprites.white = loadSprite('white', 1, 1, origin_0_0);

    sprites.test = loadSprite('test.png', sprite_size, sprite_size);
    sprites.test_animated = loadSprite('test_sprite.png', [13, 13], [13, 13]);
    sprites.animation = createAnimation({
      idle: {
        frames: [0,1,2,3],
        times: 200,
      }
    });
    sprites.animation.setState('idle');

    sprites.game_bg = loadSprite('white', 1, 1, {
      width : game_width,
      height : game_height,
      origin: [0, 0],
    });
  }

  function doBlurEffect(src, dest) {
    glov_engine.effects.applyGaussianBlur({
      source: src,
      destination: dest,
      blurRadius: 5,
      blurTarget: glov_engine.getTemporaryTarget(),
    });
  }
  function doDesaturateEffect(src, dest) {
    let saturation = 0.1;

    // Perf note: do not allocate these each frame for better perf
    let xform = math_device.m43BuildIdentity();
    let tmp = math_device.m43BuildIdentity();

    math_device.m43BuildIdentity(xform);
    if (saturation !== 1) {
      glov_engine.effects.saturationMatrix(saturation, tmp);
      math_device.m43Mul(xform, tmp, xform);
    }
    // if ((hue % (Math.PI * 2)) !== 0) {
    //   glov_engine.effects.hueMatrix(hue, tmp);
    //   math_device.m43Mul(xform, tmp, xform);
    // }
    // if (contrast !== 1) {
    //   glov_engine.effects.contrastMatrix(contrast, tmp);
    //   math_device.m43Mul(xform, tmp, xform);
    // }
    // if (brightness !== 0) {
    //   glov_engine.effects.brightnessMatrix(brightness, tmp);
    //   math_device.m43Mul(xform, tmp, xform);
    // }
    // if (additiveRGB[0] !== 0 || additiveRGB[1] !== 0 || additiveRGB[2] !== 0) {
    //   glov_engine.effects.additiveMatrix(additiveRGB, tmp);
    //   math_device.m43Mul(xform, tmp, xform);
    // }
    // if (grayscale) {
    //   glov_engine.effects.grayScaleMatrix(tmp);
    //   math_device.m43Mul(xform, tmp, xform);
    // }
    // if (negative) {
    //   glov_engine.effects.negativeMatrix(tmp);
    //   math_device.m43Mul(xform, tmp, xform);
    // }
    // if (sepia) {
    //   glov_engine.effects.sepiaMatrix(tmp);
    //   math_device.m43Mul(xform, tmp, xform);
    // }
    glov_engine.effects.applyColorMatrix({
      colorMatrix: xform,
      source: src,
      destination: dest,
    });
  }

  let test_room;

  function test(dt) {

    if (!test_room) {
      test_room = net.subs.getChannel('test.test', true);
      app.chat_ui.setChannel(test_room);
    }

    if (!test.color_sprite) {
      test.color_sprite = math_device.v4Copy(color_white);
      test.character = {
        x : (Math.random() * (game_width - sprite_size) + (sprite_size * 0.5)),
        y : (Math.random() * (game_height - sprite_size) + (sprite_size * 0.5)),
      };
      test.last_send = {};
    }

    test.character.dx = 0;
    test.character.dy = 0;
    if (glov_input.isKeyDown(key_codes.LEFT) || glov_input.isKeyDown(key_codes.A) || glov_input.isPadButtonDown(0, pad_codes.LEFT)) {
      test.character.dx = -1;
    } else if (glov_input.isKeyDown(key_codes.RIGHT) || glov_input.isKeyDown(key_codes.D) || glov_input.isPadButtonDown(0, pad_codes.RIGHT)) {
      test.character.dx = 1;
    }
    if (glov_input.isKeyDown(key_codes.UP) || glov_input.isKeyDown(key_codes.W) || glov_input.isPadButtonDown(0, pad_codes.UP)) {
      test.character.dy = -1;
    } else if (glov_input.isKeyDown(key_codes.DOWN) || glov_input.isKeyDown(key_codes.S) || glov_input.isPadButtonDown(0, pad_codes.DOWN)) {
      test.character.dy = 1;
    }

    test.character.x += test.character.dx * dt * 0.2;
    test.character.y += test.character.dy * dt * 0.2;
    let bounds = {
      x: test.character.x - sprite_size/2,
      y: test.character.y - sprite_size/2,
      w: sprite_size,
      h: sprite_size,
    };
    if (glov_input.isMouseDown() && glov_input.isMouseOver(bounds)) {
      math_device.v4Copy(color_yellow, test.color_sprite);
    } else if (glov_input.clickHit(bounds)) {
      math_device.v4Copy((test.color_sprite[2] === 0) ? color_white : color_red, test.color_sprite);
      sound_manager.play('test');
    } else if (glov_input.isMouseOver(bounds)) {
      math_device.v4Copy(color_white, test.color_sprite);
      test.color_sprite[3] = 0.5;
    } else {
      math_device.v4Copy(color_white, test.color_sprite);
      test.color_sprite[3] = 1;
    }

    draw_list.queue(sprites.game_bg, 0, 0, Z.BACKGROUND, [0, 0.72, 1, 1]);
    //draw_list.queue(sprites.test, test.character.x, test.character.y, Z.SPRITES, test.color_sprite, [sprite_size, sprite_size], null, 0, 'alpha');
    sprites.test_animated.draw({
      x: test.character.x,
      y: test.character.y,
      z: Z.SPRITES,
      color: test.color_sprite,
      size: [sprite_size, sprite_size],
      frame: sprites.animation.getFrame(dt),
    });

    // Network send
    if (net.client.id && test_room.data.public) {
      if (test.character.x !== test.last_send.x || test.character.y !== test.last_send.y) {
        // pos changed
        let now = glov_engine.getFrameTimestamp();
        if (!test.last_send.sending && (!test.last_send.time || now - test.last_send.time > 500)) {
          // do send!
          test.last_send.sending = true;
          test.last_send.time = now;
          test.last_send.x = test.character.x;
          test.last_send.y = test.character.y;
          test_room.setChannelData(`public.clients.${net.client.id}.pos`, [test.character.x, test.character.y], false, function () {
            test.last_send.sending = false;
            test.last_send.time = glov_engine.getFrameTimestamp();
          });
        }
      }
    }

    // Draw other users
    let room_clients = test_room.getChannelData('public.clients', {});
    for (let client_id in room_clients) {
      let other_client = room_clients[client_id];
      if (other_client.pos) {
        draw_list.queue(sprites.test, other_client.pos[0], other_client.pos[1], Z.SPRITES - 1, color_gray, [sprite_size, sprite_size], null, 0, 'alpha');
        glov_ui.font.drawSizedAligned(glov_font.styleColored(null, 0x00000080), other_client.pos[0], other_client.pos[1] - 64, Z.SPRITES - 1,
          glov_ui.font_height, glov_font.ALIGN.HCENTER, 0, 0,
          other_client.ids.display_name || `client_${client_id}`);
      }
    }

    app.chat_ui.run(dt);
    app.account_ui.showLogin();
  }

  function testInit(dt) {
    app.game_state = test;
    test(dt);
  }

  function loading() {
    let load_count = glov_sprite.loading() + sound_manager.loading();
    $('#loading_text').text(`Loading (${load_count})...`);
    if (!load_count) {
      $('.screen').hide();
      app.game_state = testInit;
    }
  }

  function loadingInit() {
    initGraphics();
    app.game_state = loading;
    loading();
  }

  app.game_state = loadingInit;

  function tick(dt) {
    if (glov_ui.modal_dialog) {
      // Testing effects during modal dialogs
      glov_engine.queueFrameEffect(Z.MODAL - 2, doBlurEffect);
      glov_engine.queueFrameEffect(Z.MODAL - 1, doDesaturateEffect);
    }
    // Borders
    glov_ui.drawRect(glov_camera.x0(), glov_camera.y0(), glov_camera.x1(), 0, Z.BORDERS, glov_engine.pico8_colors[0]);
    glov_ui.drawRect(glov_camera.x0(), game_height, glov_camera.x1(), glov_camera.y1(), Z.BORDERS, glov_engine.pico8_colors[0]);
    glov_ui.drawRect(glov_camera.x0(), 0, 0, game_height, Z.BORDERS, glov_engine.pico8_colors[0]);
    glov_ui.drawRect(game_width, 0, glov_camera.x1(), game_height, Z.BORDERS, glov_engine.pico8_colors[0]);

    app.game_state(dt);
  }

  loadingInit();
  glov_engine.go(tick);
}
