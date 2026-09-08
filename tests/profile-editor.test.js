"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createUsernameChecker } = require("../profile-editor.js");
const { isValidName } = require("../profile-editor.js");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("unchanged Apply dismisses before reaching any backend request", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const start = source.indexOf('dialog.querySelector("form").addEventListener("submit"');
  const submit = source.slice(start, source.indexOf("dialog.showModal()", start));
  const guard = 'if (nameInput.value.trim() === originalName && input.value.trim() === original && !photo)';
  assert.ok(submit.indexOf(guard) >= 0);
  assert.ok(submit.indexOf(guard) < submit.indexOf("await requestJson"));
  assert.match(submit.slice(submit.indexOf(guard)), /\{\s*dialog\.dismiss\(\);\s*return;/);
});

test("names accept nonblank text up to 32 characters", () => {
  for (const value of ["Dave", "Dave B", "名字", "🎵", "a", "hello!? 123"]) assert.equal(isValidName(value), true);
  for (const value of ["", "  ", "\n\t"]) assert.equal(isValidName(value), false);
  assert.equal(isValidName("a".repeat(32)), true);
  assert.equal(isValidName("a".repeat(33)), false);
  assert.equal(isValidName("🎵".repeat(32)), true);
  assert.equal(isValidName("🎵".repeat(33)), false);
});

test("username status copy matches the editor's four outcomes", async () => {
  let message;
  const checker = createUsernameChecker("dave", async name => ({ exists: name === "taken" }), (_, text) => { message = text; });
  checker.check("");
  assert.match(message, /^Use 3–32 letters/);
  checker.check("dave");
  assert.equal(message, "Current username");
  checker.check("taken");
  await delay(340);
  assert.equal(message, "Username already taken");
  checker.check("newname");
  await delay(340);
  assert.equal(message, "Username is available");
  checker.cancel();
});

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
