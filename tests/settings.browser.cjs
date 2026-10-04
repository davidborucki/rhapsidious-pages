// Run with Playwright available and the static site served on localhost:8765.
const { chromium, webkit, devices } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const isWebkit = process.env.BROWSER_ENGINE === "webkit";
  const origin = process.env.TEST_BASE_URL || "http://127.0.0.1:8765";
  const browser = await (isWebkit ? webkit : chromium).launch({ headless: true, executablePath: process.env.SETTINGS_BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage(isWebkit ? devices["iPhone 13"] : { viewport: { width: 390, height: 844 }, hasTouch: true });
    const requests = [];
    let failUnblock = true;
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
      if (path === "/me/account") {
        if (failDeletion) status = 500;
        else {
          await new Promise(resolve => { releaseDeletion = resolve; });
          body = { status: "ok", accountDeleted: true };
        }
      }
      if (path === "/app/config") body = { privacyPolicyUrl: origin + "/privacy-policy/", termsOfServiceUrl: origin + "/terms-of-service/", supportUrl: origin + "/support/" };
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(() => localStorage.setItem("voxxly_web_access_token", "test-token"));
    await page.goto(origin + "/#/settings");
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    assert.equal(await page.locator("[data-section]").count(), 7);
    assert.equal(await page.locator(".settings-detail").isVisible(), false);
    assert.ok(!requests.some(req => req.path === "/me/blocked-users"));
    async function openSection(name) {
      const back = page.getByRole("link", { name: "Back to settings", exact: true });
      if (await back.isVisible()) await back.click();
      await page.getByRole("link", { name, exact: true }).click();
      await page.getByRole("heading", { name, exact: true }).waitFor();
      assert.equal(await page.locator(".settings-home").isVisible(), false);
    }
    await openSection("Manage account");
    assert.equal(await page.locator("#primaryNav").isVisible(), false);
    assert.equal(await page.locator(".site-header").isVisible(), true);
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("heading", { name: "Delete account?", exact: true }).waitFor();
    assert.ok(!requests.some(req => req.path === "/me/account"));
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.ok(!requests.some(req => req.path === "/me/account"));
    await page.getByRole("link", { name: "Back to settings", exact: true }).click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        detailHidden: document.querySelector(".settings-detail").hidden,
        rows: Array.from(document.querySelectorAll("[data-section]")).filter(row => !row.hidden).length
      }));
      assert.equal(layout.overflow, false);
      assert.equal(layout.detailHidden, true);
      assert.equal(layout.rows, 7);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: require("node:path").join(process.env.SETTINGS_SCREENSHOT_DIR, "voxxly-settings-" + width + ".png"), fullPage: true });
    }
    await page.getByRole("searchbox", { name: "Search settings" }).fill("privacy");
    assert.equal(await page.locator("[data-section]:visible").count(), 1);
    await page.getByRole("searchbox", { name: "Search settings" }).fill("no matching setting");
    await page.getByText("No settings found.").waitFor();
    await page.getByRole("searchbox", { name: "Search settings" }).fill("");
    await openSection("Blocked users");
    await page.getByRole("button", { name: "Unblock blocked_person" }).click();
    await page.getByText("Couldn’t unblock this user. Please try again.").waitFor();
    assert.equal(await page.locator("[data-unblock]").count(), 1);
    failUnblock = false;
    await page.getByRole("button", { name: "Unblock blocked_person" }).click();
    await page.getByRole("heading", { name: "No blocked users" }).waitFor();
    await page.getByRole("link", { name: "Back to settings", exact: true }).click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    await page.setViewportSize({ width: 390, height: 844 });
    // A touch-style hover must not leave Manage account looking selected.
    if (isWebkit) {
      await page.locator('[data-section="account"]').hover();
      assert.equal(await page.locator('[data-section="account"]').evaluate(el => getComputedStyle(el).backgroundColor),
        await page.locator('[data-section="blocked"]').evaluate(el => getComputedStyle(el).backgroundColor));
    }
    for (const [name, destination, heading] of [["Contact support", "/support/", "Support"], ["Privacy policy", "/privacy-policy/", "Privacy Policy"], ["Terms of service", "/terms-of-service/", "Terms of Service"]]) {
      const link = page.getByRole("link", { name, exact: true });
      assert.equal(await link.getAttribute("target"), "_blank");
      const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
      await popup.waitForLoadState();
      assert.equal(new URL(popup.url()).pathname, destination);
      await popup.getByRole("heading", { name: heading, exact: true, level: 1 }).waitFor();
      assert.equal(await popup.evaluate(() => window.opener), null);
      assert.equal(new URL(page.url()).hash, "#/settings");
      assert.equal(await page.locator(".settings-home").isVisible(), true);
      await popup.close();
    }
    assert.ok(!requests.some(req => /deactiv|\/account$/.test(req.path)));
    await openSection("Manage account");
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
    await page.getByRole("heading", { name: "Your next good listen.", exact: true }).waitFor();
    await page.getByText("Your account has been deleted.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("voxxly_web_access_token")), null);
    assert.ok(requests.filter(req => req.path === "/me/account").every(req => req.method === "DELETE" && req.data === null));
    console.log("Settings browser checks passed: direct new-tab support/legal links, list/detail navigation, search, responsive layouts, consistent touch row styling, deletion cancellation, failure/retry, duplicate clicks and sign-out after navigation.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
