"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const clipUtils = require("../clip-utils.js");

test("normalizes and preserves a valid thumbnail URL", function () {
  const thumbnailUrl = "https://images.rhapsidious.com/clip-thumbnails/123-v1-a1b2c3d4e5f6.jpg";
  const clip = clipUtils.normalizeClip({ id: 123, streamUrl: "/iosclips/123/stream", thumbnailUrl: thumbnailUrl });
  assert.equal(clip.thumbnailUrl, thumbnailUrl);
  assert.equal(clip.streamUrl, "/iosclips/123/stream");
  assert.equal(clipUtils.getAbsoluteThumbnailUrl(clip.thumbnailUrl), thumbnailUrl);
});

test("normalizes null and absent thumbnail URLs", function () {
  assert.equal(clipUtils.normalizeClip({ id: 1, thumbnailUrl: null }).thumbnailUrl, null);
  assert.equal(clipUtils.normalizeClip({ id: 2 }).thumbnailUrl, null);
});

test("rejects malformed, relative, and non-web thumbnail URLs", function () {
  assert.equal(clipUtils.getAbsoluteThumbnailUrl("not a URL"), "");
  assert.equal(clipUtils.getAbsoluteThumbnailUrl("/iosclips/123/stream"), "");
  assert.equal(clipUtils.getAbsoluteThumbnailUrl("javascript:alert(1)"), "");
});

test("grid markup uses lazy images and never embeds video players", function () {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const rendererStart = appSource.indexOf("function renderClipThumbnail");
  const rendererEnd = appSource.indexOf("function bindClipThumbnailErrors", rendererStart);
  const renderer = appSource.slice(rendererStart, rendererEnd);
  assert.match(renderer, /loading="lazy"/);
  assert.match(renderer, /data-clip-thumbnail-image/);
  assert.doesNotMatch(renderer, /<video/);
  assert.doesNotMatch(renderer, /streamUrl/);
  assert.match(renderer, /clip-thumbnail-placeholder/);
  assert.match(renderer, /width="540" height="960"/);
  assert.match(renderer, /routes\.feed\}\?clip=/);
});

test("profile and saved grids open an accessible keyboard-controlled clip viewer", function () {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /function openClipViewer/);
  assert.match(appSource, /aria-modal/);
  assert.match(appSource, /event\.target === overlay/);
  assert.match(appSource, /event\.key === "Escape"/);
  assert.match(appSource, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
  assert.match(appSource, /bindClipViewerLinks\(socialState\.savedClips\)/);
  assert.match(appSource, /bindClipViewerLinks\(activeCollection\)/);
});

test("failed thumbnail requests stop retrying and reveal the placeholder", function () {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const handlerStart = appSource.indexOf("function bindClipThumbnailErrors");
  const handlerEnd = appSource.indexOf("function renderSavedClip", handlerStart);
  const handler = appSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /failedThumbnailUrls\.add/);
  assert.match(handler, /image\.hidden = true/);
  assert.match(handler, /\{ once: true \}/);
});

test("full-screen video may use only the validated thumbnail as its poster", function () {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const rendererStart = appSource.indexOf("function renderFeedItem");
  const rendererEnd = appSource.indexOf("function renderFeed(options)", rendererStart);
  const renderer = appSource.slice(rendererStart, rendererEnd);
  assert.match(renderer, /getAbsoluteThumbnailUrl\(item\.thumbnailUrl\)/);
  assert.match(renderer, /poster=/);
});

test("grid CSS restricts layouts to three and four portrait columns", function () {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.match(css, /\.clip-grid\s*{[^}]*repeat\(3,/s);
  assert.match(css, /@container clip-grid \(min-width: 1060px\)\s*{\s*\.clip-grid\s*{[^}]*repeat\(4,/s);
  assert.match(css, /\.profile-clip\s*{[^}]*aspect-ratio:\s*9\s*\/\s*16/s);
  assert.doesNotMatch(css, /\.clip-grid\s*{[^}]*repeat\((?:1|2|5|6),/s);
});
