// Run with Playwright available and the static site served on localhost:8765.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SETTINGS_BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage();
    const requests = [];
    let failUnblock = true;
    let failSupport = true;
    let failDeletion = true;
    let releaseDeletion;
    await page.route("https://dev-backend-withered-thunder-4589.fly.dev/**", async route => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      requests.push({ path, method: req.method(), data: req.postData() });
      let body = {};
      let status = 200;
      if (path === "/auth/me") body = { id: 1, username: "dave", email: "dave@example.com" };
      if (path === "/me/blocked-users") body = [{ id: 2, username: "blocked_person" }];
      if (path === "/users/2/block" && failUnblock) status = 500;
      if (path === "/support/tickets" && failSupport) status = 500;
      if (path === "/me/account") {
        if (failDeletion) status = 500;
        else {
          await new Promise(resolve => { releaseDeletion = resolve; });
          body = { status: "ok", accountDeleted: true };
        }
      }
      if (path === "/app/config") body = { privacyPolicyUrl: "https://example.com/privacy", termsOfServiceUrl: "https://example.com/terms" };
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(() => localStorage.setItem("voxxly_web_access_token", "test-token"));
    await page.goto("http://127.0.0.1:8765/#/settings");
    await page.getByRole("heading", { name: "Manage account", exact: true }).waitFor();
    assert.equal(await page.locator("#primaryNav").isVisible(), false);
    assert.equal(await page.locator(".site-header").isVisible(), true);
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("heading", { name: "Delete account?", exact: true }).waitFor();
    assert.ok(!requests.some(req => req.path === "/me/account"));
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.ok(!requests.some(req => req.path === "/me/account"));
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const menu = document.querySelector(".settings-menu").getBoundingClientRect();
        const panel = document.querySelector(".settings-detail").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth, beside: panel.left > menu.right, menu: menu.width, panel: panel.width };
      });
      assert.equal(layout.overflow, false);
      assert.equal(layout.beside, width > 700);
      if (width > 700) assert.ok(layout.panel > layout.menu);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: require("node:path").join(process.env.SETTINGS_SCREENSHOT_DIR, "voxxly-settings-" + width + ".png"), fullPage: true });
    }
    await page.getByRole("button", { name: "Blocked users", exact: true }).click();
    await page.getByRole("button", { name: "Unblock blocked_person" }).click();
    await page.getByText("Couldn’t unblock this user. Please try again.").waitFor();
    assert.equal(await page.locator("[data-unblock]").count(), 1);
    failUnblock = false;
    await page.getByRole("button", { name: "Unblock blocked_person" }).click();
    await page.getByRole("heading", { name: "No blocked users" }).waitFor();
    await page.getByRole("button", { name: "Contact support", exact: true }).click();
    assert.equal(await page.locator("#sendSupport").isDisabled(), true);
    await page.locator("#supportMessage").fill("The clip audio stopped.");
    await page.getByRole("button", { name: "Privacy policy", exact: true }).click();
    await page.getByRole("link", { name: /Open privacy policy/ }).waitFor();
    assert.equal(await page.getByRole("link", { name: /Open privacy policy/ }).getAttribute("href"), "https://example.com/privacy");
    await page.getByRole("button", { name: "Contact support", exact: true }).click();
    assert.equal(await page.locator("#supportMessage").inputValue(), "The clip audio stopped.");
    await page.locator("#sendSupport").click();
    await page.getByText(/We couldn’t confirm delivery/).waitFor();
    assert.equal(await page.locator("#supportMessage").inputValue(), "The clip audio stopped.");
    failSupport = false;
    await page.locator("#sendSupport").click();
    await page.getByRole("heading", { name: "Message sent" }).waitFor();
    assert.equal(requests.filter(req => req.path === "/support/tickets").length, 2);
    assert.ok(!requests.some(req => /deactiv|\/account$/.test(req.path)));
    await page.getByRole("button", { name: "Manage account", exact: true }).click();
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByText("Couldn’t delete your account. Please try again.").waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("voxxly_web_access_token")), "test-token");
    failDeletion = false;
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Deleting…", exact: true }).isDisabled(), true);
    await page.locator("[data-delete-account]").dispatchEvent("click");
    await page.evaluate(() => { window.location.hash = "#/profile"; });
    await page.locator(".settings-page").waitFor({ state: "detached" });
    assert.equal(requests.filter(req => req.path === "/me/account").length, 2);
    assert.equal(typeof releaseDeletion, "function");
    releaseDeletion();
    await page.getByRole("heading", { name: "Log in to Voxxly", exact: true }).waitFor();
    await page.getByText("Your account has been deleted.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("voxxly_web_access_token")), null);
    assert.ok(requests.filter(req => req.path === "/me/account").every(req => req.method === "DELETE" && req.data === null));
    console.log("Settings browser checks passed: responsive layouts, existing settings, deletion cancellation, failure/retry, duplicate clicks and sign-out after navigation.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
