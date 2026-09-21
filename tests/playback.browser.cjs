"use strict";
// Real native media over a local HTTP Range server; API metadata alone is mocked.
// NODE_PATH=<Playwright runtime> PLAYBACK_BROWSER_PATH=<browser> node tests/playback.browser.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxxly-playback-"));
  const mediaPath = path.join(directory, "sample.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=270x480:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "24", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "27", "-c:a", "aac", "-movflags", "+faststart", mediaPath]);
  const media = fs.readFileSync(mediaPath);
  const transfers = [];
  let offline = false;
  let delay = 10;
  const root = path.resolve(__dirname, "..");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/media/")) {
      if (offline) { transfers.push({ path: url.pathname, bytes: 0, aborted: true, offline: true }); res.destroy(); return; }
      const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1;
      const transfer = { path: url.pathname, range: req.headers.range || null, bytes: 0, aborted: false };
      transfers.push(transfer);
      res.writeHead(match ? 206 : 200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": end - start + 1,
        ...(match ? { "Content-Range": `bytes ${start}-${end}/${media.length}` } : {}), "Cache-Control": "public,max-age=3600", "Timing-Allow-Origin": "*" });
      let offset = start;
      const timer = setInterval(() => {
        if (offline) { res.destroy(); return; }
        const chunk = media.subarray(offset, Math.min(offset + 32768, end + 1));
        transfer.bytes += chunk.length;
        offset += chunk.length;
        res.write(chunk);
        if (offset > end) { clearInterval(timer); res.end(); }
      }, delay);
      res.on("close", () => { clearInterval(timer); transfer.aborted = offset <= end; });
      return;
    }
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.resolve(root, "." + relative);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYBACK_BROWSER_PATH || undefined });
  const failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", error => failures.push(error.message));
    const interactions = [];
    let feeds = 0;
    let creatorCalls = 0;
    const clips = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, iosUserId: 2, name: `Clip ${i + 1}`, streamUrl: `${origin}/media/${i + 1}.mp4`, thumbnailUrl: null }));
    clips[3].fullEpisodeFilepath = `${origin}/media/episode.mp4`;
    await page.route("**/config.js*", async route => {
      const source = fs.readFileSync(path.join(root, "config.js"), "utf8");
      await route.fulfill({ contentType: "text/javascript", body: source + "\nAPP_CONFIG.feed.playbackTelemetry=true; APP_CONFIG.feed.speculativeNative=true;" });
    });
    await page.route("https://dev-backend-withered-thunder-4589.fly.dev/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      let body = [];
      if (url.pathname === "/auth/me") body = { id: 1, username: "viewer" };
      else if (url.pathname === "/ios/users/1") body = { id: 1, username: "viewer" };
      else if (url.pathname === "/iosclips/feed") { feeds++; body = feeds === 1 ? clips.slice(0, 5) : clips.slice(5); }
      else if (url.pathname === "/iosclips/interactions") { interactions.push(JSON.parse(request.postData())); body = {}; }
      else if (url.pathname === "/ios/users/2") {
        creatorCalls++;
        await new Promise(resolve => setTimeout(resolve, 1500));
        body = { id: 2, username: "creator" };
      } else if (/saved-clips|reposted-clips|\/clips$/.test(url.pathname)) body = clips;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(() => {
      localStorage.setItem("voxxly_web_access_token", "fixture-token");
      // Explicit qualification conditions, not a claim about the host's actual link.
      Object.defineProperty(navigator, "connection", { value: { effectiveType: "4g", downlink: 10, saveData: false } });
      window.videoIdentities = new Map();
      window.videoLoadCalls = new Map();
      const load = HTMLMediaElement.prototype.load;
      HTMLMediaElement.prototype.load = function () {
        window.videoLoadCalls.set(this, (window.videoLoadCalls.get(this) || 0) + 1);
        return load.call(this);
      };
    });
    const active = ".soundbite-card.is-active video";
    await page.goto(origin + "/#/feed");
    await page.waitForSelector(active);
    // Slow creator enrichment must not hold back publication.
    assert.equal(await page.locator(".feed-overlay-creator").first().textContent(), "@Voxxly creator");
    await page.locator(active).click(); // satisfy autoplay policy, if necessary
    await page.evaluate(() => { const video = document.querySelector(".soundbite-card.is-active video"); if (video.paused) video.play(); });
    await page.waitForFunction(() => document.querySelector(".soundbite-card.is-active video").readyState >= 3);
    await page.waitForTimeout(2200);
    assert.equal(creatorCalls, 1);
    const initialPaths = new Set(transfers.map(item => item.path));
    assert.ok(initialPaths.size <= 3, "only current and two upcoming may request media");
    assert.equal(feeds, 1, "legacy feed never fetched early");
    assert.equal(interactions.length, 0, "speculation emits no watches");
    await page.evaluate(() => { window.firstVideo = document.querySelector(".soundbite-card.is-active video"); window.firstSource = firstVideo.src; });
    async function step(direction, id, verifyImmediate = false) {
      if (verifyImmediate) await page.evaluate(() => {
        window.addEventListener("keydown", () => {
          const card = document.querySelector(".soundbite-card.is-active");
          window.synchronousActivation = { id: card?.dataset.clipId, source: card?.querySelector("video").getAttribute("src") };
        }, { once: true });
      });
      await page.keyboard.press(direction > 0 ? "ArrowDown" : "ArrowUp");
      if (verifyImmediate) {
        const activation = await page.evaluate(() => window.synchronousActivation);
        assert.equal(activation.id, String(id), "incoming clip activates within the navigation event, with no animation timer");
        assert.ok(activation.source, "cold loading may begin immediately too");
      }
      await page.waitForFunction(id => document.querySelector(".soundbite-card.is-active")?.dataset.clipId === String(id), id);
      await page.waitForTimeout(650);
      assert.ok(await page.locator("[data-feed-video]").count() <= 5);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("video")].filter(video => !video.paused && !video.muted).length <= 1), true);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("[data-feed-slide][hidden]")].every(slide => slide.inert && slide.querySelector("video").tabIndex === -1)), true);
    }
    await step(1, 2, true);
    await step(1, 3);
    const beforeBackTransfers = transfers.filter(item => item.path === "/media/1.mp4").length;
    await step(-1, 2);
    await step(-1, 1);
    assert.equal(await page.evaluate(() => firstVideo === document.querySelector(".soundbite-card.is-active video") && firstVideo.src === firstSource && !videoLoadCalls.get(firstVideo)), true);
    assert.equal(transfers.filter(item => item.path === "/media/1.mp4").length, beforeBackTransfers, "warm back navigation makes no replacement media request");
    await page.locator(".is-active [data-feed-mute-toggle]").click();
    if (!(await page.locator(active).evaluate(video => video.muted))) await page.locator(".is-active [data-feed-mute-toggle]").click();
    await page.locator(active).click();
    await page.locator(active).click();
    assert.equal(await page.locator(active).evaluate(video => video.muted), true);
    await page.mouse.move(900, 450);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 140);
    await page.waitForTimeout(800);
    assert.equal(await page.locator(".soundbite-card.is-active").getAttribute("data-clip-id"), "2");
    await step(1, 3);
    await step(1, 4);
    await step(1, 5);
    await step(1, 6);
    assert.equal(feeds, 2);
    await step(-1, 5);
    await step(-1, 4);
    assert.ok(interactions.some(item => item.clipId === 5), "last watch is submitted before rebuilding");
    // Visibility suspends preparation/audio without destroying retained buffers.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("video")].every(video => video.paused)), true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    for (const [width, height] of [[320, 568], [390, 844], [430, 932], [760, 900], [768, 900], [1440, 900], [1920, 900]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1), true, `no long scroll page at ${width}`);
      const layout = await page.evaluate(() => {
        const card = document.querySelector('.soundbite-card.is-active');
        const rect = selector => {
          const node = card.querySelector(selector) || document.querySelector(selector);
          const { x, y, width, height, right, bottom } = node.getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        };
        return {
          video: rect('video'), rail: rect('.feed-action-rail'), watch: rect('.feed-watch-action'),
          copy: rect('.feed-video-copy'), nav: rect('.primary-nav'), volume: rect('.feed-volume-control'),
          header: getComputedStyle(document.querySelector('.site-header')).display,
          fit: getComputedStyle(card.querySelector('video')).objectFit,
        };
      });
      if (width <= 760) {
        assert.equal(layout.header, 'none', 'mobile feed hides logo and account bar');
        assert.equal(layout.fit, 'cover');
        assert.ok(Math.abs(layout.video.x) < 1 && Math.abs(layout.video.y) < 1, 'video starts at viewport origin');
        assert.ok(Math.abs(layout.video.width - width) < 1 && Math.abs(layout.video.height - height) < 1, `video fills ${width}x${height} dynamic viewport: ${JSON.stringify(layout.video)}`);
        assert.ok(layout.rail.x > 0 && layout.rail.right <= width && layout.rail.bottom < layout.nav.y, 'rail stays inside video, above navigation');
        assert.ok(layout.watch.y >= layout.volume.bottom && layout.watch.right <= width, 'optional Watch remains onscreen');
        assert.ok(layout.copy.bottom < layout.nav.y && layout.copy.right < layout.rail.x, 'caption clears navigation and action rail');
        assert.ok(Math.abs(layout.volume.y - 20) < 1, 'mobile volume control moved down four pixels');
        assert.ok(Math.abs(layout.nav.y - layout.copy.bottom - 8) < 1, 'caption sits eight pixels above bottom navigation');
        assert.ok(Math.abs(layout.rail.y - Math.min(height / 2 + 62, height - 210) + layout.rail.height / 2) < 1, 'mobile rail shifts down one Watch slot, clamped on short screens');
        assert.ok(layout.nav.bottom <= height && layout.nav.bottom >= height - 16, 'bottom navigation stays available');
      } else {
        assert.notEqual(layout.header, 'none', 'desktop header remains visible');
        assert.equal(layout.fit, 'contain');
        assert.ok(layout.rail.x >= layout.video.right, 'desktop rail remains outside video');
      }
      await page.screenshot({ path: path.join(directory, `feed-${width}.png`) });
    }
    const telemetry = await page.evaluate(() => window.voxxlyPlaybackDiagnostics());
    assert.ok(telemetry.some(item => item.type === "first-frame" && item.method === "requestVideoFrameCallback"));
    assert.ok(telemetry.some(item => item.type === "transfer"));
    // A failed next cold source must not start a second audio stream or an automatic retry storm.
    offline = true;
    await step(1, 5);
    await step(1, 6);
    await step(1, 7);
    await page.waitForFunction(() => Boolean(document.querySelector(".soundbite-card.is-active video").error));
    const failedRequests = transfers.filter(item => item.path === "/media/7.mp4").length;
    await page.waitForTimeout(400);
    assert.equal(transfers.filter(item => item.path === "/media/7.mp4").length, failedRequests, "failed native entry doesn't auto-retry");
    offline = false;
    delay = 80;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + "/#/saved");
    assert.equal(await page.locator('.site-header').isVisible(), true, 'mobile Saved retains the account header');
    await page.locator("[data-view-clip]").first().click();
    await page.waitForSelector("[data-clip-viewer-video]");
    await page.evaluate(() => { window.viewerFirst = document.querySelector("[data-clip-viewer-video]"); });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.evaluate(() => viewerFirst === document.querySelector("[data-clip-viewer-video]") && !videoLoadCalls.get(viewerFirst)), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("video").count(), 0);
    await page.goto(origin + "/#/profile");
    assert.equal(await page.locator('.site-header').isVisible(), true, 'mobile Profile retains the account header');
    await page.locator("[data-view-clip]").first().click();
    await page.waitForSelector("[data-clip-viewer-video]");
    await page.evaluate(() => { window.profileFirst = document.querySelector("[data-clip-viewer-video]"); });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.evaluate(() => profileFirst === document.querySelector("[data-clip-viewer-video]") && !videoLoadCalls.get(profileFirst)), true);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(origin + "/#/feed");
    await page.waitForSelector(active);
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL("**/#/login");
    assert.equal(await page.locator("video").count(), 0);
    assert.deepEqual(failures, []);
    // Default one-ahead path with absent network hints (as on Safari), exercised
    // using real Chromium media transfers. This is NOT a Safari engine benchmark.
    const nextPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    nextPage.on("pageerror", error => failures.push(error.message));
    const nextWatches = [];
    const transferStart = transfers.length;
    const nextReports = [];
    await nextPage.addInitScript(() => {
      localStorage.setItem("voxxly_web_access_token", "fixture-token");
      Object.defineProperty(navigator, "connection", { value: undefined });
    });
    await nextPage.route("https://dev-backend-withered-thunder-4589.fly.dev/**", route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/iosclips/interactions") nextWatches.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(pathname === "/auth/me" ? { id: 1, username: "test" } : pathname === "/iosclips/feed" ? clips : []) });
    });
    await nextPage.goto(origin + "/?playbackDebug=1#/feed");
    await nextPage.waitForSelector(active);
    await nextPage.locator(active).evaluate(video => video.play());
    await nextPage.waitForFunction(() => {
      const next = document.querySelector('[data-clip-id="2"] video');
      return next && next.readyState >= 2 && next.buffered.length && next.buffered.end(0) > 0;
    });
    await nextPage.evaluate(() => { window.preparedVideo = document.querySelector('[data-clip-id="2"] video'); window.preparedSource = preparedVideo.src; });
    assert.equal(nextWatches.length, 0, 'default preparation emits no watch events');
    assert.equal(await nextPage.evaluate(() => [...document.querySelectorAll('video')].filter(video => !video.paused).length), 1);
    assert.ok(transfers.slice(transferStart).some(item => item.path === '/media/2.mp4'), 'upcoming media actually requested before swipe');
    assert.ok(!transfers.slice(transferStart).some(item => item.path === '/media/3.mp4'), 'next+2 not downloaded');
    await nextPage.keyboard.press('ArrowDown');
    await nextPage.waitForFunction(() => document.querySelector('.soundbite-card.is-active')?.dataset.clipId === '2');
    assert.equal(await nextPage.evaluate(() => document.querySelector('.soundbite-card.is-active video') === preparedVideo && preparedVideo.src === preparedSource), true);
    await nextPage.waitForFunction(() => window.voxxlyPlaybackDiagnostics().some(item => item.type === 'first-frame' && item.clipId === 2));
    const oneAheadTelemetry = await nextPage.evaluate(() => window.voxxlyPlaybackDiagnostics());
    assert.equal(oneAheadTelemetry.find(item => item.type === 'first-frame' && item.clipId === 2).warm, true);
    await nextPage.getByText('Playback diagnostics', { exact: true }).click();
    await nextPage.waitForFunction(() => document.querySelector('details pre')?.textContent.includes('bufferedSeconds'));
    await nextPage.screenshot({ path: path.join(directory, 'one-ahead-diagnostics.png') });
    // Start a fresh pool, leave its neighbor offscreen, and force current waiting.
    // Verify cancellation on the native element and actual server-written bytes.
    const cancellationStart = transfers.length;
    await nextPage.reload();
    await nextPage.waitForSelector(active);
    await nextPage.locator(active).evaluate(video => video.play());
    await nextPage.waitForFunction(() => {
      const video = document.querySelector('[data-clip-id="2"] video');
      return video?.networkState === 2 && video.readyState >= 2;
    });
    const cancellation = await nextPage.evaluate(() => {
      const current = document.querySelector('.soundbite-card.is-active video');
      const next = document.querySelector('[data-clip-id="2"] video');
      const source = current.src;
      current.dispatchEvent(new Event('waiting'));
      return { cancelled: !next.hasAttribute('src'), currentPreserved: current.src === source && !current.paused };
    });
    assert.deepEqual(cancellation, { cancelled: true, currentPreserved: true });
    await nextPage.waitForTimeout(600);
    const cancelledTransfers = transfers.slice(cancellationStart).filter(item => item.path === '/media/2.mp4');
    assert.ok(cancelledTransfers.length > 0 && cancelledTransfers.every(item => item.aborted && item.bytes < media.length), 'unused native download stops before the full MP4 is transferred');
    assert.ok(!transfers.slice(cancellationStart).some(item => item.path === '/media/3.mp4'));
    nextReports.push({ cancellation, cancelledTransfers });
    await nextPage.close();
    fs.writeFileSync(path.join(directory, 'one-ahead.json'), JSON.stringify({ telemetry: oneAheadTelemetry, cancellation: nextReports, transfers: transfers.slice(transferStart) }, null, 2));
    // Exercise the exact opt-in reserve/ack contract across a complete cycle.
    const queuePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    queuePage.on("pageerror", error => failures.push(error.message));
    const queueLog = [];
    let cycle = 1;
    let cursor = 0;
    let reservations = [];
    let settled = new Set();
    let nextReservation = 1;
    await queuePage.route("**/config.js*", route => route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, "config.js"), "utf8") + "\nAPP_CONFIG.feed.queueV2=true; APP_CONFIG.feed.playbackTelemetry=true;" }));
    await queuePage.route("https://dev-backend-withered-thunder-4589.fly.dev/**", async route => {
      const url = new URL(route.request().url());
      const payload = route.request().postDataJSON();
      queueLog.push({ path: url.pathname, payload });
      let body = [];
      if (url.pathname === "/auth/me") body = { id: 1, username: "viewer" };
      else if (url.pathname === "/iosclips/queue/v2/reserve") {
        if (settled.size === 4 && reservations.length === 0) { cycle++; settled = new Set(); }
        for (const clip of clips.slice(0, 4)) {
          if (reservations.length < 3 && !settled.has(clip.id) && !reservations.some(item => item.clip.id === clip.id)) reservations.push({ reservationId: `r${nextReservation++}`, expiresAtEpochMs: Date.now() + 900000, clip: { ...clip, creator: { id: 2, username: "embedded", profilePhotoUrl: null } } });
        }
        body = { version: 2, cycleId: `cycle${cycle}`, nextCursor: `cycle${cycle}:${++cursor}`, status: reservations.length ? "RESERVED" : "EMPTY", items: reservations };
      } else if (url.pathname === "/iosclips/queue/v2/ack") {
        const reservation = reservations.find(item => item.reservationId === payload.reservationId);
        assert.ok(reservation, "only actual active reservations may be acknowledged");
        await new Promise(resolve => setTimeout(resolve, 150));
        settled.add(reservation.clip.id);
        reservations = reservations.filter(item => item !== reservation);
        queueLog.push({ path: "ack-complete", id: reservation.clip.id });
        body = { accepted: true, duplicate: false };
      } else if (url.pathname === "/ios/users/2") body = { id: 2, username: "creator" };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await queuePage.addInitScript(() => localStorage.setItem("voxxly_web_access_token", "fixture-token"));
    await queuePage.goto(origin + "/#/feed");
    await queuePage.waitForSelector(active);
    await queuePage.waitForTimeout(700);
    assert.equal(queueLog.filter(item => item.path.endsWith("/ack")).length, 0);
    assert.equal(await queuePage.locator(".is-active .feed-overlay-creator").textContent(), "@embedded");
    for (const id of [2, 3, 4, 1]) {
      await queuePage.keyboard.press("ArrowDown");
      await queuePage.waitForFunction(id => document.querySelector(".soundbite-card.is-active")?.dataset.clipId === String(id), id);
      await queuePage.waitForTimeout(900);
      assert.ok(await queuePage.locator("[data-feed-video]").count() <= 5);
      assert.equal(await queuePage.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map(item => item.id);
        return new Set(ids).size === ids.length;
      }), true);
    }
    assert.equal(cycle, 2);
    const lastAck = queueLog.findIndex(item => item.path === "ack-complete" && item.id === 4);
    assert.ok(queueLog.slice(lastAck + 1).some(item => item.path.endsWith("/reserve")), "new cycle is requested after the last acknowledgment completes");
    assert.ok(!queueLog.some(item => item.path === "/iosclips/feed" || item.path === "/iosclips/interactions"), "v2 doesn't mix legacy watch/feed requests");
    await queuePage.keyboard.press("ArrowUp");
    await queuePage.waitForFunction(() => document.querySelector(".soundbite-card.is-active")?.dataset.clipId === "4");
    await queuePage.waitForTimeout(700);
    await queuePage.keyboard.press("ArrowUp");
    await queuePage.waitForFunction(() => document.querySelector(".soundbite-card.is-active")?.dataset.clipId === "3");
    await queuePage.close();
    assert.deepEqual(failures, []);
    // Explicit autoplay rejection exercises the guarded muted retry, not an assumption
    // about the browser's profile-specific autoplay policy.
    const rejected = await browser.newPage();
    rejected.on("pageerror", error => failures.push(error.message));
    await rejected.route("https://dev-backend-withered-thunder-4589.fly.dev/**", route => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(pathname === "/auth/me" ? { id: 1, username: "test" } : pathname === "/iosclips/feed" ? clips : []) });
    });
    await rejected.addInitScript(() => {
      localStorage.setItem("voxxly_web_access_token", "fixture-token");
      window.rejections = 0;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (!this.muted && !window.rejections) { window.rejections++; return Promise.reject(new DOMException("Blocked for test", "NotAllowedError")); }
        return play.call(this);
      };
    });
    await rejected.goto(origin + "/#/feed");
    await rejected.waitForFunction(() => { const video = document.querySelector(".soundbite-card.is-active video"); return video && video.muted && !video.paused && video.readyState >= 2; });
    assert.equal(await rejected.evaluate(() => window.rejections), 1);
    assert.equal(await rejected.locator('.is-active [data-feed-audio-prompt]').isVisible(), true);
    await rejected.locator(active).click();
    assert.equal(await rejected.locator(active).evaluate(video => !video.muted && !video.paused), true, 'tap on a policy-muted video restores requested audio, not pause');
    assert.equal(await rejected.locator('.is-active [data-feed-audio-prompt]').isVisible(), false);
    // Delay one policy rejection until a later tap has already started playback.
    await rejected.evaluate(() => {
      const play = HTMLMediaElement.prototype.play;
      window.holdPlay = true;
      HTMLMediaElement.prototype.play = function () {
        if (window.holdPlay && !this.muted) {
          window.holdPlay = false;
          return new Promise((resolve, reject) => { window.rejectOldPlay = reject; });
        }
        return play.call(this);
      };
    });
    // Reduced-motion remains a one-clip transition, with no native controls added.
    await rejected.emulateMedia({ reducedMotion: "reduce" });
    await rejected.keyboard.press("ArrowDown");
    await rejected.waitForFunction(() => document.querySelector(".soundbite-card.is-active")?.dataset.clipId === "2");
    await rejected.locator(active).click();
    await rejected.evaluate(() => window.rejectOldPlay(new DOMException('Old request', 'NotAllowedError')));
    assert.equal(await rejected.locator(active).evaluate(video => !video.muted && !video.paused), true, 'stale rejection never mutes a newer successful play');
    await rejected.locator('.is-active [data-feed-mute-toggle]').click();
    await rejected.locator(active).click();
    await rejected.locator(active).click();
    await rejected.keyboard.press('ArrowDown');
    await rejected.waitForFunction(() => document.querySelector('.soundbite-card.is-active')?.dataset.clipId === '3');
    assert.equal(await rejected.locator(active).evaluate(video => video.muted), true, 'intentional mute survives pause/resume and navigation');
    assert.equal(await rejected.locator("video[controls]").count(), 0);
    await rejected.close();
    const rollback = await browser.newPage();
    await rollback.route("**/config.js*", route => route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, "config.js"), "utf8") + "\nAPP_CONFIG.feed.playbackWindow=false;" }));
    await rollback.route("https://dev-backend-withered-thunder-4589.fly.dev/**", route => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(pathname === "/auth/me" ? { id: 1, username: "test" } : pathname === "/iosclips/feed" ? clips : []) });
    });
    await rollback.addInitScript(() => localStorage.setItem("voxxly_web_access_token", "fixture-token"));
    await rollback.goto(origin + "/#/feed");
    await rollback.waitForSelector(active);
    assert.equal(await rollback.locator("video").count(), 1);
    await rollback.keyboard.press("ArrowDown");
    await rollback.waitForFunction(() => document.querySelector(".soundbite-card.is-active")?.dataset.clipId === "2");
    await rollback.locator(active).evaluate(video => video.pause());
    await rollback.waitForTimeout(600);
    assert.equal(await rollback.locator(active).evaluate(video => video.paused), true, "animation completion must not override a user pause");
    assert.equal(await rollback.locator("video").count(), 1);
    await rollback.close();
    assert.deepEqual(failures, []);
    const warm = telemetry.filter(item => item.type === "first-frame" && item.warm).map(item => item.activationMs).sort((a, b) => a - b);
    const percentile = p => warm.length ? warm[Math.min(warm.length - 1, Math.floor(warm.length * p))] : null;
    console.log(JSON.stringify({ result: "PASS", browser: await browser.version(), mediaBytes: media.length, conditions: "localhost HTTP/1.1, generated 270x480 H264/AAC 24s; 32KiB/10ms; forced 4g hint; NOT CDN measurements", initialRequestedClips: [...initialPaths], transfers: transfers.length, transferBytes: transfers.reduce((sum, transfer) => sum + transfer.bytes, 0), warmSamples: warm.length, p50ActivationMs: percentile(0.5), p95ActivationMs: percentile(0.95), artifacts: directory }, null, 2));
    fs.writeFileSync(path.join(directory, "telemetry.json"), JSON.stringify({ telemetry, transfers }, null, 2));
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
