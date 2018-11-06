/*global Z: false */

const glov_engine = require('./glov/engine.js');
const local_storage = require('./local_storage.js');
const net = require('./net.js');

class AccountUI {
  constructor() {
    let glov_ui = glov_engine.glov_ui;
    this.edit_box_name = glov_ui.createEditBox({
      placeholder: 'Username',
      initial_focus: true,
      text: local_storage.get('name') || '',
    });
    this.edit_box_password = glov_ui.createEditBox({
      placeholder: 'Password',
      type: 'password',
      text: local_storage.get('name') && local_storage.get('password') || '',
    });
  }

  showLogin() {
    let glov_ui = glov_engine.glov_ui;
    let edit_box_name = this.edit_box_name;
    let edit_box_password = this.edit_box_password;
    let x = glov_ui.camera.x0() + 10;
    let y = glov_ui.camera.y0() + 10;
    if (!net.subs.loggedIn()) {
      let submit = false;
      let w = 100;
      let pad = 10;
      submit = edit_box_name.run({ x, y, w }) === edit_box_name.SUBMIT || submit;
      x += w + pad;
      submit = edit_box_password.run({ x, y, w }) === edit_box_password.SUBMIT || submit;
      x += w + pad;
      submit = glov_ui.buttonText({
        x, y, w: 240,
        text: 'Log in/Create User',
      }) || submit;
      x += 240 + pad;

      if (submit) {
        local_storage.set('name', edit_box_name.text);
        // do log in!
        net.subs.login(edit_box_name.text, edit_box_password.text, function (err) {
          if (err) {
            glov_ui.modalDialog({
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
      glov_ui.print(null, x, y, Z.UI, (user_id !== display_name) ?
        `Logged in as ${user_id} (Display Name: ${display_name})` :
        `Logged in as ${user_id}`);
    }
  }
}

export function create(...args) {
  return new AccountUI(...args);
}
