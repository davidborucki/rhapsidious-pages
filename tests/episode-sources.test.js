const test = require("node:test");
const assert = require("node:assert/strict");
const sources = require("../episode-sources.js");
const youtube = "https://www.youtube.com/watch?v=abc123", spotify = "https://open.spotify.com/episode/abc123";
test("preferred provider, unavailable-provider fallback and legacy links", () => {
  assert.equal(sources.resolve({youtubeUrl: youtube, spotifyUrl: spotify}, "SPOTIFY"), spotify);
  assert.equal(sources.resolve({youtubeUrl: youtube, spotifyUrl: spotify}, "YOUTUBE"), youtube);
  assert.equal(sources.resolve({youtubeUrl: youtube}, "SPOTIFY"), youtube);
  assert.equal(sources.resolve({spotifyUrl: spotify}, "YOUTUBE"), spotify);
  assert.equal(sources.resolve({fullEpisodeFilepath: "https://example.com/full"}), "https://example.com/full");
  assert.equal(sources.resolve({sourceUrl: "https://example.com/full"}), "https://example.com/full");
  assert.equal(sources.resolve({}), "");
});
test("invalid destinations and optional blank links", () => {
  assert.ok(sources.valid(" ", "YOUTUBE"));
  for (const value of ["http://youtu.be/abc", "https://youtube.com.evil.test/watch?v=abc", "https://user@youtube.com/watch?v=abc", "javascript:alert(1)", "https://youtube.com/redirect?q=x", "https://youtube.com/watch", "https://youtu.be/" + "a".repeat(2048)]) assert.equal(sources.valid(value, "YOUTUBE"), false, value);
  assert.equal(sources.valid("https://open.spotify.com/track/abc", "SPOTIFY"), false);
  assert.ok(sources.valid(spotify+"?si=hello", "SPOTIFY"));
});
