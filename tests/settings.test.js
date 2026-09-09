"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { legalUrl, supportPayload } = require("../settings.js");
test("legal links accept only absolute web URLs", () => {
  assert.equal(legalUrl("https://example.com/privacy"), "https://example.com/privacy");
  for (const value of [null, "", "/privacy", "javascript:alert(1)", "data:text/html,test"]) assert.equal(legalUrl(value), "");
});
test("support payload matches backend fields and category values", () => {
  assert.deepEqual(supportPayload("PLAYBACK_ISSUE", "  No audio  ", " me@example.com "), { category: "PLAYBACK_ISSUE", message: "No audio", email: "me@example.com" });
  assert.equal(supportPayload("OTHER", "message", "").email, null);
  assert.equal(supportPayload("OTHER", " ", ""), null);
  assert.equal(supportPayload("UNKNOWN", "message", ""), null);
  assert.ok(supportPayload("OTHER", "a".repeat(4000), ""));
  assert.equal(supportPayload("OTHER", "a".repeat(4001), ""), null);
});
