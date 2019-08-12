const glov_server = require('./glov/server.js');
const express = require('express');
const http = require('http');
const path = require('path');
const test_worker = require('./test_worker.js');

const port = 3000;

let app = express();
let server = new http.Server(app);
app.use(express.static(path.join(__dirname, '../client/')));

glov_server.startup({ server });

test_worker.init(glov_server.channel_server);

server.listen(port, () => {
  console.log(`Running server at http://localhost:${port}`);
});
