(function (root) {
  "use strict";
  const sections = [
    ["account", "Manage account"],
    ["blocked", "Blocked users"],
    ["content", "Age-restricted content"],
    ["support", "Contact support"],
    ["privacy", "Privacy policy"],
    ["terms", "Terms of service"]
  ];
  const categories = [
    ["ACCOUNT_ISSUE", "Account issue"], ["PLAYBACK_ISSUE", "Playback issue"],
    ["RECOMMENDATION_ISSUE", "Recommendations"], ["COPYRIGHT_TAKEDOWN", "Copyright / takedown"],
    ["SAFETY_CONCERN", "Safety concern"], ["OTHER", "Something else"]
  ];
  function legalUrl(value) {
    try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : ""; }
    catch (_) { return ""; }
  }
  function supportPayload(category, message, email) {
    const trimmed = message.trim();
    if (!categories.some(item => item[0] === category) || !trimmed || message.length > 4000) return null;
    return { category: category, message: trimmed, email: email.trim() || null };
  }
  function mount(host, options) {
    const escape = options.escape;
    const request = options.request;
    const user = options.user;
    let active = true;
    let selected = "account";
    let blocked = null;
    let loadingBlocked = false;
    let blockedError = "";
    const unblocking = new Set();
    let links = null;
    let loadingLinks = false;
    let linksError = "";
    let submitting = false;
    let submitted = false;
    let supportError = "";
    const draft = { category: "ACCOUNT_ISSUE", message: "", email: user.email || "" };
    host.innerHTML = `
      <section class="page-wrap settings-page" aria-label="Settings">
        <a class="secondary-button settings-back-button" href="#/profile" aria-label="Back to profile" title="Back to profile"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7M5 12h14" /></svg></a>
        <div class="settings-layout">
          <nav class="settings-menu" aria-label="Settings sections">
            <h2>Settings</h2>
            ${sections.map(([id, title]) => `<button type="button" data-section="${id}" aria-controls="settingsDetail">${title}</button>`).join("")}
          </nav>
          <section class="settings-detail" id="settingsDetail" aria-labelledby="settingsTitle"></section>
        </div>
      </section>`;
    const detail = host.querySelector("#settingsDetail");
    function render(focus) {
      if (!active) return;
      host.querySelectorAll("[data-section]").forEach(button => {
        if (button.dataset.section === selected) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      const title = sections.find(item => item[0] === selected)[1];
      let body = "";
      if (selected === "account") {
        body = `<p class="settings-intro">Manage your Voxxly account.</p>
          <div class="settings-item"><h2>Account deactivation</h2><p>Temporary deactivation isn’t available yet. Your account will stay active.</p><button class="secondary-button" disabled>Deactivate account</button><p class="settings-footnote">Deactivation is different from permanently deleting your account.</p></div>`;
      } else if (selected === "content") {
        body = `<p class="settings-intro">Manage mature and age-restricted content.</p>
          <div class="settings-item"><h2>Content preferences</h2><p>A personal setting for mature content isn’t available yet.</p><div class="settings-unavailable"><span>Hide mature content</span><span class="settings-badge">Not available yet</span></div><p class="settings-footnote">Existing server-side age restrictions still apply. This page does not override them.</p></div>`;
      } else if (selected === "blocked") {
        body = `<p class="settings-intro">Review the accounts you’ve blocked. You can unblock them here.</p>`;
        if (blockedError) body += `<p class="settings-error" role="alert">${escape(blockedError)}</p><button class="secondary-button" data-retry="blocked">Try again</button>`;
        if (blocked === null && !blockedError) body += `<p class="muted" role="status">Loading blocked users…</p>`;
        if (blocked && !blocked.length) body += `<div class="settings-item"><h2>No blocked users</h2><p>Accounts you block will appear here.</p></div>`;
        if (blocked && blocked.length) body += `<ul class="settings-users">${blocked.map(person => `<li>${options.avatar(person, person.username)}<div class="settings-user-name"><strong>${escape(person.username || "User")}</strong><span>@${escape(person.username || "user")}</span></div><button class="secondary-button" type="button" data-unblock="${escape(String(person.id))}" aria-label="Unblock ${escape(person.username || "user")}" ${unblocking.has(String(person.id)) ? "disabled" : ""}>${unblocking.has(String(person.id)) ? "Unblocking…" : "Unblock"}</button></li>`).join("")}</ul>`;
      } else if (selected === "support") {
        body = submitted ? `<div class="settings-item" role="status"><h2>Message sent</h2><p>Thanks for contacting us. Your support request has been received.</p><button class="secondary-button" data-new-ticket>Send another message</button></div>` : `
          <p class="settings-intro">Tell us what happened and how we can help.</p>
          <form id="settingsSupport" class="settings-support">
            <label for="supportCategory">Category</label><select id="supportCategory" ${submitting ? "disabled" : ""}>${categories.map(([value, label]) => `<option value="${value}" ${value === draft.category ? "selected" : ""}>${label}</option>`).join("")}</select>
            <label for="supportEmail">Contact email${user.email ? "" : " (optional)"}</label><input id="supportEmail" type="email" maxlength="255" value="${escape(draft.email)}" autocomplete="email" ${user.email ? "readonly" : ""} ${submitting ? "disabled" : ""}>
            ${user.email ? '<p class="settings-footnote">We’ll use your account email if we need to follow up.</p>' : ""}
            <label for="supportMessage">Message</label><textarea id="supportMessage" rows="7" maxlength="4000" required placeholder="Describe the issue…" ${submitting ? "disabled" : ""}>${escape(draft.message)}</textarea>
            <p class="settings-footnote" id="supportCount">${draft.message.length}/4000 characters</p>
            <p class="settings-error" role="alert">${escape(supportError)}</p>
            <button class="primary-button" id="sendSupport" ${submitting || !supportPayload(draft.category, draft.message, draft.email) ? "disabled" : ""}>${submitting ? "Sending…" : "Send message"}</button>
          </form>`;
      } else {
        const url = links && legalUrl(links[selected === "privacy" ? "privacyPolicyUrl" : "termsOfServiceUrl"]);
        body = `<p class="settings-intro">${selected === "privacy" ? "Read how your information is collected, used and handled." : "Review the terms that apply when you use Voxxly."}</p>`;
        if (loadingLinks) body += `<p class="muted" role="status">Loading…</p>`;
        else if (url) body += `<a class="secondary-button" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Open ${selected === "privacy" ? "privacy policy" : "terms of service"}<span class="sr-only"> (opens in a new tab)</span></a>`;
        else body += `<p class="settings-error" role="alert">${escape(linksError || "This document’s link hasn’t been configured yet.")}</p><button class="secondary-button" data-retry="links">Try again</button>`;
      }
      detail.innerHTML = `<h1 id="settingsTitle" tabindex="-1">${title}</h1>${body}`;
      if (focus) detail.querySelector("h1").focus({ preventScroll: true });
      bindDetail();
    }
    async function loadBlocked() {
      if (loadingBlocked) return;
      loadingBlocked = true;
      blockedError = "";
      render();
      try {
        const result = await request("/me/blocked-users");
        if (!Array.isArray(result) || result.some(person => !person || person.id == null)) throw new Error("Unexpected blocked-user response.");
        if (active) blocked = result;
      } catch (_) { if (active) blockedError = "Couldn’t load blocked users. Please try again."; }
      finally { loadingBlocked = false; if (active && selected === "blocked") render(); }
    }
    async function loadLinks() {
      if (loadingLinks) return;
      loadingLinks = true;
      linksError = "";
      render();
      try { const result = await request("/app/config"); if (active) links = result; }
      catch (_) { if (active) linksError = "Couldn’t load the document link. Please try again."; }
      finally { loadingLinks = false; if (active && ["privacy", "terms"].includes(selected)) render(); }
    }
    function bindDetail() {
      detail.querySelectorAll("[data-retry]").forEach(button => button.addEventListener("click", () => button.dataset.retry === "blocked" ? loadBlocked() : loadLinks()));
      detail.querySelectorAll("[data-unblock]").forEach(button => button.addEventListener("click", async function () {
        const id = button.dataset.unblock;
        if (unblocking.has(id)) return;
        unblocking.add(id);
        blockedError = "";
        render();
        try {
          await request("/users/" + encodeURIComponent(id) + "/block", { method: "DELETE" });
          if (active) {
            blocked = blocked.filter(person => String(person.id) !== id);
            options.onUnblock();
          }
        } catch (_) { if (active) blockedError = "Couldn’t unblock this user. Please try again."; }
        finally {
          unblocking.delete(id);
          if (active && selected === "blocked") {
            render();
            detail.querySelector("h1").focus({ preventScroll: true });
          }
        }
      }));
      const another = detail.querySelector("[data-new-ticket]");
      if (another) another.addEventListener("click", () => { submitted = false; draft.message = ""; render(); });
      const form = detail.querySelector("form");
      if (!form) return;
      form.addEventListener("input", function () {
        draft.category = form.querySelector("select").value;
        draft.email = form.querySelector("input").value;
        draft.message = form.querySelector("textarea").value;
        form.querySelector("#supportCount").textContent = draft.message.length + "/4000 characters";
        form.querySelector("#sendSupport").disabled = submitting || !supportPayload(draft.category, draft.message, draft.email);
      });
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        const payload = supportPayload(draft.category, draft.message, draft.email);
        if (submitting || !payload || !form.reportValidity()) return;
        submitting = true;
        supportError = "";
        render();
        try {
          await request("/support/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (active) submitted = true;
        } catch (_) { if (active) supportError = "We couldn’t confirm delivery. Your message is still here; try again when you’re ready."; }
        finally { submitting = false; if (active && selected === "support") render(true); }
      });
    }
    host.querySelectorAll("[data-section]").forEach(button => button.addEventListener("click", function () {
      selected = button.dataset.section;
      render(true);
      if (selected === "blocked" && blocked === null && !blockedError) loadBlocked();
      if (["privacy", "terms"].includes(selected) && !links && !linksError) loadLinks();
    }));
    render();
    return function () { active = false; };
  }
  const api = { mount: mount, supportPayload: supportPayload, legalUrl: legalUrl };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VoxxlySettings = api;
})(typeof window !== "undefined" ? window : globalThis);
