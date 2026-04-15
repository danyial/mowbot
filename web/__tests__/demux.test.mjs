import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

function makeFrame(streamType, payload) {
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, Buffer.from(payload)]);
}

test("demuxBuffer splits stdout (type=1) and stderr (type=2) frames", async () => {
  const { demuxBuffer } = await import("../lib/server/demux.mjs");
  const buf = Buffer.concat([
    makeFrame(1, "hello\n"),
    makeFrame(2, "oops\n"),
  ]);
  const { stdout, stderr } = demuxBuffer(buf);
  assert.equal(stdout, "hello\n");
  assert.equal(stderr, "oops\n");
});

test("demuxBuffer handles a multi-frame concatenation", async () => {
  const { demuxBuffer } = await import("../lib/server/demux.mjs");
  const buf = Buffer.concat([
    makeFrame(1, "a\n"),
    makeFrame(1, "b\n"),
    makeFrame(2, "e1\n"),
  ]);
  const { stdout, stderr } = demuxBuffer(buf);
  assert.equal(stdout, "a\nb\n");
  assert.equal(stderr, "e1\n");
});

test("demuxBuffer skips unknown stream types silently", async () => {
  const { demuxBuffer } = await import("../lib/server/demux.mjs");
  const buf = makeFrame(3, "weird\n"); // type 3 is undefined in Docker protocol
  const { stdout, stderr } = demuxBuffer(buf);
  assert.equal(stdout, "");
  assert.equal(stderr, "");
});
