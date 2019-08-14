// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');

export const ERR_NOT_FOUND = 'ERR_NOT_FOUND';

let queues = {};

// cb(src, message)
// register_cb(err) if already exists
export function register(id, cb, register_cb) {
  assert(id);
  assert(cb);
  assert(!queues[id]);
  queues[id] = cb;
  register_cb(null);
}

export function unregister(id) {
  assert(queues[id]);
  delete queues[id];
}

// cb(err)
export function publish(src, dest, message, cb) {
  // Force this async, message is *not* serialized upon call, so this can be super-fast in-process later
  process.nextTick(function () {
    if (!queues[dest]) {
      return cb(ERR_NOT_FOUND);
    }
    queues[dest](src, message);
    return cb(null);
  });
}
