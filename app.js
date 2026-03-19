(function () {
  const app = document.getElementById("app");
  const logoutButton = document.getElementById("logoutButton");
  const config = window.APP_CONFIG || {};
  const authConfig = config.auth || {};
  const uploadConfig = config.uploads || {};
  const tokenStorageKey = authConfig.tokenStorageKey || "upload_admin_token";
  const deviceIdStorageKey = authConfig.deviceIdStorageKey || "upload_admin_device_id";
  let authenticatedUser = null;
  let authenticatedUserId = null;
  let authenticatedUserError = "";

  const routes = {
    login: "#/login",
    dashboard: "#/dashboard",
    single: "#/single",
    multi: "#/multi"
  };

  function getApiUrl(path) {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }

    return `${(config.apiBaseUrl || "").replace(/\/$/, "")}${path}`;
  }

  function getToken() {
    return window.localStorage.getItem(tokenStorageKey);
  }

  function setToken(token) {
    if (token) {
      window.localStorage.setItem(tokenStorageKey, token);
    }
  }

  function clearAuthenticatedUser() {
    authenticatedUser = null;
    authenticatedUserId = null;
    authenticatedUserError = "";
  }

  function clearAuth() {
    window.localStorage.removeItem(tokenStorageKey);
    clearAuthenticatedUser();
  }

  function isAuthenticated() {
    return Boolean(getToken());
  }

  function setHash(route) {
    if (window.location.hash !== route) {
      window.location.hash = route;
      return;
    }

    render();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getValueByPath(source, path) {
    if (!source || !path) {
      return undefined;
    }

    return String(path)
      .split(".")
      .reduce(function (current, key) {
        if (current == null) {
          return undefined;
        }

        return current[key];
      }, source);
  }

  async function parseJson(response) {
    const text = await response.text();

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return { raw: text };
    }
  }

  function getErrorMessage(payload, fallback) {
    const configured = getValueByPath(payload, authConfig.errorResponseField || uploadConfig.errorResponseField);
    if (configured) {
      return configured;
    }

    const generic = payload && (payload.message || payload.error || payload.details);
    if (generic) {
      return generic;
    }

    return fallback;
  }

  function getAuthenticatedUserId() {
    return authenticatedUserId;
  }

  function getAuthenticatedUsername() {
    const configuredUsername = getValueByPath(authenticatedUser, authConfig.usernameResponseField || "username");
    if (configuredUsername != null && configuredUsername !== "") {
      return configuredUsername;
    }

    const fallbacks = [
      authenticatedUser && authenticatedUser.username,
      authenticatedUser && authenticatedUser.userName,
      authenticatedUser && authenticatedUser.login,
      authenticatedUser && authenticatedUser.name
    ];

    return fallbacks.find(function (value) {
      return value != null && value !== "";
    }) || null;
  }

  function getAuthenticatedUserMessage() {
    return authenticatedUserError || "Your authenticated user ID is unavailable. Sign in again.";
  }

  function readAuthenticatedUserId(payload) {
    const configuredId = getValueByPath(payload, authConfig.userIdResponseField || "id");
    if (configuredId != null && configuredId !== "") {
      return configuredId;
    }

    if (payload && payload.id != null && payload.id !== "") {
      return payload.id;
    }

    return null;
  }

  function getAuthHeaders() {
    const token = getToken();
    if (!token) {
      return {};
    }

    const authHeaderName = authConfig.authHeaderName || "Authorization";
    const authScheme = authConfig.authScheme || "Bearer";
    return {
      [authHeaderName]: authScheme ? `${authScheme} ${token}` : token
    };
  }

  async function loadAuthenticatedUser() {
    authenticatedUserError = "";
    const response = await window.fetch(getApiUrl(authConfig.mePath || "/auth/me"), {
      method: "GET",
      headers: getAuthHeaders(),
      credentials: authConfig.withCredentials ? "include" : "same-origin"
    });

    const payload = await parseJson(response);

    if (!response.ok) {
      if (response.status === 401) {
        clearAuth();
      }

      throw new Error(getErrorMessage(payload, "Failed to load the authenticated user."));
    }

    const userId = readAuthenticatedUserId(payload);
    if (userId == null || userId === "") {
      throw new Error("Authenticated user loaded, but no user id was returned.");
    }

    authenticatedUser = payload;
    authenticatedUserId = userId;
    authenticatedUserError = "";
    return payload;
  }

  function renderStatus(status) {
    if (!status || !status.message) {
      return "";
    }

    return `<div class="status status-${escapeHtml(status.type || "info")}">${escapeHtml(status.message)}</div>`;
  }

  function renderMultiResults(results) {
    if (!results || !results.length) {
      return "";
    }

    return `
      <div class="stack">
        ${results
          .map(function (result) {
            const outcomeClass = result.success ? "success" : "error";
            const outcomeLabel = result.success ? "Uploaded" : "Failed";
            const detail = result.message ? `: ${escapeHtml(result.message)}` : "";

            return `
              <div class="status status-${outcomeClass}">
                <strong>${outcomeLabel}</strong> ${escapeHtml(result.name)}${detail}
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function getOrCreateDeviceId() {
    const existing = window.localStorage.getItem(deviceIdStorageKey);
    if (existing) {
      return existing;
    }

    const deviceId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(deviceIdStorageKey, deviceId);
    return deviceId;
  }

  function getDefaultClipName(file) {
    return file.name.replace(/\.[^/.]+$/, "") || file.name;
  }

  function normalizeCsv(value) {
    return String(value || "")
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean)
      .join(",");
  }

  function appendFormValue(formData, fieldName, value) {
    formData.append(fieldName, value == null ? "" : String(value));
  }

  function buildMetadataFromForm(form, prefix) {
    const useManualHost = form[`${prefix}ManualHostToggle`].checked;
    const manualHost = form[`${prefix}ManualHost`].value.trim();
    const authenticatedUsername = getAuthenticatedUsername();
    const host = useManualHost ? manualHost : authenticatedUsername;

    if (!host) {
      if (useManualHost) {
        throw new Error("Enter a host before submitting.");
      }

      throw new Error("Your authenticated username is unavailable. Check the box and enter the host manually.");
    }

    return {
      genre: form[`${prefix}Genre`].value.trim(),
      guestCsv: normalizeCsv(form[`${prefix}Guests`].value),
      host: host,
      subtopicCsv: normalizeCsv(form[`${prefix}Subtopics`].value),
      toneCsv: normalizeCsv(form[`${prefix}Tone`].value),
      wpm: form[`${prefix}Wpm`].value.trim()
    };
  }

  function buildClipFormData(iosUserId, name, file, metadata) {
    const formData = new window.FormData();
    appendFormValue(formData, uploadConfig.iosUserIdField || "iosUserId", iosUserId);
    appendFormValue(formData, uploadConfig.titleField || "name", name);
    appendFormValue(formData, uploadConfig.genreField || "genre", metadata && metadata.genre);
    appendFormValue(formData, uploadConfig.guestCsvField || "guestCsv", metadata && metadata.guestCsv);
    appendFormValue(formData, uploadConfig.hostField || "host", metadata && metadata.host);
    appendFormValue(formData, uploadConfig.subtopicCsvField || "subtopicCsv", metadata && metadata.subtopicCsv);
    appendFormValue(formData, uploadConfig.toneCsvField || "toneCsv", metadata && metadata.toneCsv);
    appendFormValue(formData, uploadConfig.wpmField || "wpm", metadata && metadata.wpm);
    formData.append(uploadConfig.singleFileField || "file", file);
    return formData;
  }

  function renderMetadataFields(prefix) {
    const authenticatedUsername = getAuthenticatedUsername();
    const hostHint = authenticatedUsername
      ? `Host will use your username: ${authenticatedUsername}.`
      : "Your authenticated username is unavailable. Check the box and enter the host manually.";

    return `
      <div class="field">
        <label for="${prefix}Genre">Genre</label>
        <input id="${prefix}Genre" name="${prefix}Genre" type="text" />
      </div>
      <div class="field">
        <label for="${prefix}Guests">Guests</label>
        <input id="${prefix}Guests" name="${prefix}Guests" type="text" placeholder="guest-one,guest-two" />
      </div>
      <div class="field">
        <label for="${prefix}Subtopics">Subtopics</label>
        <input id="${prefix}Subtopics" name="${prefix}Subtopics" type="text" placeholder="topic-one,topic-two" />
      </div>
      <div class="field">
        <label for="${prefix}Tone">Tone</label>
        <input id="${prefix}Tone" name="${prefix}Tone" type="text" placeholder="warm,playful" />
      </div>
      <div class="field">
        <label for="${prefix}Wpm">WPM</label>
        <input id="${prefix}Wpm" name="${prefix}Wpm" type="number" min="0" step="1" inputmode="numeric" />
      </div>
      <div class="field">
        <label>
          <input id="${prefix}ManualHostToggle" name="${prefix}ManualHostToggle" type="checkbox" />
          Check this box if I am not the host
        </label>
      </div>
      <p id="${prefix}AutoHostHint">${escapeHtml(hostHint)}</p>
      <div id="${prefix}ManualHostWrap" class="field" hidden>
        <label for="${prefix}ManualHost">Host</label>
        <input id="${prefix}ManualHost" name="${prefix}ManualHost" type="text" disabled />
      </div>
    `;
  }

  function syncHostInput(prefix) {
    const toggle = document.getElementById(`${prefix}ManualHostToggle`);
    const manualHostWrap = document.getElementById(`${prefix}ManualHostWrap`);
    const manualHostInput = document.getElementById(`${prefix}ManualHost`);
    const autoHostHint = document.getElementById(`${prefix}AutoHostHint`);

    if (!toggle || !manualHostWrap || !manualHostInput || !autoHostHint) {
      return;
    }

    const useManualHost = toggle.checked;
    const authenticatedUsername = getAuthenticatedUsername();

    manualHostWrap.hidden = !useManualHost;
    manualHostInput.disabled = !useManualHost;
    manualHostInput.required = useManualHost;

    if (!useManualHost) {
      manualHostInput.value = "";
    }

    autoHostHint.hidden = useManualHost;
    autoHostHint.textContent = authenticatedUsername
      ? `Host will use your username: ${authenticatedUsername}.`
      : "Your authenticated username is unavailable. Check the box and enter the host manually.";
  }

  function bindHostToggle(prefix) {
    const toggle = document.getElementById(`${prefix}ManualHostToggle`);
    if (!toggle) {
      return;
    }

    syncHostInput(prefix);
    toggle.addEventListener("change", function () {
      syncHostInput(prefix);
    });
  }

  async function uploadSingleClip(iosUserId, name, file, metadata) {
    const response = await window.fetch(getApiUrl(uploadConfig.singlePath || "/iosclips"), {
      method: "POST",
      headers: getAuthHeaders(),
      credentials: uploadConfig.withCredentials ? "include" : "same-origin",
      body: buildClipFormData(iosUserId, name, file, metadata)
    });

    const payload = await parseJson(response);

    if (!response.ok) {
      if (response.status === 401) {
        clearAuth();
      }

      throw new Error(getErrorMessage(payload, "Clip upload failed."));
    }

    return payload;
  }

  function renderLogin(status) {
    logoutButton.classList.add("hidden");
    app.innerHTML = `
      <section class="panel login-panel">
        <div class="stack">
          <div class="stack">
            <h2>Admin Login</h2>
            <p>Sign in to upload clips to the Rhapsidious library.</p>
          </div>
          ${renderStatus(status)}
          <form id="loginForm" class="stack">
            <div class="field">
              <label for="login">Username or Email</label>
              <input id="login" name="login" type="text" autocomplete="username" required />
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required />
            </div>
            <div class="actions">
              <button class="primary-button" type="submit">Log In</button>
            </div>
          </form>
        </div>
      </section>
    `;

    document.getElementById("loginForm").addEventListener("submit", handleLoginSubmit);
  }

  function renderDashboard() {
    logoutButton.classList.remove("hidden");
    app.innerHTML = `
      <section class="dashboard-grid">
        <article class="panel dashboard-card">
          <div class="stack">
            <h2>Upload Single Clip</h2>
            <p>Submit one clip with a title and a single media file.</p>
          </div>
          <div class="actions">
            <button id="goSingle" class="primary-button" type="button">Open</button>
          </div>
        </article>
        <article class="panel dashboard-card">
          <div class="stack">
            <h2>Upload Multiple Clips</h2>
            <p>Send files one at a time to the existing upload endpoint.</p>
          </div>
          <div class="actions">
            <button id="goMulti" class="primary-button" type="button">Open</button>
          </div>
        </article>
      </section>
    `;

    document.getElementById("goSingle").addEventListener("click", function () {
      setHash(routes.single);
    });

    document.getElementById("goMulti").addEventListener("click", function () {
      setHash(routes.multi);
    });
  }

  function renderSingleUpload(status) {
    logoutButton.classList.remove("hidden");
    const canSubmit = getAuthenticatedUserId() != null && getAuthenticatedUserId() !== "";
    const resolvedStatus = canSubmit ? status : { type: "error", message: getAuthenticatedUserMessage() };
    app.innerHTML = `
      <section class="panel form-panel">
        <div class="stack">
          <div class="stack">
            <h2>Upload Single Clip</h2>
            <p>Send one clip with its authenticated account, file, and recommendation metadata.</p>
          </div>
          ${renderStatus(resolvedStatus)}
          <form id="singleUploadForm" class="stack">
            <div class="field">
              <label for="clipName">Name</label>
              <input id="clipName" name="clipName" type="text" required />
            </div>
            <div class="field">
              <label for="singleClipFile">Clip File</label>
              <input id="singleClipFile" name="singleClipFile" type="file" required />
            </div>
            ${renderMetadataFields("single")}
            <div class="actions">
              <button class="primary-button" type="submit" ${canSubmit ? "" : "disabled"}>Submit</button>
              <button id="backToDashboardSingle" class="secondary-button" type="button">Back</button>
            </div>
          </form>
        </div>
      </section>
    `;

    document.getElementById("singleUploadForm").addEventListener("submit", handleSingleUploadSubmit);
    bindHostToggle("single");
    document.getElementById("backToDashboardSingle").addEventListener("click", function () {
      setHash(routes.dashboard);
    });
  }

  function renderMultiUpload(state) {
    const status = state && state.status;
    const progress = state && typeof state.progress === "number" ? state.progress : 0;
    const fileCount = state && typeof state.fileCount === "number" ? state.fileCount : 0;
    const results = (state && state.results) || [];
    const canSubmit = getAuthenticatedUserId() != null && getAuthenticatedUserId() !== "";
    const resolvedStatus = canSubmit ? status : { type: "error", message: getAuthenticatedUserMessage() };

    logoutButton.classList.remove("hidden");
    app.innerHTML = `
      <section class="panel form-panel">
        <div class="stack">
          <div class="stack">
            <h2>Upload Multiple Clips</h2>
            <p>Uploads are sent sequentially with one shared metadata set for every selected file.</p>
          </div>
          <div id="multiUploadStatus">${renderStatus(resolvedStatus)}</div>
          <form id="multiUploadForm" class="stack">
            <div class="field">
              <label for="multiClipFiles">Clip Files</label>
              <input id="multiClipFiles" name="multiClipFiles" type="file" multiple required />
            </div>
            ${renderMetadataFields("multi")}
            <div class="progress-wrap">
              <div class="meta-row">
                <span id="multiFileCount">${fileCount} file${fileCount === 1 ? "" : "s"} selected</span>
                <span id="multiProgressText">${progress}% complete</span>
              </div>
              <div class="progress-bar" aria-hidden="true">
                <div id="multiProgressValue" class="progress-value" style="width: ${progress}%;"></div>
              </div>
            </div>
            <div id="multiUploadResults">${renderMultiResults(results)}</div>
            <div class="actions">
              <button id="multiUploadSubmitButton" class="primary-button" type="submit" ${canSubmit ? "" : "disabled"}>Submit</button>
              <button id="backToDashboardMulti" class="secondary-button" type="button">Back</button>
            </div>
          </form>
        </div>
      </section>
    `;

    document.getElementById("multiUploadForm").addEventListener("submit", handleMultiUploadSubmit);
    bindHostToggle("multi");
    document.getElementById("multiClipFiles").addEventListener("change", function (event) {
      updateMultiUploadState({
        progress: 0,
        fileCount: event.target.files.length,
        status: status,
        results: []
      });
    });
    document.getElementById("backToDashboardMulti").addEventListener("click", function () {
      setHash(routes.dashboard);
    });
  }

  function updateMultiUploadState(state) {
    const progress = state && typeof state.progress === "number" ? state.progress : 0;
    const fileCount = state && typeof state.fileCount === "number" ? state.fileCount : 0;
    const statusHost = document.getElementById("multiUploadStatus");
    const fileCountNode = document.getElementById("multiFileCount");
    const progressNode = document.getElementById("multiProgressText");
    const progressValue = document.getElementById("multiProgressValue");
    const submitButton = document.getElementById("multiUploadSubmitButton");
    const resultsHost = document.getElementById("multiUploadResults");

    if (statusHost) {
      statusHost.innerHTML = renderStatus(state && state.status);
    }

    if (fileCountNode) {
      fileCountNode.textContent = `${fileCount} file${fileCount === 1 ? "" : "s"} selected`;
    }

    if (progressNode) {
      progressNode.textContent = `${progress}% complete`;
    }

    if (progressValue) {
      progressValue.style.width = `${progress}%`;
    }

    if (resultsHost) {
      resultsHost.innerHTML = renderMultiResults(state && state.results);
    }

    if (submitButton && typeof state?.isSubmitting === "boolean") {
      submitButton.disabled = state.isSubmitting || getAuthenticatedUserId() == null || getAuthenticatedUserId() === "";
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const login = form.login.value.trim();
    const password = form.password.value;
    const deviceId = getOrCreateDeviceId();

    submitButton.disabled = true;
    renderLogin({ type: "info", message: "Signing in..." });

    try {
      const response = await window.fetch(getApiUrl(authConfig.loginPath || "/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: authConfig.withCredentials ? "include" : "same-origin",
        body: JSON.stringify({
          login: login,
          password: password,
          deviceId: deviceId
        })
      });

      const payload = await parseJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Login failed. Check your credentials and try again."));
      }

      const token =
        getValueByPath(payload, authConfig.tokenResponseField || "accessToken") ||
        payload?.accessToken;

      if (!token) {
        throw new Error("Login succeeded but no access token was returned.");
      }

      setToken(token);
      await loadAuthenticatedUser();
      setHash(routes.dashboard);
    } catch (error) {
      clearAuth();
      authenticatedUserError = error.message || "Login failed.";
      renderLogin({ type: "error", message: error.message || "Login failed." });
    } finally {
      submitButton.disabled = false;
    }
  }

  async function handleSingleUploadSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const iosUserId = getAuthenticatedUserId();
    const name = form.clipName.value.trim();
    const file = form.singleClipFile.files[0];
    let metadata;

    if (iosUserId == null || iosUserId === "") {
      renderSingleUpload({ type: "error", message: getAuthenticatedUserMessage() });
      return;
    }

    if (!file) {
      renderSingleUpload({ type: "error", message: "Select a file before submitting." });
      return;
    }

    try {
      metadata = buildMetadataFromForm(form, "single");
    } catch (error) {
      renderSingleUpload({ type: "error", message: error.message || "Clip metadata is incomplete." });
      return;
    }

    submitButton.disabled = true;
    renderSingleUpload({ type: "info", message: "Uploading clip..." });

    try {
      const payload = await uploadSingleClip(iosUserId, name, file, metadata);

      form.reset();
      renderSingleUpload({
        type: "success",
        message: payload?.message || "Clip uploaded successfully."
      });
    } catch (error) {
      renderSingleUpload({
        type: "error",
        message: error.message || "Single clip upload failed."
      });
    } finally {
      submitButton.disabled = false;
    }
  }

  async function handleMultiUploadSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const iosUserId = getAuthenticatedUserId();
    const files = Array.from(form.multiClipFiles.files || []);
    let metadata;

    if (iosUserId == null || iosUserId === "") {
      updateMultiUploadState({
        progress: 0,
        fileCount: files.length,
        status: { type: "error", message: getAuthenticatedUserMessage() },
        results: [],
        isSubmitting: false
      });
      return;
    }

    if (!files.length) {
      updateMultiUploadState({
        progress: 0,
        fileCount: 0,
        status: { type: "error", message: "Select one or more files before submitting." },
        results: [],
        isSubmitting: false
      });
      return;
    }

    try {
      metadata = buildMetadataFromForm(form, "multi");
    } catch (error) {
      updateMultiUploadState({
        progress: 0,
        fileCount: files.length,
        status: { type: "error", message: error.message || "Clip metadata is incomplete." },
        results: [],
        isSubmitting: false
      });
      return;
    }

    const results = [];
    updateMultiUploadState({
      progress: 0,
      fileCount: files.length,
      status: { type: "info", message: "Uploading files..." },
      results: results,
      isSubmitting: true
    });

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const name = getDefaultClipName(file);

      try {
        await uploadSingleClip(iosUserId, name, file, metadata);
        results.push({
          success: true,
          name: name,
          message: "Upload complete."
        });
      } catch (error) {
        results.push({
          success: false,
          name: name,
          message: error.message || "Upload failed."
        });
      }

      updateMultiUploadState({
        progress: Math.round(((index + 1) / files.length) * 100),
        fileCount: files.length,
        status: { type: "info", message: `Processed ${index + 1} of ${files.length} files.` },
        results: results,
        isSubmitting: true
      });
    }

    const successCount = results.filter(function (result) {
      return result.success;
    }).length;
    const failureCount = results.length - successCount;

    form.reset();
    updateMultiUploadState({
      progress: 100,
      fileCount: 0,
      status: {
        type: failureCount ? "error" : "success",
        message: `Completed ${successCount}/${results.length} uploads. Failed: ${failureCount}.`
      },
      results: results,
      isSubmitting: false
    });
  }

  function render() {
    const hash = window.location.hash || (isAuthenticated() ? routes.dashboard : routes.login);

    if (!isAuthenticated() && hash !== routes.login) {
      setHash(routes.login);
      return;
    }

    switch (hash) {
      case routes.dashboard:
        renderDashboard();
        break;
      case routes.single:
        renderSingleUpload();
        break;
      case routes.multi:
        renderMultiUpload({ progress: 0, fileCount: 0, results: [] });
        break;
      case routes.login:
      default:
        renderLogin();
        break;
    }
  }

  logoutButton.addEventListener("click", function () {
    clearAuth();
    setHash(routes.login);
  });

  window.addEventListener("hashchange", render);

  (async function initialize() {
    if (isAuthenticated()) {
      try {
        await loadAuthenticatedUser();
      } catch (error) {
        clearAuth();
        authenticatedUserError = error.message || "Failed to load the authenticated user.";
        renderLogin({ type: "error", message: authenticatedUserError });
        return;
      }
    }

    render();
  })();
})();
