(function (root) {
  "use strict";
  function mount(host, options) {
    const { request, escape: esc, toast } = options;
    let active = true, entries = [], selected = null, filter = "all", generation = 0, draft = "", requestId = null, busy = false;
    const paths = { SUPPORT: "/admin/support/tickets", VIDEO: "/admin/reports/clips", ACCOUNT: "/admin/reports/users" };
    const label = { SUPPORT: "Support", VIDEO: "Video report", ACCOUNT: "Account report" };
    const done = item => ["RESOLVED", "CLOSED", "DISMISSED", "REVIEWED"].includes(item.status);
    const summary = item => item.message || item.details || (item.reason || "").replaceAll("_", " ").toLowerCase();
    const date = value => value ? new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
    host.innerHTML = `<section class="page-wrap inbox-page"><header class="inbox-heading"><a href="#/settings" class="secondary-button">Back</a><h1 tabindex="-1">Support inbox</h1><button class="secondary-button" data-refresh>Refresh</button></header><nav class="inbox-filters" aria-label="Inbox filters">${[["all","All"],["SUPPORT","Support"],["VIDEO","Videos"],["ACCOUNT","Accounts"],["resolved","Resolved"]].map(([id,text])=>`<button class="secondary-button" data-filter="${id}" aria-pressed="${id===filter}">${text}</button>`).join("")}</nav><p class="status-error" role="alert" data-error></p><div data-inbox-content><p>Loading…</p></div></section>`;
    const content = host.querySelector("[data-inbox-content]"), error = host.querySelector("[data-error]");
    function list() {
      selected = null; generation++; draft = ""; requestId = null;
      const visible = entries.filter(item => filter === "resolved" ? done(item) : !done(item) && (filter === "all" || filter === item.kind));
      content.innerHTML = visible.length ? `<div class="inbox-list">${visible.map(item=>`<button class="inbox-row" data-case="${item.kind}:${item.id}"><span><strong>${label[item.kind]} #${item.id}</strong><span class="inbox-preview">${esc(summary(item).slice(0,140))}</span></span><time>${esc(date(item.createdAt))}</time></button>`).join("")}</div>` : `<p class="inbox-empty">No ${filter==="resolved"?"resolved conversations":"requests yet"}.</p>`;
      content.querySelectorAll("[data-case]").forEach(button=>button.addEventListener("click",()=>open(entries.find(item=>`${item.kind}:${item.id}`===button.dataset.case))));
    }
    async function load() {
      if (busy) return;
      error.textContent = "";
      const revision = ++generation;
      try {
        const results = await Promise.all(Object.entries(paths).map(async ([kind,path])=>(await request(path)).map(item=>({...item,kind}))));
        if (!active || revision !== generation) return;
        entries=results.flat().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)); list();
      } catch (_) { if(active && revision===generation) {content.innerHTML="";error.textContent="Unable to load inbox.";} }
    }
    async function open(item, preserveDraft = false) {
      if (!item || busy) return;
      selected=item;if(!preserveDraft){draft="";requestId=null;}error.textContent="";
      const revision=++generation;
      content.innerHTML="<p>Loading…</p>";
      try {
        const data=await request(`/admin/inbox/${item.kind}/${item.id}/messages`);
        if(!active || revision!==generation) return;
        conversation(item,data);
      } catch (_) {if(active && revision===generation){content.innerHTML='<button class="secondary-button" data-list>Back to inbox</button>';content.querySelector('[data-list]').onclick=list;error.textContent="Unable to load conversation.";}}
    }
    function conversation(item,data) {
      content.innerHTML=`<section class="inbox-conversation"><div class="inbox-heading"><button class="secondary-button" data-list>Inbox</button><h2>${label[item.kind]} #${item.id}</h2><button class="secondary-button" data-resolve>${done(item)?"Reopen":"Resolve"}</button></div><p class="inbox-contact">${esc(data.email || "No contact email")}</p>${item.kind==="VIDEO"?`<a href="#/feed?clip=${encodeURIComponent(item.clipId)}">View video</a>`:item.kind==="ACCOUNT"?`<a href="#/profile?userId=${encodeURIComponent(item.reportedUserId)}">View account</a>`:""}<div class="inbox-messages"><article class="inbox-message"><small>Request · ${esc(date(item.createdAt))}</small><p>${esc(summary(item))}</p></article>${data.messages.filter(message=>!message.initial).map(message=>`<article class="inbox-message ${message.incoming?"":"is-reply"}"><small>${message.incoming?"Customer":message.sentAt?"Support":"Support · queued"} · ${esc(date(message.createdAt))}</small><p>${esc(message.body)}</p></article>`).join("")}</div>${data.email?'<form class="inbox-reply"><label for="inboxReply">Reply</label><textarea id="inboxReply" rows="5" maxlength="10000" required placeholder="Write a reply…"></textarea><button class="primary-button" type="submit">Send reply</button></form>':""}</section>`;
      content.querySelector('[data-list]').onclick=()=>{if(!busy)list();};
      content.querySelector('[data-resolve]').onclick=async event=>{
        if(busy)return;busy=true;event.currentTarget.disabled=true;error.textContent="";
        const status=done(item)?(item.kind==="SUPPORT"?"OPEN":"PENDING"):"RESOLVED";
        try {await request(`${paths[item.kind]}/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,adminNotes:item.adminNotes})});if(active){item.status=status;toast(status==="RESOLVED"?"Resolved":"Reopened");list();}}
        catch(_){if(active)error.textContent="Couldn’t update status.";}
        finally{busy=false;if(active){const b=content.querySelector('[data-resolve]');if(b)b.disabled=false;}}
      };
      const form=content.querySelector('form');if(!form)return;
      const textarea=form.querySelector('textarea');textarea.value=draft;
      textarea.oninput=()=>{draft=textarea.value;requestId=null;};
      form.onsubmit=async event=>{
        event.preventDefault();if(busy || !draft.trim())return;
        busy=true;requestId=requestId || crypto.randomUUID();const button=form.querySelector('button');button.disabled=textarea.disabled=true;button.textContent="Sending…";error.textContent="";
        try {await request(`/admin/inbox/${item.kind}/${item.id}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body:draft,requestId})});if(active){draft="";toast("Reply queued");}}
        catch(_){if(active)error.textContent="Couldn’t queue reply. Your draft is saved.";}
        finally{busy=false;if(active){if(!draft)open(item);else{button.disabled=textarea.disabled=false;button.textContent="Send reply";}}}
      };
    }
    host.querySelector('[data-refresh]').onclick=()=>{if(!busy){if(selected)open(selected,true);else load();}};
    host.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{if(busy)return;filter=button.dataset.filter;host.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));error.textContent="";list();});
    load();return ()=>{active=false;generation++;host.innerHTML="";};
  }
  root.VoxxlySupportInbox={mount};
})(window);
