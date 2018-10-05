const dot_prop = require('dot-prop');
const FileStore = require('fs-store').FileStore;
const mkdirp = require('mkdirp');
const path = require('path');

class DataStoreOneFile {
  constructor(path) {
    this.root_store = new FileStore(path);
  }
  set(obj_name, key, value) {
    let obj = this.root_store.get(obj_name, {});
    if (!key) {
      obj = value;
    } else {
      dot_prop.set(obj, key, value);
    }
    this.root_store.set(obj_name, obj);
  }
  get(obj_name, key, default_value) {
    let obj = this.root_store.get(obj_name, {});
    if (!key) {
      return obj;
    }
    return dot_prop.get(obj, key, default_value);
  }
}

class DataStore {
  constructor(path) {
    this.path = path;
    this.stores = {};
    this.mkdirs = {};
    this.mkdir(path);
  }
  mkdir(path) {
    if (this.mkdirs[path]) {
      return;
    }
    mkdirp.sync(path);
    this.mkdirs[path] = true;
  }
  getStore(obj_name) {
    let store = this.stores[obj_name];
    if (!store) {
      let store_path = path.join(this.path, obj_name + '.json');
      this.mkdir(path.dirname(store_path));
      store = this.stores[obj_name] = new FileStore(store_path);
    }
    return store;
  }
  set(obj_name, key, value) {
    let store = this.getStore(obj_name);
    let obj = store.get('data', {});
    if (!key) {
      obj = value;
    } else {
      dot_prop.set(obj, key, value);
    }
    store.set('data', obj);
  }
  get(obj_name, key, default_value) {
    let store = this.getStore(obj_name);
    let obj = store.get('data', {});
    if (!key) {
      return obj;
    }
    return dot_prop.get(obj, key, default_value);
  }
}

export function create(path, one_file) {
  if (one_file) {
    return new DataStoreOneFile(path);
  } else {
    return new DataStore(path);
  }
}
