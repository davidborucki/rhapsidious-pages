(function (root) {
  "use strict";
  function create(options) {
    let active = null, owner = null, pending = new Map(), sending = false, retryAt = 0;
    const key = id => `voxxly_view_queue_${id}`;
    function persist() {
      if (!owner) return;
      try { localStorage.setItem(key(owner), JSON.stringify([...pending.values()].slice(-200))); } catch (_) {}
    }
    function syncUser() {
      const user = options.user();
      const next = user && String(user.id);
      if (owner === next) return user;
      active = null; owner = next; pending = new Map(); retryAt = 0;
      if (owner) try {
        const stored = JSON.parse(localStorage.getItem(key(owner)) || "[]");
        if (Array.isArray(stored)) stored.slice(-200).forEach(row => {
          if (row && typeof row.id === "string" && Date.parse(row.startedAt) > Date.now() - 6 * 86400000) pending.set(row.id, row);
        });
      } catch (_) {}
      return user;
    }
    function snapshot() {
      if (!active || active.watchMs < 250 || !Number.isFinite(active.video.duration)) return;
      const durationMs = Math.round(active.video.duration * 1000);
      if (durationMs < 100 || durationMs > 7200000) return;
      let coverageMs = 0, retentionMask = 0;
      const buckets = Array(20).fill(0);
      active.ranges.forEach(([a,b]) => {
        a = Math.max(0,a); b = Math.min(active.video.duration,b);
        coverageMs += Math.max(0,b-a)*1000;
        for (let i=0;i<20;i++) buckets[i] += Math.max(0,Math.min(b,(i+1)*active.video.duration/20)-Math.max(a,i*active.video.duration/20));
      });
      buckets.forEach((amount,i) => { if (amount >= active.video.duration/20*0.8) retentionMask |= 1 << i; });
      const row = { id: active.id, clipId: Number(active.clip.id), startedAt: active.startedAt,
        watchMs: Math.round(active.watchMs), coverageMs: Math.min(durationMs,Math.round(coverageMs)), durationMs,
        retentionMask, replays: Math.min(100,active.replays,Math.floor(active.watchMs/durationMs)),
        episodeClick: active.episodeClick, source: active.source, device: active.device };
      pending.set(row.id,row);
      if (pending.size > 200) pending.delete(pending.keys().next().value);
    }
    function addRange(a,b) {
      if (b <= a) return;
      const merged=[];
      for (const interval of [...active.ranges,[a,b]].sort((x,y)=>x[0]-y[0])) {
        const last=merged[merged.length-1];
        if (last && interval[0] <= last[1]+0.02) last[1]=Math.max(last[1],interval[1]);
        else merged.push(interval.slice());
      }
      active.ranges=merged.slice(0,200);
    }
    function sample() {
      if (!active) return;
      const video=active.video, now=performance.now(), position=video.currentTime;
      const elapsed=Math.max(0,(now-active.lastAt)/1000), previous=active.lastPosition;
      const allowed=!document.hidden && !document.querySelector("dialog[open]") && video.isConnected && !video.paused && !video.seeking && video.readyState>=2;
      if (allowed && active.wasPlaying && elapsed>0 && elapsed<=1.5) {
        let advanced=position-previous;
        const loop=video.loop && Number.isFinite(video.duration) && previous>video.duration-1.5 && position<1.5 && advanced<0;
        if (loop) advanced=video.duration-previous+position;
        // A seek, stalled frame, or background timer must not become watch time.
        if (advanced>0 && advanced<=elapsed*Math.max(1,video.playbackRate)*1.5+0.15) {
          active.watchMs=Math.min(14400000,active.watchMs+Math.min(elapsed,advanced/video.playbackRate)*1000);
          if (loop) { addRange(previous,video.duration); addRange(0,position); active.replays++; }
          else addRange(previous,position);
        }
      }
      active.lastAt=now;active.lastPosition=position;active.wasPlaying=allowed;
    }
    function stop() { sample();snapshot();active=null;persist();if(pending.size>=20) flush(); }
    function select(video,clip,source) {
      const user=syncUser();
      if (active && active.video===video && String(active.clip.id)===String(clip.id)) return;
      stop();
      if (!user || !video || !clip || String(clip.iosUserId)===String(user.id)) return;
      active={ id:crypto.randomUUID(),video,clip,source,startedAt:new Date().toISOString(),watchMs:0,ranges:[],replays:0,episodeClick:false,
        device:matchMedia("(pointer: coarse)").matches?"mobile":"desktop",lastAt:performance.now(),lastPosition:video.currentTime,wasPlaying:false };
    }
    async function flush(keepalive=false) {
      syncUser();sample();snapshot();persist();
      if (!owner || sending || !pending.size || Date.now()<retryAt) return;
      const user=owner, batch=[...pending.values()].slice(0,50);
      sending=true;
      try {
        const response=await options.request("/me/analytics/views",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessions:batch}),keepalive,retryAuth:false,retryForbidden:false});
        if (owner!==user) return;
        const accepted=new Set(response.accepted || []);
        batch.forEach(row=>{if(accepted.has(row.id) && pending.get(row.id)===row)pending.delete(row.id);});
        retryAt=0;persist();
      } catch (error) {
        if (owner!==user) return;
        if (error.status===400) { batch.forEach(row=>{if(pending.get(row.id)===row)pending.delete(row.id);});persist(); }
        retryAt=Date.now()+Math.max(60000,error.retryAfterMs||0);
      } finally { sending=false; }
    }
    const timer=setInterval(sample,250);
    const upload=setInterval(()=>flush(),60000);
    const visibility=()=>{if(document.hidden){sample();snapshot();persist();flush(true);}else if(active){active.lastAt=performance.now();active.lastPosition=active.video.currentTime;active.wasPlaying=false;}};
    document.addEventListener("visibilitychange",visibility);
    const pagehide=()=>{stop();flush(true);};
    window.addEventListener("pagehide",pagehide);
    return { select,stop,flush,episode(clipId){if(active && String(active.clip.id)===String(clipId)){active.episodeClick=true;snapshot();}},
      destroy(){stop();clearInterval(timer);clearInterval(upload);document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",pagehide);} };
  }
  root.VoxxlyCreatorTracking={create};
})(window);
