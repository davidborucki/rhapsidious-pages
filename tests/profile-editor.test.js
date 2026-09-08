"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createUsernameChecker } = require("../profile-editor.js");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("current legacy username is allowed without an availability request", () => {
  let state;
  const checker = createUsernameChecker("My Name", () => { throw new Error("Must not request"); }, s => { state = s; });
  checker.check(" My Name ");
  assert.equal(state, "unchanged");
  checker.check("!");
  assert.equal(state, "invalid");
  checker.cancel();
});

test("availability reports taken and available, including trimmed input", async () => {
  let state;
  const checker = createUsernameChecker("original", async name => ({ exists: name === "taken" }), s => { state = s; });
  checker.check("taken");
  assert.equal(state, "checking");
  await delay(340);
  assert.equal(state, "taken");
  checker.check(" free ");
  await delay(340);
  assert.equal(state, "available");
  checker.cancel();
});

test("stale requests and responses after close cannot override current state", async () => {
  let finish;
  let state;
  const checker = createUsernameChecker("original", () => new Promise(resolve => { finish = resolve; }), s => { state = s; });
  checker.check("someone");
  await delay(340);
  checker.check("original");
  finish({ exists: true });
  await delay(0);
  assert.equal(state, "unchanged");
  checker.check("another");
  await delay(340);
  checker.cancel();
  finish({ exists: false });
  await delay(0);
  assert.equal(state, "checking");
});

test("failed and malformed availability responses do not enable Apply", async () => {
  for (const request of [async () => { throw new Error("offline"); }, async () => ({})]) {
    let state;
    const checker = createUsernameChecker("original", request, s => { state = s; });
    checker.check("newname");
    await delay(340);
    assert.equal(state, "error");
    checker.cancel();
  }
});
