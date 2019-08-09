const assert = require('assert');
const events = require('events');
const util = require('util');
const wscommon = require('../common/wscommon.js');
const WebSocket = require('ws');


const regex_ipv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u;
function ipFromRequest(req) {
  // See getRemoteAddressFromRequest() for more implementation details, possibilities, proxying options
  // console.log('Client connection headers ' + JSON.stringify(req.headers));

  // Security note: must check x-forwarded-for *only* if we know this request came from a
  //   reverse proxy, should warn if missing x-forwarded-for.
  let ip = req.headers['x-forwarded-for'] || req.client.remoteAddress ||
    req.client.socket && req.client.socket.remoteAddress;
  let port = req.headers['x-forwarded-port'] || req.client.remotePort ||
    req.client.socket && req.client.socket.remotePort;
  assert(ip);
  let m = ip.match(regex_ipv4);
  if (m) {
    ip = m[1];
  }
  return `${ip}${port ? `:${port}` : ''}`;
}

function WSClient(ws_server, socket) {
  events.EventEmitter.call(this);
  this.ws_server = ws_server;
  this.socket = socket;
  this.id = ++ws_server.last_client_id;
  this.addr = ipFromRequest(socket.handshake);
  this.last_pak_id = 0;
  this.resp_cbs = {};
  this.handlers = ws_server.handlers; // reference, not copy!
  this.connected = true;
  this.disconnected = false;
  this.responses_waiting = 0;
  ws_server.clients[this.id] = this;
}
util.inherits(WSClient, events.EventEmitter);

WSClient.prototype.log = function (...args) {
  let client = this;
  let msg = [];
  for (let ii = 0; ii < arguments.length; ++ii) {
    if (typeof args[ii] === 'object') {
      msg.push(util.inspect(args[ii]));
    } else {
      msg.push(args[ii]);
    }
  }
  console.log(`WS Client ${client.id} ${msg.join(' ')}`);
};

WSClient.prototype.onError = function (e) {
  this.ws_server.emit('error', e);
};

WSClient.prototype.send = wscommon.sendMessage;

function WSServer() {
  events.EventEmitter.call(this);
  this.wss = null;
  this.last_client_id = 0;
  this.clients = Object.create(null);
  this.handlers = {};
  this.restarting = false;
}
util.inherits(WSServer, events.EventEmitter);

// cb(client, data, resp_func)
WSServer.prototype.onMsg = function (msg, cb) {
  assert.ok(!this.handlers[msg]);
  this.handlers[msg] = cb;
};

WSServer.prototype.init = function (server) {
  let ws_server = this;
  ws_server.wss = new WebSocket.Server({ server });

  ws_server.wss.on('connection', (socket, req) => {
    socket.handshake = req;
    let client = new WSClient(ws_server, socket);
    console.log(`WS Client ${client.id} connected from ${client.addr}` +
      ` (${Object.keys(ws_server.clients).length} clients connected)`);

    client.send('internal_client_id', client.id);

    socket.on('close', function () {
      client.connected = false;
      client.disconnected = true;
      delete ws_server.clients[client.id];
      console.log(`WS Client ${client.id} disconnected` +
        ` (${Object.keys(ws_server.clients).length} clients connected)`);
      client.emit('disconnect');
      ws_server.emit('disconnect', client);
    });
    socket.on('message', function (data) {
      wscommon.handleMessage(client, data);
    });
    socket.on('error', function (e) {
      // Not sure this exists on `ws`
      client.onError(e);
    });
    ws_server.emit('client', client);
  });
};

WSServer.prototype.broadcast = function (msg, data) {
  let ws_server = this;
  let num_sent = 0;
  for (let client_id in ws_server.clients) {
    if (ws_server.clients[client_id]) {
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
