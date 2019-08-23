// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
const local_storage = require('./glov/local_storage.js');
const glov_font = require('./glov/font.js');
const net = require('./glov/net.js');
const ui = require('./glov/ui.js');
const { vec4 } = require('./glov/vmath.js');

function AccountUI() {
  this.edit_box_name = ui.createEditBox({
    placeholder: 'Username',
    initial_focus: true,
    text: local_storage.get('name') || '',
  });
  this.edit_box_password = ui.createEditBox({
    placeholder: 'Password',
    type: 'password',
    text: local_storage.get('name') && local_storage.get('password') || '',
  });
}

AccountUI.prototype.showLogin = function (param) {
  let { x, y, style, button_height, prelogout, center } = param;
  button_height = button_height || ui.button_height;
  let edit_box_name = this.edit_box_name;
  let edit_box_password = this.edit_box_password;
  let login_message;
  const BOX_H = ui.font_height;
  let pad = 10;
  let min_h = BOX_H * 2 + pad * 3 + button_height;
  let calign = center ? glov_font.ALIGN.HRIGHT : glov_font.ALIGN.HLEFT;
  if (!net.client.connected) {
    login_message = 'Establishing connection...';
  } else if (net.subs.logging_in) {
    login_message = 'Logging in...';
  } else if (net.subs.logging_out) {
    login_message = 'Logging out...';
  } else if (!net.subs.loggedIn()) {
    let submit = false;
    let w = 100;
    ui.font.drawSizedAligned(style, center ? x - 8 : x, y, Z.UI, ui.font_height, calign, 0, 0, 'Username:');
    submit = edit_box_name.run({ x: center ? x : x + 140, y, w }) === edit_box_name.SUBMIT || submit;
    y += BOX_H + pad;
    ui.font.drawSizedAligned(style, center ? x - 8 : x, y, Z.UI, ui.font_height, calign, 0, 0, 'Password:');
    submit = edit_box_password.run({ x: center ? x : x + 140, y, w }) === edit_box_password.SUBMIT || submit;
    y += BOX_H + pad;
    submit = ui.buttonText({
      x, y, w: 240, h: button_height,
      text: 'Log in/Create User',
    }) || submit;
    y += button_height + pad;

    if (submit) {
      local_storage.set('name', edit_box_name.text);
      // do log in!
      net.subs.login(edit_box_name.text, edit_box_password.text, function (err) {
        if (err) {
          ui.modalDialog({
            title: 'Login Error',
            text: err,
            buttons: {
              'OK': null,
            },
          });
        }
      });
    }
  } else {
    let user_id = net.subs.loggedIn();
    let user_channel = net.subs.getChannel(`user.${user_id}`);
    let display_name = user_channel.getChannelData('public.display_name') || user_id;
    ui.font.drawSizedAligned(style, center ? x - 8 : x + 240 + 8, y, Z.UI, ui.font_height,
      // eslint-disable-next-line no-bitwise
      calign | glov_font.ALIGN.VCENTER, 0, button_height,
      (user_id !== display_name) ?
        `Logged in as ${user_id} (Display Name: ${display_name})` :
        `Logged in as ${user_id}`);
    if (ui.buttonText({
      x, y, w: 240, h: button_height,
      text: 'Log out',
    })) {
      edit_box_password.setText('');
      if (prelogout) {
        prelogout();
      }
      net.subs.logout();
    }
    y += button_height + 8;
  }
  if (login_message) {
    let w = ui.font.drawSizedAligned(style, x - 400, y, Z.UI, ui.font_height * 1.5, glov_font.ALIGN.HVCENTERFIT, 800,
      min_h, login_message);
    w += 100;
    ui.drawRect(x - w / 2, y, x + w / 2, y + min_h, Z.UI - 0.5, vec4(0,0,0,0.25));
    y += min_h;
  }
  return y;
};

export function create(...args) {
  return new AccountUI(...args);
}
