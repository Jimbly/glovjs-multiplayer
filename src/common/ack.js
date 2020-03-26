// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-bitwise:off */

const assert = require('assert');
const { isPacket } = require('../common/packet.js');

export function ackInitReceiver(receiver) {
  receiver.last_pak_id = 0;
  receiver.resp_cbs = {};
  receiver.responses_waiting = 0;
}

// `receiver` is really the sender, here
export function wrapMessage(receiver, msg, err, data, resp_func) {
  assert(typeof msg === 'string' || typeof msg === 'number');
  let net_data = {
    msg: msg,
    err: err,
    data: data
  };
  if (resp_func) {
    net_data.pak_id = ++receiver.last_pak_id;
    receiver.resp_cbs[net_data.pak_id] = resp_func;
  }
  return net_data;
}
const ACKFLAG_IS_RESP = 1<<3;
const ACKFLAG_HAS_RESP = 1<<4;
const ACKFLAG_ERR = 1<<5;
const ACKFLAG_DATA = 1<<6;
const ACKFLAG_DATA_JSON = 1<<7;
export function ackWrapMessagePak(pak, receiver, msg, err, data, resp_func) {
  let flags = 0;

  if (typeof msg === 'number') {
    flags |= ACKFLAG_IS_RESP;
    pak.writeInt(msg);
  } else {
    pak.writeAnsiString(msg);
  }
  if (resp_func) {
    flags |= ACKFLAG_HAS_RESP;
    let resp_pak_id = ++receiver.last_pak_id;
    receiver.resp_cbs[resp_pak_id] = resp_func;
    pak.writeInt(resp_pak_id);
  }
  if (err) {
    flags |= ACKFLAG_ERR;
    pak.writeString(err);
  }
  if (data !== undefined) {
    flags |= ACKFLAG_DATA;
    if (!isPacket(data)) {
      flags |= ACKFLAG_DATA_JSON;
      pak.writeJSON(data);
    } else {
      pak.append(data);
      data.pool();
    }
  }

  pak.updateFlags(flags);
}

function ackReadHeader(pak) {
  let flags = pak.getFlags();
  let msg = (flags & ACKFLAG_IS_RESP) ? pak.readInt() : pak.readAnsiString();
  let pak_id = (flags & ACKFLAG_HAS_RESP) ? pak.readInt() : undefined;
  let err = (flags & ACKFLAG_ERR) ? pak.readString() : undefined;
  let data;
  if (flags & ACKFLAG_DATA) {
    if (flags & ACKFLAG_DATA_JSON) {
      data = pak.readJSON();
    } else {
      data = pak;
    }
  }
  return {
    msg,
    err,
    data,
    pak_id,
  };
}

export function failAll(receiver, err) {
  err = err || 'ERR_DISCONNECTED';
  let cbs = receiver.resp_cbs;
  receiver.resp_cbs = {};
  receiver.responses_waiting = 0;
  for (let pak_id in cbs) {
    cbs[pak_id](err);
  }
}

// `source` is a string for debug/logging only
// `receiver` needs initReceicver called on it, have .onError() in the prototype and optionally .log()
// sendFunc(msg, err, data, resp_func)
// handleFunc(msg, data, resp_func)
// eslint-disable-next-line consistent-return
export function ackHandleMessage(receiver, source, net_data_or_pak, send_func, handle_func) {
  let net_data = isPacket(net_data_or_pak) ? ackReadHeader(net_data_or_pak) : net_data_or_pak;
  let { err, data, msg, pak_id } = net_data;
  let now = Date.now();
  let expecting_response = Boolean(pak_id);
  let timeout_id;
  if (expecting_response) {
    timeout_id = 'pending';
  }
  let sent_response = false;
  let start_time = now;

  function respFunc(err, resp_data, resp_func) {
    assert(!sent_response, 'Response function called twice');
    sent_response = true;
    // the callback wants to send a response, and possibly get a response from that!
    if (!expecting_response) {
      // But, the other end is not expecting a response from this packet, black-hole it
      if (resp_func) {
        // We better not be expecting a response to our response!
        receiver.onError(`Sending a response to a packet (${msg}) that did not expect` +
          ' one, but we are expecting a response');
        return;
      }
      // however, if there was an error, let's forward that along as an error message
      if (err) {
        send_func('error', null, err, null);
      }
      return;
    }
    if (timeout_id) {
      if (timeout_id !== 'pending') {
        clearTimeout(timeout_id);
      }
    } else {
      (receiver.log ? receiver : console).log(`Response finally sent for ${msg
      } after ${((Date.now() - start_time) / 1000).toFixed(1)}s`);
    }
    receiver.responses_waiting--;
    send_func(pak_id, err, resp_data, resp_func);
  }
  respFunc.expecting_response = expecting_response;

  if (typeof msg === 'number') {
    let cb = receiver.resp_cbs[msg];
    if (!cb) {
      return receiver.onError(`Received response to unknown packet with id ${msg} from ${source}`);
    }
    delete receiver.resp_cbs[msg];
    cb(err, data, respFunc); // eslint-disable-line callback-return
  } else {
    if (!msg) {
      return receiver.onError(`Received message with no .msg from ${source}`);
    }
    handle_func(msg, data, respFunc);
  }
  if (expecting_response) {
    // Note, this may be -1 if respFunc has already been called
    receiver.responses_waiting++;
    if (!sent_response) {
      // timeout warning for response
      timeout_id = setTimeout(function () {
        timeout_id = null;
        (receiver.log ? receiver : console).log(`Response not sent for ${msg
        } after ${((Date.now() - start_time) / 1000).toFixed(1)}s`);
      }, 15*1000);
    }
  }
}
