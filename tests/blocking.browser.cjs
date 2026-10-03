// Run with Playwright installed: node tests/blocking.browser.cjs.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = process.env.BLOCKING_SITE_ROOT || path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    fs.readFile(file, (error, data) => { res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(error ? '' : data); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.BLOCKING_BROWSER_PATH || undefined });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    let blocked = false, failBlock = true, failUnblock = false;
    await page.route('https://dev-backend-withered-thunder-4589.fly.dev/**', async route => {
      const req = route.request(), url = new URL(req.url()), endpoint = url.pathname;
      requests.push({ path: endpoint, method: req.method() });
      let body = {}, status = 200;
      const user = { id: 1, username: 'viewer', email: 'viewer@example.test' };
      const target = { id: 2, username: 'creator' };
      if (endpoint === '/auth/me') body = user;
      else if (endpoint === '/me/blocked-users') body = blocked ? [target] : [];
      else if (endpoint === '/users/2/block') {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (req.method() === 'POST' ? failBlock : failUnblock) status = 500;
        else { blocked = req.method() === 'POST'; body = { blocked, userId: 2 }; }
      } else if (endpoint === '/ios/users/2') { body = target; if (blocked) status = 404; }
      else if (/\/follows\//.test(endpoint)) body = { following: false };
      else if (/\/follow-counts$/.test(endpoint)) body = { followerCount: 0, followingCount: 0 };
      else if (endpoint.endsWith('/recent-searches')) body = { users: [] };
      else if (/clips$|\/followers$|\/following$|\/search$/.test(endpoint)) body = [];
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.addInitScript(() => localStorage.setItem('voxxly_web_access_token', 'test-token'));
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base + '/#/profile?userId=2');
    const block = page.getByRole('button', { name: 'Block', exact: true });
    await block.click();
    await page.getByText('Couldn’t block user.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Follow', exact: true }).isVisible(), true);
    assert.equal(blocked, false);
    failBlock = false;
    await block.click();
    await page.getByText('User blocked', { exact: true }).waitFor();
    assert.equal(await page.locator('#followProfile').count(), 0);
    assert.equal(await page.locator('.profile-tabs').count(), 0);
    assert.equal(requests.filter(r => r.path === '/users/2/block' && r.method === 'POST').length, 2);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.BLOCKING_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.BLOCKING_SCREENSHOT_DIR, 'blocked-profile-' + width + '.png'), fullPage: true });
    }
    await page.reload();
    await page.getByText('User blocked', { exact: true }).waitFor();
    failUnblock = true;
    await page.getByRole('button', { name: 'Unblock', exact: true }).click();
    await page.getByText('Couldn’t unblock user.', { exact: true }).waitFor();
    assert.equal(blocked, true);
    failUnblock = false;
    await page.getByRole('button', { name: 'Unblock', exact: true }).click();
    await block.waitFor();
    await page.getByRole('button', { name: 'Follow', exact: true }).waitFor();
    await block.click();
    await page.getByText('User blocked', { exact: true }).waitFor();
    await page.goto(base + '/#/settings');
    await page.getByRole('button', { name: 'Blocked users', exact: true }).click();
    failUnblock = true;
    await page.getByRole('button', { name: 'Unblock creator' }).click();
    await page.getByText('Couldn’t unblock this user. Please try again.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-unblock]').count(), 1);
    failUnblock = false;
    await page.getByRole('button', { name: 'Unblock creator' }).click();
    await page.getByRole('heading', { name: 'No blocked users', exact: true }).waitFor();
    await page.goto(base + '/#/profile?userId=2');
    await block.waitFor();
    await page.goto(base + '/#/profile');
    await page.getByRole('button', { name: 'Edit profile', exact: true }).waitFor();
    assert.equal(await page.locator('#blockProfile').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Blocking browser checks passed: block/unblock failures and success, refresh persistence, settings, own profile, mobile/desktop layout.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
