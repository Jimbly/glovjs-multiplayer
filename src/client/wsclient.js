/* global WebSocket */

const assert = require('assert');
const { min } = Math;
const wscommon = require('../common/wscommon.js');

export function WSClient() {
  this.last_pak_id = 0;
  this.id = null;
  this.resp_cbs = {};
  this.handlers = {};
  this.socket = null;
  this.connected = false;
  this.disconnected = false;
  this.retry_scheduled = false;
  this.retry_count = 0;
  this.disconnect_time = 0;

  let path = document.location.toString().match(/^[^#?]+/u)[0]; // remove search and anchor
  if (path.slice(-1) !== '/') {
    // /file.html or /path/file.html or /path
    let idx = path.lastIndexOf('/');
    if (idx !== -1) {
      let filename = path.slice(idx+1);
      if (filename.indexOf('.') !== -1) {
        path = path.slice(0, idx+1);
      } else {
        path += '/';
      }
    } else {
      path += '/';
    }
  }
  path = path.replace(/^http/u, 'ws');
  this.path = `${path}ws`;

  this.connect(false);

  this.onMsg('internal_client_id', this.onInternalClientID.bind(this));
}

WSClient.prototype.timeSinceDisconnect = function () {
  return Date.now() - this.disconnect_time;
};

WSClient.prototype.onInternalClientID = function (client_id, resp_func) {
  let client = this;
  client.connected = true;
  client.disconnected = false;
  client.id = client_id;
  // Fire user-level connect handler as well
  wscommon.handleMessage(client, JSON.stringify({
    msg: 'connect',
    data: {
      client_id: client_id,
    },
  }));
  resp_func();
};


WSClient.prototype.send = function (msg, data, resp_func) {
  wscommon.sendMessage.call(this, msg, data, resp_func);
};

WSClient.prototype.onError = function (e) {
  throw e;
};

// cb(client, data, resp_func)
WSClient.prototype.onMsg = function (msg, cb) {
  assert.ok(!this.handlers[msg]);
  this.handlers[msg] = function wrappedCallback(client, data, resp_func) {
    // Client interface does not need a client passed to it!
    return cb(data, resp_func);
  };
};

WSClient.prototype.retryConnection = function () {
  let client = this;
  assert(!client.socket);
  assert(!client.retry_scheduled);
  client.retry_scheduled = true;
  ++client.retry_count;
  setTimeout(function () {
    assert(client.retry_scheduled);
    assert(!client.socket);
    client.retry_scheduled = false;
    client.connect(true);
  }, min(client.retry_count * client.retry_count * 100, 1000));
};

WSClient.prototype.connect = function (for_reconnect) {
  let client = this;

  // TODO: Add a secret from first connection to auth the reconnect
  let path = for_reconnect && client.id ? `${client.path}?reconnect=${client.id}` : client.path;
  let socket = new WebSocket(path);
  client.socket = socket;

  // Protect callbacks from ever firing if we've already disconnected this socket
  //   from the WSClient
  function guard(fn) {
    return function (...args) {
      if (client.socket !== socket) {
        return;
      }
      fn(...args);
    };
  }

  function abort(skip_close) {
    client.socket = null;
    if (client.connected) {
      client.disconnect_time = Date.now();
    }
    client.connected = false;
    client.disconnected = true;
    if (!skip_close) {
      try {
        socket.close();
      } catch (e) {
        // ignore
      }
    }
  }

  function retry(skip_close) {
    abort(skip_close);
    client.retryConnection();
  }

  // Local state, for this one connection
  let connected = false;
  client.socket.addEventListener('error', guard(function (err) {
    if (!connected) {
      console.log('WebSocket error during initial connection, retrying...', err);
      retry();
    } else {
      console.log('WebSocket error', err);
      // Disconnect and reconnect here, is this a terminal error? Probably not, we'll get a 'close' event if it is?
      client.onError(err);
    }
  }));

  client.socket.addEventListener('message', guard(function (data) {
    wscommon.handleMessage(client, data.data);
  }));

  client.socket.addEventListener('open', guard(function () {
    console.log('WebSocket open');
    connected = true;
    // reset retry count so next retry is fast if we get disconnected
    client.retry_count = 0;
  }));

  client.socket.addEventListener('close', guard(function () {
    console.log('WebSocket close, retrying connection...');
    retry(true);
  }));

  // For debugging reconnect handling
  // setTimeout(function () {
  //   if (connected) {
  //     socket.close();
  //   }
  // }, 5000);
};
