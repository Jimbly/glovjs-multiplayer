/*eslint global-require:off*/

const cmd_parse = require('../common/cmd_parse.js').create();
const engine = require('./glov/engine.js');
const glov_font = require('./glov/font.js');
const fs = require('fs');
const input = require('./glov/input.js');
const local_storage = require('./glov/local_storage.js');
const net = require('./glov/net.js');
const net_position_manager = require('./glov/net_position_manager.js');
const particles = require('./glov/particles.js');
const shaders = require('./glov/shaders.js');
const glov_sprites = require('./glov/sprites.js');
const sprite_animation = require('./glov/sprite_animation.js');
const ui = require('./glov/ui.js');

const particle_data = require('./particle_data.js');
const { vec2, vec4, v4copy } = require('./glov/vmath.js');
local_storage.storage_prefix = 'glovjs-multiplayer';

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

export function main() {
  net.init();

  if (!engine.startup({
    game_width,
    game_height,
    pixely: false,
    sound_manager: require('./glov/sound_manager.js').create(),
  })) {
    return;
  }

  const test_shader = shaders.create(gl.FRAGMENT_SHADER, fs.readFileSync(`${__dirname}/shaders/test.fp`, 'utf8'));

  const sound_manager = engine.sound_manager;
  // const font = engine.font;


  const createSprite = glov_sprites.create;
  const createAnimation = sprite_animation.create;

  app.account_ui = require('./account_ui.js').create();
  app.chat_ui = require('./chat_ui.js').create(cmd_parse);

  const color_white = vec4(1, 1, 1, 1);
  const color_gray = vec4(0.5, 0.5, 0.5, 1);
  const color_red = vec4(1, 0, 0, 1);
  const color_yellow = vec4(1, 1, 0, 1);

  // Cache KEYS
  const KEYS = input.KEYS;
  const pad_codes = input.pad_codes;

  const sprite_size = 64;
  function initGraphics() {
    particles.preloadParticleData(particle_data);

    sound_manager.loadSound('test');

    sprites.white = createSprite({ url: 'white' });

    sprites.test = createSprite({
      name: 'test',
      size: vec2(sprite_size, sprite_size),
      origin: vec2(0.5, 0.5),
    });
    sprites.test_tint = createSprite({
      name: 'tinted',
      ws: [16, 16, 16, 16],
      hs: [16, 16, 16],
      size: vec2(sprite_size, sprite_size),
      layers: 2,
      origin: vec2(0.5, 0.5),
    });
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

    sprites.game_bg = createSprite({
      url: 'white',
      size: vec2(game_width, game_height),
    });
  }


  let test_room;
  let test;

  function playerMotion(dt) {
    // Network send
    if (pos_manager.checkNet((pos) => {
      test.character.x = pos[0];
      test.character.y = pos[1];
    })) {
      return;
    }

    test.character.dx = 0;
    test.character.dy = 0;
    if (input.keyDown(KEYS.LEFT) || input.keyDown(KEYS.A) ||
      input.padButtonDown(pad_codes.LEFT)
    ) {
      test.character.dx = -1;
      sprites.animation.setState('idle_left');
    } else if (input.keyDown(KEYS.RIGHT) || input.keyDown(KEYS.D) ||
      input.padButtonDown(pad_codes.RIGHT)
    ) {
      test.character.dx = 1;
      sprites.animation.setState('idle_right');
    }
    if (input.keyDown(KEYS.UP) || input.keyDown(KEYS.W) ||
      input.padButtonDown(pad_codes.UP)
    ) {
      test.character.dy = -1;
    } else if (input.keyDown(KEYS.DOWN) || input.keyDown(KEYS.S) ||
      input.padButtonDown(pad_codes.DOWN)
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
    if (input.mouseDown() && input.mouseOver(bounds)) {
      v4copy(test.color_sprite, color_yellow);
    } else if (input.click(bounds)) {
      v4copy(test.color_sprite, (test.color_sprite[2] === 0) ? color_white : color_red);
      sound_manager.play('test');
    } else if (input.mouseOver(bounds)) {
      v4copy(test.color_sprite, color_white);
      test.color_sprite[3] = 0.5;
    } else {
      v4copy(test.color_sprite, color_white);
      test.color_sprite[3] = 1;
    }

    // Network send
    pos_manager.updateMyPos(vec2(test.character.x, test.character.y), 'idle');
  }

  test = function (dt) {
    // Allow focusing the canvas, and before chat.
    ui.focusCheck('canvas');

    app.chat_ui.run(dt);
    app.account_ui.showLogin();

    if (!test.color_sprite) {
      test.color_sprite = v4copy(vec4(), color_white);
      test.character = { x: 0, y: 0 };
    }

    if (test_room) {
      playerMotion(dt);

      sprites.game_bg.draw({
        x: 0, y: 0, z: Z.BACKGROUND,
        color: [0.5, 0.6, 0.7, 1],
        shader: test_shader,
        shader_params: {
          params: [1.0, 1.0, 1.0, engine.getFrameTimestamp() * 0.0005 % 1000],
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

      // Draw other users
      let room_clients = test_room.getChannelData('public.clients', {});
      for (let client_id in room_clients) {
        let other_client = room_clients[client_id];
        if (other_client.pos && other_client.ids) {
          let pos = pos_manager.updateOtherClient(client_id, dt);
          sprites.test.draw({
            x: pos[0], y: pos[1], z: Z.SPRITES - 1,
            color: color_gray,
          });
          ui.font.drawSizedAligned(glov_font.styleColored(null, 0x00000080),
            pos[0], pos[1] - 64, Z.SPRITES - 1,
            ui.font_height, glov_font.ALIGN.HCENTER, 0, 0,
            other_client.ids.display_name || `client_${client_id}`);
        }
      }
    }

    app.chat_ui.runLate(dt);
  };

  function testInit(dt) {
    engine.setState(test);

    net.subs.onLogin(function () {
      test_room = net.subs.getChannel('test.test', true);
      pos_manager.reinit({
        channel: test_room,
        default_pos: vec2(
          (Math.random() * (game_width - sprite_size) + (sprite_size * 0.5)),
          (Math.random() * (game_height - sprite_size) + (sprite_size * 0.5))
        ),
      });
      app.chat_ui.setChannel(test_room);
    });

    test(dt);
  }

  initGraphics();
  engine.setState(testInit);
}
