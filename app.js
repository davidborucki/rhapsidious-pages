(function () {
  const app = document.getElementById("app");
  const logoutButton = document.getElementById("logoutButton");
  const config = window.APP_CONFIG || {};
  const authConfig = config.auth || {};
  const uploadConfig = config.uploads || {};
  const tokenStorageKey = authConfig.tokenStorageKey || "upload_admin_token";
  const deviceIdStorageKey = authConfig.deviceIdStorageKey || "upload_admin_device_id";

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

  function clearAuth() {
    window.localStorage.removeItem(tokenStorageKey);
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

  function buildClipFormData(iosUserId, name, file) {
    const formData = new window.FormData();
    formData.append(uploadConfig.iosUserIdField || "iosUserId", iosUserId);
    formData.append(uploadConfig.titleField || "name", name);
    formData.append(uploadConfig.singleFileField || "file", file);
    return formData;
  }

  function getDefaultClipName(file) {
    return file.name.replace(/\.[^/.]+$/, "") || file.name;
  }

  async function uploadSingleClip(iosUserId, name, file) {
    const response = await window.fetch(getApiUrl(uploadConfig.singlePath || "/iosclips"), {
      method: "POST",
      headers: getAuthHeaders(),
      credentials: uploadConfig.withCredentials ? "include" : "same-origin",
      body: buildClipFormData(iosUserId, name, file)
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
    app.innerHTML = `
      <section class="panel form-panel">
        <div class="stack">
          <div class="stack">
            <h2>Upload Single Clip</h2>
            <p>Send one clip with its iOS user ID, name, and file.</p>
          </div>
          ${renderStatus(status)}
          <form id="singleUploadForm" class="stack">
            <div class="field">
              <label for="singleIosUserId">iOS User ID</label>
              <input id="singleIosUserId" name="singleIosUserId" type="text" required />
            </div>
            <div class="field">
              <label for="clipName">Name</label>
              <input id="clipName" name="clipName" type="text" required />
            </div>
            <div class="field">
              <label for="singleClipFile">Clip File</label>
              <input id="singleClipFile" name="singleClipFile" type="file" required />
            </div>
            <div class="actions">
              <button class="primary-button" type="submit">Submit</button>
              <button id="backToDashboardSingle" class="secondary-button" type="button">Back</button>
            </div>
          </form>
        </div>
      </section>
    `;

    document.getElementById("singleUploadForm").addEventListener("submit", handleSingleUploadSubmit);
    document.getElementById("backToDashboardSingle").addEventListener("click", function () {
      setHash(routes.dashboard);
    });
  }

  function renderMultiUpload(state) {
    const status = state && state.status;
    const progress = state && typeof state.progress === "number" ? state.progress : 0;
    const fileCount = state && typeof state.fileCount === "number" ? state.fileCount : 0;
    const results = (state && state.results) || [];

    logoutButton.classList.remove("hidden");
    app.innerHTML = `
      <section class="panel form-panel">
        <div class="stack">
          <div class="stack">
            <h2>Upload Multiple Clips</h2>
            <p>Uploads are sent sequentially to the existing single upload endpoint.</p>
          </div>
          <div id="multiUploadStatus">${renderStatus(status)}</div>
          <form id="multiUploadForm" class="stack">
            <div class="field">
              <label for="multiIosUserId">iOS User ID</label>
              <input id="multiIosUserId" name="multiIosUserId" type="text" required />
            </div>
            <div class="field">
              <label for="multiClipFiles">Clip Files</label>
              <input id="multiClipFiles" name="multiClipFiles" type="file" multiple required />
            </div>
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
              <button id="multiUploadSubmitButton" class="primary-button" type="submit">Submit</button>
              <button id="backToDashboardMulti" class="secondary-button" type="button">Back</button>
            </div>
          </form>
        </div>
      </section>
    `;

    document.getElementById("multiUploadForm").addEventListener("submit", handleMultiUploadSubmit);
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
      submitButton.disabled = state.isSubmitting;
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
      setHash(routes.dashboard);
    } catch (error) {
      renderLogin({ type: "error", message: error.message || "Login failed." });
    } finally {
      submitButton.disabled = false;
    }
  }

  async function handleSingleUploadSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const iosUserId = form.singleIosUserId.value.trim();
    const name = form.clipName.value.trim();
    const file = form.singleClipFile.files[0];

    if (!file) {
      renderSingleUpload({ type: "error", message: "Select a file before submitting." });
      return;
    }

    submitButton.disabled = true;
    renderSingleUpload({ type: "info", message: "Uploading clip..." });

    try {
      const payload = await uploadSingleClip(iosUserId, name, file);

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
    const iosUserId = form.multiIosUserId.value.trim();
    const files = Array.from(form.multiClipFiles.files || []);

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
        await uploadSingleClip(iosUserId, name, file);
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
  render();
})();
