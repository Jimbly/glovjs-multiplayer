// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const ack = require('../../common/ack.js');
const assert = require('assert');
const cmd_parse = require('../../common/cmd_parse.js');
const client_worker = require('./client_worker.js');
const { ChannelWorker } = require('./channel_worker.js');
const default_workers = require('./default_workers.js');
const exchange = require('./exchange.js');

const { max } = Math;

// Messages not allowed to be forwarded from client to arbitrary worker
const RESERVED = {
  'subscribe': 1, 'unsubscribe': 1,
  'client_changed': 1,
  'apply_channel_data': 1, 'set_channel_data': 1,
};

function logdata(data) {
  if (data === undefined) {
    return '';
  }
  let r = JSON.stringify(data);
  if (r.length < 80) {
    return r;
  }
  return `${r.slice(0, 77)}...`;
}

function defaultRespFunc(err) {
  if (err) {
    console.log('Received unhandled error response:', err);
  }
}

// source is a ChannelWorker
// dest is channel_id in the form of `type.id`
export function channelServerSend(source, dest, msg, err, data, resp_func) {
  /*
    TODO: Deal with ordering of initial packets to new channels:
    Keep list of known other channels (maybe LRU with expiry).
    Upon the first message to an unknown channel, we need to queue up all other
      messages to that channel until the first one gets through (including possible
      auto-creation of the channel and retry).
    If a message fails due to ERR_NOT_FOUND, we need to queue up future messages
      to this channel *as well as* any other messages that fail and want to retry,
      but these should be queued in the order they were originally sent, not the
      order failures come back.
    Or, we have a per-process (same UID we use for client IDs), per-destination-
      channel index, and the receiving end orders packets and waits for missing ones.
    Or, it's per-source, to be resilient against moving channels to different
      processes (logic here from other project).
  */
  assert(source.channel_id);
  if (!data || !data.q) {
    console.log(`${source.channel_id}->${dest}: ${msg} ${err ? `err:${logdata(err)}` : ''} ${logdata(data)}`);
  }

  assert(typeof dest === 'string' && dest);
  assert(typeof msg === 'string' || typeof msg === 'number');
  let net_data = ack.wrapMessage(source, msg, err, data, resp_func);
  if (source.ids) {
    net_data.ids = source.ids;
  }
  if (!resp_func) {
    resp_func = defaultRespFunc;
  }
  let retries = 10;
  function trySend(prev_error) {
    if (!retries--) {
      return resp_func(prev_error || 'RETRIES_EXHAUSTED');
    }
    return exchange.publish(source.channel_id, dest, net_data, function (err) {
      if (!err) {
        // Sent successfully, resp_func called when other side ack's.
        return null;
      }
      if (err !== exchange.ERR_NOT_FOUND) {
        // Some error other than not finding the destination, should we do a retry?
        return resp_func(err);
      }
      // Destination not found, should we create it?
      let [dest_type, dest_id] = dest.split('.');
      let channel_server = source.channel_server;
      let ctor = channel_server.channel_types[dest_type];
      if (!ctor) {
        return resp_func('ERR_UNKNOWN_CHANNEL_TYPE');
      }
      if (!ctor.autocreate) {
        return resp_func(err); // ERR_NOT_FOUND
      }
      return channel_server.autoCreateChannel(dest_type, dest_id, function (err2) {
        if (err2) {
          console.log(`Error auto-creating channel ${dest}:`, err2);
        } else {
          console.log(`Auto-created channel ${dest}`);
        }
        trySend(err);
      });
    });
  }
  trySend();
}

function onUnSubscribe(channel_server, client, channel_id) {
  client.client_channel.unsubscribeOther(channel_id);
}

function onClientDisconnect(channel_server, client) {
  client.client_channel.unsubscribeAll();
}

function onSubscribe(channel_server, client, channel_id) {
  client.client_channel.subscribeOther(channel_id);
}

function onSetChannelData(channel_server, client, data, resp_func) {
  if (!data.q) {
    console.log(`client_id:${client.id}->${data.channel_id}: set_channel_data ${logdata(data)}`);
  }
  data.key = String(data.key);
  let channel_id = data.channel_id;
  assert(channel_id);

  let key = data.key.split('.');
  if (key[0] !== 'public' && key[0] !== 'private') {
    console.log(` - failed, invalid scope: ${key[0]}`);
    resp_func('failed: invalid scope');
    return;
  }
  if (!key[1]) {
    console.log(' - failed, missing member name');
    resp_func('failed: missing member name');
    return;
  }

  // TODO: Disable autocreate for this call?
  // TODO: Error if channel does not exist, but do not require an ack? channelServerSend needs a simple "sent" ack?
  channelServerSend(client.client_channel, channel_id, 'set_channel_data', null, data);
  resp_func();
}

function onChannelMsg(channel_server, client, data, resp_func) {
  // Messages to everyone subscribed to the channel, e.g. chat
  console.log(`client_id:${client.id}->${data.channel_id}: channel_msg ${logdata(data)}`);
  if (RESERVED[data.msg]) {
    return void resp_func(`Not allowed to send internal message ${data.msg}`);
  }
  let channel_id = data.channel_id;
  assert(channel_id);
  let client_channel = client.client_channel;

  if (!client_channel.isSubscribedTo(channel_id)) {
    return void resp_func(`Client is not on channel ${channel_id}`);
  }
  if (data.broadcast && typeof data.data !== 'object') {
    return void resp_func('Broadcast requires data object');
  }
  if (!resp_func.expecting_response) {
    resp_func = null;
  }
  if (data.broadcast) {
    delete data.broadcast;
    channelServerSend(client_channel, channel_id, 'broadcast', null, data, resp_func);
  } else {
    channelServerSend(client_channel, channel_id, data.msg, null, data.data, resp_func);
  }
}

const regex_valid_username = /^[a-zA-Z0-9_]+$/u;
function onLogin(channel_server, client, data, resp_func) {
  console.log(`client_id:${client.id}->server login ${logdata(data)}`);
  if (!data.name) {
    return resp_func('invalid username');
  }
  if ({}[data.name]) {
    // hasOwnProperty, etc
    return resp_func('invalid username');
  }
  if (!data.name.match(regex_valid_username)) {
    // has a "." or other invalid character
    return resp_func('invalid username');
  }

  let client_channel = client.client_channel;
  assert(client_channel);

  return channelServerSend(client_channel, `user.${data.name}`, 'login', null, {
    password: data.password,
  }, function (err, resp_data) {
    if (!err) {
      client_channel.ids = client_channel.ids || {};
      client_channel.ids.user_id = data.name;
      client.ids.user_id = data.name;
      client_channel.ids.display_name = resp_data.display_name;
      client.ids.display_name = resp_data.display_name;

      // Tell channels we have a new user id/display name
      for (let channel_id in client_channel.subscribe_counts) {
        channelServerSend(client_channel, channel_id, 'client_changed');
      }

      // Always subscribe client to own user
      onSubscribe(channel_server, client, `user.${data.name}`);
    }
    resp_func(err);
  });
}

class ChannelServer {
  constructor() {
    this.last_client_id = 0;
    this.channel_types = {};
    this.local_channels = {};
  }

  autoCreateChannel(channel_type, subid, cb) {
    let channel_id = `${channel_type}.${subid}`;
    assert(!this.local_channels[channel_id]);
    let Ctor = this.channel_types[channel_type];
    assert(Ctor);
    assert(Ctor.autocreate);
    let channel = new Ctor(this, channel_id);
    exchange.register(channel.channel_id, channel.handleMessage.bind(channel), (err) => {
      if (err) {
        // someone else create an identically named channel at the same time, discard ours
      } else {
        // success
        this.local_channels[channel_id] = channel;
      }
      cb(err);
    });
  }

  createChannelLocal(channel_id) {
    assert(!this.local_channels[channel_id]);
    let channel_type = channel_id.split('.')[0];
    let Ctor = this.channel_types[channel_type];
    assert(Ctor);
    // fine whether it's Ctor.autocreate or not
    let channel = new Ctor(this, channel_id);
    this.local_channels[channel_id] = channel;
    exchange.register(channel.channel_id, channel.handleMessage.bind(channel), function (err) {
      // someone else create an identically named channel, shouldn't be possible to happen!
      assert(!err);
    });
    return channel;
  }

  clientIdFromWSClient(client) { // eslint-disable-line class-methods-use-this
    // TODO: combine a UID for our process with client.id
    return `u${client.id}`;
  }

  init(ds_store, ws_server) {
    this.ds_store = ds_store;
    this.ws_server = ws_server;
    ws_server.on('client', (client) => {
      assert(!client.ids);
      client.ids = {
        type: 'client',
        id: this.clientIdFromWSClient(client),
        // ws_client_id: client.id // not needed anymore?
        user_id: null,
        display_name: null,
      };
      client.client_channel = this.createChannelLocal(`client.${client.ids.id}`);
      client.client_channel.client = client;
      client.ids.channel_id = client.client_channel.channel_id;
    });
    ws_server.on('disconnect', onClientDisconnect.bind(this, this));
    ws_server.onMsg('subscribe', onSubscribe.bind(this, this));
    ws_server.onMsg('unsubscribe', onUnSubscribe.bind(this, this));
    ws_server.onMsg('set_channel_data', onSetChannelData.bind(this, this));
    ws_server.onMsg('channel_msg', onChannelMsg.bind(this, this));
    ws_server.onMsg('login', onLogin.bind(this, this));

    default_workers.init(this);
    client_worker.init(this);

    this.tick_func = this.doTick.bind(this);
    this.tick_time = 250;
    this.last_tick_timestamp = Date.now();
    this.server_time = 0;
    setTimeout(this.tick_func, this.tick_time);
  }

  doTick() {
    setTimeout(this.tick_func, this.tick_time);
    let now = Date.now();
    let dt = max(0, now - this.last_tick_timestamp);
    this.last_tick_timestamp = now;
    if (dt > this.tick_time * 2) {
      // large stall, discard extra time
      dt = this.tick_time;
    }
    this.server_time += dt;
    this.ws_server.broadcast('server_time', this.server_time);
    for (let channel_id in this.local_channels) {
      let channel = this.local_channels[channel_id];
      if (channel.tick) {
        channel.tick(dt, this.server_time);
      }
    }
  }

  registerChannelWorker(channel_type, ctor, options) {
    options = options || {};
    this.channel_types[channel_type] = ctor;
    ctor.autocreate = options.autocreate;

    // Register handlers
    if (!ctor.prototype.cmd_parse) {
      let cmdparser = ctor.prototype.cmd_parse = cmd_parse.create();
      if (options.cmds) {
        for (let cmd in options.cmds) {
          cmdparser.register(cmd, options.cmds[cmd]);
        }
      }
    }
    function addUnique(map, msg, cb) {
      assert(!map[msg]);
      map[msg] = cb;
    }
    if (!ctor.prototype.handlers) {
      let handlers = ctor.prototype.handlers = {};
      if (options.handlers) {
        for (let msg in options.handlers) {
          addUnique(handlers, msg, options.handlers[msg]);
        }
      }
      // Built-in and default handlers
      if (!handlers.error) {
        handlers.error = ChannelWorker.prototype.handleError;
      }
      addUnique(handlers, 'subscribe', ChannelWorker.prototype.onSubscribe);
      addUnique(handlers, 'unsubscribe', ChannelWorker.prototype.onUnSubscribe);
      addUnique(handlers, 'client_changed', ChannelWorker.prototype.onClientChanged);
      addUnique(handlers, 'set_channel_data', ChannelWorker.prototype.onSetChannelData);
      addUnique(handlers, 'broadcast', ChannelWorker.prototype.onBroadcast);
      addUnique(handlers, 'cmdparse', ChannelWorker.prototype.onCmdParse);
    }
    if (!ctor.prototype.filters) {
      let filters = ctor.prototype.filters = {};

      if (options.filters) {
        for (let msg in options.filters) {
          addUnique(filters, msg, options.filters[msg]);
        }
      }

      // Built-in and default filters
      if (ctor.prototype.maintain_client_list) {
        addUnique(filters, 'channel_data', ChannelWorker.prototype.onChannelData);
        addUnique(filters, 'apply_channel_data', ChannelWorker.prototype.onApplyChannelData);
      }
    }
  }

  getChannelsByType(channel_type) {
    // TODO: If this is needed distributed, this needs to use exchange (perhaps sendToChannelsByType() instead)
    let ret = [];
    for (let channel_id in this.local_channels) {
      let channel_type_test = channel_id.split('.')[0];
      if (channel_type_test === channel_type) {
        ret.push(this.local_channels[channel_id]);
      }
    }
    return ret;
  }
}

export function create(...args) {
  return new ChannelServer(...args);
}

export function pathEscape(filename) {
  return filename.replace(/\./gu, '\\.');
}
