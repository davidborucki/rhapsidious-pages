"use strict";
// NODE_PATH=<Playwright runtime> node tests/profile-header.browser.cjs
// All backend writes use isolated fixtures, including against TEST_BASE_URL.
const { chromium, webkit, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
(async () => {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const isWebkit = process.env.BROWSER_ENGINE === "webkit";
    browser = await (isWebkit ? webkit : chromium).launch({ headless: true });
    const context = await browser.newContext(isWebkit ? devices["iPhone 13"] : { viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const origin = process.env.TEST_BASE_URL || `http://127.0.0.1:${server.address().port}`;
    if (!isWebkit) await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await page.addInitScript(({ isWebkit }) => {
      localStorage.setItem("voxxly_web_access_token", "fixture-token");
      // WebKit's automation driver cannot grant clipboard permission.
      if (isWebkit) Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.copiedText = text; } } });
    }, { isWebkit });
    const failures = [], requests = [];
    page.on("pageerror", error => failures.push(error.message));
    let following = false, blocked = false, reportStatus = 201, failFollow = false, showCollections = false;
    const user = id => ({ id, username: id === 1 ? "dave" : "itskaitlyngilbride", profilePhotoUrl: origin + "/assets/voxxly-logo-192.png" });
    await page.route("https://dev-backend-withered-thunder-4589.fly.dev/**", async route => {
      const req = route.request(), url = new URL(req.url());
      const bodyIn = req.postData() ? JSON.parse(req.postData()) : null;
      requests.push({ path: url.pathname, method: req.method(), body: bodyIn });
      let body = [], status = 200;
      if (showCollections && /\/(reposted-clips|saved-clips)$/.test(url.pathname)) body = [{ id: 30, iosUserId: 2, name: "A test video", creator: user(2) }];
      else if (url.pathname === "/auth/me") body = user(1);
      else if (/^\/ios\/users\/[12]$/.test(url.pathname)) body = user(Number(url.pathname.split("/").pop()));
      else if (url.pathname.endsWith("/follow-counts")) body = { followerCount: 5300, followingCount: 241 };
      else if (url.pathname.includes("/follows/")) body = { following };
      else if (url.pathname === "/ios/follows") {
        if (failFollow) status = 500;
        else { following = req.method() === "POST"; body = { following }; }
      }
      else if (url.pathname === "/me/blocked-users") body = blocked ? [user(2)] : [];
      else if (url.pathname === "/users/2/block") { blocked = req.method() === "POST"; body = { blocked }; }
      else if (url.pathname === "/users/2/reports") { status = reportStatus; body = { status: "ok", reportId: 1 }; }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const visit = async id => {
      await page.goto(origin + `/#/profile?userId=${id}`);
      await page.locator(".profile-stats strong").filter({ hasText: "241" }).waitFor();
    };
    for (const id of [1, 2]) {
      await visit(id);
      assert.deepEqual(await page.locator(".profile-stat span").allTextContents(), ["Posts", "Followers", "Following"]);
      assert.equal((await page.locator(".empty-state").textContent()).trim(), "No posts yet");
      await page.getByRole("link", { name: "Reposts 0", exact: true }).click();
      await page.getByRole("heading", { name: "No reposts yet", exact: true }).waitFor();
      assert.equal((await page.locator(".empty-state").textContent()).trim(), "No reposts yet");
      await page.getByRole("link", { name: "Posts 0", exact: true }).click();
      assert.deepEqual(await page.locator(".profile-actions > *").allTextContents(), id === 1 ? ["Edit profile", "Settings"] : ["Follow", "Share", ""]);
      assert.equal(await page.locator("#reportProfile").count(), id === 1 ? 0 : 1);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const geometry = await page.evaluate(() => {
          const hero = document.querySelector(".profile-hero"), avatar = hero.querySelector(".profile-avatar");
          const name = hero.querySelector(".profile-identity");
          const a = avatar.getBoundingClientRect(), n = name.getBoundingClientRect();
          const buttons = [...hero.querySelectorAll(".profile-actions > *")];
          const boxes = buttons.map(button => button.getBoundingClientRect());
          const report = hero.querySelector("#reportProfile");
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            avatarLeft: a.right <= n.left && Math.abs(a.y + a.height / 2 - n.y - n.height / 2) < 2 || (innerWidth > 760 && a.right <= n.left),
            gradient: getComputedStyle(hero).backgroundImage,
            avatarBorder: getComputedStyle(avatar).borderWidth,
            avatarShadow: getComputedStyle(avatar).boxShadow,
            equalButtons: Math.abs(boxes[0].width - boxes[1].width) < 1 && Math.abs(boxes[0].y - boxes[1].y) < 1,
            iconFirst: buttons.filter(button => button !== report).every(button => button.firstElementChild.tagName.toLowerCase() === "svg" && button.querySelector("svg").getBoundingClientRect().right <= button.querySelector("span").getBoundingClientRect().left),
            reportOnRight: !report || (() => {
              const box = report.getBoundingClientRect();
              return box.left > boxes[1].right && Math.abs(box.y + box.height / 2 - boxes[1].y - boxes[1].height / 2) < 1
                && box.width === box.height && getComputedStyle(report).borderRadius === "50%" && report.textContent === "";
            })()
          };
        });
        assert.deepEqual(geometry, { overflow: false, avatarLeft: true, gradient: "none", avatarBorder: "0px", avatarShadow: "none", equalButtons: true, iconFirst: true, reportOnRight: true });
        if (process.env.REPORT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REPORT_SCREENSHOT_DIR, `header-${id}-${isWebkit ? "webkit" : "chromium"}-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      if (id === 1) {
        await page.getByRole("button", { name: "Edit profile", exact: true }).click();
        await page.locator("#profileEditor").waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("link", { name: "Settings", exact: true }).click();
        await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
      }
    }
    const follow = page.locator("#followProfile");
    await follow.click();
    await page.getByRole("button", { name: "Following", exact: true }).waitFor();
    assert.equal(await follow.getAttribute("aria-pressed"), "true");
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(await follow.evaluate(button => button.scrollWidth <= button.clientWidth), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(requests.some(r => r.path === "/ios/follows" && r.method === "POST" && r.body.followedUserId === 2));
    failFollow = true;
    await follow.click();
    await page.waitForFunction(() => !document.querySelector("#followProfile").disabled);
    assert.equal(await follow.getAttribute("aria-pressed"), "true");
    failFollow = false;
    await follow.click();
    await page.getByRole("button", { name: "Follow", exact: true }).waitFor();
    assert.equal(await follow.getAttribute("aria-pressed"), "false");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByText("Copied to clipboard", { exact: true }).waitFor();
    const copied = await page.evaluate(isWebkit => isWebkit ? window.copiedText : navigator.clipboard.readText(), isWebkit);
    assert.equal(copied, origin + "/#/profile?userId=2");
    await page.getByText("Copied to clipboard", { exact: true }).waitFor({ state: "detached", timeout: 5000 });
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("denied"); }; });
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByText("Couldn’t copy link. Try again.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Copied to clipboard", { exact: true }).count(), 0);
    const report = page.getByRole("button", { name: "Report account", exact: true });
    await report.click();
    assert.equal(await page.evaluate(() => document.activeElement.id), "videoReportTitle");
    assert.equal(await page.locator("#reportReason").inputValue(), "");
    assert.equal(await page.getByRole("button", { name: "Submit", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.ok(!requests.some(r => r.path.endsWith("/reports")));
    assert.equal(await report.evaluate(button => button.matches(":focus-visible")), false);
    for (const status of [500, 429, 201, 409]) {
      reportStatus = status;
      if (!await page.locator("#videoReport").count()) await report.click();
      await page.locator("#reportReason").selectOption("IMPERSONATION");
      await page.locator("#reportDetails").fill("Test report details");
      await page.getByRole("button", { name: "Submit", exact: true }).click();
      if (status >= 429) {
        await page.locator("[data-report-error]:visible").waitFor();
        await page.waitForFunction(() => !document.querySelector('#videoReport [type="submit"]').disabled);
      } else {
        await page.locator("#videoReport").waitFor({ state: "detached" });
        await page.getByText(status === 409 ? "Already reported" : "Report sent", { exact: true }).waitFor();
      }
    }
    assert.ok(requests.filter(r => r.path.endsWith("/reports")).every(r => r.path === "/users/2/reports" && r.body.reason === "IMPERSONATION" && r.body.details === "Test report details"));
    await report.click();
    await page.getByRole("button", { name: "Block account", exact: true }).click();
    await page.getByText("User blocked", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Unblock", exact: true }).click();
    await page.getByRole("button", { name: "Follow", exact: true }).waitFor();
    showCollections = true;
    for (const route of ["/#/profile?userId=1&tab=reposts", "/#/saved"]) {
      await page.goto(origin + route);
      await page.getByRole("heading", { name: "A test video", exact: true }).waitFor();
      assert.equal(await page.locator(".clip-creator-link").count(), 0);
      assert.deepEqual(await page.locator(".profile-clip-copy").allTextContents().then(items => items.map(text => text.trim())), ["A test video"]);
    }
    assert.deepEqual(failures, []);
    console.log("Profile header checks passed: responsive avatar-first layout, stats order, minimal empty states, title-only saved/reposted cards, flat colors, own/other actions, follow/unfollow and rollback, clipboard and temporary toast, account reports/cancel/retry, block/unblock.");
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
