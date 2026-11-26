const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); return res.end(); }
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const engine = process.env.BROWSER_ENGINE || 'chromium';
    browser = await (engine === 'webkit' ? webkit : chromium).launch();
    const page = await browser.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://dev-backend-withered-thunder-4589.fly.dev/**', async route => {
      requests.push({ path: new URL(route.request().url()).pathname, data: route.request().postDataJSON() });
      await route.fulfill({ status: 409, contentType: 'application/json', body: '{}' });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const state = async (id, expected) => assert.equal(await page.locator('#requirement-' + id).getAttribute('data-state'), expected);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(origin + '/?signup-test=' + width + '#/signup');
      await page.locator('#requirement-password-length').waitFor();
      for (const id of ['username-length', 'username-characters', 'email-format', 'password-length', 'password-limit', 'password-nonblank']) await state(id, 'untouched');
      const dotColor = id => page.locator('#requirement-' + id + ' .requirement-dot').evaluate(el => getComputedStyle(el).backgroundColor);
      assert.equal(await dotColor('password-length'), 'rgb(170, 165, 178)');
      await page.getByLabel('Username', { exact: true }).fill('a!');
      await state('username-length', 'invalid'); await state('username-characters', 'invalid');
      await page.getByLabel('Username', { exact: true }).fill('abc._-');
      await state('username-length', 'valid'); await state('username-characters', 'valid');
      await page.getByLabel('Email', { exact: true }).fill('a@'); await state('email-format', 'invalid');
      await page.getByLabel('Email', { exact: true }).fill('tester@example.com'); await state('email-format', 'valid');
      const password = page.getByLabel('Password', { exact: true });
      await password.fill('!'); await state('password-length', 'invalid');
      assert.equal(await dotColor('password-length'), 'rgb(255, 107, 97)');
      await password.fill('!!!!!!!!'); await state('password-length', 'valid');
      assert.equal(await dotColor('password-length'), 'rgb(77, 215, 164)');
      await page.getByRole('button', { name: 'Show password', exact: true }).click();
      assert.equal(await password.inputValue(), '!!!!!!!!');
      await password.fill(''); await state('password-length', 'invalid'); await state('password-nonblank', 'invalid');
      await password.fill('😀'.repeat(19)); await state('password-limit', 'invalid');
      await password.fill('Test!._-123');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (width === 390) await page.screenshot({ path: `/tmp/voxxly-build20-signup-${engine}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await state('age', 'untouched'); await state('agreement', 'untouched');
      if (await page.locator('#signupGender').getAttribute('required') !== null) {
        await state('gender', 'untouched');
        await page.locator('#signupGender').selectOption('MALE'); await state('gender', 'valid');
        await page.locator('#signupGender').selectOption(''); await state('gender', 'invalid');
        await page.locator('#signupGender').selectOption('FEMALE');
      }
      await page.getByLabel('Date of birth').fill('2020-01-01'); await state('age', 'invalid');
      await page.getByLabel('Date of birth').fill('2000-01-01'); await state('age', 'valid');
      await page.getByRole('checkbox').check(); await state('agreement', 'valid');
      await page.getByRole('checkbox').uncheck(); await state('agreement', 'invalid');
      await page.getByRole('checkbox').check();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await page.getByText('That username or email is already in use.').waitFor();
      assert.equal(requests.filter(r => r.path === '/ios/users').at(-1).data.password, 'Test!._-123');
    }
    assert.deepEqual(errors, []);
    console.log(engine + ': responsive signup indicators, exact colors, edit/clear/reverse, password symbols, age/agreement and request payload passed.');
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
