// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { ChannelWorker } = require('./channel_worker.js');

class ClientWorker extends ChannelWorker {
  constructor(channel_server, channel_id) {
    super(channel_server, channel_id);
    this.client_id = this.channel_subid; // 1234
    this.client = null; // WSClient filled in by channel_server
  }

  onApplyChannelData(source, data) {
    if (!this.ids || !this.ids.user_id) {
      // not logged in yet
      return;
    }
    if (source.type !== 'user' || source.id !== this.ids.user_id) {
      // not about our user
      return;
    }
    if (data.key === 'public.display_name') {
      this.ids.display_name = data.value;
      this.client.ids.display_name = data.value;
    }
  }

  onUnhandledMessage(source, msg, data, resp_func) {
    assert(this.client);
    assert(this.client.connected);
    if (!resp_func.expecting_response) {
      resp_func = null;
    }

    this.client.send('channel_msg', {
      channel_id: source.channel_id,
      msg: msg,
      data: data,
    }, resp_func);
  }
}

export function init(channel_server) {
  channel_server.registerChannelWorker('client', ClientWorker, {
    autocreate: false,
    filters: {
      'apply_channel_data': ClientWorker.prototype.onApplyChannelData,
    },
  });
}
