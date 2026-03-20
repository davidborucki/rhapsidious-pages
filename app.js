(function () {
  const app = document.getElementById("app");
  const logoutButton = document.getElementById("logoutButton");
  const config = window.APP_CONFIG || {};
  const authConfig = config.auth || {};
  const processingConfig = config.processing || {};
  const uploadConfig = config.uploads || {};
  const tokenStorageKey = authConfig.tokenStorageKey || "upload_admin_token";
  const deviceIdStorageKey = authConfig.deviceIdStorageKey || "upload_admin_device_id";
  const processingPollIntervalMs = Math.min(2000, Math.max(1000, Number(processingConfig.pollIntervalMs) || 1500));
  let authenticatedUser = null;
  let authenticatedUserId = null;
  let authenticatedUserError = "";
  let activeProcessingPollRun = 0;
  let activeMultiUploadRun = 0;
  let multiUploadState = {
    stage: "dropzone",
    cards: [],
    isSubmitting: false,
    isDragActive: false
  };

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

  function cancelProcessingPolling() {
    activeProcessingPollRun += 1;
  }

  function cancelMultiUploadRun() {
    activeMultiUploadRun += 1;
    multiUploadState.isSubmitting = false;
  }

  function resetMultiUploadState() {
    multiUploadState = {
      stage: "dropzone",
      cards: [],
      isSubmitting: false,
      isDragActive: false
    };
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

  function getFirstValueByPaths(source, paths) {
    for (let index = 0; index < paths.length; index += 1) {
      const value = getValueByPath(source, paths[index]);
      if (value != null && value !== "") {
        return value;
      }
    }

    return null;
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

  function readUploadedClipId(payload) {
    return getFirstValueByPaths(payload, [
      processingConfig.clipIdResponseField || uploadConfig.clipIdResponseField || "clipId",
      "id",
      "clip.id",
      "data.clipId",
      "data.id"
    ]);
  }

  function readProcessingStatus(payload) {
    return getFirstValueByPaths(payload, [
      processingConfig.statusResponseField || "status",
      "processingStatus",
      "state",
      "data.status"
    ]);
  }

  function getProcessingStatusDetails(rawStatus) {
    const normalizedStatus = String(rawStatus || "")
      .trim()
      .replace(/[\s-]+/g, "_")
      .toUpperCase();

    switch (normalizedStatus) {
      case "UPLOADING":
      case "UPLOADED":
      case "PENDING":
      case "QUEUED":
        return { type: "info", message: "Uploading clip...", done: false, failed: false };
      case "TRANSCRIBING":
      case "TRANSCRIPTION":
        return { type: "info", message: "Transcribing...", done: false, failed: false };
      case "GENERATING_METADATA":
      case "METADATA":
      case "ENRICHING":
        return { type: "info", message: "Generating metadata...", done: false, failed: false };
      case "FINALIZING":
      case "SAVING":
      case "COMPLETING":
        return { type: "info", message: "Finalizing...", done: false, failed: false };
      case "COMPLETED":
      case "DONE":
      case "SUCCESS":
        return { type: "success", message: "Completed", done: true, failed: false };
      case "FAILED":
      case "ERROR":
        return { type: "error", message: "Processing failed.", done: false, failed: true };
      default:
        return { type: "info", message: "Generating metadata...", done: false, failed: false };
    }
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  async function fetchProcessingStatus(clipId) {
    const statusUrl = new URL(getApiUrl(processingConfig.statusPath || "/processing/status"), window.location.origin);
    statusUrl.searchParams.set(processingConfig.clipIdQueryParam || "clipId", clipId);

    const response = await window.fetch(statusUrl.toString(), {
      method: "GET",
      headers: getAuthHeaders(),
      credentials:
        processingConfig.withCredentials || authConfig.withCredentials || uploadConfig.withCredentials
          ? "include"
          : "same-origin"
    });

    const payload = await parseJson(response);

    if (!response.ok) {
      if (response.status === 401) {
        clearAuth();
      }

      throw new Error(getErrorMessage(payload, "Failed to load processing status."));
    }

    return payload;
  }

  async function pollProcessingStatus(clipId, options) {
    const isActive = options && options.isActive;
    const onUpdate = options && options.onUpdate;

    while (!isActive || isActive()) {
      const payload = await fetchProcessingStatus(clipId);

      if (isActive && !isActive()) {
        return null;
      }

      const rawStatus = readProcessingStatus(payload);
      const statusDetails = getProcessingStatusDetails(rawStatus);

      if (onUpdate) {
        onUpdate(statusDetails, payload);
      }

      if (statusDetails.failed) {
        throw new Error(getErrorMessage(payload, "Processing failed."));
      }

      if (statusDetails.done) {
        return payload;
      }

      await wait(processingPollIntervalMs);
    }

    return null;
  }

  function buildUploadDetailsFromValues(values) {
    const useManualHost = Boolean(values && values.useManualHost);
    const manualHost = String((values && values.manualHost) || "").trim();
    const authenticatedUsername = getAuthenticatedUsername();
    const host = useManualHost ? manualHost : authenticatedUsername;

    if (!host) {
      if (useManualHost) {
        throw new Error("Enter a host before submitting.");
      }

      throw new Error("Your authenticated username is unavailable. Check the box and enter the host manually.");
    }

    return {
      guestCsv: normalizeCsv(values && values.guestCsv),
      host: host
    };
  }

  function buildUploadDetailsFromForm(form, prefix) {
    return buildUploadDetailsFromValues({
      guestCsv: form[`${prefix}Guests`].value,
      useManualHost: form[`${prefix}ManualHostToggle`].checked,
      manualHost: form[`${prefix}ManualHost`].value
    });
  }

  function buildClipFormData(iosUserId, name, file, uploadDetails) {
    const formData = new window.FormData();
    appendFormValue(formData, uploadConfig.iosUserIdField || "iosUserId", iosUserId);
    appendFormValue(formData, uploadConfig.titleField || "name", name);
    appendFormValue(formData, uploadConfig.guestCsvField || "guestCsv", uploadDetails && uploadDetails.guestCsv);
    appendFormValue(formData, uploadConfig.hostField || "host", uploadDetails && uploadDetails.host);
    formData.append(uploadConfig.singleFileField || "file", file);
    console.log([...formData.entries()]);
    return formData;
  }

  function renderHostGuestFields(prefix, values, options) {
    const fieldValues = values || {};
    const fieldOptions = options || {};
    const useManualHost = Boolean(fieldValues.useManualHost);
    const guestCsv = fieldValues.guestCsv || "";
    const manualHost = fieldValues.manualHost || "";
    const disableInputs = Boolean(fieldOptions.disableInputs);
    const authenticatedUsername = getAuthenticatedUsername();
    const hostHint = authenticatedUsername
      ? `Host will use your username: ${authenticatedUsername}.`
      : "Your authenticated username is unavailable. Check the box and enter the host manually.";

    return `
      <div class="field">
        <label for="${prefix}Guests">Guests</label>
        <input id="${prefix}Guests" name="${prefix}Guests" type="text" placeholder="guest-one,guest-two" value="${escapeHtml(guestCsv)}" ${disableInputs ? "disabled" : ""} />
      </div>
      <div class="field">
        <label>
          <input id="${prefix}ManualHostToggle" name="${prefix}ManualHostToggle" type="checkbox" ${useManualHost ? "checked" : ""} ${disableInputs ? "disabled" : ""} />
          Check this box if I am not the host
        </label>
      </div>
      <p id="${prefix}AutoHostHint" ${useManualHost ? "hidden" : ""}>${escapeHtml(hostHint)}</p>
      <div id="${prefix}ManualHostWrap" class="field" ${useManualHost ? "" : "hidden"}>
        <label for="${prefix}ManualHost">Host</label>
        <input id="${prefix}ManualHost" name="${prefix}ManualHost" type="text" value="${escapeHtml(manualHost)}" ${useManualHost ? "required" : "disabled"} ${disableInputs ? "disabled" : ""} />
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

  function bindHostToggle(prefix, options) {
    const toggle = document.getElementById(`${prefix}ManualHostToggle`);
    if (!toggle) {
      return;
    }

    syncHostInput(prefix);
    toggle.addEventListener("change", function () {
      syncHostInput(prefix);
      if (options && typeof options.onChange === "function") {
        options.onChange(toggle.checked);
      }
    });
  }

  function createMultiUploadCard(file, index) {
    return {
      id: `multi-card-${index}`,
      file: file,
      name: getDefaultClipName(file),
      guestCsv: "",
      useManualHost: false,
      manualHost: "",
      status: { type: "info", message: "Ready" },
      progress: 0
    };
  }

  function getMultiUploadCards() {
    return multiUploadState.cards || [];
  }

  function renderDropzoneIcon() {
    return `
      <svg class="dropzone-icon" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 10l12 12h-8v16h-8V22h-8z" fill="currentColor"></path>
        <path d="M18 42h28a8 8 0 000-16 13 13 0 00-25-2A10 10 0 0018 42z" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }

  function setMultiUploadFiles(files) {
    cancelMultiUploadRun();
    multiUploadState.cards = Array.from(files || []).map(function (file, index) {
      return createMultiUploadCard(file, index);
    });
    multiUploadState.stage = multiUploadState.cards.length ? "cards" : "dropzone";
    multiUploadState.isDragActive = false;
    multiUploadState.isSubmitting = false;
    renderMultiUpload();
  }

  function isMultiUploadActive(runId) {
    return runId === activeMultiUploadRun && (window.location.hash || routes.multi) === routes.multi;
  }

  function getUploadProgressForMessage(message) {
    switch (message) {
      case "Uploading...":
      case "Uploading clip...":
        return 15;
      case "Transcribing...":
        return 45;
      case "Generating metadata...":
        return 70;
      case "Finalizing...":
        return 90;
      case "Completed":
        return 100;
      default:
        return 0;
    }
  }

  function renderMultiUploadCard(card, index, options) {
    const cardOptions = options || {};
    const isLastCard = Boolean(cardOptions.isLastCard);
    const submitDisabled = Boolean(cardOptions.submitDisabled);

    return `
      <section class="panel form-panel">
        <div class="stack">
          <div class="stack">
            <h2>Upload Clip ${index + 1}</h2>
            <p>Send this clip with its own name, host, and guest list.</p>
          </div>
          ${renderStatus(card.status || { type: "info", message: "Ready" })}
          <div class="field">
            <label for="${card.id}Name">Name</label>
            <input id="${card.id}Name" name="${card.id}Name" type="text" value="${escapeHtml(card.name || "")}" required ${multiUploadState.isSubmitting ? "disabled" : ""} />
          </div>
          <div class="field">
            <label for="${card.id}File">Clip File</label>
            <input id="${card.id}File" name="${card.id}File" type="text" value="${escapeHtml(card.file.name)}" disabled />
          </div>
          ${renderHostGuestFields(card.id, card, { disableInputs: multiUploadState.isSubmitting })}
          ${isLastCard ? `<div class="actions"><button class="primary-button" type="submit" ${submitDisabled ? "disabled" : ""}>Submit</button></div>` : ""}
        </div>
      </section>
    `;
  }

  function bindMultiUploadCardInputs() {
    getMultiUploadCards().forEach(function (card, index) {
      const nameInput = document.getElementById(`${card.id}Name`);
      const guestsInput = document.getElementById(`${card.id}Guests`);
      const manualHostInput = document.getElementById(`${card.id}ManualHost`);

      if (nameInput) {
        nameInput.addEventListener("input", function (event) {
          multiUploadState.cards[index].name = event.currentTarget.value;
        });
      }

      if (guestsInput) {
        guestsInput.addEventListener("input", function (event) {
          multiUploadState.cards[index].guestCsv = event.currentTarget.value;
        });
      }

      if (manualHostInput) {
        manualHostInput.addEventListener("input", function (event) {
          multiUploadState.cards[index].manualHost = event.currentTarget.value;
        });
      }

      bindHostToggle(card.id, {
        onChange: function (checked) {
          multiUploadState.cards[index].useManualHost = checked;
          if (!checked) {
            multiUploadState.cards[index].manualHost = "";
          }
        }
      });
    });
  }

  function handleMultiFilesChange(event) {
    setMultiUploadFiles(event.target.files || []);
  }

  function updateMultiDropzoneState(isDragActive) {
    if (multiUploadState.stage !== "dropzone" || multiUploadState.isSubmitting || multiUploadState.isDragActive === isDragActive) {
      return;
    }

    multiUploadState.isDragActive = isDragActive;
    const dropzone = document.getElementById("multiDropzone");
    if (dropzone) {
      dropzone.classList.toggle("dropzone-surface-active", isDragActive);
    }
  }

  function bindMultiDropzone() {
    const fileInput = document.getElementById("multiDropzoneFiles");
    const dropzone = document.getElementById("multiDropzone");
    const selectButton = document.getElementById("selectMultiClipButton");

    if (!fileInput || !dropzone || !selectButton) {
      return;
    }

    function openPicker() {
      if (!multiUploadState.isSubmitting && getAuthenticatedUserId() != null && getAuthenticatedUserId() !== "") {
        fileInput.click();
      }
    }

    fileInput.addEventListener("change", handleMultiFilesChange);
    selectButton.addEventListener("click", openPicker);
    dropzone.addEventListener("click", function (event) {
      if (event.target === selectButton) {
        return;
      }

      openPicker();
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
      dropzone.addEventListener(eventName, function (event) {
        event.preventDefault();
        updateMultiDropzoneState(true);
      });
    });

    dropzone.addEventListener("dragleave", function (event) {
      event.preventDefault();
      if (event.relatedTarget && dropzone.contains(event.relatedTarget)) {
        return;
      }

      updateMultiDropzoneState(false);
    });

    dropzone.addEventListener("drop", function (event) {
      event.preventDefault();
      updateMultiDropzoneState(false);
      if (
        getAuthenticatedUserId() != null &&
        getAuthenticatedUserId() !== "" &&
        event.dataTransfer &&
        event.dataTransfer.files &&
        event.dataTransfer.files.length
      ) {
        setMultiUploadFiles(event.dataTransfer.files);
      }
    });
  }

  function handleMultiStageReset() {
    cancelMultiUploadRun();
    resetMultiUploadState();
    renderMultiUpload();
  }

  async function uploadSingleClip(iosUserId, name, file, uploadDetails) {
    const response = await window.fetch(getApiUrl(uploadConfig.singlePath || "/iosclips"), {
      method: "POST",
      headers: getAuthHeaders(),
      credentials: uploadConfig.withCredentials ? "include" : "same-origin",
      body: buildClipFormData(iosUserId, name, file, uploadDetails)
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
            <p>Create one upload card per selected file and send them sequentially.</p>
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

  function renderSingleUpload(status, options) {
    logoutButton.classList.remove("hidden");
    const viewOptions = options || {};
    const canSubmit = getAuthenticatedUserId() != null && getAuthenticatedUserId() !== "";
    const resolvedStatus = canSubmit ? status : { type: "error", message: getAuthenticatedUserMessage() };
    const submitDisabled = !canSubmit || Boolean(viewOptions.disableSubmit);
    app.innerHTML = `
      <section class="panel form-panel">
        <div class="stack">
          <div class="stack">
            <h2>Upload Single Clip</h2>
            <p>Send one clip with its authenticated account, file, host, and guests.</p>
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
            ${renderHostGuestFields("single")}
            <div class="actions">
              <button class="primary-button" type="submit" ${submitDisabled ? "disabled" : ""}>Submit</button>
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

  function renderMultiUpload() {
    const cards = getMultiUploadCards();
    const canSubmit = getAuthenticatedUserId() != null && getAuthenticatedUserId() !== "";
    const isDropzoneStage = multiUploadState.stage !== "cards";
    const stageStatus = canSubmit ? null : { type: "error", message: getAuthenticatedUserMessage() };

    logoutButton.classList.remove("hidden");
    app.innerHTML = `
      <div class="stack">
        ${isDropzoneStage
          ? `
            <section class="panel form-panel multi-dropzone-panel">
              <div class="stack">
                <div class="stack">
                  <h2>Upload Multiple Clips</h2>
                  <p>Start by dropping in all the clips you want to upload.</p>
                </div>
                ${renderStatus(stageStatus)}
                <input id="multiDropzoneFiles" class="hidden" type="file" multiple />
                <div id="multiDropzone" class="dropzone-surface ${multiUploadState.isDragActive ? "dropzone-surface-active" : ""}" role="button" tabindex="0">
                  ${renderDropzoneIcon()}
                  <div class="stack dropzone-copy">
                    <p class="dropzone-title">Drag and drop video clips to upload</p>
                    <p>Or click to select multiple clips</p>
                  </div>
                  <button id="selectMultiClipButton" class="primary-button" type="button" ${!canSubmit ? "disabled" : ""}>Select clips</button>
                </div>
                <div class="actions">
                  <button id="backToDashboardMulti" class="secondary-button" type="button">Back</button>
                </div>
              </div>
            </section>
          `
          : `
            <section class="panel form-panel multi-stage-panel">
              <div class="stack">
                <div class="stack">
                  <h2>Upload Multiple Clips</h2>
                  <p>Each selected file now has its own upload card below.</p>
                </div>
                ${renderStatus(stageStatus)}
                <div class="actions">
                  <button id="resetMultiStage" class="secondary-button" type="button" ${multiUploadState.isSubmitting ? "disabled" : ""}>Choose different clips</button>
                  <button id="backToDashboardMulti" class="secondary-button" type="button">Back</button>
                </div>
                <p>${escapeHtml(`${cards.length} clip${cards.length === 1 ? "" : "s"} selected in upload order.`)}</p>
              </div>
            </section>
            <form id="multiUploadForm" class="stack multi-card-stack">${cards
              .map(function (card, index) {
                return renderMultiUploadCard(card, index, {
                  isLastCard: index === cards.length - 1,
                  submitDisabled: !canSubmit || multiUploadState.isSubmitting
                });
              })
              .join("")}</form>
          `}
      </div>
    `;

    document.getElementById("backToDashboardMulti").addEventListener("click", function () {
      setHash(routes.dashboard);
    });

    if (isDropzoneStage) {
      bindMultiDropzone();
      const dropzone = document.getElementById("multiDropzone");
      if (dropzone) {
        dropzone.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const selectButton = document.getElementById("selectMultiClipButton");
            if (selectButton && !selectButton.disabled) {
              selectButton.click();
            }
          }
        });
      }
      return;
    }

    document.getElementById("resetMultiStage").addEventListener("click", handleMultiStageReset);
    if (cards.length) {
      document.getElementById("multiUploadForm").addEventListener("submit", handleMultiUploadSubmit);
      bindMultiUploadCardInputs();
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
    const pollRunId = activeProcessingPollRun + 1;
    let uploadDetails;

    if (iosUserId == null || iosUserId === "") {
      renderSingleUpload({ type: "error", message: getAuthenticatedUserMessage() });
      return;
    }

    if (!file) {
      renderSingleUpload({ type: "error", message: "Select a file before submitting." });
      return;
    }

    try {
      uploadDetails = buildUploadDetailsFromForm(form, "single");
    } catch (error) {
      renderSingleUpload({ type: "error", message: error.message || "Clip details are incomplete." });
      return;
    }

    submitButton.disabled = true;
    activeProcessingPollRun = pollRunId;
    renderSingleUpload({ type: "info", message: "Uploading clip..." }, { disableSubmit: true });

    try {
      const payload = await uploadSingleClip(iosUserId, name, file, uploadDetails);
      const clipId = readUploadedClipId(payload);

      if (clipId == null || clipId === "") {
        throw new Error("Clip uploaded, but no clip id was returned for processing status.");
      }

      await pollProcessingStatus(clipId, {
        isActive: function () {
          return pollRunId === activeProcessingPollRun && (window.location.hash || routes.single) === routes.single;
        },
        onUpdate: function (statusDetails) {
          if (pollRunId !== activeProcessingPollRun) {
            return;
          }

          renderSingleUpload(
            {
              type: statusDetails.type,
              message: statusDetails.message
            },
            { disableSubmit: !statusDetails.done && !statusDetails.failed }
          );
        }
      });

      if (pollRunId !== activeProcessingPollRun) {
        return;
      }

      form.reset();
      renderSingleUpload({
        type: "success",
        message: "Completed"
      });
    } catch (error) {
      if (pollRunId !== activeProcessingPollRun) {
        return;
      }

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
    const iosUserId = getAuthenticatedUserId();
    const cards = getMultiUploadCards();
    const uploadRunId = activeMultiUploadRun + 1;

    if (iosUserId == null || iosUserId === "") {
      multiUploadState.cards = cards.map(function (card) {
        return {
          ...card,
          status: { type: "error", message: getAuthenticatedUserMessage() }
        };
      });
      renderMultiUpload();
      return;
    }

    if (!cards.length) {
      renderMultiUpload();
      return;
    }

    activeMultiUploadRun = uploadRunId;
    multiUploadState.isSubmitting = true;
    renderMultiUpload();

    for (let index = 0; index < cards.length; index += 1) {
      if (!isMultiUploadActive(uploadRunId)) {
        return;
      }

      const card = multiUploadState.cards[index];
      let uploadDetails;

      if (!card.name.trim()) {
        multiUploadState.cards[index].status = { type: "error", message: "Failed: Enter a name before submitting." };
        multiUploadState.cards[index].progress = 0;
        renderMultiUpload();
        continue;
      }

      try {
        uploadDetails = buildUploadDetailsFromValues(card);
      } catch (error) {
        multiUploadState.cards[index].status = {
          type: "error",
          message: `Failed: ${error.message || "Clip details are incomplete."}`
        };
        multiUploadState.cards[index].progress = 0;
        renderMultiUpload();
        continue;
      }

      multiUploadState.cards[index].status = { type: "info", message: "Uploading..." };
      multiUploadState.cards[index].progress = getUploadProgressForMessage("Uploading...");
      renderMultiUpload();

      try {
        const payload = await uploadSingleClip(iosUserId, card.name.trim(), card.file, uploadDetails);
        const clipId = readUploadedClipId(payload);

        if (clipId == null || clipId === "") {
          throw new Error("Clip uploaded, but no clip id was returned for processing status.");
        }

        await pollProcessingStatus(clipId, {
          isActive: function () {
            return isMultiUploadActive(uploadRunId);
          },
          onUpdate: function (statusDetails) {
            if (!isMultiUploadActive(uploadRunId)) {
              return;
            }

            multiUploadState.cards[index].status = {
              type: statusDetails.type,
              message: statusDetails.message
            };
            multiUploadState.cards[index].progress = getUploadProgressForMessage(statusDetails.message);
            renderMultiUpload();
          }
        });

        if (!isMultiUploadActive(uploadRunId)) {
          return;
        }

        multiUploadState.cards[index].status = { type: "success", message: "Completed" };
        multiUploadState.cards[index].progress = 100;
      } catch (error) {
        if (!isMultiUploadActive(uploadRunId)) {
          return;
        }

        multiUploadState.cards[index].status = {
          type: "error",
          message: `Failed: ${error.message || "Upload failed."}`
        };
        multiUploadState.cards[index].progress = multiUploadState.cards[index].progress || 0;
      }

      renderMultiUpload();
    }

    if (!isMultiUploadActive(uploadRunId)) {
      return;
    }

    multiUploadState.isSubmitting = false;
    renderMultiUpload();
  }

  function render() {
    const hash = window.location.hash || (isAuthenticated() ? routes.dashboard : routes.login);

    if (hash !== routes.single) {
      cancelProcessingPolling();
    }

    if (hash !== routes.multi) {
      cancelMultiUploadRun();
      resetMultiUploadState();
    }

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
        renderMultiUpload();
        break;
      case routes.login:
      default:
        renderLogin();
        break;
    }
  }

  logoutButton.addEventListener("click", function () {
    cancelProcessingPolling();
    cancelMultiUploadRun();
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
