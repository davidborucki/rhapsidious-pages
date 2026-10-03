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
    let selected = null;
    let searchQuery = "";
    let lastSection = null;
    let blocked = null;
    let loadingBlocked = false;
    let blockedError = "";
    const unblocking = new Set();
    let links = null;
    let loadingLinks = false;
    let linksError = "";
    let confirmingDeletion = false;
    let deleting = false;
    let deletionError = "";
    let submitting = false;
    let submitted = false;
    let supportError = "";
    const draft = { category: "ACCOUNT_ISSUE", message: "", email: user.email || "" };
    const paths = {
      account: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      blocked: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
      content: '<path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z"/><path d="M12 8v5m0 3h.01"/>',
      support: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v6h4v-6zm16 0h2v6h-4v-6zm0 6c0 3-4 3-8 3"/>',
      privacy: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
      terms: '<path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h8"/>'
    };
    const icon = id => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id]}</svg>`;
    const externalSections = {
      support: { path: "./support/", key: "supportUrl" },
      privacy: { path: "./privacy-policy/", key: "privacyPolicyUrl" },
      terms: { path: "./terms-of-service/", key: "termsOfServiceUrl" }
    };
    const externalUrl = id => legalUrl(links && links[externalSections[id].key])
      || new URL(externalSections[id].path, window.location.href).href;
    const groups = [
      ["Your account", ["account"]],
      ["Privacy and content", ["blocked", "content"]],
      ["Support and about", ["support", "privacy", "terms"]]
    ];
    host.innerHTML = `
      <section class="page-wrap settings-page" aria-label="Settings">
        <header class="settings-heading">
          <a class="secondary-button settings-back-button" href="#/profile" aria-label="Back to profile"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></a>
          <h1 id="settingsTitle" tabindex="-1">Settings</h1>
        </header>
        <div class="settings-home">
          <label class="settings-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><input type="search" placeholder="Search settings" aria-label="Search settings" autocomplete="off"></label>
          <nav class="settings-menu" aria-label="Settings sections">
            ${groups.map(([heading, ids]) => `<section class="settings-group"><h2>${heading}</h2>${ids.map(id => {
              const title = sections.find(item => item[0] === id)[1];
              const destination = externalSections[id]
                ? `href="${escape(externalUrl(id))}" target="_blank" rel="noopener noreferrer"`
                : `href="#/settings?section=${id}"`;
              return `<a class="settings-row" data-section="${id}" ${destination}>${icon(id)}<span>${title}</span><svg class="settings-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></a>`;
            }).join("")}</section>`).join("")}
            ${(user.admin === true || user.isAdmin === true) ? '<section class="settings-group"><h2>Administration</h2><a class="settings-row" data-section="inbox" href="#/admin/support">'+icon("support")+'<span>Support inbox</span></a></section>' : ""}
          </nav>
          <p class="settings-empty" role="status" hidden>No settings found.</p>
        </div>
        <section class="settings-detail" id="settingsDetail" aria-labelledby="settingsTitle" hidden></section>
      </section>`;
    const detail = host.querySelector("#settingsDetail");
    const home = host.querySelector(".settings-home");
    const titleElement = host.querySelector("#settingsTitle");
    const back = host.querySelector(".settings-back-button");
    const search = host.querySelector(".settings-search input");
    function filterSections() {
      const query = searchQuery.trim().toLocaleLowerCase();
      let visible = 0;
      host.querySelectorAll(".settings-group").forEach(group => {
        let matches = 0;
        group.querySelectorAll("[data-section]").forEach(row => {
          row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
          if (!row.hidden) { matches += 1; visible += 1; }
        });
        group.hidden = matches === 0;
      });
      host.querySelector(".settings-empty").hidden = visible > 0;
    }
    search.addEventListener("input", () => { searchQuery = search.value; filterSections(); });
    function render(focus) {
      if (!active) return;
      home.hidden = selected !== null;
      detail.hidden = selected === null;
      back.href = selected ? "#/settings" : "#/profile";
      back.setAttribute("aria-label", selected ? "Back to settings" : "Back to profile");
      titleElement.textContent = selected ? sections.find(item => item[0] === selected)[1] : "Settings";
      if (!selected) {
        detail.innerHTML = "";
        filterSections();
        if (focus) {
          const previous = lastSection && host.querySelector(`[data-section="${lastSection}"]`);
          (previous && !previous.hidden ? previous : titleElement).focus({ preventScroll: true });
        }
        return;
      }
      if (focus) titleElement.focus({ preventScroll: true });
      let body = "";
      if (selected === "account") {
        body = `<div class="settings-item">
          <h2>${confirmingDeletion ? "Delete account?" : "Delete account"}</h2>
          <p>${confirmingDeletion ? "This can’t be undone." : "Permanently delete your account."}</p>
          ${deletionError ? `<p class="settings-error" role="alert">${escape(deletionError)}</p>` : ""}
          <div class="settings-actions">
            ${confirmingDeletion ? `<button class="secondary-button" data-cancel-delete ${deleting ? "disabled" : ""}>Cancel</button>` : ""}
            <button class="secondary-button settings-delete" data-delete-account ${deleting ? "disabled" : ""}>${deleting ? "Deleting…" : "Delete account"}</button>
          </div>
        </div>`;
      } else if (selected === "content") {
        body = `<p class="settings-intro">Manage mature and age-restricted content.</p>
          <div class="settings-item"><h2>Content preferences</h2><p>A personal setting for mature content isn’t available yet.</p><div class="settings-unavailable"><span>Hide mature content</span><span class="settings-badge">Not available yet</span></div><p class="settings-footnote">Existing server-side age restrictions still apply. This page does not override them.</p></div>`;
      } else if (selected === "blocked") {
        body = "";
        if (blockedError) body += `<p class="settings-error" role="alert">${escape(blockedError)}</p><button class="secondary-button" data-retry="blocked">Try again</button>`;
        if (blocked === null && !blockedError) body += `<p class="muted" role="status">Loading…</p>`;
        if (blocked && !blocked.length) body += `<div class="settings-item"><h2>No blocked users</h2></div>`;
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
        const url = (links && legalUrl(links[selected === "privacy" ? "privacyPolicyUrl" : "termsOfServiceUrl"]))
          || new URL(selected === "privacy" ? "./privacy-policy/" : "./terms-of-service/", window.location.href).href;
        body = `<p class="settings-intro">${selected === "privacy" ? "Read how your information is collected, used and handled." : "Review the terms that apply when you use Voxxly."}</p>`;
        if (url) body += `<a class="secondary-button" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Open ${selected === "privacy" ? "privacy policy" : "terms of service"}<span class="sr-only"> (opens in a new tab)</span></a>`;
        else body += `<p class="settings-error" role="alert">${escape(linksError || "This document’s link hasn’t been configured yet.")}</p><button class="secondary-button" data-retry="links">Try again</button>`;
      }
      detail.innerHTML = body;
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
      finally {
        loadingLinks = false;
        if (active) {
          Object.keys(externalSections).forEach(id => {
            host.querySelector(`[data-section="${id}"]`).href = externalUrl(id);
          });
          if (["privacy", "terms"].includes(selected)) render();
        }
      }
    }
    function bindDetail() {
      const deleteButton = detail.querySelector("[data-delete-account]");
      if (deleteButton) deleteButton.addEventListener("click", async function () {
        if (deleting) return;
        if (!confirmingDeletion) {
          confirmingDeletion = true;
          render();
          detail.querySelector("[data-cancel-delete]").focus();
          return;
        }
        deleting = true;
        deletionError = "";
        render();
        try {
          await request("/me/account", { method: "DELETE" });
          // Deletion still signs out this session if the user left Settings while waiting.
          options.onAccountDeleted();
        } catch (_) {
          deletionError = "Couldn’t delete your account. Please try again.";
        } finally {
          deleting = false;
          if (active && selected === "account") render(true);
        }
      });
      const cancelDelete = detail.querySelector("[data-cancel-delete]");
      if (cancelDelete) cancelDelete.addEventListener("click", function () {
        if (deleting) return;
        confirmingDeletion = false;
        deletionError = "";
        render();
        detail.querySelector("[data-delete-account]").focus();
      });
      detail.querySelectorAll("[data-retry]").forEach(button => button.addEventListener("click", () => button.dataset.retry === "blocked" ? loadBlocked() : loadLinks()));
      detail.querySelectorAll("[data-unblock]").forEach(button => button.addEventListener("click", async function () {
        const id = button.dataset.unblock;
        if (unblocking.has(id)) return;
        unblocking.add(id);
        blockedError = "";
        render();
        try {
          await request("/users/" + encodeURIComponent(id) + "/block", { method: "DELETE" });
          if (active) blocked = blocked.filter(person => String(person.id) !== id);
          options.onUnblock(id);
        } catch (_) { if (active) blockedError = "Couldn’t unblock this user. Please try again."; }
        finally {
          unblocking.delete(id);
          if (active && selected === "blocked") {
            render();
            titleElement.focus({ preventScroll: true });
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
    function updateRoute(focus = true) {
      if (!active) return;
      const query = new URLSearchParams(window.location.hash.split("?")[1] || "");
      const candidate = query.get("section");
      const next = sections.some(item => item[0] === candidate) ? candidate : null;
      if (selected !== next) {
        if (selected) lastSection = selected;
        if (!deleting) { confirmingDeletion = false; deletionError = ""; }
      }
      selected = next;
      render(focus);
      if (focus) window.scrollTo({ top: 0, behavior: "instant" });
      if (selected === "blocked" && blocked === null && !blockedError) loadBlocked();
      if (["privacy", "terms"].includes(selected) && !links && !linksError) loadLinks();
    }
    updateRoute(false);
    loadLinks();
    const cleanup = function () { active = false; };
    cleanup.updateRoute = updateRoute;
    return cleanup;
  }
  const api = { mount: mount, supportPayload: supportPayload, legalUrl: legalUrl };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VoxxlySettings = api;
})(typeof window !== "undefined" ? window : globalThis);
