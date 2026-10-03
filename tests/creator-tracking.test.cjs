"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
 let clock=0,wall=Date.now(),user={id:1},fail=false;const jobs=new Map(),listeners=new Map(),storage=new Map(),requests=[];
 const video={currentTime:0,duration:10,paused:false,seeking:false,readyState:4,isConnected:true,playbackRate:1,loop:true};
 const document={hidden:false,querySelector:()=>null,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:()=>{}};
 const sandbox={document,crypto:require('node:crypto').webcrypto,performance:{now:()=>clock},matchMedia:()=>({matches:false}),localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setInterval:(fn,ms)=>{jobs.set(ms,fn);return ms;},clearInterval:ms=>jobs.delete(ms),Date:class extends Date{constructor(...args){super(...(args.length?args:[wall]));}static now(){return wall;}},console};
 sandbox.window=sandbox;sandbox.addEventListener=(name,fn)=>listeners.set(name,fn);sandbox.removeEventListener=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../creator-tracking.js'),'utf8'),sandbox);
 const tracker=sandbox.VoxxlyCreatorTracking.create({user:()=>user,request:async(path,options)=>{const payload=JSON.parse(options.body);requests.push({user:user.id,...payload});if(fail)throw{status:503};return{accepted:payload.sessions.map(r=>r.id)};}});
 const select=id=>tracker.select(video,{id,iosUserId:2},'profile');
 function tick(seconds,{advance=true}={}){for(let i=0;i<seconds*4;i++){clock+=250;wall+=250;if(advance&&!video.paused){video.currentTime+=.25;if(video.currentTime>=video.duration)video.currentTime-=video.duration;}jobs.get(250)();}}
 return{tracker,video,document,requests,storage,listeners,select,tick,setUser:value=>{user=value;},setFail:value=>{fail=value;},advanceWall:ms=>{wall+=ms;}};
}
test('paused, stalled, hidden and seeking time are excluded; natural loops retain coverage',async()=>{
 const f=fixture();f.select(20);f.tick(5);f.video.paused=true;f.tick(4);f.video.paused=false;f.tick(3,{advance:false});f.document.hidden=true;f.tick(5);f.document.hidden=false;f.video.currentTime=8;f.video.seeking=true;f.tick(.25,{advance:false});f.video.seeking=false;f.tick(1);await f.tracker.flush();
 const row=f.requests[0].sessions[0];assert.ok(row.watchMs>=5000&&row.watchMs<6500,JSON.stringify(row));assert.ok(row.coverageMs<6500);assert.equal(row.replays,0);
 f.tick(10);await f.tracker.flush();const next=f.requests[1].sessions[0];assert.equal(next.id,row.id);assert.ok(next.replays>=1);assert.ok(next.coverageMs>=9500);assert.ok(next.watchMs<18000);
});
test('failed batches survive reload and retain IDs; retries do not mix signed-in users',async()=>{
 const f=fixture();f.select(20);f.tick(4);f.tracker.stop();f.setFail(true);await f.tracker.flush();const id=f.requests[0].sessions[0].id;
 assert.ok(f.storage.get('voxxly_view_queue_1').includes(id));f.setFail(false);f.advanceWall(61000);await f.tracker.flush();assert.equal(f.requests[1].sessions[0].id,id);assert.equal(JSON.parse(f.storage.get('voxxly_view_queue_1')).length,0);
 f.select(21);f.tick(4);f.tracker.stop();f.setFail(true);await f.tracker.flush();f.setUser({id:3});f.setFail(false);f.select(22);f.tick(4);await f.tracker.flush();const last=f.requests.at(-1);assert.equal(last.user,3);assert.deepEqual(last.sessions.map(row=>row.clipId),[22]);
});
test('self views are omitted and visibility/page exit use the batch transport',async()=>{
 const f=fixture();f.tracker.select(f.video,{id:10,iosUserId:1},'profile');f.tick(4);await f.tracker.flush();assert.equal(f.requests.length,0);
 f.select(20);f.tick(4);f.document.hidden=true;f.listeners.get('visibilitychange')();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.requests.length,1);assert.equal(f.requests[0].sessions[0].clipId,20);
 f.listeners.get('pagehide')();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.requests[1].sessions[0].id,f.requests[0].sessions[0].id);
});
