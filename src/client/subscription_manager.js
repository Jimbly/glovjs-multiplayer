/* global md5 */

const assert = require('assert');
const dot_prop = require('dot-prop');
const local_storage = require('./local_storage.js');

class ClientChannelWorker {
  constructor(subs, channel_id) {
    this.subs = subs;
    this.channel_id = channel_id;
    this.subscriptions = 0;
    this.on_channel_data = null;
    this.handlers = {};
    this.data = {};
    this.onMsg('channel_data', this.handleChannelData.bind(this));
    this.onMsg('apply_channel_data', this.handleApplyChannelData.bind(this));
    this.logged_in = false;
    this.logging_in = false;
  }

  // cb(data [, mod_key, mod_value]);
  onChannelData(cb) {
    this.on_channel_data = cb;
  }

  handleChannelData(data, resp_func) {
    console.log(`got channel_data(${this.channel_id}):  ${JSON.stringify(data)}`);
    this.data = data;
    if (this.on_channel_data) {
      this.on_channel_data(this.data);
    }
    resp_func();
  }
  handleApplyChannelData(data, resp_func) {
    console.log(`got channel data mod: ${JSON.stringify(data)}`);
    if (data.value === undefined) {
      dot_prop.delete(this.data, data.key);
    } else {
      dot_prop.set(this.data, data.key, data.value);
    }
    if (this.on_channel_data) {
      this.on_channel_data(this.data, data.key, data.value);
    }
    resp_func();
  }

  getChannelData(key, default_value) {
    return dot_prop.get(this.data, key, default_value);
  }

  setChannelData(key, value, skip_predict, resp_func) {
    if (!skip_predict) {
      dot_prop.set(this.data, key, value);
    }
    this.subs.client.send('set_channel_data', { channel_id: this.channel_id, key, value }, resp_func);
  }

  removeMsgHandler(msg, cb) {
    assert(this.handlers[msg] === cb);
    delete this.handlers[msg];
  }
  onMsg(msg, cb) {
    assert(!this.handlers[msg]);
    this.handlers[msg] = cb;
  }

  send(msg, data, opts, resp_func) {
    this.subs.client.send('channel_msg', { channel_id: this.channel_id, msg, data, broadcast: opts.broadcast }, resp_func);
  }
}

class SubscriptionManager {
  constructor(client) {
    this.client = client;
    this.on_connect = null;
    this.on_login = null;
    this.channels = {};

    this.first_connect = true;
    this.connected = false;
    this.server_time = 0;
    client.onMsg('connect', this.handleConnect.bind(this));
    client.onMsg('channel_msg', this.handleChannelMessage.bind(this));
    client.onMsg('server_time', this.handleServerTime.bind(this));
  }

  handleConnect() {
    this.connected = true;
    let reconnect = false;
    if (this.first_connect) {
      this.first_connect = false;
    } else {
      reconnect = true;
    }
    if (this.on_connect) {
      this.on_connect(reconnect);
    }
    // (re-)subscribe to all channels
    for (let channel_id in this.channels) {
      let channel = this.channels[channel_id];
      if (channel.subscriptions) {
        this.client.send('subscribe', channel_id);
      }
    }
  }

  handleChannelMessage(data, resp_func) {
    console.log(`got channel_msg(${data.channel_id}) ${data.msg}: ${JSON.stringify(data.data)}`);
    let channel_id = data.channel_id;
    let msg = data.msg;
    data = data.data;
    let channel = this.getChannel(channel_id);
    if (!channel.handlers[msg]) {
      return;
    }
    channel.handlers[msg](data, resp_func);
  }

  handleServerTime(data) {
    this.server_time = data;
    if (this.server_time < this.server_time_interp && this.server_time > this.server_time_interp - 250) {
      /*jshint noempty:false*/
      // slight time travel backwards, this one packet must have been delayed,
      // since we once got a packet quicker. Just ignore this, interpolate from
      // where we were before
      // TODO: If the server had a short stall (less than 250ms) we might be
      // ahead from now on!  Slowly interp back to the specified time
      // (run speed at 90% until it matches?, same thing for catching up to
      // small jumps ahead)
    } else {
      this.server_time_interp = this.server_time;
    }
  }

  getServerTime() {
    // Interpolated server time as of start of last tick
    return this.server_time_interp;
  }

  tick(dt) {
    this.server_time_interp += dt;
  }

  subscribe(channel_id) {
    this.getChannel(channel_id, true);
  }

  getChannel(channel_id, do_subscribe) {
    let channel = this.channels[channel_id];
    if (!channel) {
      channel = this.channels[channel_id] = new ClientChannelWorker(this, channel_id);
    }
    if (do_subscribe) {
      channel.subscriptions++;
      if (this.connected && channel.subscriptions === 1) {
        this.client.send('subscribe', channel_id);
      }
    }
    return channel;
  }

  getMyUserChannel() {
    let user_id = this.loggedIn();
    if (!user_id) {
      return null;
    }
    return this.getChannel(`user.${user_id}`);
  }

  unsubscribe(channel_id) {
    let channel = this.channels[channel_id];
    assert(channel);
    assert(channel.subscriptions);
    channel.subscriptions--;
    if (this.connected && !channel.subscriptions) {
      this.client.send('unsubscribe', channel_id);
    }
  }

  onConnect(cb) {
    assert(!this.on_connect);
    this.on_connect = cb;
  }

  onLogin(cb) {
    assert(!this.on_login);
    this.on_login = cb;
  }

  loggedIn() {
    return this.logged_in ? this.logged_in_username : false;
  }

  login(username, password, resp_func) {
    if (this.logging_in) {
      return resp_func('Login already in progress');
    }
    this.logging_in = true;
    this.logged_in = false;
    //client.send('channel_msg', { channel_id: room_name, msg: 'emote', data: 'is now known as ' + name, broadcast: true });
    if (password && password.split('$$')[0] === 'prehashed') {
      password = password.split('$$')[1];
    } else if (password) {
      password = md5(md5(username) + password);
      local_storage.set('password', 'prehashed$$' + password);
    } else {
      password = undefined;
    }
    this.client.send('login', { name: username, password: password }, (err) => {
      this.logging_in = false;
      if (!err) {
        this.logged_in_username = username;
        this.logged_in = true;
        if (this.on_login) {
          this.on_login(username);
        }
      }
      resp_func(err);
    });
  }
}


export function create(client) {
  return new SubscriptionManager(client);
}
