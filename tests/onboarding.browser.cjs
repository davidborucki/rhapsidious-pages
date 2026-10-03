"use strict";
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
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream"); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser, page;
  try {
    const engine = process.env.BROWSER_ENGINE || "chromium";
    browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
    page = await browser.newPage(engine === "webkit" ? devices["iPhone 13"] : { viewport: { width: 390, height: 844 }, hasTouch: true });
    const origin = process.env.TEST_BASE_URL || `http://127.0.0.1:${server.address().port}`;
    const requests = [], errors = [];
    let loginError = true, signupError = false, mailError = false, invalid = false, resetError = false, holdMail = null;
    page.on("pageerror", e => errors.push(e.message));
    await page.route("https://dev-backend-withered-thunder-4589.fly.dev/**", async route => {
      const req = route.request(), pathname = new URL(req.url()).pathname;
      requests.push({ pathname, body: req.postDataJSON(), headers: req.headers() });
      let status = 200, body = [];
      if (pathname === "/auth/login") { status = loginError ? 401 : 200; body = loginError ? {} : { accessToken: "fixture", refreshToken: "fixture-refresh" }; }
      else if (pathname === "/auth/me") body = { id: 1, username: "listener" };
      else if (pathname === "/ios/users") { status = signupError ? 409 : 200; body = { id: 1 }; }
      else if (pathname === "/auth/password/forgot") { if (holdMail) await holdMail; status = mailError ? 503 : 200; body = { ok: true }; }
      else if (pathname === "/auth/password/validate") { status = invalid ? 400 : 200; body = { ok: true }; }
      else if (pathname === "/auth/password/reset") { status = resetError ? 503 : 200; body = { ok: true }; }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const goto = async hash => { await page.goto(origin + "/" + hash); await page.locator(".auth-content").waitFor(); };
    const screenshot = async name => { if (process.env.REPORT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REPORT_SCREENSHOT_DIR, `entry-${engine}-${name}.png`), fullPage: true }); };
    const layout = async () => {
      const result = await page.locator(".auth-page").evaluate(el => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        gradients: [...el.querySelectorAll("*"), el].filter(n => getComputedStyle(n).backgroundImage.includes("gradient")).map(n => n.className),
        panels: el.querySelectorAll(".panel").length
      }));
      assert.deepEqual(result, { overflow: false, gradients: [], panels: 0 });
    };
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width > 760 ? 900 : 844 });
      await goto("#/login"); await layout(); await screenshot("login-" + width);
      await goto("#/signup"); await layout(); await screenshot("signup-" + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await goto("#/login");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    assert.equal(requests.filter(r => r.pathname === "/auth/login").length, 0);
    await page.getByLabel("Username or email").fill("listener");
    await page.getByLabel("Password", { exact: true }).fill("old-password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    assert.equal(await page.locator("#password").getAttribute("type"), "text");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.getByText("Incorrect username or password.").waitFor();
    await page.getByRole("link", { name: "Create an account", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("listener");
    await page.getByLabel("Email", { exact: true }).fill("listener@example.test");
    await page.getByLabel("Password", { exact: true }).fill("new-password");
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: location.origin + "/#/upload", newURL: location.origin + "/#/login" })));
    assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "new-password");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("heading", { name: "A little about you." }).waitFor();
    await page.getByLabel("Date of birth").fill("2000-01-01");
    await page.getByLabel("Gender", { exact: true }).selectOption("FEMALE");
    await layout(); await screenshot("signup-about");
    await page.getByRole("button", { name: "Back to account details" }).click();
    assert.equal(await page.getByLabel("Username", { exact: true }).inputValue(), "listener");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    assert.equal(await page.getByLabel("Date of birth").inputValue(), "2000-01-01");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    assert.equal(requests.filter(r => r.pathname === "/ios/users").length, 0);
    await page.getByRole("checkbox").check(); signupError = true;
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByText("That username or email is already in use.").waitFor();
    assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "listener@example.test");
    assert.equal(requests.find(r => r.pathname === "/ios/users").body.password, "new-password");
    await goto("#/forgot-password"); await screenshot("forgot");
    mailError = true;
    await page.getByLabel("Email", { exact: true }).fill("listener@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.getByText("Couldn’t send the link. Try again shortly.").waitFor();
    mailError = false;
    let release; holdMail = new Promise(resolve => release = resolve);
    await page.getByRole("button", { name: "Send reset link" }).click();
    assert.equal(await page.getByRole("button", { name: "Sending…" }).isDisabled(), true);
    release(); holdMail = null;
    await page.getByRole("heading", { name: "Check your inbox." }).waitFor(); await screenshot("sent");
    await page.getByRole("link", { name: "Try another email" }).click(); await page.getByLabel("Email", { exact: true }).waitFor();
    const secret = "A".repeat(43);
    await goto("#/reset-password?token=" + secret);
    await page.getByLabel("New password", { exact: true }).waitFor();
    await page.reload(); await page.getByLabel("New password", { exact: true }).waitFor();
    await layout(); await screenshot("reset");
    await page.getByLabel("New password", { exact: true }).fill("new-password");
    await page.getByLabel("Confirm password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Save password" }).click();
    await page.getByText("Passwords don’t match.").waitFor();
    assert.equal(requests.filter(r => r.pathname === "/auth/password/reset").length, 0);
    await page.getByLabel("Confirm password", { exact: true }).fill("new-password"); resetError = true;
    await page.getByRole("button", { name: "Save password" }).click();
    await page.getByText("Couldn’t save your password. Try again.").waitFor(); resetError = false;
    await page.getByRole("button", { name: "Save password" }).click();
    await page.getByRole("heading", { name: "You’re all set." }).waitFor(); await screenshot("complete");
    assert(!page.url().includes(secret));
    assert.equal(await page.evaluate(() => Object.values(localStorage).some(v => v.includes("A".repeat(43)))), false);
    invalid = true; await goto("#/reset-password?token=" + secret);
    await page.getByRole("heading", { name: "Let’s try a new link." }).waitFor(); await screenshot("expired");
    await goto("#/reset-password"); await page.getByRole("link", { name: "Get a reset link" }).waitFor();
    // A late email response must not overwrite a different page.
    await goto("#/forgot-password");
    holdMail = new Promise(resolve => release = resolve);
    await page.getByLabel("Email", { exact: true }).fill("listener@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.getByRole("link", { name: "← Log in" }).click(); release(); holdMail = null;
    await page.getByRole("heading", { name: "Your next good listen." }).waitFor();
    assert.equal(requests.filter(r => r.pathname.startsWith("/auth/password/")).some(r => r.headers.authorization), false);
    // Complete signup and preserve the destination that prompted sign-in.
    signupError = false; loginError = false;
    await page.goto(origin + "/#/upload");
    await page.getByRole("link", { name: "Create an account", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("newlistener");
    await page.getByLabel("Email", { exact: true }).fill("newlistener@example.test");
    await page.getByLabel("Password", { exact: true }).fill("new-password");
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: location.origin + "/#/upload", newURL: location.origin + "/#/login" })));
    assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "new-password");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Date of birth").fill("2020-01-01");
    await page.getByLabel("Gender", { exact: true }).selectOption("MALE");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByText("You must be at least 13 to create an account.").waitFor();
    await page.getByLabel("Date of birth").fill("2000-01-01");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByRole("button", { name: "Choose videos", exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, "#/upload");
    const created = requests.filter(r => r.pathname === "/ios/users").at(-1).body;
    assert.equal(created.username, "newlistener"); assert.equal(created.gender, "MALE");
    assert.equal(created.termsVersion, "2026-10-02");
    assert.deepEqual(errors, []);
    console.log("Entry checks passed: responsive flat layouts, login validation, password visibility, two-step signup and retained fields, email request/retry, reset/reload/expiry/success, and navigation races.");
  } catch (error) {
    if (page) {
      console.error("Failure page:", await page.locator("#app").innerText());
      if (process.env.REPORT_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.REPORT_SCREENSHOT_DIR,"entry-failure.png"),fullPage:true});
    }
    throw error;
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
