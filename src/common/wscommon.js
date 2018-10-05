/*jshint unused:vars*/
/*global require,console,setTimeout,clearTimeout*/
const assert = require('assert');

function sendMessageInternal(client, msg, err, data, resp_func) {
  assert(typeof msg === 'string' || typeof msg === 'number');
  let net_data = {
    msg: msg,
    err: err,
    data: data
  };
  if (resp_func) {
    net_data.pak_id = ++client.last_pak_id;
    client.resp_cbs[net_data.pak_id] = resp_func;
  }
  if (!client.connected) { // client.socket.readyState !== 1) { // WebSocket.OPEN
    (client.log ? client : console).log('Attempting to send on a disconnected link, ignoring', net_data);
  } else {
    client.socket.emit('message', net_data);
    //WebSockets: client.socket.send(JSON.stringify(net_data));
  }
}

export function sendMessage(msg, data, resp_func) {
  sendMessageInternal(this, msg, null, data, resp_func);
}

export function handleMessage(client, net_data) {
  /* WebSockets
  try {
    net_data = JSON.parse(net_data);
  } catch (e) {
    (client.log ? client : console)('Error parsing data from client ' + client.id);
    return client.onError(e);
  }
  */
  let err = net_data.err;
  let data = net_data.data;
  let msg = net_data.msg;
  let pak_id = net_data.pak_id;

  let expecting_response = !!pak_id;
  let timeout_id;
  if (expecting_response) {
    timeout_id = 'pending';
  }
  let sent_response = false;
  let start_time = Date.now();
  function respFunc(err, resp_data, resp_func) {
    assert(!sent_response, 'Response function called twice');
    sent_response = true;
    // the callback wants to send a response, and possibly get a response from that!
    if (!expecting_response) {
      // But, the other end is not expecting a response from this packet, black-hole it
      if (resp_func) {
        // We better not be expecting a response to our response!
        return client.onError('Sending a response to a packet that did not expect one, but we are expecting a response');
      }
      // however, if there was an error, let's forward that along as an error message
      if (err) {
        sendMessageInternal(client, 'error', null, err, null);
      }
      return;
    }
    if (timeout_id) {
      if (timeout_id !== 'pending') {
        clearTimeout(timeout_id);
      }
    } else {
      (client.log ? client : console).log('Response finally sent for ' + msg + ' after ' + ((Date.now() - start_time) / 1000).toFixed(1) + 's');
    }
    client.responses_waiting--;
    sendMessageInternal(client, pak_id, err, resp_data, resp_func);
  }
  if (typeof msg === 'number') {
    let cb = client.resp_cbs[msg];
    if (!cb) {
      return client.onError('Received response to unknown packet with id ' +
        msg + ' from client ' + client.id);
    }
    cb(err, data, respFunc);
  } else {
    if (!msg) {
      return client.onError('Received message with no .msg from client ' + client.id);
    }
    let handler = client.handlers[msg];
    if (!handler) {
      return client.onError('No handler for message ' +
        JSON.stringify(msg) + ' from client ' + client.id);
    }
    handler(client, data, respFunc);
  }
  if (expecting_response) {
    // Note, this may be -1 if respFunc has already been called
    client.responses_waiting = (client.responses_waiting || 0) + 1;
    if (!sent_response) {
      // timeout warning for response
      timeout_id = setTimeout(function () {
        timeout_id = null;
        (client.log ? client : console).log('Response not sent for ' + msg + ' after ' + ((Date.now() - start_time) / 1000).toFixed(1) + 's');
      }, 15*1000);
    }
  }
}
