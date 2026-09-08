(function (root) {
  "use strict";
  // Ignore stale responses when the user types again or closes the editor.
  function createUsernameChecker(original, request, publish) {
    let revision = 0;
    let timer;
    return {
      check: function (value) {
        const username = value.trim();
        const current = ++revision;
        clearTimeout(timer);
        if (username && username === original) return publish("unchanged", "Current username");
        if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
          return publish("invalid", "Use 3–32 letters, numbers, dots, underscores or hyphens.");
        }
        publish("checking", "Checking availability…");
        timer = setTimeout(async function () {
          try {
            const result = await request(username);
            if (current !== revision) return;
            if (!result || typeof result.exists !== "boolean") throw new Error("Invalid response");
            publish(result.exists ? "taken" : "available", result.exists ? "Username already taken" : "Username is available");
          } catch (_) {
            if (current === revision) publish("error", "Couldn’t check availability. Edit the username to try again.");
          }
        }, 300);
      },
      cancel: function () { ++revision; clearTimeout(timer); }
    };
  }
  function isValidName(value) { return Boolean(value.trim()) && Array.from(value).length <= 32; }
  const api = { createUsernameChecker: createUsernameChecker, isValidName: isValidName };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProfileEditor = api;
})(typeof window !== "undefined" ? window : globalThis);
