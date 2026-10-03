"use strict";
// NODE_PATH=<Playwright runtime> node tests/profile-interactions.browser.cjs
// Serves this checkout locally; all backend calls are intercepted.
const { chromium, webkit, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
(async () => {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, "." + (new URL(req.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream");
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await (process.env.BROWSER_ENGINE === "webkit" ? webkit : chromium).launch({ headless: true, executablePath: process.env.REPORT_BROWSER_PATH || undefined });
    const page = await browser.newPage(process.env.BROWSER_ENGINE === "webkit" ? { ...devices["iPhone 13"] } : { viewport: { width: 390, height: 844 }, hasTouch: true });
    const touchSession = process.env.BROWSER_ENGINE === "webkit" ? null : await page.context().newCDPSession(page);
    // Check painted geometry and hit testing, not just the final resting layout.
    await page.addInitScript(() => {
      window.startViewerControlAudit = () => {
        const overlay = document.querySelector(".clip-viewer-backdrop");
        const close = overlay.querySelector("[data-clip-viewer-close]");
        const frame = overlay.querySelector(".clip-viewer-dialog");
        const volume = overlay.querySelector("[data-feed-volume-control]");
        const mute = overlay.querySelector("[data-feed-mute-toggle]");
        const errors = [];
        let samples = 0, raf;
        const sample = () => {
          samples++;
          const c = close.getBoundingClientRect(), f = frame.getBoundingClientRect();
          const v = volume.getBoundingClientRect(), m = mute.getBoundingClientRect();
          const style = getComputedStyle(close);
          const problem = [];
          if (!close.isConnected || overlay.querySelector("[data-clip-viewer-close]") !== close) problem.push("close replaced or detached");
          if (close.parentElement !== frame || volume.parentElement !== frame) problem.push("controls must share the video frame");
          if (Math.abs(c.y + c.height / 2 - m.y - m.height / 2) > 1) problem.push("vertical alignment");
          if (Math.abs(v.left - f.left - (f.right - c.right)) > 1) problem.push("unequal side insets");
          if (Math.abs(c.height - v.height) > 1) problem.push("unequal button sizes");
          if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0) problem.push("close hidden");
          const x = c.x + c.width / 2, y = c.y + c.height / 2;
          // During a drag, both controls can travel beyond the viewport together.
          if (x > 0 && x < innerWidth && y > 0 && y < innerHeight && !close.contains(document.elementFromPoint(x, y))) problem.push("close occluded");
          if (problem.length && errors.length < 5) errors.push({ problem, close: c.toJSON(), frame: f.toJSON(), mute: m.toJSON() });
        };
        const tick = () => { sample(); raf = requestAnimationFrame(tick); };
        const events = ["pointermove", "pointerup", "pointercancel"];
        events.forEach(type => overlay.addEventListener(type, sample));
        tick();
        window.finishViewerControlAudit = () => {
          cancelAnimationFrame(raf);
          events.forEach(type => overlay.removeEventListener(type, sample));
          sample();
          return { samples, errors };
        };
      };
    });
    async function startControlAudit() {
      await page.evaluate(() => window.startViewerControlAudit());
    }
    async function finishControlAudit() {
      const result = await page.evaluate(() => window.finishViewerControlAudit());
      assert.ok(result.samples > 1);
      assert.deepEqual(result.errors, [], JSON.stringify(result));
    }
    async function swipe(target, dx, dy, cancel = false) {
      await startControlAudit();
      const box = await target.boundingBox();
      const x = box.x + box.width * 0.35;
      const y = box.y + box.height * 0.5;
      if (touchSession) {
        await touchSession.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let i = 1; i <= 6; i++) {
          await touchSession.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * i / 6, y: y + dy * i / 6 }] });
        }
        await touchSession.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
      } else {
        // WebKit's driver exposes taps only; exercise pointer dispatch separately.
        await target.evaluate((el, args) => {
          const stage = el.closest(".clip-viewer-stage");
          const capture = stage && stage.setPointerCapture;
          if (stage) stage.setPointerCapture = () => {};
          const options = { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 123, isPrimary: true };
          el.dispatchEvent(new PointerEvent("pointerdown", { ...options, clientX: args.x, clientY: args.y }));
          el.dispatchEvent(new PointerEvent("pointermove", { ...options, clientX: args.x + args.dx, clientY: args.y + args.dy }));
          el.dispatchEvent(new PointerEvent(args.cancel ? "pointercancel" : "pointerup", { ...options, clientX: args.x + args.dx, clientY: args.y + args.dy }));
          if (stage) stage.setPointerCapture = capture;
        }, { x, y, dx, dy, cancel });
      }
      await page.waitForTimeout(260);
      await finishControlAudit();
    }
    const failures = [];
    page.on("pageerror", error => failures.push(error.message));
    const requests = [];
    let failSave = false;
    const clipsFor = userId => [0, 1].map(i => ({ id: userId * 10 + i, iosUserId: userId, name: `Video ${userId * 10 + i}`, fullEpisodeFilepath: `https://example.test/episode/${userId * 10 + i}`, creator: { id: userId, username: `creator${userId}` } }));
    const waitForRequest = async predicate => {
      for (let i = 0; i < 100; i++) {
        if (requests.some(predicate)) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.fail("Expected backend request");
    };
    await page.route("https://dev-backend-withered-thunder-4589.fly.dev/**", async route => {
      const req = route.request(); const url = new URL(req.url());
      const bodyIn = req.postData() ? JSON.parse(req.postData()) : null;
      requests.push({ path: url.pathname, method: req.method(), body: bodyIn });
      let body = [], status = 200;
      if (url.pathname === "/auth/me") body = { id: 1, username: "creator1" };
      else if (/^\/ios\/users\/[12]$/.test(url.pathname)) { const id = Number(url.pathname.split("/").pop()); body = { id, username: `creator${id}` }; }
      else if (/^\/ios\/users\/[12]\/clips$/.test(url.pathname)) body = clipsFor(Number(url.pathname.split("/")[3]));
      else if (url.pathname === "/iosclips/feed") body = clipsFor(2);
      else if (url.pathname.endsWith("/follow-counts")) body = { followerCount: 0, followingCount: 0 };
      else if (url.pathname.includes("/follows/")) body = { following: false };
      else if (url.pathname.endsWith("/stream")) { await route.abort(); return; }
      else if (url.pathname === "/ios/saved-clips" && failSave) { status = 500; body = {}; failSave = false; }
      else if (url.pathname.endsWith("/reports")) { status = 201; body = { status: "ok", reportId: 1 }; }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(() => localStorage.setItem("voxxly_web_access_token", "fixture-token"));
    const origin = process.env.TEST_BASE_URL || `http://127.0.0.1:${server.address().port}`;
    for (const userId of [1, 2]) {
      const clipId = userId * 10;
      await page.goto(origin + `/#/profile?userId=${userId}`);
      await page.locator(`[data-view-clip="${clipId}"]`).click();
      const viewer = page.locator(".clip-viewer-backdrop");
      const rail = viewer.locator(".feed-action-rail");
      await rail.waitFor();
      assert.equal(await viewer.locator(".clip-viewer-arrow").count(), 0);
      const save = rail.locator("[data-save-clip]");
      await page.waitForFunction(() => !document.querySelector(".clip-viewer-backdrop [data-save-clip]").disabled);
      for (const [width, height] of [[320, 568], [390, 844], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        await startControlAudit();
        await finishControlAudit();
        const geometry = await rail.evaluate(el => {
          const children = [...el.children];
          const boxes = children.map(c => c.getBoundingClientRect());
          return {
            order: children.map(c => c.hasAttribute("data-full-episode") ? "watch" : c.classList.contains("feed-avatar-link") ? "profile" : c.hasAttribute("data-like-clip") ? "like" : c.hasAttribute("data-save-clip") ? "save" : c.hasAttribute("data-repost-clip") ? "repost" : "report"),
            ordered: boxes.every((b, i) => i === 0 || b.top >= boxes[i - 1].bottom - 1),
            visible: boxes.every(b => b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight),
            reportColor: getComputedStyle(el.lastElementChild).color
          };
        });
        assert.deepEqual(geometry.order, ["watch", "profile", "like", "save", "repost", "report"]);
        assert.ok(geometry.ordered && geometry.visible, JSON.stringify(geometry));
        assert.equal(geometry.reportColor, "rgb(255, 255, 255)");
        if (process.env.REPORT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REPORT_SCREENSHOT_DIR, `profile-${userId}-${process.env.BROWSER_ENGINE || "chromium"}-${width}.png`) });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await rail.locator(".feed-avatar-link").getAttribute("href"), `#/profile?userId=${userId}`);
      await rail.locator("[data-full-episode]").evaluate(a => { a.addEventListener("click", e => e.preventDefault(), { once: true }); a.click(); });
      await waitForRequest(r => r.body && r.body.clipId === clipId && r.body.hasClickedToFullEpisode);
      await rail.locator("[data-like-clip]").click();
      assert.equal(await rail.locator("[data-like-clip]").getAttribute("aria-pressed"), "true");
      await waitForRequest(r => r.body && r.body.clipId === clipId && r.body.hasLiked);
      failSave = true;
      await save.click();
      await page.waitForFunction(() => { const b = document.querySelector(".clip-viewer-backdrop [data-save-clip]"); return !b.disabled && b.getAttribute("aria-pressed") === "false"; });
      await save.click();
      await page.waitForFunction(() => { const b = document.querySelector(".clip-viewer-backdrop [data-save-clip]"); return !b.disabled && b.getAttribute("aria-pressed") === "true"; });
      await waitForRequest(r => r.path === "/ios/saved-clips" && r.method === "POST" && r.body.iosClipId === clipId);
      await rail.locator("[data-repost-clip]").click();
      await page.waitForFunction(() => { const b = document.querySelector(".clip-viewer-backdrop [data-repost-clip]"); return !b.disabled && b.getAttribute("aria-pressed") === "true"; });
      await waitForRequest(r => r.path === "/ios/reposted-clips" && r.body.iosClipId === clipId);
      const report = rail.locator("[data-report-clip]");
      await report.click();
      assert.equal(await page.evaluate(() => document.activeElement.id), "videoReportTitle");
      assert.equal(await page.locator("#reportReason").inputValue(), "");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await report.evaluate(el => el.matches(":focus-visible")), false);
      // Keyboard users retain a visible, white focus indicator.
      await report.focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "videoReportTitle");
      await page.keyboard.press("Escape");
      assert.equal(await report.evaluate(el => document.activeElement === el), true);
      assert.equal(await report.evaluate(el => getComputedStyle(el).outlineColor), "rgb(255, 255, 255)");
      const video = viewer.locator("[data-clip-viewer-video]");
      // One trackpad gesture advances once even with a burst of wheel events.
      await video.evaluate(el => {
        for (let i = 0; i < 6; i++) el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }));
      });
      assert.equal(await report.getAttribute("data-report-clip"), String(clipId + 1));
      await page.waitForTimeout(260);
      await video.evaluate(el => el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 })));
      await page.waitForTimeout(260);
      assert.equal(await report.getAttribute("data-report-clip"), String(clipId));
      // Short, horizontal, cancelled, and control gestures must not change clips.
      await swipe(video, 0, 20);
      await swipe(video, 100, 15);
      await swipe(video, 0, -120, true);
      await swipe(viewer.locator("[data-feed-mute-toggle]"), 0, -100);
      await swipe(video, 0, 120); // already at the first clip
      assert.equal(await report.getAttribute("data-report-clip"), String(clipId));
      await swipe(video, 0, -120);
      assert.equal(await report.getAttribute("data-report-clip"), String(clipId + 1));
      assert.equal(await save.getAttribute("data-save-clip"), String(clipId + 1));
      assert.equal(await save.getAttribute("aria-pressed"), "false");
      await swipe(video, 0, -120); // already at the last clip
      assert.equal(await report.getAttribute("data-report-clip"), String(clipId + 1));
      await report.click();
      await page.locator("#reportReason").selectOption("OTHER");
      await page.getByRole("button", { name: "Submit", exact: true }).click();
      await page.locator("#videoReport").waitFor({ state: "detached" });
      await waitForRequest(r => r.path === `/clips/${clipId + 1}/reports`);
      await swipe(video, 0, 120);
      assert.equal(await rail.locator("[data-like-clip]").getAttribute("aria-pressed"), "true");
      assert.equal(await save.getAttribute("aria-pressed"), "true");
      // Seek every part of both animations, including mobile toolbar-sized
      // viewport changes and navigation interrupted by a reverse direction change.
      await startControlAudit();
      for (const key of ["ArrowDown", "ArrowUp", "ArrowDown"]) {
        await page.evaluate(key => {
          document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
          document.querySelector(".clip-viewer-stage").getAnimations().forEach(animation => animation.pause());
        }, key);
        for (const time of [0, 16, 55, 110, 180, 219]) {
          await page.evaluate(time => {
            document.querySelector(".clip-viewer-stage").getAnimations().forEach(animation => { animation.currentTime = time; });
          }, time);
          await page.setViewportSize({ width: 390, height: time % 2 ? 760 : 844 });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
      }
      await finishControlAudit();
      if (process.env.REPORT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REPORT_SCREENSHOT_DIR, `profile-${userId}-${process.env.BROWSER_ENGINE || "chromium"}-after-transition.png`) });
      // A real tap on X must close even while the incoming frame is animated.
      await page.evaluate(() => {
        document.querySelector(".clip-viewer-stage").getAnimations().forEach(animation => { animation.currentTime = 55; });
      });
      const closeBox = await viewer.locator("[data-clip-viewer-close]").boundingBox();
      await page.touchscreen.tap(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
      await viewer.waitFor({ state: "detached" });
      // Reduced motion takes the same path without an animation.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator(`[data-view-clip="${clipId}"]`).click();
      await swipe(viewer.locator("[data-clip-viewer-video]"), 0, -120);
      assert.equal(await viewer.locator("[data-report-clip]").getAttribute("data-report-clip"), String(clipId + 1));
      await viewer.locator("[data-clip-viewer-close]").click();
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    // The feed uses the exact same rendered stack and report focus behavior.
    await page.goto(origin + "/#/feed");
    const report = page.locator(".soundbite-card.is-active [data-report-clip]");
    await report.click();
    assert.equal(await page.evaluate(() => document.activeElement.id), "videoReportTitle");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await report.evaluate(el => el.matches(":focus-visible")), false);
    assert.deepEqual(failures, []);
    console.log("Profile interaction checks passed: own/other profiles, exact stack order, responsive layout, equal close/mute insets and continuous visibility through drag/animation/viewport changes, mid-transition close, reduced motion, vertical swipes and boundaries, Watch/Like/Save/Repost/Report, failed-save rollback, navigation state, report focus and pointer/keyboard dismissal.");
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
