// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
const camera2d = require('./glov/camera2d.js');
const engine = require('./glov/engine.js');
const glov_font = require('./glov/font.js');
const input = require('./glov/input.js');
const net = require('./glov/net.js');
const ui = require('./glov/ui.js');
const { clamp } = require('../common/util.js');

const FADE_START_TIME = 10000;
const FADE_TIME = 1000;

function ChatUI(cmd_parse, max_len) {
  this.cmd_parse = cmd_parse;
  this.edit_text_entry = ui.createEditBox({
    placeholder: 'Chatbox',
    initial_focus: false,
    max_len,
    text: '',
  });
  this.channel = null;

  this.on_join = this.onMsgJoin.bind(this);
  this.on_leave = this.onMsgLeave.bind(this);
  this.on_chat = this.onMsgChat.bind(this);
  this.msgs = [];
  this.max_messages = 8;
  this.max_len = max_len;

  this.styles = {
    def: glov_font.style(null, {
      color: 0xBBBBBBff,
      outline_width: 1.0,
      outline_color: 0x000000ff,
    }),
    error: glov_font.style(null, {
      color: 0xDD0000ff,
      outline_width: 1.0,
      outline_color: 0x000000ff,
    }),
  };

  net.subs.on('admin_msg', (msg) => {
    this.addChat(msg, 'error');
  });
}

ChatUI.prototype.addChat = function (msg, style) {
  this.msgs.push({ msg, style, timestamp: Date.now() });
  console.log(msg);
};
ChatUI.prototype.onMsgJoin = function (data) {
  this.addChat(`${data.display_name} joined the channel`);
};
ChatUI.prototype.onMsgLeave = function (data) {
  this.addChat(`${data.display_name} left the channel`);
};
ChatUI.prototype.onMsgChat = function (data) {
  this.addChat(`[${data.client_ids.display_name}] ${data.msg}`);
};

ChatUI.prototype.runLate = function () {
  this.did_run_late = true;
  if (input.keyDownEdge(input.KEYS.RETURN)) {
    this.edit_text_entry.focus();
  }
  if (input.keyDownEdge(input.KEYS.SLASH) ||
    input.keyDownEdge(input.KEYS.NUMPAD_DIVIDE)
  ) {
    this.edit_text_entry.focus();
    this.edit_text_entry.setText('/');
  }
};

ChatUI.prototype.cmdParse = function (str) {
  let handleCmdParse = (err, resp) => {
    if (err) {
      this.addChat(`[error] ${err}`);
    } else if (resp) {
      this.addChat(`[system] ${(typeof resp === 'string') ? resp : JSON.stringify(resp)}`);
    }
  };
  this.cmd_parse.handle(null, str, (err, resp) => {
    if (err && this.cmd_parse.was_not_found) {
      // forward to server
      net.subs.sendCmdParse(str, handleCmdParse);
    } else {
      handleCmdParse(err, resp);
    }
  });
};

function pad2(str) {
  return `0${str}`.slice(-2);
}
function conciseDate(dt) {
  return `${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ${pad2(dt.getHours())
  }:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`;
}

ChatUI.prototype.run = function (opts) {
  opts = opts || {};
  if (net.client.disconnected) {
    ui.font.drawSizedAligned(
      glov_font.style(null, {
        outline_width: 2,
        outline_color: 0x000000ff,
        color: 0xDD2020ff
      }),
      camera2d.x0(), camera2d.y0(), Z.DEBUG,
      ui.font_height, glov_font.ALIGN.HVCENTER, camera2d.w(), camera2d.h() * 0.20,
      `Connection lost, attempting to reconnect (${(net.client.timeSinceDisconnect()/1000).toFixed(0)})...`);
  }

  if (!this.did_run_late) {
    this.runLate();
  }
  this.did_run_late = false;
  let x = camera2d.x0() + 10;
  let y0 = camera2d.y1();
  let y = y0;
  let w = engine.game_width / 2;
  let is_focused = false;
  if (net.subs.loggedIn() && !(ui.modal_dialog || ui.menu_up || opts.hide)) {
    let was_focused = this.edit_text_entry.isFocused();
    y -= 40;
    if (!was_focused && opts.pointerlock && input.pointerLocked()) {
      // do not show edit box
      ui.font.drawSizedAligned(this.styles.def, x, y, Z.CHAT + 1, ui.font_height, glov_font.ALIGN.HFIT, w, 0,
        '<Press Enter to chat>');
    } else {
      let res = this.edit_text_entry.run({ x, y, w, pointer_lock: opts.pointerlock });
      is_focused = this.edit_text_entry.isFocused();
      if (res === this.edit_text_entry.SUBMIT) {
        let text = this.edit_text_entry.getText();
        if (text) {
          if (text[0] === '/') {
            this.cmdParse(text.slice(1));
          } else {
            if (text.length > this.max_len) {
              this.addChat('[error] Chat message too long');
            } else {
              this.channel.send('chat', { msg: text }, { broadcast: true }, (err) => {
                if (err) {
                  this.addChat(`[error] ${err}`);
                }
              });
            }
          }
          this.edit_text_entry.setText('');
        } else {
          is_focused = false;
          ui.focusCanvas();
        }
      }
      if (opts.pointerlock && is_focused && input.pointerLocked()) {
        // Gained focus undo pointerlock
        input.pointerLockExit();
      }
      if (is_focused && was_focused && input.mouseDownEdge({ peek: true })) {
        // On touch, tapping doesn't always remove focus from the edit box!
        // Maybe this logic should be in the editbox logic?
        ui.focusCanvas();
      }
    }
  }
  y -= 8;
  let numlines;
  let indent = 80;
  function wordCallback(ignored, linenum, word) {
    numlines = Math.max(numlines, linenum);
  }
  let now = Date.now();
  for (let ii = 0; ii < Math.min(this.msgs.length, this.max_messages); ++ii) {
    let msg = this.msgs[this.msgs.length - ii - 1];
    let age = now - msg.timestamp;
    let alpha = is_focused ? 1 : 1 - clamp((age - FADE_START_TIME) / FADE_TIME, 0, 1);
    if (!alpha) {
      break;
    }
    let style = this.styles[msg.style || 'def'];
    let line = msg.msg;
    numlines = 0;
    ui.font.wrapLines(w, indent, ui.font_height, line, wordCallback);
    let h = ui.font_height * (numlines + 1);
    y -= h;
    ui.font.drawSizedWrapped(glov_font.styleAlpha(style, alpha), x, y, Z.CHAT + 1, w, indent, ui.font_height, line);
    if (input.mouseOver({ x, y, w, h }) && !input.mousePosIsTouch()) {
      ui.drawTooltip({
        x, y: y - 50,
        tooltip_width: 350,
        tooltip_pad: ui.tooltip_pad * 0.5,
        tooltip: `Received at ${conciseDate(new Date(msg.timestamp))}`,
        pixel_scale: ui.tooltip_panel_pixel_scale * 0.5,
      });
    }
  }

  let border = 8;
  ui.drawRect(camera2d.x0(), y - border, x + w + border + 8, y0, Z.CHAT, [0.3,0.3,0.3,0.75]);
};

ChatUI.prototype.setChannel = function (channel) {
  if (channel === this.channel) {
    return;
  }
  if (this.channel) {
    this.addChat(`Left channel ${this.channel.channel_id}`);
    this.channel.removeMsgHandler('chat', this.on_chat);
    this.channel.removeMsgHandler('join', this.on_join);
    this.channel.removeMsgHandler('leave', this.on_leave);
  }
  this.channel = channel;
  if (this.channel) {
    channel.onMsg('chat', this.on_chat);
    channel.onMsg('join', this.on_join);
    channel.onMsg('leave', this.on_leave);
    this.addChat(`Joined channel ${this.channel.channel_id}`);
    channel.onceSubscribe((data) => {
      let clients = data && data.public && data.public.clients;
      if (clients) {
        let here = [];
        for (let client_id in clients) {
          if (client_id === net.client.id) {
            continue;
          }
          let client = clients[client_id];
          if (client.ids) {
            here.push(client.ids.display_name || client.ids.user_id || client_id);
          }
        }
        if (here.length) {
          this.addChat(`Other users already here: ${here.join(', ')}`);
        }
      }
    });
  }
};

export function create(...args) {
  return new ChatUI(...args);
}
