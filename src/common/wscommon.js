// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const ack = require('./ack.js');

export const CONNECTION_TIMEOUT = 60000;
export const PING_TIME = CONNECTION_TIMEOUT / 2;

function sendMessageInternal(client, msg, err, data, resp_func) {
  if (!client.connected || client.socket.readyState !== 1) { // WebSocket.OPEN
    (client.log ? client : console).log('Attempting to send on a disconnected link, ignoring', { msg, err, data });
  } else {
    let net_data = ack.wrapMessage(client, msg, err, data, resp_func);
    client.socket.send(JSON.stringify(net_data));
    client.last_send_time = Date.now();
  }
}

export function sendMessage(msg, data, resp_func) {
  sendMessageInternal(this, msg, null, data, resp_func); // eslint-disable-line no-invalid-this
}

export function handleMessage(client, net_data) {
  let now = Date.now();
  let source = `client ${client.id}`;
  try {
    net_data = JSON.parse(net_data);
  } catch (e) {
    (client.log ? client : console).log(`Error parsing data from ${source}`);
    return client.onError(e);
  }
  client.last_receive_time = now;

  return ack.handleMessage(client, source, net_data, function sendFunc(msg, err, data, resp_func) {
    sendMessageInternal(client, msg, err, data, resp_func);
  }, function handleFunc(msg, data, resp_func) {
    let handler = client.handlers[msg];
    if (!handler) {
      return resp_func(`No handler for message ${JSON.stringify(msg)} from ${source}`);
    }
    return handler(client, data, resp_func);
  });
}
