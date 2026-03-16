(function () {
  const app = document.getElementById("app");
  const logoutButton = document.getElementById("logoutButton");
  const config = window.APP_CONFIG || {};
  const authConfig = config.auth || {};
  const uploadConfig = config.uploads || {};
  const tokenStorageKey = authConfig.tokenStorageKey || "upload_admin_token";
  const cookieSessionKey = authConfig.cookieSessionKey || `${tokenStorageKey}_session`;

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
    if (!token) {
      return;
    }

    window.localStorage.setItem(tokenStorageKey, token);
  }

  function setCookieSession() {
    window.sessionStorage.setItem(cookieSessionKey, "active");
  }

  function clearToken() {
    window.localStorage.removeItem(tokenStorageKey);
  }

  function clearCookieSession() {
    window.sessionStorage.removeItem(cookieSessionKey);
  }

  function clearAuth() {
    clearToken();
    clearCookieSession();
  }

  function isAuthenticated() {
    if (authConfig.mode === "cookie") {
      return window.sessionStorage.getItem(cookieSessionKey) === "active";
    }

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

  function parseJsonSafe(value) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return value ? { raw: value } : null;
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
    const headers = {};

    if (authConfig.mode !== "cookie") {
      const token = getToken();
      if (token) {
        const authHeaderName = authConfig.authHeaderName || "Authorization";
        const authScheme = authConfig.authScheme || "Bearer";
        headers[authHeaderName] = authScheme ? `${authScheme} ${token}` : token;
      }
    }

    return headers;
  }

  function renderStatus(status) {
    if (!status || !status.message) {
      return "";
    }

    return `<div class="status status-${escapeHtml(status.type || "info")}">${escapeHtml(status.message)}</div>`;
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
              <label for="username">Username</label>
              <input id="username" name="username" type="text" autocomplete="username" required />
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

    const form = document.getElementById("loginForm");
    form.addEventListener("submit", handleLoginSubmit);
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
            <p>Send a batch of files and monitor the upload progress.</p>
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
            <p>Send one clip with its title.</p>
          </div>
          ${renderStatus(status)}
          <form id="singleUploadForm" class="stack">
            <div class="field">
              <label for="clipTitle">Title</label>
              <input id="clipTitle" name="clipTitle" type="text" required />
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
    const fileCount = state && state.fileCount ? state.fileCount : 0;
    logoutButton.classList.remove("hidden");
    app.innerHTML = `
      <section class="panel form-panel">
        <div class="stack">
          <div class="stack">
            <h2>Upload Multiple Clips</h2>
            <p>Select multiple files and upload them in one request.</p>
          </div>
          <div id="multiUploadStatus">${renderStatus(status)}</div>
          <form id="multiUploadForm" class="stack">
            <div class="field">
              <label for="multiClipFiles">Clip Files</label>
              <input id="multiClipFiles" name="multiClipFiles" type="file" multiple required />
            </div>
            <div class="progress-wrap">
              <div class="meta-row">
                <span id="multiFileCount">${fileCount} file${fileCount === 1 ? "" : "s"} selected</span>
                <span id="multiProgressText">${progress}% uploaded</span>
              </div>
              <div class="progress-bar" aria-hidden="true">
                <div id="multiProgressValue" class="progress-value" style="width: ${progress}%;"></div>
              </div>
            </div>
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
        status: status
      });
    });
    document.getElementById("backToDashboardMulti").addEventListener("click", function () {
      setHash(routes.dashboard);
    });
  }

  function updateMultiUploadState(state) {
    const progress = state && typeof state.progress === "number" ? state.progress : 0;
    const fileCount = state && state.fileCount ? state.fileCount : 0;
    const statusHost = document.getElementById("multiUploadStatus");
    const fileCountNode = document.getElementById("multiFileCount");
    const progressNode = document.getElementById("multiProgressText");
    const progressValue = document.getElementById("multiProgressValue");
    const submitButton = document.getElementById("multiUploadSubmitButton");

    if (statusHost) {
      statusHost.innerHTML = renderStatus(state && state.status);
    }

    if (fileCountNode) {
      fileCountNode.textContent = `${fileCount} file${fileCount === 1 ? "" : "s"} selected`;
    }

    if (progressNode) {
      progressNode.textContent = `${progress}% uploaded`;
    }

    if (progressValue) {
      progressValue.style.width = `${progress}%`;
    }

    if (submitButton && typeof state?.isSubmitting === "boolean") {
      submitButton.disabled = state.isSubmitting;
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const username = form.username.value.trim();
    const password = form.password.value;
    const usernameField = authConfig.usernameField || "username";
    const passwordField = authConfig.passwordField || "password";

    submitButton.disabled = true;
    renderLogin({ type: "info", message: "Signing in..." });

    try {
      const response = await window.fetch(getApiUrl(authConfig.loginPath || "/api/admin/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: authConfig.withCredentials ? "include" : "same-origin",
        body: JSON.stringify({
          [usernameField]: username,
          [passwordField]: password
        })
      });

      const payload = await parseJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Login failed. Check your credentials and try again."));
      }

      if (authConfig.mode !== "cookie") {
        const token =
          getValueByPath(payload, authConfig.tokenResponseField || "token") ||
          payload?.token ||
          payload?.accessToken ||
          payload?.jwt;

        if (!token) {
          throw new Error("Login succeeded but no auth token was returned.");
        }

        setToken(token);
      } else {
        setCookieSession();
      }

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
    const title = form.clipTitle.value.trim();
    const file = form.singleClipFile.files[0];

    if (!file) {
      renderSingleUpload({ type: "error", message: "Select a file before submitting." });
      return;
    }

    submitButton.disabled = true;
    renderSingleUpload({ type: "info", message: "Uploading clip..." });

    const formData = new window.FormData();
    formData.append(uploadConfig.titleField || "title", title);
    formData.append(uploadConfig.singleFileField || "file", file);

    try {
      const response = await window.fetch(getApiUrl(uploadConfig.singlePath || "/api/admin/clips"), {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: uploadConfig.withCredentials ? "include" : "same-origin",
        body: formData
      });

      const payload = await parseJson(response);

      if (!response.ok) {
        if (response.status === 401) {
          clearAuth();
        }
        throw new Error(getErrorMessage(payload, "Single clip upload failed."));
      }

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

  function uploadWithProgress(url, formData, onProgress) {
    return new Promise(function (resolve, reject) {
      const request = new window.XMLHttpRequest();
      request.open("POST", url);

      Object.entries(getAuthHeaders()).forEach(function (entry) {
        request.setRequestHeader(entry[0], entry[1]);
      });

      request.withCredentials = Boolean(uploadConfig.withCredentials);

      request.upload.addEventListener("progress", function (event) {
        if (!event.lengthComputable) {
          return;
        }

        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      });

      request.addEventListener("load", function () {
        const payload = request.responseText ? parseJsonSafe(request.responseText) : null;

        if (request.status >= 200 && request.status < 300) {
          resolve(payload);
          return;
        }

        if (request.status === 401) {
          clearAuth();
        }

        reject(new Error(getErrorMessage(payload, "Batch upload failed.")));
      });

      request.addEventListener("error", function () {
        reject(new Error("Network error while uploading files."));
      });

      request.send(formData);
    });
  }

  async function handleMultiUploadSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = Array.from(form.multiClipFiles.files || []);

    if (!files.length) {
      updateMultiUploadState({
        progress: 0,
        fileCount: 0,
        status: { type: "error", message: "Select one or more files before submitting." },
        isSubmitting: false
      });
      return;
    }

    updateMultiUploadState({
      progress: 0,
      fileCount: files.length,
      status: { type: "info", message: "Uploading files..." },
      isSubmitting: true
    });

    const formData = new window.FormData();
    files.forEach(function (file) {
      formData.append(uploadConfig.multiFileField || "files", file);
    });

    try {
      const payload = await uploadWithProgress(getApiUrl(uploadConfig.multiPath || "/api/admin/clips/bulk"), formData, function (progress) {
        updateMultiUploadState({
          progress: progress,
          fileCount: files.length,
          status: { type: "info", message: "Uploading files..." },
          isSubmitting: true
        });
      });

      form.reset();
      updateMultiUploadState({
        progress: 100,
        fileCount: 0,
        status: { type: "success", message: payload?.message || "Files uploaded successfully." },
        isSubmitting: false
      });
    } catch (error) {
      updateMultiUploadState({
        progress: 0,
        fileCount: files.length,
        status: { type: "error", message: error.message || "Batch upload failed." },
        isSubmitting: false
      });
    }
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
        renderMultiUpload({ progress: 0, fileCount: 0 });
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
