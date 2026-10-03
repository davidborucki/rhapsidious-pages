(function(root) {
  "use strict";
  const number=value=>new Intl.NumberFormat(undefined,{notation:Number(value)>=10000?"compact":"standard",maximumFractionDigits:1}).format(Number(value)||0);
  const percent=value=>value==null?"—":`${Number(value).toFixed(1)}%`;
  const time=value=>value==null?"—":value>=3600?`${number(value/3600)}h`:value>=60?`${number(value/60)}m`:`${number(value)}s`;
  const chartIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 3v17h17M8 15v-4m5 4V6m5 9V9"/></svg>';
  const definitions={views:"Plays watched for at least 3 seconds. Your own views are excluded.",viewers:"Distinct signed-in viewers who watched at least 3 seconds.",watchSeconds:"Time actually spent watching, including repeat plays. Paused, buffered, hidden-tab time and seeks are excluded.",completionRate:"Views that watched at least 90% of the clip, excluding skipped sections.",averageWatchSeconds:"Average watch time per view, including loops.",holdRate:"The percentage of started plays that reached 3 seconds.",averageWatchedPercent:"Average unique portion of the clip watched per view.",repeatViewers:"Viewers with two or more qualifying plays during this period.",replays:"Times playback looped after at least one clip-length of watch time.",episodeClicks:"Viewing sessions that opened the full episode.",newFollowers:"Followers added during the period who still follow you."};
  function mount(host,options) {
    const escape=options.escape;
    const params=new URLSearchParams(location.hash.split("?")[1]||"");
    const range=["7d","30d","90d","all"].includes(params.get("range"))?params.get("range"):"7d";
    const clipId=params.get("clipId");
    let active=true,data=null,metric="views",sort="views",search="";
    const controller=new AbortController();
    const href=(nextRange,id=clipId)=>`#/analytics?range=${nextRange}${id?`&clipId=${encodeURIComponent(id)}`:""}`;
    const title=clipId?"Clip analytics":"Analytics";
    host.innerHTML=`<section class="page-wrap analytics-page"><a class="back-link" href="${clipId?href(range,""):"#/profile"}">${clipId?"All analytics":"Your profile"}</a><header class="analytics-heading"><div><p class="analytics-eyebrow">${clipId?"Your clip":"Creator"}</p><h1 tabindex="-1">${title}</h1></div><button type="button" class="analytics-export" disabled aria-label="Download analytics as CSV">Export CSV</button></header><div class="analytics-toolbar"><nav class="analytics-ranges" aria-label="Analytics timeframe">${[["7d","7D"],["30d","1M"],["90d","3M"],["all","All time"]].map(([id,label])=>`<a href="${href(id)}" ${range===id?'aria-current="page"':""}>${label}</a>`).join("")}</nav><span class="analytics-dates"></span></div><div class="analytics-content" aria-live="polite"><p class="analytics-empty" role="status">Loading analytics…</p></div></section>`;
    const content=host.querySelector(".analytics-content");
    const exportButton=host.querySelector(".analytics-export");
    const format=(key,value)=>key.toLowerCase().includes("rate")||key==="averageWatchedPercent"?percent(value):key.includes("Seconds")?time(value):number(value);
    function comparison(key) {
      if(!data.previous || data.previous[key]==null || data.summary[key]==null)return "";
      const old=Number(data.previous[key]),current=Number(data.summary[key]);
      if(old===0)return current>0?'<span class="metric-change">New this period</span>':'<span class="metric-change">—</span>';
      const isRate=key==="completionRate";
      const delta=isRate?current-old:(current-old)/old*100;
      return `<span class="metric-change ${delta>0?"positive":""}">${delta>0?"+":""}${delta.toFixed(1)}${isRate?" pts":"%"} <span>vs previous period</span></span>`;
    }
    function stat(key,label,hero=false) {return `<div class="analytics-stat${hero?" analytics-stat-primary":""}"><span title="${escape(definitions[key]||label)}">${label}</span><strong>${format(key,data.summary[key])}</strong>${hero?comparison(key):""}</div>`;}
    function breakdown(rows,labels) {
      const total=rows.reduce((sum,row)=>sum+Number(row.views),0);
      return total?rows.map(row=>`<div class="analytics-breakdown"><div><span>${escape(labels[row.name]||row.name)}</span><strong>${percent(row.views/total*100)}</strong></div><div class="analytics-bar"><span style="width:${row.views/total*100}%"></span></div><small>${number(row.views)} views</small></div>`).join(""):'<p class="analytics-empty">No views yet</p>';
    }
    function filledSeries() {
      const rows=new Map(data.series.map(row=>[row.date.slice(0,10),row]));
      const start=new Date(range==="all"?(data.series[0]?.date||data.to):data.from),end=new Date(data.to);
      start.setUTCHours(0,0,0,0);if(range==="all")start.setUTCDate(1);
      const points=[];
      for(let day=start;day<=end && points.length<1200;range==="all"?day.setUTCMonth(day.getUTCMonth()+1):day.setUTCDate(day.getUTCDate()+1)) {
        const date=day.toISOString().slice(0,10);points.push(rows.get(date)||{date,views:0,viewers:0,watchSeconds:0});
      }
      return points;
    }
    function chart() {
      const points=filledSeries(),values=points.map(row=>Number(row[metric])||0),max=Math.max(...values,1);
      const coords=values.map((value,i)=>`${20+i/(Math.max(values.length-1,1))*660},${170-value/max*140}`);
      const dateLabel=value=>new Date(value+"T12:00:00Z").toLocaleDateString(undefined,{month:"short",...(range!=="all"?{day:"numeric"}:{year:"numeric"}),timeZone:"UTC"});
      const chartHost=host.querySelector(".analytics-chart");
      chartHost.innerHTML=`<div class="analytics-chart-readout" aria-live="off"></div><svg viewBox="0 0 700 190" role="img" aria-label="${metric==="watchSeconds"?"Watch time":metric} over time"><path class="chart-grid" d="M20 30H680M20 100H680M20 170H680"/>${values.some(Boolean)?`<polygon points="20,170 ${coords.join(" ")} 680,170" class="chart-area"/><polyline points="${coords.join(" ")}" class="chart-line"/>${values.length===1?`<circle cx="20" cy="${170-values[0]/max*140}" r="4" fill="var(--orange)"/>`:""}`:'<text x="350" y="105" text-anchor="middle" class="chart-empty">No views yet</text>'}</svg><div class="chart-axis"><span>${escape(dateLabel(points[0].date))}</span><span>${escape(dateLabel(points[points.length-1].date))}</span></div><input class="chart-scrubber" type="range" min="0" max="${points.length-1}" value="${points.length-1}" aria-label="Explore chart dates">`;
      const readout=chartHost.querySelector(".analytics-chart-readout"),slider=chartHost.querySelector("input");
      const show=index=>{const row=points[index];if(!row)return;readout.textContent=`${dateLabel(row.date)} · ${format(metric,row[metric])}${metric==="watchSeconds"?"":" "+metric}`;slider.setAttribute("aria-valuetext",readout.textContent);slider.value=index;};
      slider.addEventListener("input",()=>show(Number(slider.value)));
      chartHost.querySelector("svg").addEventListener("pointermove",event=>{const box=event.currentTarget.getBoundingClientRect();show(Math.max(0,Math.min(points.length-1,Math.round((event.clientX-box.left)/box.width*(points.length-1)))));});
      show(points.length-1);
    }
    function clipList() {
      const rows=data.clips.filter(row=>row.title.toLowerCase().includes(search.toLowerCase())).slice().sort((a,b)=>(b[sort]||0)-(a[sort]||0));
      host.querySelector(".analytics-clip-list").innerHTML=rows.length?rows.map(row=>`<a class="analytics-clip-row" href="${href(range,row.id)}"><div class="analytics-clip-name">${row.thumbnailUrl?`<img src="${escape(row.thumbnailUrl)}" alt="" loading="lazy">`:`<span class="analytics-clip-placeholder">${chartIcon}</span>`}<span><strong>${escape(row.title)}</strong>${row.deleted?'<small>Deleted</small>':""}</span></div><div><strong>${number(row.views)}</strong><small>Views</small></div><div><strong>${time(row.watchSeconds)}</strong><small>Watch time</small></div><div><strong>${percent(row.completionRate)}</strong><small>Completed</small></div></a>`).join(""):`<p class="analytics-empty">${search?"No matching clips":"No clips yet"}</p>`;
    }
    function draw() {
      const date=value=>new Date(value).toLocaleDateString(undefined,{month:"short",day:"numeric",timeZone:"UTC"});
      host.querySelector(".analytics-dates").textContent=range==="all"?"All recorded activity":`${date(data.from)} – ${date(data.to)}`;
      if(data.clip){host.querySelector("h1").textContent=data.clip.title;if(data.clip.deleted)host.querySelector(".analytics-eyebrow").textContent="Deleted clip";}
      content.innerHTML=`<div class="analytics-overview">${stat("views","Views",true)}${stat("viewers","Viewers",true)}${stat("watchSeconds","Watch time",true)}${stat("completionRate","Completion",true)}</div>
        <section class="analytics-section"><div class="analytics-section-heading"><h2>Performance</h2><div class="analytics-chart-tabs" role="group" aria-label="Chart metric">${[["views","Views"],["viewers","Viewers"],["watchSeconds","Watch time"]].map(([key,label])=>`<button type="button" data-metric="${key}" aria-pressed="${metric===key}">${label}</button>`).join("")}</div></div><div class="analytics-chart"></div></section>
        <div class="analytics-secondary">${stat("averageWatchSeconds","Average watch")}${stat("averageWatchedPercent","Average watched")}${stat("holdRate","3-second hold")}${stat("repeatViewers","Repeat viewers")}${stat("replays","Replays")}${stat("episodeClicks","Episode opens")}</div>
        <div class="analytics-columns"><section class="analytics-section"><h2>Audience retention</h2><div class="retention-chart" role="img" aria-label="Percentage of views that watched each part of the clip">${data.retention.some(v=>v!=null)?data.retention.map((value,i)=>`<div class="retention-column" tabindex="0" aria-label="${i*5} to ${(i+1)*5}% of clip: ${percent(value)} of views" title="${i*5}–${(i+1)*5}%: ${percent(value)}"><span style="height:${Math.max(1,Number(value))}%"></span></div>`).join(""):'<p class="analytics-empty">No retention data yet</p>'}</div><div class="chart-axis"><span>Start</span><span>Halfway</span><span>End</span></div></section><section class="analytics-section"><h2>Engagement</h2><div class="analytics-engagement">${[["liked","Likes"],["saved","Saves"],["reposted","Reposts"]].map(([key,label])=>stat(key,label)).join("")}</div>${!clipId?`<div class="analytics-followers">${stat("followers","Followers")}${stat("newFollowers","New followers")}</div>`:""}</section></div>
        <div class="analytics-columns"><section class="analytics-section"><h2>Where views come from</h2>${breakdown(data.sources,{feed:"Soundbytes",profile:"Profiles",saved:"Saved",shared:"Shared links"})}</section><section class="analytics-section"><h2>Devices</h2>${breakdown(data.devices,{mobile:"Mobile",desktop:"Desktop"})}</section></div>
        ${!clipId?`<section class="analytics-section"><div class="analytics-section-heading"><h2>Clips <span class="muted">${data.clips.length}</span></h2><label class="analytics-sort"><span class="sr-only">Sort clips</span><select aria-label="Sort clips"><option value="views">Most viewed</option><option value="watchSeconds">Watch time</option><option value="completionRate">Completion</option><option value="saved">Most saved</option></select></label></div><input class="analytics-search" type="search" placeholder="Find a clip" aria-label="Find a clip"><div class="analytics-clip-list"></div></section>`:""}
        <footer class="analytics-footer"><span>Playback: web · Updates within a minute · UTC</span><details><summary>About these numbers</summary><p>Viewing metrics start with this update. Earlier views are not reconstructed. Your own views are excluded.</p><p>A view is 3 seconds watched. Completion means 90% watched, without skipped sections. Retention shows the portion watched at each point.</p><p>Likes, saves, reposts and followers include all apps. Counts reflect actions made in the selected period that remain active. Deleted clips retain their history.</p><p>Playback figures are client-reported estimates, not audited advertising measurements.</p></details></footer>`;
      chart();if(!clipId)clipList();
      content.querySelectorAll("[data-metric]").forEach(button=>button.addEventListener("click",()=>{metric=button.dataset.metric;content.querySelectorAll("[data-metric]").forEach(b=>b.setAttribute("aria-pressed",String(b===button)));chart();}));
      content.querySelector(".analytics-sort select")?.addEventListener("change",event=>{sort=event.target.value;clipList();});
      content.querySelector(".analytics-search")?.addEventListener("input",event=>{search=event.target.value;clipList();});
      exportButton.disabled=false;
    }
    exportButton.addEventListener("click",()=>{
      if(!data)return;
      const quote=value=>'"'+String(value??"").replace(/^([\s]*[=+@-])/ ,"'$1").replace(/"/g,'""')+'"';
      const keys=["title","views","viewers","watchSeconds","averageWatchSeconds","completionRate","averageWatchedPercent","replays","episodeClicks","liked","saved","reposted"];
      const rows=[["From (UTC)",data.from],["To (UTC)",data.to],["Playback scope","Web; own views excluded"],[],keys,...data.clips.map(row=>keys.map(k=>row[k]))];
      const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(quote).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
      const a=document.createElement("a");a.href=url;a.download=`voxxly-${clipId?"clip-"+clipId:"profile"}-${range}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    function load() {
      content.innerHTML='<p class="analytics-empty" role="status">Loading analytics…</p>';
      options.request(`/me/analytics?range=${range}${clipId?`&clipId=${encodeURIComponent(clipId)}`:""}`,{signal:controller.signal,retryForbidden:false}).then(result=>{if(active){data=result;draw();}}).catch(error=>{
        if(!active)return;content.innerHTML=`<div class="analytics-empty"><p>${error.status===404?"Clip unavailable.":"Couldn’t load analytics."}</p><button class="secondary-button" type="button">Try again</button></div>`;
        content.querySelector("button").addEventListener("click",load);
      });
    }
    load();
    return ()=>{active=false;controller.abort();};
  }
  root.VoxxlyCreatorAnalytics={mount};
})(window);
