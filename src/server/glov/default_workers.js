// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');

class DefaultUserWorker {
  constructor(channel_worker, channel_id) {
    this.channel_worker = channel_worker;
    this.channel_id = channel_id; // user.1234
    this.user_id = channel_worker.channel_subid; // 1234
  }
  cmdRename(new_name, resp_func) {
    if (!new_name) {
      return resp_func('Missing name');
    }
    this.channel_worker.setChannelData('public.display_name', new_name);
    return resp_func(null, 'Successfully renamed');
  }
  handleLogin(src, data, resp_func) {
    if (!data.password) {
      return resp_func('missing password');
    }

    if (!this.channel_worker.getChannelData('private.password')) {
      this.channel_worker.setChannelData('private.password', data.password);
      this.channel_worker.setChannelData('public.display_name', this.user_id);
    }
    if (this.channel_worker.getChannelData('private.password') !== data.password) {
      return resp_func('invalid password');
    }
    return resp_func(null, {
      display_name: this.channel_worker.getChannelData('public.display_name'),
    });
  }
  handleSetChannelData(src/*, key, value*/) {
    assert(src);
    assert(src.type);
    if (src.type !== 'client') {
      // from another channel, accept it
      return true;
    }
    // Only allow changes from own client!
    if (src.user_id !== this.user_id) {
      return false;
    }
    return true;
  }
}

export function init(channel_server) {
  channel_server.registerChannelWorker('user', DefaultUserWorker, {
    autocreate: true,
    cmds: {
      rename: DefaultUserWorker.prototype.cmdRename,
    },
    handlers: {
      login: DefaultUserWorker.prototype.handleLogin,
    },
  });
}
