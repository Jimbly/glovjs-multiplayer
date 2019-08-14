// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

class ClientWorker {
  constructor(channel_worker, channel_id) {
    this.channel_worker = channel_worker;
    this.channel_id = channel_id; // client.1234
    this.client_id = channel_worker.channel_subid; // 1234
    this.client = null; // WSClient filled in by channel_server
  }
}

export function init(channel_server) {
  channel_server.registerChannelWorker('client', ClientWorker, {
    autocreate: false,
  });
}
