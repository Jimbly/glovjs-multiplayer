
function canonical(cmd) {
  return cmd.toLowerCase().replace(/[_\.]/g, '');
}

class CmdParse {
  constructor() {
    this.cmds = {};
    this.was_not_found = false;
  }
  handle(str, resp_func) {
    this.was_not_found = false;
    let m = str.match(/^([^\s]+)(?:\s+(.*))?$/);
    if (!m) {
      resp_func('Missing command');
      return true;
    }
    let cmd = canonical(m[1]);
    if (!this.cmds[cmd]) {
      this.was_not_found = true;
      resp_func(`Unknown command: "${m[1]}"`);
      return false;
    }
    this.cmds[cmd](m[2], resp_func);
    return true;
  }

  register(cmd, func) {
    this.cmds[canonical(cmd)] = func;
  }
}

export function create() {
  return new CmdParse();
}
