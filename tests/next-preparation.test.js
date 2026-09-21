"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { NativePool, allowNextPreparation } = require("../playback-window");

test("one-ahead admits Safari/unknown hints, but respects offline, slow links, Save-Data and rollback", () => {
  assert.equal(allowNextPreparation({ userAgent: "iPhone Safari" }, true), true);
  for (const nav of [{ onLine: false }, { deviceMemory: 2 }, { connection: { saveData: true } },
    { connection: { effectiveType: "3g" } }, { connection: { downlink: 0.8 } }]) {
    assert.equal(allowNextPreparation(nav, true), false);
  }
  assert.equal(allowNextPreparation({}, false), false);
});

function setup(t) {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  for (const [name, value] of Object.entries({
    window: { setInterval: () => 123 }, navigator: { userAgent: "iPhone Safari" },
    document: { hidden: false, head: { appendChild() {} }, createElement: () => ({ remove() {} }) },
    location: { origin: "https://web.example" }
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  class Video extends EventTarget {
    constructor() {
      super(); this.attrs = new Map(); this.paused = true; this.readyState = 0;
      this.networkState = 0; this.currentTime = 0; this.duration = 30;
      this.ahead = 0; this.loads = 0; this.plays = 0;
      this.buffered = { get length() { return 1; }, start: () => 0, end: () => this.ahead };
    }
    matches() { return true; }
    querySelectorAll() { return []; }
    set src(value) { this.attrs.set("src", value); this.networkState = 2; }
    get src() { return this.attrs.get("src"); }
    setAttribute(key, value) { this.attrs.set(key, value); }
    hasAttribute(key) { return this.attrs.has(key); }
    removeAttribute(key) { this.attrs.delete(key); }
    pause() { this.paused = true; }
    load() { this.loads++; this.networkState = 0; this.ahead = 0; }
    remove() { this.removed = true; }
    requestVideoFrameCallback() { return 1; }
    cancelVideoFrameCallback() {}
  }
  const clips = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, streamUrl: `https://media.example/${i + 1}.mp4` }));
  const pool = new NativePool({ prepareNextClip: true, telemetry: true, source: clip => clip.streamUrl, create: () => new Video() });
  t.after(() => pool.destroy());
  const current = pool.reconcile(clips, 2, 1);
  pool.activate(current);
  current.video.paused = false;
  current.video.readyState = 3;
  current.video.ahead = 8;
  current.waiting = false;
  const tick = (advance = 0) => { now += advance; pool.tick(); };
  const begin = () => { tick(); tick(751); return pool.preparing; };
  return { pool, clips, current, tick, begin };
}

test("current-first admission prepares only the immediate next source, never plays it, and reuses it on activation", t => {
  const { pool, current, tick, begin } = setup(t);
  current.waiting = true;
  tick(2000);
  assert.equal(pool.preparing, null);
  current.waiting = false;
  const next = begin();
  assert.equal(next.clip.id, 4);
  assert.equal(next.video.paused, true);
  assert.equal(next.wrapper.inert, true);
  assert.equal(next.wrapper.hidden, true);
  assert.equal(next.video.tabIndex, -1);
  assert.equal(pool.scheduler.ordered.filter(entry => entry.video.hasAttribute("src")).length, 2);
  next.video.readyState = 3; next.video.ahead = 2.2; next.video.networkState = 1;
  tick();
  assert.equal(next.prepared, true);
  const source = next.video.src;
  pool.activate(next);
  assert.equal(pool.active.video, next.video);
  assert.equal(next.video.src, source);
  assert.equal(next.video.loads, 0);
  assert.equal(pool.samples.at(-1).type, "activation");
  assert.equal(pool.samples.at(-1).warm, true);
});

for (const reason of ["waiting", "hidden", "offline", "timeout", "overrun", "ignored-stop", "failed"]) {
  test(`preparation cancels on ${reason}, without touching current or retrying the same neighbor`, t => {
    const { pool, clips, current, tick, begin } = setup(t);
    const next = begin();
    if (reason === "waiting") current.waiting = true;
    if (reason === "hidden") document.hidden = true;
    if (reason === "offline") navigator.onLine = false;
    if (reason === "failed") next.failed = true;
    if (reason === "overrun") next.video.ahead = 5;
    if (reason === "ignored-stop") { next.video.ahead = 2; next.video.readyState = 3; tick(); }
    tick(reason === "timeout" ? 4001 : reason === "ignored-stop" ? 601 : 0);
    assert.equal(pool.preparing, null);
    assert.equal(next.video.hasAttribute("src"), false);
    assert.equal(next.video.loads, 1);
    assert.equal(pool.active, current);
    assert.equal(current.video.loads, 0);
    assert.equal(current.video.paused, false);
    current.waiting = false; document.hidden = false; navigator.onLine = true;
    pool.reconcile(clips, 2, 1);
    tick(5000); tick(1000);
    assert.equal(pool.preparing, null);
    assert.ok(pool.scheduler.entries.size <= 5);
    assert.equal(pool.preparationAttempts.size, 1);
  });
}

test("Safari-style metadata-only readiness stays honest, retains its element, and never moves on to next+2", t => {
  const { pool, begin, tick } = setup(t);
  const next = begin();
  next.video.readyState = 1; next.video.networkState = 1;
  tick(10000);
  assert.equal(pool.preparing, next);
  assert.equal(next.prepared, false);
  assert.equal(pool.snapshot().entries.find(entry => entry.id === 4).bufferedSeconds, 0);
  assert.equal(pool.scheduler.ordered.find(entry => entry.offset === 2).video.hasAttribute("src"), false);
  assert.equal(pool.samples.some(event => event.type === "neighbor-ready"), false);
});

test("already-idle neighbor buffers survive pause and background without new downloads", t => {
  const { pool, current, begin, tick } = setup(t);
  const next = begin();
  next.video.readyState = 3; next.video.ahead = 2.2; next.video.networkState = 1;
  tick();
  current.video.paused = true;
  tick();
  pool.suspend(true);
  assert.equal(pool.preparing, next);
  assert.equal(next.video.loads, 0);
  assert.equal(next.video.hasAttribute("src"), true);
  assert.equal(next.video.preload, "none");
});

test("direction changes reprioritize; revision changes get a new attempt; destroy clears owned sources", t => {
  const { pool, clips, begin, tick } = setup(t);
  const next = begin();
  pool.reconcile(clips, 2, -1);
  tick();
  assert.equal(next.video.loads, 1);
  tick();
  assert.equal(pool.preparing.clip.id, 2);
  pool.reconcile(clips.map(clip => clip.id === 2 ? { ...clip, playback: { version: "new" } } : clip), 2, -1);
  tick();
  assert.equal(pool.preparing.clip.playback.version, "new");
  const entries = [...pool.scheduler.ordered];
  pool.destroy();
  tick(5000);
  assert.equal(pool.scheduler.entries.size, 0);
  assert.equal(pool.preparationAttempts.size, 0);
  assert.ok(entries.every(entry => !entry.video.hasAttribute("src")));
});
