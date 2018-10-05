const local_storage = require('./local_storage.js');
const subscription_manager = require('./subscription_manager.js');
const WSClient = require('./wsclient.js').WSClient;

let client;
let subs;

export function init() {
  client = new WSClient();
  client.connect();
  subs = subscription_manager.create(client);
  window.subs = subs; // for debugging
  exports.subs = subs;
  exports.client = client;

  subs.onConnect(function(/*reconnect*/) {
    if (local_storage.get('name') && local_storage.get('password')) {
      subs.login(local_storage.get('name'), local_storage.get('password'), function () {
        // ignore error on auto-login
      });
    }
    // if (reconnect) {
    //   setChatMessageEx('system', 'Reconnected.');
    // }
  });

}
