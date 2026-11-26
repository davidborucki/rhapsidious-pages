(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VoxxlySignupRequirements = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  const count = value => segmenter ? Array.from(segmenter.segment(value)).length : Array.from(value).length;
  const row = (id, text, meets) => ({ id, text, meets });
  function requirements(field, value, now = new Date()) {
    if (field === "username") return [
      row("username-length", "3–32 characters", value.length >= 3 && value.length <= 32),
      row("username-characters", "Letters, numbers, dots, underscores or dashes", /^[A-Za-z0-9._-]+$/.test(value))
    ];
    if (field === "email") return [row("email-format", "A valid email address", value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))];
    if (field === "password") return [
      row("password-length", "At least 8 characters", count(value) >= 8),
      row("password-limit", new TextEncoder().encode(value).length <= 72 ? "Not too long" : "Use a shorter password", new TextEncoder().encode(value).length <= 72),
      row("password-nonblank", "Not only spaces", value.trim().length > 0)
    ];
    if (field === "dob") {
      const birth = new Date(value + "T00:00:00Z");
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(birth.getTime()) && birth.toISOString().slice(0, 10) === value;
      const age = now.getUTCFullYear() - birth.getUTCFullYear() - (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate()) ? 1 : 0);
      return [row("age", "At least 13 years old", valid && age >= 13)];
    }
    if (field === "gender") return [row("gender", "Select a gender", ["MALE", "FEMALE"].includes(value))];
    if (field === "agreement") return [row("agreement", "Accept the account agreement", value === true)];
    throw new Error("Unknown signup field");
  }
  const state = (edited, meets) => !edited ? "untouched" : meets ? "valid" : "invalid";
  const statusText = value => ({ untouched: "Not checked", valid: "Met", invalid: "Not met" })[value];
  const valid = (field, value) => requirements(field, value).every(rule => rule.meets);
  return { requirements, state, statusText, valid };
});
