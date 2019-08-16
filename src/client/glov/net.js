// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const glov_engine = require('./engine.js');
const subscription_manager = require('./subscription_manager.js');
const WSClient = require('./wsclient.js').WSClient;

let client;
let subs;

export function init() {
  client = new WSClient();
  subs = subscription_manager.create(client);
  window.subs = subs; // for debugging
  exports.subs = subs;
  exports.client = client;

  glov_engine.addTickFunc((dt) => {
    subs.tick(dt);
  });
}
