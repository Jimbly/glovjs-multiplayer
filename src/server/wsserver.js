const assert = require('assert');
const events = require('events');
const util = require('util');
const wscommon = require('../common/wscommon.js');
const socket_io = require('socket.io');

const regex_ipv4 = /^\:\:ffff\:(\d+\.\d+\.\d+\.\d+)$/;
function ipFromSocketIO(socket) {
  // console.log('Client connection headers ' + JSON.stringify(socket.handshake.headers));
  let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  let port = socket.handshake.headers['x-forwarded-port'] || socket.handshake.port;
  let m = ip.match(regex_ipv4);
  if (m) {
    ip = m[1];
  }
  return ip + (port ? ':' + port : '');
}

function WSClient(ws_server, socket) {
  events.EventEmitter.call(this);
  this.ws_server = ws_server;
  this.socket = socket;
  this.id = ++ws_server.last_client_id;
  this.addr = ipFromSocketIO(socket); // ipFromRequest(socket.upgradeReq);
  this.last_pak_id = 0;
  this.resp_cbs = {};
  this.handlers = ws_server.handlers; // reference, not copy!
  this.connected = true;
  this.disconnected = false;
  this.responses_waiting = 0;
  ws_server.clients[this.id] = this;
}
util.inherits(WSClient, events.EventEmitter);

WSClient.prototype.log = function () {
  let client = this;
  let msg = [];
  for (let ii = 0; ii < arguments.length; ++ii) {
    if (typeof arguments[ii] === 'object') {
      msg.push(util.inspect(arguments[ii]));
    } else {
      msg.push(arguments[ii]);
    }
  }
  console.log('WS Client ' + client.id + ' ' + msg.join(' '));
};

WSClient.prototype.onError = function(e) {
  this.ws_server.emit('error', e);
};

WSClient.prototype.send = wscommon.sendMessage;

function WSServer() {
  events.EventEmitter.call(this);
  this.wss = null;
  this.last_client_id = 0;
  this.clients = {};
  this.handlers = {};
  this.restarting = false;
}
util.inherits(WSServer, events.EventEmitter);

// cb(client, data, resp_func)
WSServer.prototype.onMsg = function(msg, cb) {
  assert.ok(!this.handlers[msg]);
  this.handlers[msg] = cb;
};

WSServer.prototype.init = function(server) {
  let ws_server = this;
  ws_server.io = socket_io.listen(server);

  ws_server.io.sockets.on('connection', (socket) => {
    let client = new WSClient(ws_server, socket);
    console.log('WS Client ' + client.id + ' connected from ' + client.addr +
      ' (' + Object.keys(ws_server.clients).length + ' clients connected)');

    client.send('internal_client_id', client.id);

    socket.on('disconnect', function() {
      client.connected = false;
      client.disconnected = true;
      delete ws_server.clients[client.id];
      console.log('WS Client ' + client.id + ' disconnected' +
        ' (' + Object.keys(ws_server.clients).length + ' clients connected)');
      client.emit('disconnect');
      ws_server.emit('disconnect', client);
    });
    socket.on('message', function(data) {
      wscommon.handleMessage(client, data);
    });
    socket.on('error', function(e) {
      // Not sure this exists on socket.io
      client.onError(e);
    });
    ws_server.emit('client', client);
  });
};

WSServer.prototype.broadcast = function (msg, data) {
  let ws_server = this;
  let num_sent = 0;
  for (let client_id in ws_server.clients) {
    if (ws_server.clients.hasOwnProperty(client_id)) {
      let client = ws_server.clients[client_id];
      client.send(msg, data);
      ++num_sent;
    }
  }
  return num_sent;
};

function isClient(obj) {
  return obj instanceof WSClient;
}

WSServer.prototype.isClient = isClient;

module.exports = WSServer;
module.exports.isClient = isClient;
module.exports.WSClient = WSClient;
