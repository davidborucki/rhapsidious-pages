"use strict";
// NODE_PATH=<Playwright runtime> node tests/video-report.browser.cjs
// Serves this checkout locally; all backend calls are intercepted.
const { chromium } = require("playwright");
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
    browser = await chromium.launch({ headless: true, executablePath: process.env.REPORT_BROWSER_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const requests = [];
    let responseStatus = 201;
    let release = null;
    let delayNext = false;
    const clips = [42, 43].map(id => ({ id, iosUserId: 2, name: `Video ${id}`, creator: { id: 2, username: "creator" } }));
    await page.route("https://dev-backend-withered-thunder-4589.fly.dev/**", async route => {
      const req = route.request();
      const url = new URL(req.url());
      let body = [];
      let status = 200;
      if (url.pathname === "/auth/me") body = { id: 1, username: "viewer" };
      else if (/^\/ios\/users\/[12]$/.test(url.pathname)) body = { id: Number(url.pathname.split("/").pop()), username: "creator" };
      else if (url.pathname === "/iosclips/feed") body = clips;
      else if (/saved-clips|reposted-clips|\/clips$/.test(url.pathname)) body = clips;
      else if (/\/reports$/.test(url.pathname)) {
        requests.push({ path: url.pathname, body: JSON.parse(req.postData()), authorization: req.headers().authorization });
        status = responseStatus;
        if (delayNext) { delayNext = false; await new Promise(resolve => { release = resolve; }); }
        body = status === 201 ? { status: "ok", reportId: 1, clipId: Number(url.pathname.split("/")[2]) } : {};
      } else if (/\/stream$/.test(url.pathname)) { await route.abort(); return; }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(() => localStorage.setItem("voxxly_web_access_token", "fixture-token"));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + "/#/feed");
    const report = page.locator(".soundbite-card.is-active [data-report-clip]");
    await report.click();
    const dialog = page.getByRole("dialog", { name: "Report video", exact: true });
    const submit = dialog.getByRole("button", { name: "Submit", exact: true });
    await dialog.waitFor();
    assert.equal(await submit.isDisabled(), true);
    assert.equal(await dialog.locator("textarea").getAttribute("maxlength"), "2000");
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
      if (process.env.REPORT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REPORT_SCREENSHOT_DIR, `report-${width}.png`) });
    }
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 500);
    assert.equal(await report.getAttribute("data-report-clip"), "42");
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0);
    assert.equal(requests.length, 0);
    assert.equal(await report.evaluate(el => el.matches(":focus-visible")), false);
    await report.click();
    await dialog.locator("select").selectOption("COPYRIGHT");
    await dialog.locator("textarea").fill("  My work  ");
    responseStatus = 500;
    await submit.click();
    await dialog.getByText("Couldn’t send report. Try again.").waitFor();
    assert.equal(await dialog.locator("textarea").inputValue(), "  My work  ");
    assert.equal(await submit.isEnabled(), true);
    responseStatus = 201;
    delayNext = true;
    await submit.click();
    await page.waitForFunction(() => document.querySelector('#videoReport [type="submit"]').disabled);
    await page.waitForTimeout(100);
    assert.equal(requests.length, 2);
    // A second submit event while busy must not send another request.
    await dialog.locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(requests.length, 2);
    release();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.locator("#toastRegion").textContent(), "Report sent");
    assert.deepEqual(requests[1], { path: "/clips/42/reports", body: { reason: "COPYRIGHT", details: "My work" }, authorization: "Bearer fixture-token" });
    // Duplicate, unavailable and throttled responses each have short, specific feedback.
    responseStatus = 409;
    await report.click();
    await dialog.locator("select").selectOption("OTHER");
    await submit.click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.locator("#toastRegion").textContent(), "Already reported");
    for (const [status, message] of [[404, "Video unavailable."], [429, "Too many reports. Try again later."]]) {
      responseStatus = status;
      await report.click();
      await dialog.locator("select").selectOption("OTHER");
      await submit.click();
      await dialog.getByText(message).waitFor();
      await dialog.getByRole("button", { name: "Cancel" }).click();
    }
    // Saved and profile cards use the same viewer. Report the currently selected video.
    await page.goto(origin + "/#/saved");
    await page.locator('[data-view-clip="42"]').click();
    await page.keyboard.press("ArrowDown");
    await page.locator(".clip-viewer-backdrop [data-report-clip]").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".clip-viewer-backdrop").count(), 1);
    await page.locator(".clip-viewer-backdrop [data-report-clip]").click();
    responseStatus = 201;
    await dialog.locator("select").selectOption("INCORRECT_CREATOR_OR_SOURCE");
    await submit.click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(requests.at(-1).path, "/clips/43/reports");
    assert.deepEqual(requests.at(-1).body, { reason: "INCORRECT_CREATOR_OR_SOURCE", details: null });
    // Route changes dismiss the report and stale responses cannot reopen or toast.
    await page.locator(".clip-viewer-backdrop [data-report-clip]").click();
    await dialog.locator("select").selectOption("OTHER");
    delayNext = true;
    release = null;
    await submit.click();
    while (!release) await new Promise(resolve => setTimeout(resolve, 20));
    await page.evaluate(() => { location.hash = "#/profile"; });
    await dialog.waitFor({ state: "detached" });
    release();
    await page.waitForTimeout(100);
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(errors, []);
    console.log("Video report browser checks passed: responsive dialog, keyboard/focus, cancel, validation, retry, duplicate, busy guard, unavailable/rate limit, current viewer video, and route cleanup.");
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
