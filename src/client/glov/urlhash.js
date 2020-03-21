// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/*
  API usage:
  engine.defines = urlhash.register({
    key: 'D',
    type: SET,
  });
  urlhash.register({
    key: 'pos',
    // type: TYPE_STRING,
    change: (newvalue) => {},
    title: (value) => 'string',
    def: '1,2',
    hides: { otherfield: true },
    push: true, // do a pushState instead of replaceState when this changes
    root: true, // URL should be foo.com/pos/1,2 instead of foo.com/?pos=1,2
  });
  urlhash.set('pos', '3,4');
  urlhash.get('pos')
*/

const assert = require('assert');

const HISTORY_UPDATE_TIME = 1000;

export let TYPE_SET = 'set';
export let TYPE_STRING = 'string';

let params = {};

let title_suffix = '';

let url_base = (document.location.href || '').match(/^[^#?]+/)[0];

export function getURLBase() {
  return url_base;
}

function queryString() {
  let href = String(document.location);
  return href.slice(url_base.length);
}

const regex_value = /[^\w]\w+=([^&]+)/;
function getValue(query_string, opts) {
  if (opts.root) {
    let m = query_string.match(opts.regex_root);
    if (m) {
      return m[1]; // otherwise try non-rooted format
    }
  }
  let m = query_string.match(opts.regex) || [];
  if (opts.type === TYPE_SET) {
    let r = {};
    for (let ii = 0; ii < m.length; ++ii) {
      let m2 = m[ii].match(regex_value);
      assert(m2);
      r[m2[1]] = 1;
    }
    return r;
  } else {
    return m[1] || opts.def;
  }
}

let last_history_str = null; // always re-set it on the first update

function goInternal(query_string) { // with the '?'
  // Update all values, except those hidden by what is currently in the query string
  let hidden = {};
  for (let key in params) {
    let opts = params[key];
    if (opts.hides) {
      if (getValue(query_string, opts)) {
        for (let otherkey in opts.hides) {
          hidden[otherkey] = 1;
        }
      }
    }
  }

  let dirty = {};
  for (let key in params) {
    if (hidden[key]) {
      continue;
    }
    let opts = params[key];
    let new_value = getValue(query_string, opts);
    if (opts.type === TYPE_SET) {
      for (let v in new_value) {
        if (!opts.value[v]) {
          opts.value[v] = 1;
          dirty[key] = true;
        }
      }
      for (let v in opts.value) {
        if (!new_value[v]) {
          delete opts.value[v];
          dirty[key] = true;
        }
      }
    } else {
      if (new_value !== opts.value) {
        dirty[key] = true;
        opts.value = new_value;
      }
    }
  }

  // Call all change callbacks
  for (let key in dirty) {
    let opts = params[key];
    if (opts.change) {
      opts.change(opts.value);
    }
  }
}

let eff_title;
function toString() {
  eff_title = '';
  let values = [];
  let hidden = {};
  for (let key in params) {
    let opts = params[key];
    if (opts.hides && opts.value) {
      for (let otherkey in opts.hides) {
        hidden[otherkey] = 1;
      }
    }
  }
  let root_value = '';
  for (let key in params) {
    if (hidden[key]) {
      continue;
    }
    let opts = params[key];
    if (opts.type === TYPE_SET) {
      for (let v in opts.value) {
        values.push(`${key}=${v}`);
      }
    } else {
      if (opts.value !== opts.def) {
        if (opts.root) {
          assert(!root_value);
          root_value = `${key}/${opts.value}`;
        } else {
          values.push(`${key}=${opts.value}`);
        }
        if (!eff_title && opts.title) {
          eff_title = opts.title(opts.value);
        }
      }
    }
  }
  if (title_suffix) {
    if (eff_title) {
      eff_title = `${eff_title} | ${title_suffix}`;
    } else {
      eff_title = title_suffix;
    }
  }
  return `${root_value}${values.length ? '?' : ''}${values.join('&')}`;
}

export function refreshTitle() {
  toString();
  if (eff_title && eff_title !== document.title) {
    document.title = eff_title;
  }
}

function periodicRefreshTitle() {
  refreshTitle();
  setTimeout(periodicRefreshTitle, 1000);
}

function onPopState() {
  let query_string = queryString();
  last_history_str = query_string;
  goInternal(query_string);
  refreshTitle();
}

let last_history_set_time = 0;
let scheduled = false;
let need_push_state = false;
function updateHistory(new_need_push_state) {
  let new_str = toString();
  if (last_history_str === new_str) {
    return;
  }
  need_push_state = need_push_state || new_need_push_state;
  last_history_str = new_str;
  if (scheduled) {
    // already queued up
    return;
  }
  let delay = HISTORY_UPDATE_TIME;
  if (Date.now() - last_history_set_time > HISTORY_UPDATE_TIME) {
    // Been awhile, apply "instantly" (but still wait until next tick to ensure
    //   any other immediate changes are registered)
    delay = 1;
  }
  scheduled = true;
  setTimeout(function () {
    scheduled = false;
    last_history_set_time = Date.now();
    if (need_push_state) {
      need_push_state = false;
      window.history.pushState(undefined, eff_title, `${url_base}${last_history_str}`);
    } else {
      window.history.replaceState(undefined, eff_title, `${url_base}${last_history_str}`);
    }
    if (eff_title) {
      document.title = eff_title;
    }
    //window.history.replaceState(undefined, eff_title, `#${last_history_str}`);
  }, delay);
}

// Optional startup
export function startup(param) {
  assert(!title_suffix);
  title_suffix = param.title_suffix;

  // Refresh the current URL, it might be in the non-rooted format
  updateHistory(false);

  if (title_suffix) {
    refreshTitle();
    setTimeout(periodicRefreshTitle, 1000);
  }
}

export function register(opts) {
  assert(opts.key);
  assert(!params[opts.key]);
  opts.type = opts.type || TYPE_STRING;
  let regex_search = `(?:[^\\w])${opts.key}=([^&]+)`;
  let regex_type = 'u';
  if (opts.type === TYPE_SET) {
    regex_type = 'gu';
  } else {
    opts.def = opts.def || '';
  }
  opts.regex = new RegExp(regex_search, regex_type);
  if (opts.root) {
    opts.regex_root = new RegExp(`^${opts.key}/([^?]+)`, regex_type);
  }
  params[opts.key] = opts;
  // Get initial value
  opts.value = getValue(queryString(), opts);
  let ret = opts.value;
  if (opts.type === TYPE_SET && typeof Proxy === 'function') {
    // Auto-apply changes to URL if someone modifies the proxy
    ret = new Proxy(opts.value, {
      set: function (target, prop, value) {
        if (value) {
          target[prop] = 1;
        } else {
          delete target[prop];
        }
        updateHistory();
        return true;
      }
    });
  }

  if (!window.onpopstate) {
    window.onpopstate = onPopState;
  }

  return ret;
}

export function set(key, value, value2) {
  let opts = params[key];
  assert(opts);
  if (opts.type === TYPE_SET) {
    if (Boolean(opts.value[value]) !== Boolean(value2)) {
      opts.value[value] = value2 ? 1 : 0;
      updateHistory(opts.push);
    }
  } else {
    if (opts.value !== value) {
      opts.value = value;
      updateHistory(opts.push);
    }
  }
}

export function get(key) {
  let opts = params[key];
  assert(opts);
  return opts.value;
}

export function go(query_string) { // with the '?'
  goInternal(query_string);
  updateHistory(true);
}
