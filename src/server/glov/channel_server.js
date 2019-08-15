// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const ack = require('../../common/ack.js');
const assert = require('assert');
const cmd_parse = require('../../common/cmd_parse.js');
const { ChannelWorker } = require('./channel_worker.js');
const client_comm = require('./client_comm.js');
const default_workers = require('./default_workers.js');
const exchange = require('./exchange.js');

const { max } = Math;

export function logdata(data) {
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

class ChannelServer {
  constructor() {
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
    client_comm.init(this);

    default_workers.init(this);

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
