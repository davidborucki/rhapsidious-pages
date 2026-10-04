'use strict';
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {execFileSync}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voxxly-neighbor-')),root=path.resolve(__dirname,'..'),file=path.join(dir,'short.mp4');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=180x320:rate=24','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',file]);
 const media=fs.readFileSync(file),requests=[];
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/media/')){
   requests.push(url.pathname); const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=m?+m[1]:0,end=m&&m[2]?Math.min(+m[2],media.length-1):media.length-1;
   res.writeHead(m?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(m?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})});return res.end(media.subarray(start,end+1));
  }
  const local=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname)); if(!local.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(local,(e,data)=>{if(e){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(local)]||'application/octet-stream');res.end(data);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin='http://127.0.0.1:'+server.address().port;
 const browser=await(process.env.BROWSER_ENGINE==='webkit'?webkit:chromium).launch({headless:true});
 try {
  for(const route of ['profile?userId=1','profile?userId=2','saved']){
   const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const owner=route.includes('userId=2')?2:1;
   const clips=Array.from({length:7},(_,i)=>({id:i+1,iosUserId:owner,name:'Conversation '+(i+1),streamUrl:origin+'/media/'+(i+1)+'.mp4'}));
   await page.route('https://dev-backend-withered-thunder-4589.fly.dev/**',r=>{
    const u=new URL(r.request().url());let body=[];
    if(u.pathname==='/auth/me')body={id:1,username:'avery',emailConfirmed:true};
    else if(/^\/ios\/users\/[12]$/.test(u.pathname))body={id:owner,username:'creator'};
    else if(u.pathname.endsWith('/clips')||u.pathname.endsWith('/saved-clips'))body=clips;
    else if(u.pathname.endsWith('follow-counts'))body={followers:0,following:0};
    else if(u.pathname.includes('/follows/'))body={following:false};
    return r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   });
   await page.addInitScript(()=>localStorage.setItem('voxxly_web_access_token','fixture-token'));
   await page.goto(origin+'/?playbackDebug=1#/'+route);
   await page.locator('[data-view-clip="4"]').click();
   await page.locator('[data-clip-viewer-video]').evaluate(v=>v.play());
   await page.waitForFunction(()=>{
    const videos=[...document.querySelectorAll('.clip-viewer-dialog video')];
    return videos.length===5 && videos.every(v=>v.readyState>=2&&v.buffered.length&&v.buffered.end(0)>0);
   },{},{timeout:15000});
   const state=await page.evaluate(()=>{
    window.retainedPlayers=[...document.querySelectorAll('.clip-viewer-dialog video')];
    return {count:retainedPlayers.length,playing:retainedPlayers.filter(v=>!v.paused).length};
   });
   assert.deepEqual(state,{count:5,playing:1});
   for(const key of ['ArrowDown','ArrowDown','ArrowUp','ArrowUp','ArrowUp','ArrowUp']){
    await page.evaluate(direction=>{
      const active=document.querySelector('[data-clip-viewer-video]');
      const id=Number(active.src.match(/(\d+)\.mp4/)[1])+direction;
      window.nextRetained=[...document.querySelectorAll('.clip-viewer-dialog video')].find(v=>v.src.endsWith('/'+id+'.mp4'));
    }, key==='ArrowDown'?1:-1);
    await page.keyboard.press(key);await page.waitForTimeout(700);
    if(await page.evaluate(()=>Boolean(window.nextRetained))) assert.equal(await page.locator('[data-clip-viewer-video]').evaluate(v=>v===window.nextRetained),true);
   }
   assert.deepEqual(errors,[]);await page.close();
   console.log('PASS real media: '+route+', two prepared each side, one audible player, forward/back reuse');
  }
  fs.writeFileSync(path.join(dir,'requests.json'),JSON.stringify(requests));console.log(dir);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
