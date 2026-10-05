'use strict';
// Real H.264 + AAC media. Local API fixtures avoid disabling the HTTP cache.
// STRICT_AUDIO=1 additionally models per-element permission: only a tap authorizes
// a player, while scrolling never does. Natural runs use the engine's own policy.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { execFileSync } = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voxxly-audio-'));
  const file = path.join(dir, 'audio.mp4'), engine = process.env.BROWSER_ENGINE || 'chromium';
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=180x320:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','8','-c:v','libx264','-preset','ultrafast','-c:a','aac','-movflags','+faststart',file]);
  const media = fs.readFileSync(file), requests = [];
  let origin, localOrigin;
  const user = id => ({ id, username: id === 1 ? 'viewer' : 'creator', emailConfirmed: true });
  const clips = owner => Array.from({length:9}, (_, i) => ({id:i+1,iosUserId:owner,name:'Audio clip '+(i+1),streamUrl:origin+'/media/'+(i+1)+'.mp4',creator:user(owner)}));
  const server = http.createServer((req,res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const p = url.pathname.slice(4); let body = [];
      if (p === '/auth/login') body = {accessToken:'audio-test'};
      else if (p === '/auth/me') body = user(1);
      else if (/^\/ios\/users\/[12]$/.test(p)) body = user(Number(p.split('/').pop()));
      else if (p === '/iosclips/feed' || p.endsWith('/saved-clips')) body = clips(2);
      else if (/\/users\/[12]\/clips$/.test(p)) body = clips(Number(p.split('/')[3]));
      else if (p.endsWith('follow-counts')) body = {followers:0,following:0};
      else if (p.includes('/follows/')) body = {following:false};
      res.setHeader('Content-Type','application/json');
      if(p === '/iosclips/feed' || p === '/auth/login') setTimeout(()=>res.end(JSON.stringify(body)),180);
      else res.end(JSON.stringify(body)); return;
    }
    if (url.pathname.startsWith('/media/')) {
      requests.push({path:url.pathname,range:req.headers.range});
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = m ? +m[1] : 0, end = m && m[2] ? Math.min(+m[2],media.length-1) : media.length-1;
      res.writeHead(m ? 206 : 200, {'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'public,max-age=3600',...(m ? {'Content-Range':`bytes ${start}-${end}/${media.length}`} : {})});
      res.end(media.subarray(start,end+1)); return;
    }
    const local = path.resolve(root, '.'+(url.pathname==='/' ? '/index.html' : url.pathname));
    if (!local.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
    fs.readFile(local,(error,data) => {
      if(error){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(local)] || 'application/octet-stream');
      if (url.pathname === '/config.js') data = data.toString()+`\nAPP_CONFIG.apiBaseUrl=${JSON.stringify(origin+'/api')};`;
      res.end(data);
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); localOrigin = 'http://127.0.0.1:'+server.address().port; origin = process.env.TEST_BASE_URL?.replace(/\/$/,'') || localOrigin;
  const browser = await (engine==='webkit'?webkit:chromium).launch({headless:true});
  const errors = [], results = [];
  try {
    const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    page.setDefaultTimeout(15000);
    if (process.env.TEST_BASE_URL) {
      // Production assets, isolated local API/media; no real account mutations.
      await page.route(origin+'/config.js*',async route=>{
        const response=await route.fetch();
        await route.fulfill({response,body:(await response.text())+`\nAPP_CONFIG.apiBaseUrl=${JSON.stringify(origin+'/api')};`});
      });
      for(const prefix of ['/api/','/media/']) await page.route(origin+prefix+'**',async route=>{
        const url=new URL(route.request().url());
        await route.fulfill({response:await route.fetch({url:localOrigin+url.pathname+url.search})});
      });
    }
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({strict,startup}) => {
      if(startup!=='login') localStorage.setItem('voxxly_web_access_token','audio-test');
      window.audioBlocks=0; window.nativePlay=HTMLMediaElement.prototype.play;
      const grants=new WeakSet(); let gesture=false;
      window.addEventListener('click',()=>{gesture=true;setTimeout(()=>gesture=false,0);},true);
      HTMLMediaElement.prototype.play=function(){
        if(window.injectPlayError){const name=window.injectPlayError;window.injectPlayError=null;window.nativePlay.call(this).catch(()=>{});return Promise.reject(new DOMException('Injected playback interruption',name));}
        if(window.holdPlay){window.holdPlay=false;return new Promise((resolve,reject)=>{window.rejectOldPlay=reject;});}
        if(strict && !this.muted){
          if(gesture)grants.add(this);
          if(!grants.has(this)){window.audioBlocks++;return Promise.reject(new DOMException('Per-element autoplay permission','NotAllowedError'));}
        }
        return window.nativePlay.call(this);
      };
    }, {strict:process.env.STRICT_AUDIO==='1',startup:process.env.STARTUP_AUDIO});
    let feed = true;
    const active = () => page.locator(feed ? '.soundbite-card.is-active video' : '[data-clip-viewer-video]');
    const surface = () => page.locator(feed ? '.soundbite-card.is-active' : '.clip-viewer-backdrop');
    async function playing(muted=false) {
      await page.waitForFunction(({feed,muted})=>{
        const v=document.querySelector(feed?'.soundbite-card.is-active video':'[data-clip-viewer-video]');
        return v && !v.paused && v.muted===muted && v.readyState>=2 && v.currentTime>0.05 && (muted || v.volume>0);
      },{feed,muted},{timeout:15000});
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('video')].filter(v=>!v.paused).length),1,'exactly one playing element');
      assert.equal(await page.locator('[data-clip-viewer-video]').count(),feed?0:1,'one current viewer marker');
    }
    async function wheel(direction) {
      if(engine==='webkit') await active().evaluate((v,d)=>v.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:d*160})),direction);
      else {await page.mouse.move(180,380);await page.mouse.wheel(0,direction*160);}
    }
    async function step(direction,id,muted=false,viaTouch=false) {
      const before=Date.now();
      if(viaTouch && feed) {
        // Dispatch the same touch events as a swipe without granting click activation.
        await page.locator('.feed-page').evaluate((el,d)=>{
          const start=new Event('touchstart',{bubbles:true}),end=new Event('touchend',{bubbles:true});
          Object.defineProperty(start,'touches',{value:[{clientY:450}]});
          Object.defineProperty(end,'changedTouches',{value:[{clientY:450-d*160}]});
          el.dispatchEvent(start); el.dispatchEvent(end);
        },direction);
      } else {
        await wheel(direction);
      }
      await page.waitForFunction(({feed,id})=>document.querySelector(feed?'.soundbite-card.is-active video':'[data-clip-viewer-video]')?.src.endsWith('/'+id+'.mp4'),{feed,id});
      await playing(muted); results.push({surface:feed?'feed':await page.evaluate(()=>location.hash),id,firstPlaybackMs:Date.now()-before});
      await page.waitForTimeout(600);
    }
    const startup=process.env.STARTUP_AUDIO;
    if(startup==='navigation') {
      await page.goto(origin+'/?playbackDebug=1#/saved');
      await page.locator('[data-view-clip]').first().waitFor();
      await page.locator('.primary-nav [data-route="#/feed"]').tap();
    } else if(startup==='login') {
      await page.goto(origin+'/?playbackDebug=1#/login');
      await page.locator('[name="login"]').fill('viewer');
      await page.locator('[name="password"]').fill('fixture-password');
      await page.locator('#loginSubmit').tap();
    } else await page.goto(origin+'/?playbackDebug=1#/feed');
    await active().waitFor();
    await page.evaluate(()=>window.foreground=document.querySelector('.soundbite-card.is-active video'));
    if(startup==='direct') {
      await playing(true);
      // Swipes are not permission on some iOS versions: do not fabricate success.
      await step(1,2,true,true);
      await step(1,3,true,true);
      await page.locator('.primary-nav [data-route="#/feed"]').tap();
      await playing();
      await step(-1,2);await step(-1,1);
      await page.evaluate(()=>window.foreground=document.querySelector('.soundbite-card.is-active video'));
    } else if(!startup && await active().evaluate(v=>v.muted || v.paused)) await active().tap();
    await playing();
    if(startup==='navigation' || startup==='login') assert.equal(await page.evaluate(()=>window.audioBlocks),0,'entry gesture authorizes the real player before async auth/feed requests');
    const initialBlocks=await page.evaluate(()=>window.audioBlocks);
    for(const id of [2,3,4,5,6,7,8,9]) {
      await step(1,id,false,id%2===0);
      if(process.env.STRICT_AUDIO==='1') assert.equal(await active().evaluate(v=>v===window.foreground),true,'reuse authorized element after a policy rejection, including eviction');
    }
    for(const id of [8,7,6]) await step(-1,id);
    await surface().locator('[data-feed-mute-toggle]').tap(); await playing(true);
    await step(1,7,true);
    if(startup) {
      await page.evaluate(()=>location.hash='#/saved');
      await page.locator('[data-view-clip]').first().waitFor();
      await page.locator('.primary-nav [data-route="#/feed"]').tap();
      await playing(true);
    }
    await surface().locator('[data-feed-mute-toggle]').tap(); await playing();
    await active().tap(); assert.equal(await active().evaluate(v=>v.paused),true);
    await active().tap(); await playing();
    if(process.env.STRICT_AUDIO!=='1') assert.equal(await page.evaluate(()=>window.audioBlocks),initialBlocks);
    if(process.env.STARTUP_ONLY==='1') {assert.deepEqual(errors,[]);console.log('PASS startup '+startup+': no unmute tap; 12 forward/back transitions and deliberate mute preserved');return;}
    for(const route of ['saved','profile?userId=1','profile?userId=2']) {
      await page.evaluate(route=>location.hash='#/'+route,route); feed=false;
      await page.locator('[data-view-clip="4"]').tap(); await playing();
      for(const id of [5,6,7,8,9])await step(1,id);
      for(const id of [8,7,6,5,4,3,2,1])await step(-1,id);
      await page.evaluate(()=>window.injectPlayError='AbortError'); await step(1,2);
      await page.evaluate(()=>window.injectPlayError='NotSupportedError'); await step(1,3);
      // A late policy rejection from clip 4 cannot mute clip 5 on the same node.
      await page.evaluate(()=>window.holdPlay=true);
      await wheel(1); await page.waitForFunction(()=>!!window.rejectOldPlay);
      await page.waitForTimeout(650); await step(1,5);
      await page.evaluate(()=>window.rejectOldPlay(new DOMException('Old request','NotAllowedError'))); await playing();
      await surface().locator('[data-feed-mute-toggle]').tap(); await step(1,6,true);
      await surface().locator('[data-feed-mute-toggle]').tap(); await playing();
      await active().tap(); assert.equal(await active().evaluate(v=>v.paused),true);
      await active().tap(); await playing();
      // Safari transparently recovers a rejected player; Chromium's first-policy
      // fallback still restores sound on tapping without accidentally pausing it.
      await page.evaluate(()=>window.injectPlayError='NotAllowedError'); await step(1,7,engine!=='webkit');
      if(await active().evaluate(v=>v.muted)) {await active().tap(); await playing();}
      await page.keyboard.press('Escape'); assert.equal(await page.locator('video').count(),0);
      console.log('PASS audio: '+route);
    }
    await page.evaluate(()=>location.hash='#/feed'); feed=true; await playing();
    if(process.env.STRICT_AUDIO==='1') assert.ok(await page.evaluate(()=>window.audioBlocks)>initialBlocks,'exercise actual element-reuse recovery after policy rejections');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({engine,strict:process.env.STRICT_AUDIO==='1',results,requests},null,2));
    console.log(`PASS ${engine}: audible playback on 4 surfaces, cache/window eviction, wheel/touch, mute/pause, rejected/stale play, route reuse (${results.length} transitions). ${dir}`);
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
