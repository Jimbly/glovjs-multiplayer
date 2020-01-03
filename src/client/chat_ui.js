// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
const assert = require('assert');
const camera2d = require('./glov/camera2d.js');
const { cmd_parse } = require('./glov/cmds.js');
const engine = require('./glov/engine.js');
const glov_font = require('./glov/font.js');
const input = require('./glov/input.js');
const local_storage = require('./glov/local_storage.js');
const net = require('./glov/net.js');
const ui = require('./glov/ui.js');
const { clamp } = require('../common/util.js');
const { vec4 } = require('./glov/vmath.js');

const FADE_START_TIME = 10000;
const FADE_TIME = 1000;

function CmdHistory() {
  assert(local_storage.storage_prefix !== 'demo'); // wrong initialization order
  this.entries = new Array(50);
  this.idx = local_storage.getJSON('console_idx'); // where we will next insert
  if (typeof this.idx !== 'number' || this.idx < 0 || this.idx >= this.entries.length) {
    this.idx = 0;
  } else {
    for (let ii = 0; ii < this.entries.length; ++ii) {
      this.entries[ii] = local_storage.getJSON(`console_e${ii}`);
    }
  }
  this.resetPos();
}
CmdHistory.prototype.setHist = function (idx, text) {
  this.entries[idx] = text;
  local_storage.setJSON(`console_e${idx}`, text);
};
CmdHistory.prototype.add = function (text) {
  if (!text) {
    return;
  }
  let idx = this.entries.indexOf(text);
  if (idx !== -1) {
    // already in there, just re-order
    let target = (this.idx - 1 + this.entries.length) % this.entries.length;
    while (idx !== target) {
      let next = (idx + 1) % this.entries.length;
      this.setHist(idx, this.entries[next]);
      idx = next;
    }
    this.setHist(target, text);
    return;
  }
  this.setHist(this.idx, text);
  this.idx = (this.idx + 1) % this.entries.length;
  local_storage.setJSON('console_idx', this.idx);
  this.resetPos();
};
CmdHistory.prototype.unadd = function (text) {
  // upon error, do not store this string in our history
  let idx = (this.idx - 1 + this.entries.length) % this.entries.length;
  if (this.entries[idx] !== text) {
    return;
  }
  this.idx = idx;
  local_storage.setJSON('console_idx', this.idx);
  this.resetPos();
};
CmdHistory.prototype.resetPos = function () {
  this.hist_idx = this.idx;
  this.edit_line = '';
};
CmdHistory.prototype.prev = function (cur_text) {
  if (this.hist_idx === this.idx) {
    // if first time goine backwards, stash the current edit line
    this.edit_line = cur_text;
  }
  let idx = (this.hist_idx - 1 + this.entries.length) % this.entries.length;
  let text = this.entries[idx];
  if (idx === this.idx || !text) {
    // wrapped around, or got to empty
    return this.entries[this.hist_idx] || '';
  }
  this.hist_idx = idx;
  return text || '';
};
CmdHistory.prototype.next = function (cur_text) {
  if (this.hist_idx === this.idx) {
    return cur_text || '';
  }
  let idx = (this.hist_idx + 1) % this.entries.length;
  this.hist_idx = idx;
  if (this.hist_idx === this.idx) {
    // just got back to head
    let ret = this.edit_line;
    this.edit_line = '';
    return ret || '';
  }
  return this.entries[idx] || '';
};

function ChatUI(max_len) {
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
  this.handle_cmd_parse = this.handleCmdParse.bind(this);
  this.handle_cmd_parse_error = this.handleCmdParseError.bind(this);
  cmd_parse.setDefaultHandler(this.handle_cmd_parse_error);
  this.msgs = [];
  this.max_messages = 8;
  this.max_len = max_len;
  this.history = new CmdHistory();
  this.access_obj = null; // object with .access for testing cmd access permissions

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

ChatUI.prototype.handleCmdParseError = function (err, resp) {
  if (err) {
    this.addChat(`[error] ${err}`);
  }
};

ChatUI.prototype.handleCmdParse = function (err, resp) {
  if (err) {
    this.addChat(`[error] ${err}`);
  } else if (resp) {
    this.addChat(`[system] ${(typeof resp === 'string') ? resp : JSON.stringify(resp)}`);
  }
};

ChatUI.prototype.setAccessOjb = function (obj) {
  this.access_obj = obj;
};

ChatUI.prototype.cmdParse = function (str, on_error) {
  let handleResult = on_error ?
    (err, resp) => {
      this.handle_cmd_parse(err, resp);
      if (on_error && err) {
        on_error(err);
      }
    } :
    this.handle_cmd_parse;
  cmd_parse.handle(this.access_obj, str, function (err, resp) {
    if (err && cmd_parse.was_not_found) {
      // forward to server
      net.subs.sendCmdParse(str, handleResult);
    } else {
      handleResult(err, resp);
    }
  });
};

ChatUI.prototype.cmdParseInternal = function (str) {
  cmd_parse.handle(this.access_obj, str, this.handle_cmd_parse_error);
};

function pad2(str) {
  return `0${str}`.slice(-2);
}
function conciseDate(dt) {
  return `${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ${pad2(dt.getHours())
  }:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`;
}
let help_font_style = glov_font.styleColored(null, 0x000000ff);
let help_font_style_cmd = glov_font.style(help_font_style, {
  outline_width: 0.5,
  outline_color: 0x000000FF,
});
let help_rollover_color = vec4(0, 0, 0, 0.25);
let help_rollover_color2 = vec4(0, 0, 0, 0.125);
function drawHelpTooltip(param) {
  assert(Array.isArray(param.tooltip));
  let w = param.tooltip_width;
  let h = ui.font_height;
  let x = param.x;
  let z = param.z || Z.TOOLTIP;
  let eff_tooltip_pad = ui.tooltip_pad * 0.5;
  let text_x = x + eff_tooltip_pad;
  let text_w = w - eff_tooltip_pad * 2;
  let tooltip_y1 = param.y;
  let y = tooltip_y1 - eff_tooltip_pad;
  let ret = null;
  for (let ii = 0; ii < param.tooltip.length; ++ii) {
    let line = param.tooltip[ii];
    y -= h;
    let idx = line.indexOf(' ');
    if (line[0] === '/' && idx !== -1 && param.do_selection) {
      // is a command
      let cmd = line.slice(0, idx);
      let help = line.slice(idx);
      let cmd_w = ui.font.drawSized(help_font_style_cmd,
        text_x, y, z+1, h, cmd);
      ui.font.drawSizedAligned(help_font_style,
        text_x + cmd_w, y, z+1, h, glov_font.ALIGN.HFIT,
        text_w - cmd_w, 0,
        help);
      let pos = { x, y, w, h };
      if (input.mouseUpEdge(pos)) { // up instead of down to prevent canvas capturing focus
        ret = cmd.slice(1);
      } else if (input.mouseOver(pos)) {
        ui.drawRect(x, y, text_x + cmd_w + 4, y + h, z + 0.5, help_rollover_color);
        ui.drawRect(text_x + cmd_w + 4, y, x + w, y + h, z + 0.5, help_rollover_color2);
      }
    } else {
      ui.font.drawSizedAligned(help_font_style,
        text_x, y, z+1, h, glov_font.ALIGN.HFIT,
        text_w, 0,
        line);
    }
  }
  y -= eff_tooltip_pad;
  let pixel_scale = ui.tooltip_panel_pixel_scale * 0.5;

  ui.panel({
    x, y, z, w,
    h: tooltip_y1 - y,
    pixel_scale,
  });
  return ret;
}

function getNumLines(w, indent, line) {
  let numlines = 0;
  function wordCallback(ignored, linenum, word) {
    numlines = Math.max(numlines, linenum);
  }
  ui.font.wrapLines(w, indent, ui.font_height, line, wordCallback);
  return numlines + 1;
}


const indent = 80;
const SPACE_ABOVE_ENTRY = 8;
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
      if (was_focused) {
        let cur_text = this.edit_text_entry.getText();
        if (cur_text) {
          if (cur_text[0] === '/') {
            // do auto-complete
            let autocomplete = cmd_parse.autoComplete(cur_text.slice(1));
            if (autocomplete && autocomplete.length) {
              let first = autocomplete[0];
              let auto_text = [];
              for (let ii = 0; ii < autocomplete.length; ++ii) {
                let elem = autocomplete[ii];
                auto_text.push(`/${elem.cmd} - ${elem.help}`);
              }
              let do_selection = false;
              if (first.cname &&
                cmd_parse.canonical(cur_text.slice(1)).slice(0, first.cname.length) === first.cname
              ) {
                // we've typed something that matches the first one
                auto_text = [first.help];
              } else {
                do_selection = true;
              }
              let tooltip_y = y;
              // check if last message is an error, if so, tooltip above that.
              let last_msg = this.msgs[this.msgs.length - 1];
              if (last_msg) {
                let msg = last_msg.msg;
                if (msg && msg.slice(0, 7) === '[error]') {
                  let numlines = getNumLines(w, indent, msg);
                  tooltip_y -= ui.font_height * numlines + SPACE_ABOVE_ENTRY;
                }
              }

              let selected = drawHelpTooltip({
                x, y: tooltip_y,
                tooltip_width: w,
                tooltip: auto_text,
                do_selection,
              });
              if (do_selection) {
                // auto-completes to something different than we have typed
                // Do not use ENTER as well, because sometimes a hidden command is a sub-string of a shown command?
                if (input.keyDownEdge(input.KEYS.TAB) || selected) {
                  this.edit_text_entry.setText(`/${selected || first.cmd} `);
                  this.edit_text_entry.focus();
                }
              }
            }
          }
        } else {
          this.history.resetPos();
        }
        if (input.keyDownEdge(input.KEYS.UP)) {
          this.edit_text_entry.setText(this.history.prev(cur_text));
        }
        if (input.keyDownEdge(input.KEYS.DOWN)) {
          this.edit_text_entry.setText(this.history.next(cur_text));
        }
      }
      let res = this.edit_text_entry.run({ x, y, w, pointer_lock: opts.pointerlock });
      is_focused = this.edit_text_entry.isFocused();
      if (res === this.edit_text_entry.SUBMIT) {
        let text = this.edit_text_entry.getText();
        if (text) {
          if (text[0] === '/') {
            if (text[1] === '/') { // common error of starting with //foo because chat was already focused
              text = text.slice(1);
            }
            this.history.add(text);
            this.cmdParse(text.slice(1), () => {
              if (!this.edit_text_entry.getText()) {
                this.history.unadd(text);
                this.edit_text_entry.setText(text);
              }
            });
          } else {
            if (text.length > this.max_len) {
              this.addChat('[error] Chat message too long');
            } else {
              this.channel.send('chat', { msg: text }, { broadcast: true }, (err) => {
                if (err) {
                  this.addChat(`[error] ${err}`);
                  // if (!this.edit_text_entry.getText()) {
                  //   this.edit_text_entry.setText(text);
                  // }
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
  y -= SPACE_ABOVE_ENTRY;
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
    let numlines = getNumLines(w, indent, line);
    let h = ui.font_height * numlines;
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

export function create(max_len) {
  return new ChatUI(max_len);
}
