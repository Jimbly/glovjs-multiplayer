/*jshint browser:true */
/* global io */

var wscommon = require('../common/wscommon.js');
var assert = require('assert');

export function WSClient() {
  this.last_pak_id = 0;
  this.id = null;
  this.resp_cbs = {};
  this.handlers = {};
  this.socket = null;
  this.connected = false;
  this.disconnected = false;
}

WSClient.prototype.send = function (msg, data, resp_func) {
  wscommon.sendMessage.call(this, msg, data, resp_func);
};

WSClient.prototype.onError = function(e) {
  throw e;
};

// cb(client, data, resp_func)
WSClient.prototype.onMsg = function(msg, cb) {
  assert.ok(!this.handlers[msg]);
  let wrap_cb = function (client, data, resp_func) {
    // Client interface does not need a client passed to it!
    return cb(data, resp_func);
  };
  this.handlers[msg] = wrap_cb;
};

WSClient.prototype.connect = function() {
  let client = this;

  let path = location.pathname;
  if (path.slice(-1) !== '/') {
    // /file.html or /path/file.html or /path
    let idx = path.lastIndexOf('/');
    if (idx !== -1) {
      let filename = path.slice(idx+1);
      if (filename.indexOf('.') !== -1) {
        path = path.slice(0, idx+1);
      }
    }
  }
  if (path[0] !== '/') {
    path = '/' + path;
  }
  client.socket = io.connect(undefined, { path: path + 'socket.io' });
  client.socket.onerror = function (err) {
    client.onError(err);
  };

  client.socket.on('message', function (data) {
    wscommon.handleMessage(client, data);
  });

  client.onMsg('internal_client_id', function (client_id, resp_func) {
    client.connected = true;
    client.id = client_id;
    // Fire user-level connect handler as well
    wscommon.handleMessage(client, {
      msg: 'connect',
      data: {
        client_id: client_id,
      },
    });
    resp_func();
  });
};
