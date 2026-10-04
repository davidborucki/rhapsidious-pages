const test = require("node:test");
const assert = require("node:assert/strict");
const limits = require("../upload-limits");
test("title boundaries match UTF-16 server limits and reject controls", () => {
  for (const value of ["A title", "a".repeat(200), "😀".repeat(100)]) assert.ok(limits.validTitle(value));
  for (const value of ["", " ", "x".repeat(201), "😀".repeat(101), "bad\u0000title", "bad\ntitle"]) assert.equal(limits.validTitle(value), false);
});
test("empty, oversized and excessive videos rejected without loading data", () => {
  assert.equal(limits.videoError({ name: "video.mp4", size: limits.VIDEO_BYTES }, 9), "");
  for (const [file, count] of [[{name:"a.mp4",size:0},0],[{name:"a.mp4",size:limits.VIDEO_BYTES+1},0],[{name:"a.mp4",size:1},10],[{name:"a.txt",size:1},0]]) assert.ok(limits.videoError(file,count));
});
function png(width,height) { const b=new ArrayBuffer(24),v=new DataView(b),a=new Uint8Array(b);a.set([137,80,78,71]);a.set([73,72,68,82],12);v.setUint32(16,width);v.setUint32(20,height);return b; }
test("pixel bombs rejected from tiny headers, before any image decoder", () => {
  assert.deepEqual(limits.imageDimensions(png(4000,4000)),{width:4000,height:4000});
  for(const [w,h] of [[100000,100000],[1,16000000],[0,100],[8193,1],[4001,4000]]) assert.throws(()=>limits.imageDimensions(png(w,h)));
});
test("JPEG and WebP dimensions use bounded header parsing", () => {
  const jpeg=Uint8Array.from([255,216,255,192,0,7,8,0,40,0,60]);
  assert.deepEqual(limits.imageDimensions(jpeg.buffer),{width:60,height:40});
  const webp=new Uint8Array(30);webp.set(Buffer.from("RIFF"),0);webp.set(Buffer.from("WEBPVP8X"),8);webp[24]=99;webp[27]=79;
  assert.deepEqual(limits.imageDimensions(webp.buffer),{width:100,height:80});
  assert.throws(()=>limits.imageDimensions(new TextEncoder().encode("<svg>not a photo</svg>").buffer));
});
test("photo byte limit checked before reading file data", async () => {
  await assert.rejects(limits.validatePhoto({size:limits.PHOTO_BYTES+1,slice(){throw Error("must not read");}}),/20 MB/);
  let requested=0;await limits.validatePhoto({size:100,slice(start,end){requested=end;return {arrayBuffer:async()=>png(100,100)};}});assert.equal(requested,512*1024);
});
