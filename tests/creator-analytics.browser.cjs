"use strict";
const {chromium,webkit,devices}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const os=require('node:os');const {execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'creator-qa-'));
 const mp4=path.join(temp,'clip.mp4');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=270x480:rate=24','-t','12','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',mp4]);
 const media=fs.readFileSync(mp4);
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/clip.mp4'){
   const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),media.length-1):media.length-1;
   res.writeHead(match?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})});res.end(media.subarray(start,end+1));return;
  }
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,body)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(body);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const engine=process.env.BROWSER_ENGINE||'chromium';const browser=await(engine==='webkit'?webkit:chromium).launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});const failures=[];page.on('pageerror',error=>failures.push(error.message));
 let analyticsFail=false,mutationFail=false,empty=false;const mutations=[],batches=[],ranges=[];
 let clips=[{id:10,iosUserId:1,name:'Morning conversations',streamUrl:origin+'/clip.mp4'},{id:11,iosUserId:1,name:'Finding your next idea',streamUrl:origin+'/clip.mp4'}];
 const otherClip={id:20,iosUserId:2,name:'Another creator',streamUrl:origin+'/clip.mp4'};
 const summary={starts:14920,views:12480,viewers:8620,watchSeconds:294120,averageWatchSeconds:23.6,completionRate:64.8,averageWatchedPercent:72.4,holdRate:83.6,repeatViewers:2410,replays:1630,episodeClicks:286,liked:948,saved:372,reposted:126,followers:1830,newFollowers:214};
 const fixture=(range,clipId)=>({range,from:'2026-09-27T00:00:00Z',to:'2026-10-03T21:00:00Z',updatedAt:'2026-10-03T21:00:00Z',playbackScope:'web',clip:clipId?{id:Number(clipId),title:clips.find(c=>String(c.id)===clipId)?.name||'Morning conversations',deleted:false}:null,
 summary:empty?Object.fromEntries(Object.keys(summary).map(k=>[k,k.includes('Rate')||k.startsWith('average')?null:0])):summary,previous:range==='all'?null:{...summary,views:9600,viewers:7000,watchSeconds:240000,completionRate:59},
 series:empty?[]:[720,1350,1100,1950,1680,2490,3190].map((views,i)=>({date:new Date(Date.UTC(2026,8,27+i)).toISOString().slice(0,10),views,viewers:Math.round(views*.7),watchSeconds:views*23})),
 retention:empty?Array(20).fill(null):[100,98,95,92,90,88,87,85,82,80,78,76,74,72,71,70,68,66,65,64],sources:empty?[]:[{name:'feed',views:9000},{name:'profile',views:2480},{name:'saved',views:1000}],devices:empty?[]:[{name:'mobile',views:10000},{name:'desktop',views:2480}],
 clips:empty?[]:clips.map((c,i)=>({id:c.id,title:c.name,views:9000-i*5500,viewers:5000,watchSeconds:200000-i*100000,completionRate:68-i*10,averageWatchSeconds:22,averageWatchedPercent:74,liked:50,saved:20,reposted:5,replays:100,episodeClicks:25}))});
 await page.route('https://dev-backend-withered-thunder-4589.fly.dev/**',async route=>{
  const req=route.request(),url=new URL(req.url());let body=[],status=200;
  if(url.pathname==='/auth/me')body={id:1,username:'creator1',emailConfirmed:true};
  else if(/^\/ios\/users\/[12]$/.test(url.pathname))body={id:Number(url.pathname.slice(-1)),username:'creator'+url.pathname.slice(-1)};
  else if(url.pathname==='/ios/users/1/clips')body=clips;
  else if(url.pathname==='/ios/users/2/clips')body=[otherClip];
  else if(url.pathname==='/iosclips/feed')body=[otherClip,...clips];
  else if(url.pathname.includes('follow-counts'))body={followerCount:1830,followingCount:42};
  else if(url.pathname.includes('/follows/'))body={following:false};
  else if(url.pathname==='/me/analytics') {ranges.push(url.searchParams.get('range'));if(analyticsFail){status=500;body={message:'Failed'};}else body=fixture(url.searchParams.get('range'),url.searchParams.get('clipId'));}
  else if(url.pathname==='/me/analytics/views'){const batch=JSON.parse(req.postData());batches.push(batch);body={accepted:batch.sessions.map(s=>s.id)};}
  else if(/^\/me\/clips\//.test(url.pathname)){mutations.push({method:req.method(),path:url.pathname,body:req.postData()});if(mutationFail){status=500;body={};}else {const id=Number(url.pathname.split('/').pop());if(req.method()==='PATCH')clips.find(c=>c.id===id).name=JSON.parse(req.postData()).title;else clips=clips.filter(c=>c.id!==id);status=204;body=null;}}
  await route.fulfill({status,contentType:'application/json',body:status===204?'':JSON.stringify(body)});
 });
 await page.addInitScript(()=>localStorage.setItem('voxxly_web_access_token','fixture-token'));
 await page.goto(origin+'/#/profile?userId=1');await page.getByRole('link',{name:'Settings',exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'View analytics',exact:true}).count(),0);
 await page.getByRole('link',{name:'Settings',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search settings'}).fill('analytics');
 assert.equal(await page.locator('[data-section]:visible').count(),1);
 await page.getByRole('link',{name:'View analytics',exact:true}).click();
 await page.locator('.analytics-overview').waitFor();
 await page.getByRole('link',{name:'Settings',exact:true}).click();
 await page.getByRole('link',{name:'Back to profile',exact:true}).click();
 await page.locator('[data-view-clip="10"]').click();
 const viewer=page.locator('.clip-viewer-backdrop');await viewer.locator('[data-more-clip]').waitFor();assert.equal(await viewer.locator('[data-report-clip]').count(),0);assert.equal(await viewer.locator('.feed-action-rail> :last-child').getAttribute('data-more-clip'),'10');
 await viewer.locator('[data-more-clip]').click();assert.deepEqual(await page.locator('.clip-tool-choice').allTextContents(),['Delete','Edit','View analytics']);
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('A better title');mutationFail=true;
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Couldn’t save. Try again.').waitFor();assert.equal(clips[0].name,'Morning conversations');mutationFail=false;
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('#clipTools').waitFor({state:'detached'});assert.equal(await page.locator('[data-clip-viewer-title]').textContent(),'A better title');
 await viewer.locator('[data-more-clip]').click();await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(clips.length,2);
 await viewer.locator('[data-more-clip]').click();await page.getByRole('button',{name:'View analytics',exact:true}).click();await page.locator('.analytics-overview').waitFor();assert.ok(page.url().includes('clipId=10'));
 await page.getByRole('link',{name:'All analytics',exact:true}).click();await page.locator('.analytics-clip-row').first().waitFor();
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+width);
  assert.equal(await page.locator('.analytics-page').evaluate(el=>getComputedStyle(el).backgroundImage),'none');
  await page.screenshot({path:path.join(temp,`analytics-${engine}-${width}.png`),fullPage:true});
 }
 await page.getByRole('button',{name:'Watch time',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Watch time',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByLabel('Explore chart dates').fill('2');assert.ok((await page.getByLabel('Explore chart dates').getAttribute('aria-valuetext')).includes('h'));
 await page.getByRole('searchbox',{name:'Find a clip'}).fill('better');assert.equal(await page.locator('.analytics-clip-row').count(),1);await page.getByRole('searchbox',{name:'Find a clip'}).fill('');
 for(const label of ['1M','3M','All time','7D']){await page.getByRole('link',{name:label,exact:true}).click();await page.locator('.analytics-overview').waitFor();}
 assert.ok(['7d','30d','90d','all'].every(r=>ranges.includes(r)));
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download analytics as CSV'}).click();const download=await downloadPromise;const downloaded=await download.path();assert.ok(fs.readFileSync(downloaded,'utf8').includes('A better title'));
 empty=true;await page.reload();await page.getByText('No clips yet',{exact:true}).waitFor();assert.equal(await page.locator('.analytics-stat-primary strong').last().textContent(),'—');empty=false;
 analyticsFail=true;await page.reload();await page.getByText('Couldn’t load analytics.').waitFor();analyticsFail=false;await page.getByRole('button',{name:'Try again'}).click();await page.locator('.analytics-overview').waitFor();
 await page.goto(origin+'/#/profile?userId=1');await page.locator('[data-view-clip="11"]').click();await viewer.locator('[data-more-clip]').click();await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByText('Clip deleted',{exact:true}).waitFor();assert.equal(clips.length,1);assert.equal(await viewer.locator('[data-more-clip]').getAttribute('data-more-clip'),'10');
 await viewer.locator('[data-clip-viewer-close]').click();assert.equal(await page.locator('[data-view-clip="11"]').count(),0);
 // Actual native playback, pause, seek and navigation feed the batch tracker.
 await page.goto(origin+'/#/profile?userId=2');await page.locator('[data-view-clip="20"]').click();assert.equal(await viewer.locator('[data-more-clip]').count(),0);assert.equal(await viewer.locator('[data-report-clip]').count(),1);
 await viewer.locator('video[data-clip-viewer-video]').evaluate(async video=>{video.muted=true;await video.play();});await page.waitForTimeout(4200);
 await viewer.locator('video[data-clip-viewer-video]').evaluate(video=>video.pause());await page.waitForTimeout(2300);
 await viewer.locator('video[data-clip-viewer-video]').evaluate(video=>{video.currentTime=10;});await page.waitForTimeout(300);
 await viewer.locator('[data-clip-viewer-close]').click();
 await page.evaluate(()=>{location.hash='#/analytics';});await page.locator('.analytics-overview').waitFor();
 assert.ok(batches.length>0);const records=batches.flatMap(b=>b.sessions);const watched=records.find(row=>row.clipId===20);assert.ok(watched,JSON.stringify(records));
 assert.ok(watched.watchMs>=3000&&watched.watchMs<5500,JSON.stringify(watched));assert.ok(watched.coverageMs<5500,'seek must not create completion');assert.ok(!records.some(row=>row.clipId===10||row.clipId===11),'self views excluded');
 assert.deepEqual(failures,[]);console.log(`Creator dashboard/menu/real playback checks passed (${engine}). Screenshots: ${temp}`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
