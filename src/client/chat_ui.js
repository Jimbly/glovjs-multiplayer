const camera2d = require('./glov/camera2d.js');
const glov_font = require('./glov/font.js');
const input = require('./glov/input.js');
const ui = require('./glov/ui.js');
const net = require('./glov/net.js');

class ChatUI {
  constructor(cmd_parse) {
    this.cmd_parse = cmd_parse;
    this.edit_text_entry = ui.createEditBox({
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

  runLate() {
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
  }

  run() {
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
    let w = (camera2d.x1() - camera2d.x0()) / 2;
    if (net.subs.loggedIn() && !(ui.modal_dialog || ui.menu_up)) {
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
            this.cmd_parse.handle(null, command, (err, resp) => {
              if (err && this.cmd_parse.was_not_found) {
                // forward to server
                net.subs.sendCmdParse(command, handleCmdParse);
              } else {
                handleCmdParse(err, resp);
              }
            });
          } else {
            this.channel.send('chat', { msg: text }, { broadcast: true });
          }
          this.edit_text_entry.setText('');
        } else {
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
    for (let ii = 0; ii < Math.min(this.msgs.length, this.max_messages); ++ii) {
      let line = this.msgs[this.msgs.length - ii - 1];
      numlines = 0;
      ui.font.wrapLines(w, indent, ui.font_height, line, wordCallback);
      y -= ui.font_height * (numlines + 1);
      ui.font.drawSizedWrapped(this.font_style, x, y, Z.CHAT + 1, w, indent, ui.font_height, line);
    }

    let border = 8;
    ui.drawRect(x - border, y - border, x + w + border + 8, y0, Z.CHAT, [1,1,1,0.2]);
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
  return new ChatUI(...args);
}
