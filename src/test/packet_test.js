const assert = require('assert');
const { packetCreate, packetFromJSON, PACKET_DEBUG } = require('../common/packet.js');

const test_u8_buf = (function () {
  let u8 = new Uint8Array(8);
  u8[1] = 1;
  u8[3] = 2;
  u8[7] = 3;
  return u8;
}());

const flags = [0, PACKET_DEBUG];

function doTest() {
  let success = true;
  let test = [
    ['Bool', false],
    ['U8', 7],
    ['Int', -77],
    ['Float', -777.75],
    ['String', 'seven'],
    ['AnsiString', 'seven times seven'],
    ['JSON', { seven: 7 }],
    ['Buffer', test_u8_buf],
    ['Bool', true]
  ];

  function writeTest(opts) {
    let pak = packetCreate(opts);
    for (let ii = 0; ii < test.length; ++ii) {
      pak[`write${test[ii][0]}`](test[ii][1]);
    }
    return pak;
  }

  flags.forEach(function (opts) {
    let pak = writeTest(opts);
    console.log(`Packet size: ${pak.totalSize()}`);

    pak.makeReadable();
    let pak_json = pak.toJSON();
    let json_size = JSON.stringify(pak_json).length;
    console.log(`toJSON() size: ${json_size}`);
    pak.pool();
    pak = packetFromJSON(pak_json);
    for (let ii = 0; ii < test.length; ++ii) {
      let type = test[ii][0];
      let v = pak[`read${type}`]();
      let expected_v = test[ii][1];
      if (v !== expected_v) {
        if (typeof v === typeof expected_v) {
          // same type
          if (type === 'Buffer') {
            if (v.length === expected_v.length) {
              let same = true;
              for (let jj = 0; jj < expected_v.length; ++jj) {
                if (v[jj] !== expected_v[jj]) {
                  same = false;
                }
              }
              if (same) {
                continue;
              }
            }
          } else if (typeof v === 'object') {
            if (JSON.stringify(v) === JSON.stringify(expected_v)) {
              // equal as far as JSON is concerned
              continue;
            }
          }
        }
        console.log(`Error reading type ${type} got "${
          JSON.stringify(v)}" expected "${JSON.stringify(expected_v)}"`);
        success = false;
      }
    }
    assert(pak.in_pool !== false); // undefined on Packets, true on PacketDebug
  });

  // Test append
  {
    let pak1 = packetCreate(PACKET_DEBUG);
    let pak2 = packetCreate(PACKET_DEBUG);
    pak1.writeInt(1);
    pak1.writeAnsiString('asdf');
    pak2.writeJSON({ foo: 'bar' });
    pak1.append(pak2);
    pak1.writeU8(2);
    pak1.makeReadable();
    assert.equal(pak1.readInt(), 1);
    assert.equal(pak1.readAnsiString(), 'asdf');
    assert.equal(pak1.readJSON().foo, 'bar');
    assert.equal(pak1.readU8(), 2);
    assert(pak1.in_pool);
    assert(!pak2.in_pool);
    pak2.pool();
  }

  // Test packed integers
  flags.forEach(function (opts) {
    let pak3 = packetCreate(opts);
    let writes = 0;
    // <8 and > 8 bits
    for (let ii = -300; ii <= 300; ++ii) {
      pak3.writeInt(ii);
      ++writes;
    }
    // > 16 bits
    for (let ii = -100000; ii <= 100000; ii += 1000) {
      pak3.writeInt(ii);
      ++writes;
    }
    pak3.writeInt(-2147483648);
    pak3.writeInt(2147483647);
    let size = pak3.totalSize();
    // test reading
    pak3.makeReadable();
    for (let ii = -300; ii <= 300; ++ii) {
      assert.equal(pak3.readInt(), ii);
    }
    // > 16 bits
    for (let ii = -100000; ii <= 100000; ii += 1000) {
      assert.equal(pak3.readInt(), ii);
    }
    assert.equal(pak3.readInt(), -2147483648);
    assert.equal(pak3.readInt(), 2147483647);
    console.log(`${writes} writes, ${size} bytes`);
  });

  // toJSON Perf test
  let pak = writeTest();
  pak.makeReadable();
  let ii;
  let num_tests = 100000;
  let start = Date.now();
  for (ii = 0; ii < num_tests; ++ii) {
    pak.toJSON();
  }
  pak.pool();
  console.log(`toJSON: ${Date.now() - start}ms`);

  if (success) {
    console.log('Test complete.');
  } else {
    console.error('Test FAILED.');
  }
}

doTest();
