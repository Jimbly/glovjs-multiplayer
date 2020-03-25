/* eslint no-bitwise:off */
/*  Results:
           Plain DataView / Native mapped Buffers
  Node 0.4.12            / 5276ms        (not quite the same test)
  Node 0.6.21     8275ms / 1070ms  (12%) (not quite the same test)
  Node 0.8.28     6739ms / 986ms   (14%) (not quite the same test)
  Node v4.8.2:     4500ms / 1939ms  (43%)
  Node v6.9.1:     3900ms / 1090ms  (28%)
  Node v8.11.3:    2111ms / 2928ms  (138%)
  Node v10.16.0:   2200ms / 260ms   (12%)
  Node v12.14.1:    230ms / 225ms   (98%)
  Node v13.11.1:    244ms / 241ms   (98%)
*/

const assert = require('assert');

function ImpDataView() {
  this.ab = new ArrayBuffer(1024);
  this.dv = new DataView(this.ab);
  this.reset();
}
ImpDataView.label = 'DataView';
ImpDataView.prototype.reset = function () {
  this.offs = 0;
};
ImpDataView.prototype.writeU8 = function (v) {
  this.dv.setUint8(this.offs, v);
  ++this.offs;
};
ImpDataView.prototype.writeU16 = function (v) {
  this.dv.setUint16(this.offs, v, true);
  this.offs+=2;
};
ImpDataView.prototype.writeF32 = function (v) {
  this.dv.setFloat32(this.offs, v, true);
  this.offs+=4;
};
ImpDataView.prototype.readU8 = function (v) {
  this.dv.getUint8(this.offs);
  ++this.offs;
};
ImpDataView.prototype.readU16 = function (v) {
  this.dv.getUint16(this.offs, true);
  this.offs+=2;
};
ImpDataView.prototype.readF32 = function (v) {
  this.dv.getFloat32(this.offs, true);
  this.offs+=4;
};
ImpDataView.prototype.raw = function () {
  return new Uint8Array(this.ab, 0, this.offs);
};

function ImpBuffMap() {
  this.buf = Buffer.allocUnsafe(1024);
  this.u8 = this.buf;
  this.u16 = new Uint16Array(this.buf.buffer, this.buf.byteOffset);
  this.f32 = new Float32Array(this.buf.buffer, this.buf.byteOffset);
  // Note: this needs to be extended with a native module to support non-aligned offsets efficiently
  this.reset();
}
ImpBuffMap.label = 'BuffMap ';
ImpBuffMap.prototype.reset = function () {
  this.offs = 0;
};
ImpBuffMap.prototype.writeU8 = function (v) {
  this.u8[this.offs] = v;
  ++this.offs;
};
ImpBuffMap.prototype.writeU16 = function (v) {
  this.u16[this.offs >> 1] = v;
  this.offs += 2;
};
ImpBuffMap.prototype.writeF32 = function (v) {
  this.f32[this.offs >> 2] = v;
  this.offs += 4;
};
ImpBuffMap.prototype.readU8 = function (v) {
  let ret = this.u8[this.offs];
  ++this.offs;
  return ret;
};
ImpBuffMap.prototype.readU16 = function (v) {
  let ret = this.u16[this.offs >> 1];
  this.offs += 2;
  return ret;
};
ImpBuffMap.prototype.readF32 = function (v) {
  let ret = this.f32[this.offs >> 2];
  this.offs += 4;
  return ret;
};
ImpBuffMap.prototype.raw = function () {
  return this.buf.slice(0, this.offs);
};

let imps = [
  ImpDataView, ImpBuffMap
];

function checkConsitency() {
  let bufs = [];
  for (let ii = 0; ii < imps.length; ++ii) {
    let Ctor = imps[ii];
    let buf = new Ctor();
    bufs.push(buf);
    buf.writeU8(-1);
    buf.writeU8(3);
    buf.writeU8(7);
    buf.writeU8(300);
    buf.writeU16(-1);
    buf.writeU16(201);
    buf.writeU16(301);
    buf.writeU16(1000000000);
    buf.writeF32(0.5);
    buf.writeF32(1000000000);
    buf.writeF32(NaN);
    buf.writeF32(Infinity);
  }

  let b1 = bufs[0].raw();
  let logged = [];
  for (let ii = 1; ii < imps.length; ++ii) {
    let b2 = bufs[ii].raw();
    assert.equal(b1.length, b2.length);
    for (let jj = 0; jj < b1.length; ++jj) {
      if (b1[jj] !== b2[jj]) {
        if (!logged[0]) {
          logged[0] = true;
          console.log(imps[0].label, Buffer.from(b1));
        }
        if (!logged[ii]) {
          logged[ii] = true;
          console.log(imps[ii].label, b2);
        }
        console.error(`Failed: b1=${b1[jj]} b2=${b2[jj]} idx=${jj}`);
      }
    }
  }
}

function checkPerf() {
  let LOOPS = 100000;
  // Pre-alloc buffers
  let bufs = [];
  for (let ii = 0; ii < imps.length; ++ii) {
    let Ctor = imps[ii];
    bufs.push(new Ctor());
  }
  while (true) {
    let line = [];
    let time = [];
    for (let ii = 0; ii < bufs.length; ++ii) {
      let buf = bufs[ii];
      let start = Date.now();
      for (let jj = 0; jj < LOOPS; ++jj) {
        buf.reset();
        for (let kk = 0; kk < 256; ++kk) {
          buf.writeU8(kk);
        }
        for (let kk = 0; kk < 128; ++kk) {
          buf.writeU16(kk * 256);
        }
        for (let kk = 0; kk < 128; ++kk) {
          buf.writeF32(1/kk);
        }
        buf.reset();
        for (let kk = 0; kk < 256; ++kk) {
          buf.readU8();
        }
        for (let kk = 0; kk < 128; ++kk) {
          buf.readU16();
        }
        for (let kk = 0; kk < 128; ++kk) {
          buf.readF32();
        }
      }
      let end = Date.now();
      time.push(end - start);
      line.push(`${imps[ii].label}: ${end - start}ms  `);
    }
    console.log(`${line.join('')} (${(100*time[1] / time[0]).toFixed(1)}%)`);
  }
}

checkConsitency();

checkPerf();
