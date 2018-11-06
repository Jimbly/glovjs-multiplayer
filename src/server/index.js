const data_store = require('./data_store.js');
const express = require('express');
const http = require('http');
const path = require('path');
const channel_server = require('./channel_server.js').create();
const test_worker = require('./test_worker.js');
const WSServer = require('./wsserver.js');

let is_dev = process.argv.indexOf('--dev') !== -1;
let port = is_dev ? 4013 : 4012;
//let ds_store = data_store.create('data.json', true);
let ds_store = data_store.create('data_store');

let app = express();
let server = new http.Server(app);
let ws_server = new WSServer();
ws_server.init(server);
ws_server.on('error', function (error) {
  console.error('Unhandled WSServer error:', error);
});

app.use(express.static(path.join(__dirname, '../client/')));

channel_server.init(ds_store, ws_server);
test_worker.init(channel_server);

server.listen(port, () => {
  console.log(`Running server at http://localhost:${port}`);
});
