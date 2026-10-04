"use strict";
// Real local video previews; all upload and processing requests are intercepted.
const { chromium, webkit, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, "..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxxly-upload-"));
  const videoFile = path.join(directory, "Morning conversations.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=270x480:rate=12", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoFile]);
  const media = fs.readFileSync(videoFile);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
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
    const isWebkit = process.env.BROWSER_ENGINE === "webkit";
    browser = await (isWebkit ? webkit : chromium).launch({ headless: true });
    const page = await browser.newPage(isWebkit ? devices["iPhone 13"] : { viewport: { width: 390, height: 844 }, hasTouch: true });
    const origin = process.env.TEST_BASE_URL || `http://127.0.0.1:${server.address().port}`;
    const errors = [], uploads = [], processing = [];
    let failNames = new Set(), denied = false, processingFailure = false, waitUpload = null, nextId = 10;
    const polls = new Map();
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://dev-backend-withered-thunder-4589.fly.dev/**", async route => {
      const req = route.request(), url = new URL(req.url());
      let status = 200, body = [];
      if (url.pathname === "/auth/me") body = { id: 1, username: "dave", emailConfirmed: true };
      else if (url.pathname === "/iosclips" && req.method() === "POST") {
        const payload = req.postDataBuffer().toString("utf8");
        const field = name => { const match = payload.match(new RegExp('name="' + name + '"\\r\\n\\r\\n([^\\r]*)')); return match && match[1]; };
        const upload = { title: field("name"), host: field("host"), guests: field("guestCsv"), userId: field("iosUserId"), contentType: req.headers()["content-type"] };
        uploads.push(upload);
        if (waitUpload) await waitUpload;
        if (denied) { status = 403; body = { message: "Forbidden" }; }
        else if (failNames.has(upload.title)) { status = 500; body = { message: "Upload failed. Try again." }; }
        else body = { id: nextId++ };
      } else if (url.pathname === "/processing/status") {
        const id = url.searchParams.get("clipId");
        const count = (polls.get(id) || 0) + 1;
        polls.set(id, count); processing.push(id);
        body = { status: processingFailure ? "FAILED" : count === 1 ? "TRANSCRIBING" : "COMPLETED" };
      } else if (url.pathname === "/app/config") body = {};
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(() => {
      localStorage.setItem("voxxly_web_access_token", "fixture-token");
      window.revokedPreviews = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = url => { window.revokedPreviews.push(url); revoke(url); };
    });
    const screenshot = async name => {
      if (process.env.REPORT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REPORT_SCREENSHOT_DIR, `upload-${isWebkit ? "webkit" : "chromium"}-${name}.png`), fullPage: true });
    };
    const checkLayout = async () => {
      const result = await page.locator(".upload-page").evaluate(el => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        gradients: [...el.querySelectorAll("*"), el].filter(node => getComputedStyle(node).backgroundImage.includes("gradient")).map(node => node.className),
        panels: el.querySelectorAll(".panel").length
      }));
      assert.deepEqual(result, { overflow: false, gradients: [], panels: 0 });
    };
    const select = async files => { await page.locator("#clipFiles").setInputFiles(files); await page.locator("[data-upload-title]").first().waitFor(); };
    const clear = async () => {
      const button = page.locator("#clearUploadQueue");
      if (await button.count()) await button.click();
      else await page.locator("[data-remove-upload]").click();
      await page.getByRole("button", { name: "Choose videos", exact: true }).waitFor();
    };
    await page.goto(origin + "/#/upload");
    await page.getByRole("button", { name: "Choose videos", exact: true }).waitFor();
    assert.equal(await page.locator("#uploadHost").count(), 0);
    assert.equal(await page.locator("#uploadSubmit").count(), 0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 }); await checkLayout(); await screenshot(`start-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // Actual picker path and real local media preview.
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose videos", exact: true }).click();
    await (await chooser).setFiles(videoFile);
    await page.waitForFunction(() => document.querySelector(".upload-preview video")?.readyState >= 1);
    await page.waitForFunction(() => document.querySelector(".upload-preview video")?.poster.startsWith("data:image/jpeg"));
    assert.equal(await page.locator("[data-upload-title]").inputValue(), "Morning conversations");
    assert.equal(await page.locator(".upload-details").getAttribute("open"), null);
    assert.equal(await page.locator(".progress-wrap").count(), 0);
    await page.locator("[data-preview-upload]").click();
    await page.waitForFunction(() => !document.querySelector(".upload-preview video").paused);
    await page.locator("[data-preview-upload]").click();
    await page.waitForFunction(() => document.querySelector(".upload-preview video").paused);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 }); await checkLayout(); await screenshot(`details-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("[data-upload-title]").fill("A better morning");
    const additionalChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add videos", exact: true }).focus();
    await page.keyboard.press("Enter");
    await (await additionalChooser).setFiles({ name: "Another video.mp4", mimeType: "video/mp4", buffer: media });
    assert.equal(await page.locator("[data-upload-title]").first().inputValue(), "A better morning");
    await page.getByRole("button", { name: "Remove Another video.mp4", exact: true }).click();
    assert.equal(await page.locator(".upload-item").count(), 1);
    await page.locator(".upload-details summary").click();
    await page.locator("#uploadHost").fill("Dave");
    await page.locator("#uploadGuests").fill(" Alex, , Sam ");
    await screenshot("optional-details");
    // Drafts and files survive leaving the page.
    await page.goto(origin + "/#/profile");
    await page.goto(origin + "/#/upload");
    assert.equal(await page.locator("[data-upload-title]").inputValue(), "A better morning");
    assert.equal(await page.locator("#uploadGuests").inputValue(), " Alex, , Sam ");
    // Whitespace-only titles cannot submit.
    await page.locator("[data-upload-title]").fill("   ");
    await page.locator("#uploadSubmit").click();
    await page.locator("#uploadSummary").waitFor();
    assert.equal(uploads.length, 0);
    await page.locator("[data-upload-title]").fill("A better morning");
    let release;
    waitUpload = new Promise(resolve => { release = resolve; });
    await page.locator("#uploadSubmit").click();
    await page.getByRole("heading", { name: "Uploading", exact: true }).waitFor();
    assert.equal(await page.locator("[data-remove-upload]").count(), 0);
    assert.equal(await page.locator("#clipFiles").isDisabled(), true);
    assert.equal(await page.locator("#uploadHost").count(), 0);
    await page.locator("#uploadForm").dispatchEvent("submit");
    await screenshot("uploading");
    waitUpload = null; release();
    await page.getByRole("heading", { name: "Uploaded", exact: true }).waitFor();
    assert.equal(uploads.length, 1);
    assert.deepEqual({ ...uploads[0], contentType: undefined }, { title: "A better morning", host: "Dave", guests: "Alex,Sam", userId: "1", contentType: undefined });
    assert.match(uploads[0].contentType, /^multipart\/form-data; boundary=/);
    await page.getByText("Your soundbite is ready.", { exact: true }).waitFor();
    await checkLayout(); await screenshot("complete");
    assert.equal(await page.getByRole("link", { name: "View profile", exact: true }).getAttribute("href"), "#/profile?userId=1");
    await clear();
    assert.ok((await page.evaluate(() => window.revokedPreviews)).length >= 1);
    // Empty/invalid selections don't expose a broken details screen.
    await page.locator("#clipFiles").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
    await page.getByText("Choose up to 10 videos, each under 100 MB.", { exact: true }).waitFor();
    assert.equal(await page.locator(".upload-item").count(), 0);
    // Duplicates and size checks without allocating a 101 MB fixture.
    await page.evaluate(() => {
      const duplicate = new File(["video"], "same.mp4", { type: "video/mp4", lastModified: 123 });
      const large = new File(["video"], "large.mp4", { type: "video/mp4" });
      Object.defineProperty(large, "size", { value: 101 * 1024 * 1024 });
      const data = new DataTransfer(); data.items.add(duplicate); data.items.add(duplicate); data.items.add(large);
      document.querySelector("#uploadDropzone").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
    });
    assert.equal(await page.locator(".upload-item").count(), 1);
    await page.getByText("Choose up to 10 videos, each under 100 MB.", { exact: true }).waitFor();
    await clear();
    // Batch retry must only resend the failed file, never the successful one.
    failNames.add("Second video");
    await select([{ name: "First video.mp4", mimeType: "video/mp4", buffer: media }, { name: "Second video.mp4", mimeType: "video/mp4", buffer: media }]);
    await checkLayout(); await screenshot("batch");
    await page.locator("#uploadSubmit").click();
    await page.getByRole("button", { name: "Retry upload", exact: true }).waitFor();
    assert.equal(await page.locator("[data-upload-title]").count(), 1);
    assert.equal(uploads.filter(item => item.title === "First video").length, 1);
    await screenshot("retry");
    failNames.clear();
    await page.locator("#uploadSubmit").click();
    await page.getByRole("heading", { name: "Uploaded", exact: true }).waitFor();
    assert.equal(uploads.filter(item => item.title === "First video").length, 1);
    assert.equal(uploads.filter(item => item.title === "Second video").length, 2);
    await clear();
    // Permission failure stops the remaining batch and keeps files editable.
    denied = true;
    const beforeDenied = uploads.length;
    await select([{ name: "Denied one.mp4", mimeType: "video/mp4", buffer: media }, { name: "Denied two.mp4", mimeType: "video/mp4", buffer: media }]);
    await page.locator("#uploadSubmit").click();
    await page.getByText("Forbidden", { exact: true }).first().waitFor();
    assert.equal(uploads.length, beforeDenied + 1);
    assert.equal(await page.getByText("Not uploaded", { exact: true }).count(), 1);
    assert.equal(await page.locator("[data-upload-title]").count(), 2);
    await screenshot("permission");
    await clear(); denied = false;
    // Processing failure is distinct from an upload failure and cannot resend media.
    processingFailure = true;
    await select(videoFile);
    await page.locator("#uploadSubmit").click();
    await page.getByRole("heading", { name: "Uploaded", exact: true }).waitFor();
    await page.getByText("Uploaded. Some videos still need processing.", { exact: true }).waitFor();
    assert.equal(await page.locator("#uploadSubmit").count(), 0);
    await screenshot("processing-issue");
    await clear();
    // Clearing a session releases retained preview URLs.
    await select(videoFile);
    const revoked = await page.evaluate(() => window.revokedPreviews.length);
    await page.locator("#logoutButton").click();
    await page.locator("#loginTitle").waitFor();
    assert.ok(await page.evaluate(count => window.revokedPreviews.length > count, revoked));
    assert.deepEqual(errors, []);
    console.log("Upload checks passed: responsive flat screens, real picker/preview, details and draft retention, file validation, multipart fields, progress, duplicate-submit guard, batch retry, permission/processing errors, completion, and preview cleanup.");
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
