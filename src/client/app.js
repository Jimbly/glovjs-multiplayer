/*eslint global-require:off*/
/*global VMath: false */
/*global Z: false */

const cmd_parse = require('../common/cmd_parse.js').create();
const glov_local_storage = require('./glov/local_storage.js');
const net = require('./net.js');
const net_position_manager = require('./net_position_manager.js');
const particle_data = require('./particle_data.js');
const shaders = require('./shaders.js');

glov_local_storage.storage_prefix = 'glovjs-multiplayer';

window.Z = window.Z || {};
Z.BACKGROUND = 0;
Z.SPRITES = 10;
Z.PARTICLES = 20;
Z.BORDERS = 90;
Z.UI = 100;
Z.CHAT = 500;

let app = exports;
window.app = app; // for debugging

const pos_manager = net_position_manager.create();

// Virtual viewport for our game logic
export const game_width = 1280;
export const game_height = 960;

export let sprites = {};

export function main(canvas) {
  net.init();
  const glov_engine = require('./glov/engine.js');
  const glov_font = require('./glov/font.js');

  glov_engine.startup({
    canvas,
    shaders,
    game_width,
    game_height,
    pixely: false,
  });

  const sound_manager = glov_engine.sound_manager;
  // const glov_camera = glov_engine.glov_camera;
  const glov_input = glov_engine.glov_input;
  const glov_sprite = glov_engine.glov_sprite;
  const glov_ui = glov_engine.glov_ui;
  const draw_list = glov_engine.draw_list;
  // const font = glov_engine.font;


  const createSpriteSimple = glov_sprite.createSpriteSimple.bind(glov_sprite);
  const createAnimation = glov_sprite.createAnimation.bind(glov_sprite);

  app.account_ui = require('./account_ui.js').create();
  app.chat_ui = require('./chat_ui.js').create(cmd_parse);

  const color_white = VMath.v4Build(1, 1, 1, 1);
  const color_gray = VMath.v4Build(0.5, 0.5, 0.5, 1);
  const color_red = VMath.v4Build(1, 0, 0, 1);
  const color_yellow = VMath.v4Build(1, 1, 0, 1);

  // Cache key_codes
  const key_codes = glov_input.key_codes;
  const pad_codes = glov_input.pad_codes;

  const sprite_size = 64;
  function initGraphics() {
    glov_sprite.preloadParticleData(particle_data);

    sound_manager.loadSound('test');

    const origin_0_0 = glov_sprite.origin_0_0;

    sprites.white = createSpriteSimple('white', 1, 1, origin_0_0);

    sprites.test = createSpriteSimple('test.png', sprite_size, sprite_size);
    sprites.test_tint = createSpriteSimple('tinted', [16, 16, 16, 16], [16, 16, 16], { layers: 2 });
    sprites.animation = createAnimation({
      idle_left: {
        frames: [0,1],
        times: [200, 500],
      },
      idle_right: {
        frames: [3,2],
        times: [200, 500],
      },
    });
    sprites.animation.setState('idle_left');

    sprites.game_bg = createSpriteSimple('white', 2, 2, {
      width: game_width,
      height: game_height,
      origin: [0, 0],
    });
  }


  let test_room;

  function test(dt) {
    // Allow focusing the canvas, and before chat.
    glov_ui.focusCheck('canvas');

    if (!test_room) {
      test_room = net.subs.getChannel('test.test', true);
      pos_manager.reinit({
        channel: test_room,
        client_id: net.client.id,
      });
      app.chat_ui.setChannel(test_room);
    }

    app.chat_ui.run(dt);
    app.account_ui.showLogin();

    if (!test.color_sprite) {
      test.color_sprite = VMath.v4Copy(color_white);
      test.character = {
        x: (Math.random() * (game_width - sprite_size) + (sprite_size * 0.5)),
        y: (Math.random() * (game_height - sprite_size) + (sprite_size * 0.5)),
      };
      test.last_send = {};
    }

    test.character.dx = 0;
    test.character.dy = 0;
    if (glov_input.isKeyDown(key_codes.LEFT) || glov_input.isKeyDown(key_codes.A) ||
      glov_input.isPadButtonDown(pad_codes.LEFT)
    ) {
      test.character.dx = -1;
      sprites.animation.setState('idle_left');
    } else if (glov_input.isKeyDown(key_codes.RIGHT) || glov_input.isKeyDown(key_codes.D) ||
      glov_input.isPadButtonDown(pad_codes.RIGHT)
    ) {
      test.character.dx = 1;
      sprites.animation.setState('idle_right');
    }
    if (glov_input.isKeyDown(key_codes.UP) || glov_input.isKeyDown(key_codes.W) ||
      glov_input.isPadButtonDown(pad_codes.UP)
    ) {
      test.character.dy = -1;
    } else if (glov_input.isKeyDown(key_codes.DOWN) || glov_input.isKeyDown(key_codes.S) ||
      glov_input.isPadButtonDown(pad_codes.DOWN)
    ) {
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
      VMath.v4Copy(color_yellow, test.color_sprite);
    } else if (glov_input.clickHit(bounds)) {
      VMath.v4Copy((test.color_sprite[2] === 0) ? color_white : color_red, test.color_sprite);
      sound_manager.play('test');
    } else if (glov_input.isMouseOver(bounds)) {
      VMath.v4Copy(color_white, test.color_sprite);
      test.color_sprite[3] = 0.5;
    } else {
      VMath.v4Copy(color_white, test.color_sprite);
      test.color_sprite[3] = 1;
    }

    app.sprites.game_bg.drawTech({
      x: 0, y: 0, z: Z.BACKGROUND,
      color: [0.5, 0.6, 0.7, 1],
      bucket: 'test',
      tech_params: {
        params: [1.0, 1.0, 1.0, glov_engine.getFrameTimestamp() * 0.0005 % 1000],
      },
    });

    sprites.test_tint.drawDualTint({
      x: test.character.x,
      y: test.character.y,
      z: Z.SPRITES,
      color: [1, 1, 0, 1],
      color1: [1, 0, 1, 1],
      size: [sprite_size, sprite_size],
      frame: sprites.animation.getFrame(dt),
    });

    // Network send
    if (net.client.id && test_room.data.public) {
      pos_manager.updateMyPos([test.character.x, test.character.y], 'idle');
    }

    // Draw other users
    let room_clients = test_room.getChannelData('public.clients', {});
    for (let client_id in room_clients) {
      let other_client = room_clients[client_id];
      if (other_client.pos && other_client.ids) {
        let pos = pos_manager.updateOtherClient(client_id, dt);
        draw_list.queue(sprites.test,
          pos[0], pos[1], Z.SPRITES - 1,
          color_gray, [sprite_size, sprite_size], null, 0, 'alpha');
        glov_ui.font.drawSizedAligned(glov_font.styleColored(null, 0x00000080),
          pos[0], pos[1] - 64, Z.SPRITES - 1,
          glov_ui.font_height, glov_font.ALIGN.HCENTER, 0, 0,
          other_client.ids.display_name || `client_${client_id}`);
      }
    }

    app.chat_ui.runLate(dt);
  }

  function testInit(dt) {
    glov_engine.setState(test);
    test(dt);
  }

  initGraphics();
  glov_engine.setState(testInit);
}
