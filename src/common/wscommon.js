// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const ack = require('./ack.js');
const assert = require('assert');
const { ackHandleMessage, ackWrapMessagePak } = ack;
const packet = require('./packet.js');
const { isPacket, packetCreate, packetFromBuffer } = packet;

export const CONNECTION_TIMEOUT = 60000;
export const PING_TIME = CONNECTION_TIMEOUT / 2;
exports.PROTOCOL_VERSION = '1';

// Rough estimate, if over, will prevent resizing the packet
const PAK_HEADER_SIZE = 1 + // flags
  1+16 + // message id
  1+9; // resp_pak_id

function sendMessageInternal(client, msg, err, data, resp_func) {
  if (!client.connected || client.socket.readyState !== 1) { // WebSocket.OPEN
    (client.log ? client : console).log('Attempting to send on a disconnected link, ignoring', { msg, err, data });
    if (!client.log && client.onError && msg && typeof msg !== 'number') {
      // On the client, if we try to send a new packet while disconnected, this is an application error
      client.onError(`Attempting to send msg=${msg} on a disconnected link`);
    }
    return;
  }
  let is_packet = isPacket(data);
  // assert(!data || is_packet);
  assert(typeof msg === 'string' || typeof msg === 'number');

  let pak = packetCreate(is_packet ? data.getInternalFlags() : packet.default_flags,
    is_packet ? data.totalSize() + (err ? err.length : 0) + PAK_HEADER_SIZE : 0);
  pak.writeFlags();
  ackWrapMessagePak(pak, client, msg, err, data, resp_func);
  pak.makeReadable();

  let buf = pak.getBuffer(); // a Uint8Array
  let buf_len = pak.getBufferLen();
  if (buf_len !== buf.length) {
    buf = new Uint8Array(buf.buffer, buf.byteOffset, buf_len);
  }
  client.socket.send(buf);
  client.last_send_time = Date.now();
  pak.pool();
}

export function sendMessage(msg, data, resp_func) {
  sendMessageInternal(this, msg, null, data, resp_func); // eslint-disable-line no-invalid-this
}

export function wsHandleMessage(client, buf) {
  let now = Date.now();
  let source = client.id ? `client ${client.id}` : 'server';
  if (!(buf instanceof Uint8Array)) {
    (client.log ? client : console).log(`Received incorrect WebSocket data type from ${source} (${typeof buf})`);
    return client.onError('Invalid data received');
  }
  let pak = packetFromBuffer(buf, buf.length, false);
  pak.readFlags();
  client.last_receive_time = now;

  return ackHandleMessage(client, source, pak, function sendFunc(msg, err, data, resp_func) {
    if (resp_func && !resp_func.expecting_response) {
      resp_func = null;
    }
    sendMessageInternal(client, msg, err, data, resp_func);
  }, function handleFunc(msg, data, resp_func) {
    let handler = client.handlers[msg];
    if (!handler) {
      let error_msg = `No handler for message ${JSON.stringify(msg)} from ${source}`;
      console.error(error_msg, data);
      if (client.onError) {
        return client.onError(error_msg);
      }
      return resp_func(error_msg);
    }
    return handler(client, data, resp_func);
  });
}
