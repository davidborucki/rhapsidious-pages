'use strict';
const { chromium, webkit, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname;
    const file = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const engine=process.env.BROWSER_ENGINE||'chromium';
    browser=await(engine==='webkit'?webkit:chromium).launch({headless:true});
    const context=await browser.newContext(engine==='webkit'?devices['iPhone 13']:{viewport:{width:390,height:844},hasTouch:true});
    await context.addInitScript(()=>localStorage.setItem('voxxly_web_access_token','fixture'));
    let confirmed=false,mailFails=true,confirmFails=false,otherAccount=false;
    const requests=[],errors=[];
    await context.route('https://dev-backend-withered-thunder-4589.fly.dev/**',async route=>{
      const req=route.request(),url=new URL(req.url());requests.push({path:url.pathname,method:req.method(),body:req.postData()});
      let status=200,body=[];
      if(url.pathname==='/auth/me')body={id:1,username:'listener',email:'listener@example.test',emailConfirmed:confirmed};
      else if(url.pathname==='/me/email-verification'){status=mailFails?503:200;body={ok:true};}
      else if(url.pathname==='/auth/email/confirm'){status=confirmFails?400:200;if(!confirmFails&&!otherAccount)confirmed=true;body={ok:!confirmFails};}
      else if(url.pathname==='/ios/users/2')body={id:2,username:'creator',emailConfirmed:false};
      else if(url.pathname.includes('follow-counts'))body={followerCount:1,followingCount:2};
      else if(url.pathname==='/app/config')body={};
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const origin=process.env.TEST_BASE_URL||`http://127.0.0.1:${server.address().port}`;
    const goto=async hash=>{await page.goto(origin+'/'+hash);};
    const send=()=>page.getByRole('button',{name:/^(Send link|Resend link)$/});
    const shot=async name=>{if(process.env.REPORT_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.REPORT_SCREENSHOT_DIR,`verification-${engine}-${name}.png`),fullPage:true});};
    await goto('#/profile');await send().waitFor();
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const css=await page.locator('.email-verification').evaluate(el=>({background:getComputedStyle(el).backgroundColor,gradient:getComputedStyle(el).backgroundImage}));
      assert.deepEqual(css,{background:'rgba(255, 130, 0, 0.1)',gradient:'none'});
      await shot('profile-'+width);
    }
    await page.setViewportSize({width:390,height:844});
    await send().click();await page.getByText('Couldn’t send email. Try again.',{exact:true}).waitFor();
    assert.equal(await send().isEnabled(),true);
    mailFails=false;await send().click();await page.getByText('Confirmation link sent',{exact:true}).waitFor();
    const count=requests.filter(r=>r.path==='/me/email-verification').length;
    await send().click();await page.getByText('Check your email. You can resend in a minute.',{exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.path==='/me/email-verification').length,count);
    await goto('#/profile?userId=2');await page.getByRole('heading',{name:'creator',exact:true}).waitFor();
    assert.equal(await page.locator('.email-verification').count(),0);
    await goto('#/upload');await send().waitFor();assert.equal(await page.locator('#clipFiles').count(),0);await shot('upload-locked');
    const confirmation=await context.newPage();confirmation.on('pageerror',e=>errors.push(e.message));
    await confirmation.goto(origin+'/#/confirm-email?token='+'A'.repeat(43));
    await confirmation.getByRole('button',{name:'Confirm email',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.path==='/auth/email/confirm').length,0,'Opening a link must not confirm it automatically');
    await confirmation.getByRole('button',{name:'Confirm email',exact:true}).click();
    await confirmation.getByRole('heading',{name:'Email confirmed.',exact:true}).waitFor();
    assert.equal(new URL(confirmation.url()).hash,'#/confirm-email');
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByRole('button',{name:'Choose videos',exact:true}).waitFor();
    await goto('#/profile');await page.getByRole('heading',{name:'listener',exact:true}).waitFor();assert.equal(await send().count(),0);
    await shot('confirmed-profile');
    // Confirming another account's link never grants uploads to the signed-in user.
    confirmed=false;otherAccount=true;
    await goto('#/confirm-email?token='+'B'.repeat(43));await page.reload();await page.getByRole('button',{name:'Confirm email',exact:true}).click();
    await page.getByRole('heading',{name:'Email confirmed.',exact:true}).waitFor();await page.getByRole('link',{name:'Continue',exact:true}).click();await send().waitFor();assert.equal(await page.locator('#clipFiles').count(),0);
    confirmFails=true;
    await goto('#/confirm-email?token='+'C'.repeat(43));await page.getByRole('button',{name:'Confirm email',exact:true}).click();
    await page.getByRole('heading',{name:'Get a new link.',exact:true}).waitFor();await shot('expired');
    // Link works when opened in a signed-out mail browser too.
    const guest=await browser.newContext({viewport:{width:390,height:844}});
    await guest.route('https://dev-backend-withered-thunder-4589.fly.dev/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
    const guestPage=await guest.newPage();await guestPage.goto(origin+'/#/confirm-email?token='+'D'.repeat(43));
    await guestPage.getByRole('button',{name:'Confirm email',exact:true}).click();await guestPage.getByRole('heading',{name:'Email confirmed.',exact:true}).waitFor();
    assert.equal(await guestPage.locator('.auth-content').getByRole('link',{name:'Log in',exact:true}).getAttribute('href'),'#/login');
    assert.deepEqual(errors,[]);console.log(`PASS ${engine}: private prompt, SMTP failure UI, resend cooldown, upload gate, explicit confirmation, cross-tab refresh, account isolation, expired and signed-out links`);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
