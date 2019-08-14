// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const ack = require('../../common/ack.js');
const assert = require('assert');
const cmd_parse = require('../../common/cmd_parse.js');
const client_worker = require('./client_worker.js');
const default_workers = require('./default_workers.js');
const dot_prop = require('dot-prop');
const exchange = require('./exchange.js');

const { max } = Math;

let cmd_parse_system = cmd_parse.create(); // always empty?

function noop() {
  // do nothing
}

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
function channelServerSend2(source, dest, msg, err, data, resp_func) {
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
    console.log(`${source.channel_id}->${dest}: ${msg} ${logdata(data)}`);
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
  client.channel_worker.unsubscribe(channel_id);
}

function onClientDisconnect(channel_server, client) {
  client.channel_worker.unsubscribeAll();
}

function onSubscribe(channel_server, client, channel_id) {
  client.channel_worker.subscribe(channel_id);
}

function onSetChannelData(channel_server, client, data, resp_func) {
  if (!data.q) {
    console.log(`client_id:${client.id}->${data.channel_id}: set_channel_data ${logdata(data)}`);
  }
  data.key = String(data.key);
  let channel_id = data.channel_id;
  assert(channel_id);
  let channel = client.channels[channel_id];
  if (!channel) {
    console.log(' - failed, channel does not exist');
    resp_func('failed: channel does not exist');
    return;
  }
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

  channel.setChannelDataInternal(client, data.key, data.value, data.q);
  resp_func();
}

function onChannelMsg(channel_server, client, data, resp_func) {
  // Messages to everyone subscribed to the channel, e.g. chat
  console.log(`client_id:${client.id}->${data.channel_id}: channel_msg ${logdata(data)}`);
  let channel_id = data.channel_id;
  assert(channel_id);
  let channel = client.channels[channel_id];
  if (!channel) {
    return void resp_func(`Client is not on channel ${channel_id}`);
  }
  // TODO: Also query app_worker if this is okay?
  if (data.broadcast) {
    assert(typeof data.data === 'object');
    // Replicate to all users
    data.data.client_ids = client.ids;
    // if (data.persist) {
    //   channel.msgs.push(msg);
    // }
    channel.channelEmit(data.msg, data.data);
  } else {
    channel.channelMessage(client, data.msg, data.data, resp_func);
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

  assert(client.client_channel);

  return channelServerSend2(client.client_channel, `user.${data.name}`, 'login', null, {
    password: data.password,
  }, function (err, resp_data) {
    if (!err) {
      client.client_channel.ids = client.client_channel.ids || {};
      client.client_channel.ids.user_id = data.name;
      client.ids.user_id = data.name;
      // Note: not updated upon rename, just useful for debugging
      client.client_channel.ids.display_name = resp_data.display_name;
      client.ids.display_name = resp_data.display_name;

      // Tell channels we have a new user id/display name
      for (let channel_id in client.channels) {
        client.channels[channel_id].clientChanged(client);
      }

      // Always subscribe client to own user
      onSubscribe(channel_server, client, `user.${data.name}`);
    }
    resp_func(err);
  });
}

function onCmdParse(channel_server, client, data, resp_func) {
  let channel;
  function handleCmdResult(err, resp) {
    if (err && channel.app_worker.cmd_parse.was_not_found) {
      // handled must be returning false
      // silently continue
      return;
    }
    // handled must have returned/will return true, so we'll break out
    resp_func(err, resp);
  }
  for (let channel_id in client.channels) {
    channel = client.channels[channel_id];
    let handled = channel.app_worker.cmd_parse.handle(channel.app_worker, data, handleCmdResult);
    if (handled) {
      return;
    }
  }
  cmd_parse_system.handle(null, data, resp_func);
}

function channelServerSend(source, dest, msg, data, resp_func) {
  if (!data || !data.q) {
    console.log(`${source.is_channel_worker ? source.channel_id : `client_id:${source.id}`}->` +
      `${dest.is_channel_worker ? dest.channel_id : `client_id:${dest.id}`}: ${msg} ${logdata(data)}`);
  }
  if (dest.is_channel_worker) {
    dest.channelMessage(source, msg, data, resp_func);
  } else {
    if (source.is_channel_worker) {
      dest.send('channel_msg', {
        channel_id: source.channel_id,
        msg: msg,
        data: data,
      }, resp_func);
    } else {
      // client to client?
      assert(0);
    }
  }
}


export class ChannelWorker {
  constructor(channel_server, channel_id) {
    this.channel_server = channel_server;
    this.channel_id = channel_id;
    let m = channel_id.match(/^([^.]*)\.(.*)$/u);
    assert(m);
    this.channel_type = m[1];
    this.channel_subid = m[2];
    this.ids = null; // Any extra IDs that get send along with every packet
    this.clients = [];
    //this.msgs = [];
    this.app_worker = null;
    this.store_path = `${this.channel_type}/${this.channel_id}`;
    this.data = channel_server.ds_store.get(this.store_path, '', {});
    this.data.public = this.data.public || {};
    this.data.private = this.data.private || {};
    this.data.channel_id = channel_id;
    this.subscribe_counts = {}; // refcount of subscriptions to other channels
    this.is_channel_worker = true;
    this.adding_client = null; // The client we're in the middle of adding, don't send them state updates yet
    ack.initReceiver(this);
    // Modes that can be enabled
    this.emit_join_leave_events = false;
  }
  doEmitJoinLeaveEvents() {
    this.emit_join_leave_events = true;
  }
  setAppWorker(app_worker) {
    this.app_worker = app_worker;
    if (app_worker.maintain_client_list) {
      this.data.public.clients = {};
    }
  }
  addClient(client) {
    this.clients.push(client);
    client.channels[this.channel_id] = this;
    this.adding_client = client;

    if (this.app_worker && this.app_worker.handleNewClient && !this.app_worker.handleNewClient(client)) {
      this.adding_client = null;
      // not allowed, undo
      this.clients.pop();
      delete client.channels[this.channel_id];
      return false;
    }

    if (this.emit_join_leave_events && !client.is_channel_worker) {
      this.channelEmit('join', client.ids);
    }

    if (this.app_worker.maintain_client_list && !client.is_channel_worker) {
      // Clone, not reference, we need to know the old user id for unsubscribing!
      this.setChannelData(`public.clients.${client.id}.ids`, {
        user_id: client.ids.user_id,
        client_id: client.ids.client_id,
        display_name: client.ids.display_name,
      });
      if (client.ids.user_id) {
        this.subscribe(`user.${client.ids.user_id}`);
      }
    }

    this.adding_client = null;

    this.sendChannelMessage(client, 'channel_data', {
      public: this.data.public,
    });
    //client.send('channel_msgs', this.msgs);

    return true;
  }
  subscribe(other_channel_id) {
    console.log(`${this.channel_id}->${other_channel_id}: subscribe`);
    this.subscribe_counts[other_channel_id] = (this.subscribe_counts[other_channel_id] || 0) + 1;
    if (this.subscribe_counts[other_channel_id] !== 1) {
      console.log(' - already subscribed');
      return;
    }
    this.sendChannelMessage2(other_channel_id, 'subscribe', null, null, (err, resp_data) => {
      if (err) {
        console.log(`${this.other_channel_id}->${other_channel_id} subscribe failed: ${err}`);
        this.subscribe_counts[other_channel_id]--;
        this.onError(err);
      } else {
        // succeeded, nothing special
      }
    });
  }
  unsubscribe(other_channel_id) {
    console.log(`${this.channel_id}->${other_channel_id}: unsubscribe `);
    assert(this.channel_type === 'client' || this.subscribe_counts[other_channel_id]);
    if (!this.subscribe_counts[other_channel_id]) {
      console.log(' - failed not subscribed');
      return;
    }
    --this.subscribe_counts[other_channel_id];
    if (this.subscribe_counts[other_channel_id]) {
      console.log(' - still subscribed (refcount)');
      return;
    }

    delete this.subscribe_counts[other_channel_id];
    // TODO: Disable autocreate for this call?
    this.sendChannelMessage2(other_channel_id, 'unsubscribe', null, null, (err, resp_data) => {
      if (err === exchange.ERR_NOT_FOUND) {
        // This is fine, just ignore
        console.log(`${this.other_channel_id}->${other_channel_id} unsubscribe (silently) failed: ${err}`);
      } else if (err) {
        console.log(`${this.other_channel_id}->${other_channel_id} unsubscribe failed: ${err}`);
        this.onError(err);
      } else {
        // succeeded, nothing special
      }
    });
  }
  unsubscribeAll() {
    for (let channel_id in this.subscribe_counts) {
      let count = this.subscribe_counts[channel_id];
      for (let ii = 0; ii < count; ++ii) {
        this.unsubscribe(channel_id);
      }
    }
  }
  removeClient(client) {
    let idx = this.clients.indexOf(client);
    assert(idx !== -1);
    this.clients.splice(idx, 1);
    delete client.channels[this.channel_id];
    if (this.app_worker && this.app_worker.handleClientDisconnect) {
      this.app_worker.handleClientDisconnect(client);
    }
    if (this.emit_join_leave_events && !client.is_channel_worker) {
      this.channelEmit('leave', client.ids);
    }

    if (this.app_worker.maintain_client_list && !client.is_channel_worker) {
      this.setChannelData(`public.clients.${client.id}`, undefined);
      if (client.ids.user_id) {
        this.unsubscribe(`user.${client.ids.user_id}`);
      }
    }
  }
  clientChanged(client) {
    if (this.app_worker && this.app_worker.handleClientChanged) {
      this.app_worker.handleClientChanged(client);
    }
    if (this.app_worker.maintain_client_list && !client.is_channel_worker) {
      let old_ids = this.data.public.clients[client.id] && this.data.public.clients[client.id].ids || {};
      if (old_ids.user_id !== client.ids.user_id) {
        if (old_ids.user_id) {
          this.unsubscribe(`user.${old_ids.user_id}`);
        }
        if (client.ids.user_id) {
          this.subscribe(`user.${client.ids.user_id}`);
        }
      }
      this.setChannelData(`public.clients.${client.id}.ids`, {
        user_id: client.ids.user_id,
        client_id: client.ids.client_id,
        display_name: client.ids.display_name,
      });
    }
  }
  onApplyChannelData(source, data) {
    let channel_worker = this.channel_worker;
    if (this.maintain_client_list) {
      if (source.channel_type === 'user' && data.key === 'public.display_name') {
        for (let client_id in channel_worker.data.public.clients) {
          let client_ids = channel_worker.data.public.clients[client_id].ids;
          if (client_ids.user_id === source.channel_subid) {
            channel_worker.setChannelData(`public.clients.${client_id}.ids.display_name`, data.value);
          }
        }
      }
    }
  }
  channelEmit(msg, data, except_client) {
    for (let ii = 0; ii < this.clients.length; ++ii) {
      if (this.clients[ii] === except_client) {
        continue;
      }
      channelServerSend(this, this.clients[ii], msg, data);
    }
  }
  setChannelData(key, value, q) {
    this.setChannelDataInternal(this, key, value, q);
  }

  setChannelDataInternal(client, key, value, q) {
    assert(typeof key === 'string');
    assert(typeof client === 'object');
    if (this.app_worker && this.app_worker.handleSetChannelData &&
      !this.app_worker.handleSetChannelData(client, key, value)
    ) {
      // denied by app_worker
      console.log(' - failed app_worker check');
      return;
    }

    if (value === undefined) {
      dot_prop.delete(this.data, key);
    } else {
      dot_prop.set(this.data, key, value);
    }
    // only send public changes
    if (key.startsWith('public')) {
      this.channelEmit('apply_channel_data', { key, value, q }, this.adding_client);
    }
    this.channel_server.ds_store.set(this.store_path, '', this.data);
  }
  getChannelData(key, default_vaulue) {
    return dot_prop.get(this.data, key, default_vaulue);
  }
  channelMessage(source, msg, data, resp_func) {
    if (!resp_func) {
      resp_func = noop;
    }
    if (this.filters[msg]) {
      this.filters[msg](source, data);
    }
    if (this.app_worker.handlers[msg]) {
      this.app_worker.handlers[msg].call(this.app_worker, source, data, resp_func);
    } else {
      resp_func();
    }
  }
  sendChannelMessage(dest, msg, data, resp_func) {
    channelServerSend(this, dest, msg, data, resp_func);
  }

  sendChannelMessage2(dest, msg, data, resp_func) {
    channelServerSend2(this.client_channel, dest, msg, null, data, resp_func);
  }

  // source has at least { type, id }, possibly also .user_id and .display_name if type === 'client'
  channelMessage2(source, msg, data, resp_func) {
    let had_handler = false;
    assert(resp_func);
    if (this.filters[msg]) {
      this.filters[msg](source, data);
      had_handler = true;
    }
    if (this.app_worker.handlers[msg]) {
      this.app_worker.handlers[msg].call(this.app_worker, source, data, resp_func);
    } else {
      // No use handler for this message
      if (had_handler) {
        // But, we had a filter (probably something internal) that dealt with it, silently continue;
        resp_func();
      } else {
        resp_func(`No handler registered for "${msg}"`);
      }
    }
  }

  onError(msg) {
    console.error(`ChannelWorker(${this.channel_id}) error:`, msg);
  }

  // Default error handler
  handleError(src, data, resp_func) {
    let self = this.channel_worker;
    self.onError(`Unhandled error from ${src}: ${data}`);
    resp_func();
  }

  // source is a string channel_id
  handleMessage(source, net_data) {
    let channel_worker = this;
    let ids = net_data.ids || {};
    // ids.channel_id = source;
    let split = source.split('.');
    assert(split.length === 2);
    ids.type = split[0];
    ids.id = split[1];

    ack.handleMessage(channel_worker, source, net_data, function sendFunc(msg, err, data, resp_func) {
      channelServerSend2(channel_worker, source, msg, err, data, resp_func);
    }, function handleFunc(msg, data, resp_func) {
      channel_worker.channelMessage2(ids, msg, data, resp_func);
    });
  }
}

class ChannelServer {
  constructor() {
    this.last_client_id = 0;
    this.channel_types = {};
    this.channels = {};
    default_workers.init(this);
    client_worker.init(this);
  }

  // getChannelLocal(channel_id) {
  //   if (this.channels[channel_id]) {
  //     return this.channels[channel_id];
  //   }
  //   let channel_type = channel_id.split('.')[0];
  //   if (!this.channel_types[channel_type]) {
  //     assert(false); // unknown channel type
  //     return null;
  //   }
  //   let Ctor = this.channel_types[channel_type];
  //   if (!Ctor.autocreate) {
  //     // not an auto-creating channel type
  //     return null;
  //   }
  //   let channel = new ChannelWorker(this, channel_id);
  //   this.channels[channel_id] = channel;
  //   channel.setAppWorker(new Ctor(channel, channel_id));
  //   return channel;
  // }

  autoCreateChannel(channel_type, subid, cb) {
    let channel_id = `${channel_type}.${subid}`;
    assert(!this.channels[channel_id]);
    let Ctor = this.channel_types[channel_type];
    assert(Ctor);
    assert(Ctor.autocreate);
    let channel = new ChannelWorker(this, channel_id);
    exchange.register(channel.channel_id, channel.handleMessage.bind(channel), (err) => {
      if (err) {
        // someone else create an identically named channel at the same time, discard ours
      } else {
        // success
        this.channels[channel_id] = channel;
        channel.setAppWorker(new Ctor(channel, channel_id));
      }
      cb(err);
    });
  }

  createChannelLocal(channel_id) {
    assert(!this.channels[channel_id]);
    let channel_type = channel_id.split('.')[0];
    let Ctor = this.channel_types[channel_type];
    assert(Ctor);
    // fine whether it's Ctor.autocreate or not
    let channel = new ChannelWorker(this, channel_id);
    this.channels[channel_id] = channel;
    channel.setAppWorker(new Ctor(channel, channel_id));
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
      client.client_channel.app_worker.client = client;
      client.ids.channel_id = client.client_channel.channel_id;
    });
    ws_server.on('disconnect', onClientDisconnect.bind(this, this));
    ws_server.onMsg('subscribe', onSubscribe.bind(this, this));
    ws_server.onMsg('unsubscribe', onUnSubscribe.bind(this, this));
    ws_server.onMsg('set_channel_data', onSetChannelData.bind(this, this));
    ws_server.onMsg('channel_msg', onChannelMsg.bind(this, this));
    ws_server.onMsg('login', onLogin.bind(this, this));
    ws_server.onMsg('cmdparse', onCmdParse.bind(this, this));

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
    for (let channel_id in this.channels) {
      let channel = this.channels[channel_id];
      if (channel.app_worker && channel.app_worker.tick) {
        channel.app_worker.tick(dt, this.server_time);
      }
    }
  }

  registerChannelWorker(channel_type, ctor, options) {
    options = options || {};
    this.channel_types[channel_type] = ctor;
    ctor.autocreate = options.autocreate;
    ctor.prototype.maintain_client_list = Boolean(options.maintain_client_list);

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
        addUnique(filters, 'apply_channel_data', ChannelWorker.prototype.onApplyChannelData);
      }
    }
  }

  getChannelsByType(channel_type) {
    // TODO: If this is needed distributed, this needs to use exchange (perhaps sendToChannelsByType() instead)
    let ret = [];
    for (let channel_id in this.channels) {
      let channel_type_test = channel_id.split('.')[0];
      if (channel_type_test === channel_type) {
        ret.push(this.channels[channel_id]);
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
