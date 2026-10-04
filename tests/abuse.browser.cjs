"use strict";
const { chromium, webkit } = require("playwright");
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict");
(async()=>{
 const root=path.resolve(__dirname,"..");
 const server=http.createServer((req,res)=>{const pathname=new URL(req.url,"http://localhost").pathname;const file=path.resolve(root,"."+(pathname==="/"?"/index.html":pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);return res.end();}res.setHeader("Content-Type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml"})[path.extname(file)]||"application/octet-stream");res.end(data);});});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin=`http://127.0.0.1:${server.address().port}`;
 const engine=process.env.BROWSER_ENGINE==="webkit"?webkit:chromium,browser=await engine.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});let uploads=0;const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("https://dev-backend-withered-thunder-4589.fly.dev/**",async route=>{
   const u=new URL(route.request().url());let body=[],status=200;
   if(u.pathname==="/auth/me"||u.pathname==="/ios/users/1")body={id:1,username:"tester",emailConfirmed:true};
   else if(u.pathname==="/iosclips"&&route.request().method()==="POST"){uploads++;status=429;body={message:"Upload limit reached. Try again tomorrow."};}
   else if(u.pathname==="/app/config")body={};
   else if(u.pathname.endsWith("follow-counts"))body={followers:0,following:0};
   await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.addInitScript(()=>{localStorage.setItem("voxxly_web_access_token","fixture");window.imageDecodeCount=0;const original=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){window.imageDecodeCount++;return original.call(this);};});
  await page.goto(origin+"/#/upload");await page.locator("#clipFiles").waitFor({state:"attached"});
  await page.locator("#clipFiles").setInputFiles(Array.from({length:11},(_,i)=>({name:`clip-${i}.mp4`,mimeType:"video/mp4",buffer:Buffer.from([1,2,3])})));
  await page.locator("[data-upload-title]").first().waitFor();assert.equal(await page.locator("[data-upload-title]").count(),10);assert.ok((await page.locator("#app").innerText()).includes("Choose up to 10 videos"));
  await page.locator("[data-upload-title]").first().evaluate(el=>{el.value="x".repeat(201);el.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.locator("#uploadSubmit").click();assert.equal(uploads,0);assert.ok((await page.locator("#app").innerText()).includes("1–200"));
  await page.locator("[data-upload-title]").first().fill("Valid title");await page.locator("#uploadSubmit").click();
  await page.waitForFunction(()=>document.querySelector("#app").textContent.includes("Upload limit reached"));
  await page.waitForTimeout(300);assert.equal(uploads,1,"429 must stop the rest of the batch");
  await page.goto(origin+"/#/profile?userId=1");await page.getByRole("button",{name:"Edit profile",exact:true}).click();
  const png=Buffer.alloc(33);png.set([137,80,78,71,13,10,26,10]);png.writeUInt32BE(13,8);png.write("IHDR",12);png.writeUInt32BE(100000,16);png.writeUInt32BE(100000,20);
  await page.locator("#editPhoto").setInputFiles({name:"bomb.png",mimeType:"image/png",buffer:png});
  await page.getByText("Choose a photo up to 16 megapixels.",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.imageDecodeCount),0);
  const validPng=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=32;c.height=32;c.getContext("2d").fillRect(0,0,32,32);return c.toDataURL("image/png").split(",")[1];});
  await page.locator("#editPhoto").setInputFiles({name:"valid.png",mimeType:"image/png",buffer:Buffer.from(validPng,"base64")});
  await page.getByAltText("New profile picture preview",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.imageDecodeCount),1);
  assert.deepEqual(errors,[]);console.log("PASS",process.env.BROWSER_ENGINE||"chromium","batch cap, title bounds, stop on 429, pre-decode image bomb");
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
