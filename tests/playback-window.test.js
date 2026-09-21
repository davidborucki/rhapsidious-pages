"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WindowScheduler, sourceFor, mediaKey, bufferedAhead, allowSpeculation } = require("../playback-window");
const { Queue } = require("../playback-queue");

const clips = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, streamUrl: `/clip/${i + 1}` }));
function fixture() {
  const evicted = [];
  const pool = new WindowScheduler({
    key: clip => mediaKey(clip, clip.streamUrl),
    create: (clip, key) => ({ clip, key, identity: {}, visited: false }),
    evict: entry => { evicted.push(entry); }
  });
  return { pool, evicted };
}
test("window is current-first, bounded to five and retains actual entry identity forward/back two", () => {
  const { pool, evicted } = fixture();
  const first = pool.reconcile(clips, 2, 1);
  assert.deepEqual(pool.ordered.map(entry => entry.clip.id), [3, 2, 4, 1, 5]);
  pool.reconcile(clips, 4, 1);
  assert.equal(pool.entries.size, 5);
  assert.equal(pool.entries.get(first.key), first);
  assert.equal(pool.reconcile(clips, 2, -1), first);
  assert.ok(evicted.length > 0);
  for (let i = 0; i < clips.length; i++) {
    pool.reconcile(clips, i, 1);
    assert.ok(pool.entries.size <= 5);
  }
});
test("scheduler orders next then next+2, skips visited/prepared/failed and yields to unhealthy current", () => {
  const { pool } = fixture();
  pool.reconcile(clips, 4, 1);
  assert.equal(pool.candidate(false), null);
  assert.equal(pool.candidate(true).clip.id, 6);
  pool.candidate(true).prepared = true;
  assert.equal(pool.candidate(true).clip.id, 7);
  pool.candidate(true).failed = true;
  assert.equal(pool.candidate(true), null);
  pool.reconcile(clips, 4, -1);
  assert.equal(pool.candidate(true).clip.id, 4);
  pool.candidate(true).visited = true;
  assert.equal(pool.candidate(true).clip.id, 3);
});
test("current revision wins duplicate IDs, and media revisions/source changes evict stale entries", () => {
  const { pool, evicted } = fixture();
  const first = pool.reconcile(clips, 0, 1);
  const revised = { ...clips[0], playback: { version: "new" } };
  pool.reconcile([clips[0], revised, clips[0], clips[1]], 1, 1);
  assert.equal(pool.entries.size, 2);
  assert.equal(pool.current.clip, revised);
  assert.ok(evicted.includes(first));
  const updated = pool.current;
  pool.reconcile([{ ...revised, streamUrl: "/changed" }], 0, 1);
  assert.ok(evicted.includes(updated));
});
test("stale generation callbacks and destroyed sessions are inert; all entries are evicted", () => {
  const { pool, evicted } = fixture();
  pool.reconcile(clips, 2, 1);
  let calls = 0;
  const stale = pool.guard(() => calls++);
  pool.reconcile(clips, 3, 1);
  stale();
  assert.equal(calls, 0);
  const closed = pool.guard(() => calls++);
  pool.destroy();
  closed();
  assert.equal(calls, 0);
  assert.equal(pool.entries.size, 0);
  assert.ok(evicted.length >= 5);
  assert.equal(pool.reconcile(clips, 0, 1), null);
});
test("backend descriptor URLs remain absolute; null/malformed/legacy retain streamUrl; native HLS only", () => {
  const fallback = clip => clip.streamUrl;
  const clip = { id: 1, streamUrl: "/legacy", playback: { version: "a", mp4Url: "https://clips.example/a.mp4", hlsUrl: "https://clips.example/a.m3u8" } };
  assert.equal(sourceFor(clip, fallback, true), clip.playback.mp4Url);
  for (const playback of [null, undefined, {}, { version: "a", mp4Url: "bad" }, { version: "a", mp4Url: "javascript:bad()" }]) {
    assert.equal(sourceFor({ ...clip, playback }, fallback), "/legacy");
  }
  clip.playback.mp4Url = null;
  assert.equal(sourceFor(clip, fallback, true), clip.playback.hlsUrl);
  assert.equal(sourceFor(clip, fallback, false), "/legacy");
});
test("buffer health uses the range containing current time, not the end of an unrelated range", () => {
  const video = { currentTime: 3, buffered: { length: 2, start: i => [0, 20][i], end: i => [5, 50][i] } };
  assert.equal(bufferedAhead(video), 2);
  video.currentTime = 10;
  assert.equal(bufferedAhead(video), 0);
});
test("legacy two-ahead experiment excludes absent hints, slow links, iOS, Save-Data and low memory", () => {
  const fast = { userAgent: "Chrome", deviceMemory: 8, connection: { effectiveType: "4g", downlink: 10 } };
  assert.equal(allowSpeculation(fast, true), true);
  for (const nav of [{}, { ...fast, connection: null }, { ...fast, deviceMemory: 2 }, { ...fast, userAgent: "iPhone Chrome" }, { ...fast, connection: { ...fast.connection, saveData: true } }, { ...fast, connection: { effectiveType: "3g", downlink: 1 } }]) assert.equal(allowSpeculation(nav, true), false);
  assert.equal(allowSpeculation(fast, false), false);
});

function batch() {
  return { version: 2, cycleId: "cycle", nextCursor: "cycle:1", status: "RESERVED", items: [{ reservationId: "reservation", expiresAtEpochMs: 5000, clip: clips[0] }] };
}
test("queue uses exact reserve contract, deduplicates reservations, retries with stable IDs and reconnects 409", async () => {
  const calls = [];
  let fail = true;
  const queue = new Queue(async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) });
    if (fail) { fail = false; throw new Error("offline"); }
    return batch();
  }, "session", () => "uuid", () => 1000);
  await assert.rejects(queue.reserve());
  const entries = await queue.reserve();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(entries[0]._reservation.id, "reservation");
  assert.equal(calls[0].path, "/iosclips/queue/v2/reserve");
  assert.equal(calls[0].body.cursor, null);
  let conflict = true;
  queue.request = async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) });
    if (conflict) { conflict = false; throw { status: 409 }; }
    const response = batch(); response.items.push(response.items[0]); return response;
  };
  assert.equal((await queue.reserve()).length, 1);
  assert.equal(calls.at(-1).body.cursor, null);
  queue.destroy();
});
test("only displayed clips ack; uncertain ack retries original watch snapshot and event ID", async () => {
  const calls = [];
  let fail = true;
  const queue = new Queue(async (path, options) => {
    calls.push(JSON.parse(options.body));
    if (fail) { fail = false; throw new Error("offline"); }
    return { accepted: true };
  }, "session", () => "event", () => 1000);
  const clip = { ...clips[0], _reservation: { id: "r", cycleId: "c" } };
  await queue.ack(clip, 0, false);
  assert.equal(calls.length, 0);
  await assert.rejects(queue.ack(clip, 2, true));
  await queue.ack(clip, 999, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].watchSec, 2);
  await queue.ack(clip, 10, true);
  assert.equal(calls.length, 2);
  queue.destroy();
});
test("queue cancellation rejects late responses and expired entries never enter a playback window", async () => {
  let finish;
  const queue = new Queue(() => new Promise(resolve => { finish = resolve; }), "s", () => "id");
  const pending = queue.reserve();
  queue.destroy();
  finish(batch());
  await assert.rejects(pending, /session ended/);
  const expired = new Queue(async () => batch(), "s", () => "id", () => 6000);
  assert.deepEqual(await expired.reserve(), []);
});

test("golden backend fixtures preserve optional descriptors, rights attribution and creator identity", async () => {
  const ready = require("./fixtures/playback/clip-ready.json");
  const fallback = require("./fixtures/playback/clip-fallback.json");
  const reserved = require("./fixtures/playback/queue-reserved.json");
  const { normalizeClip } = require("../clip-utils");
  assert.deepEqual(normalizeClip(ready), ready);
  assert.equal(sourceFor(ready, clip => clip.streamUrl), ready.playback.mp4Url);
  assert.equal(sourceFor(fallback, clip => clip.streamUrl), fallback.streamUrl);
  assert.notEqual(ready.creatorName, ready.creator.username);
  const queue = new Queue(async () => reserved, "fixture", () => "id", () => 0);
  const entries = await queue.reserve();
  assert.equal(entries[0].playback.version, ready.playback.version);
  assert.equal(entries[0]._reservation.id, reserved.items[0].reservationId);
  queue.destroy();
});

test("429 honors Retry-After without a hot loop or changed retry payload", async () => {
  let now = 0;
  let calls = 0;
  const queue = new Queue(async () => { if (++calls === 1) throw { status: 429, retryAfterMs: 5000 }; return batch(); }, "s", () => "id", () => now);
  await assert.rejects(queue.reserve());
  await assert.rejects(queue.reserve(), /rate limited/);
  assert.equal(calls, 1);
  now = 5000;
  await queue.reserve();
  assert.equal(calls, 2);
});

test("static container packaging includes every application script", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const docker = fs.readFileSync(path.join(__dirname, "../Dockerfile"), "utf8");
  for (const match of html.matchAll(/<script src="\.\/([^?\"]+)/g)) assert.ok(docker.includes(match[1]), `${match[1]} must be copied to the static image`);
});

test("feed transition starts playback synchronously, without a delayed or duplicate activation", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const transition = source.slice(source.indexOf("function transitionFeedToIndex("), source.indexOf("function navigateFeedBy("));
  assert.doesNotMatch(transition, /activateIncomingTimer|setTimeout/);
  assert.equal((transition.match(/activateFeedCard\(incomingCard\)/g) || []).length, 1);
  assert.ok(transition.indexOf("activateFeedCard(incomingCard)") < transition.indexOf("feedAnimationPromise = Promise.all"));
  const activation = source.slice(source.indexOf("function activateFeedCard("), source.indexOf("function bindFeedPlayers("));
  assert.match(activation, /error\.name !== "NotAllowedError"/);
});
