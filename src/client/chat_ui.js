/*global Z: false */

const glov_engine = require('./glov/engine.js');
const glov_font = require('./glov/font.js');
const net = require('./net.js');
let glov_ui;
let glov_input;

class ChatUI {
  constructor(cmd_parse) {
    this.cmd_parse = cmd_parse;
    this.edit_text_entry = glov_ui.createEditBox({
      placeholder: 'Chatbox',
      initial_focus: false,
      text: '',
    });
    this.channel = null;

    this.on_join = this.onMsgJoin.bind(this);
    this.on_leave = this.onMsgLeave.bind(this);
    this.on_chat = this.onMsgChat.bind(this);
    this.msgs = [];
    this.max_messages = 6;

    this.font_style = glov_font.style(null, {
      color: 0xBBBBBBff,
      outline_width: 1.0,
      outline_color: 0x000000ff,
    });

  }

  addChat(msg) {
    this.msgs.push(msg);
  }
  onMsgJoin(data) {
    this.addChat(`${data.display_name} joined the channel`);
  }
  onMsgLeave(data) {
    this.addChat(`${data.display_name} left the channel`);
  }
  onMsgChat(data) {
    this.addChat(`[${data.client_ids.display_name}] ${data.msg}`);
  }

  run() {
    if (glov_input.keyDownHit(glov_input.key_codes.RETURN)) {
      this.edit_text_entry.focus();
    }
    if (glov_input.keyDownHit(glov_input.key_codes.SLASH) ||
      glov_input.keyDownHit(glov_input.key_codes.NUMPAD_DIVIDE)
    ) {
      this.edit_text_entry.focus();
      this.edit_text_entry.setText('/');
    }
    let x = glov_ui.camera.x0() + 10;
    let y0 = glov_ui.camera.y1();
    let y = y0;
    let w = (glov_ui.camera.x1() - glov_ui.camera.x0()) / 2;
    if (net.subs.loggedIn() && !(glov_ui.modal_dialog || glov_ui.menu_up)) {
      y -= 40;
      if (this.edit_text_entry.run({ x, y, w }) === this.edit_text_entry.SUBMIT) {
        let text = this.edit_text_entry.getText();
        if (text) {
          if (text[0] === '/') {
            let handleCmdParse = (err, resp) => {
              if (err) {
                this.addChat(`[error] ${err}`);
              } else if (resp) {
                this.addChat(`[system] ${(typeof resp === 'string') ? resp : JSON.stringify(resp)}`);
              }
            };
            let command = text.slice(1);
            this.cmd_parse.handle(command, (err, resp) => {
              if (err && this.cmd_parse.was_not_found) {
                // forward to server
                net.client.send('cmdparse', command, handleCmdParse);
              } else {
                handleCmdParse(err, resp);
              }
            });
          } else {
            this.channel.send('chat', { msg: text }, { broadcast: true });
          }
          this.edit_text_entry.setText('');
        } else {
          this.edit_text_entry.unfocus();
        }
      }
    }
    y -= 8;
    let numlines;
    let indent = 80;
    function wordCallback(ignored, linenum, word) {
      numlines = Math.max(numlines, linenum);
    }
    for (let ii = 0; ii < Math.min(this.msgs.length, this.max_messages); ++ii) {
      let line = this.msgs[this.msgs.length - ii - 1];
      numlines = 0;
      glov_ui.font.wrapLines(w, indent, glov_ui.font_height, line, wordCallback);
      y -= glov_ui.font_height * (numlines + 1);
      glov_ui.font.drawSizedWrapped(this.font_style, x, y, Z.CHAT + 1, w, indent, glov_ui.font_height, line);
    }

    let border = 8;
    glov_ui.drawRect(x - border, y - border, x + w + border + 8, y0, Z.CHAT, [1,1,1,0.2]);
  }

  setChannel(channel) {
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
    channel.onMsg('chat', this.on_chat);
    channel.onMsg('join', this.on_join);
    channel.onMsg('leave', this.on_leave);
    this.addChat(`Joined channel ${this.channel.channel_id}`);
  }
}

export function create(...args) {
  if (!glov_ui) {
    glov_ui = glov_engine.glov_ui;
    glov_input = glov_engine.glov_input;
  }
  return new ChatUI(...args);
}
