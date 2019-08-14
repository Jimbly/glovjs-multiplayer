class TestWorker {
  constructor(channel_worker, channel_id) {
    this.channel_worker = channel_worker;
    this.channel_id = channel_id;
    channel_worker.doEmitJoinLeaveEvents();
  }
}

export function init(channel_server) {
  channel_server.registerChannelWorker('test', TestWorker, {
    maintain_client_list: true,
  });
}
