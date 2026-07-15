(function () {
  "use strict";

  const app = document.getElementById("app");
  const skipLink = document.getElementById("skipLink");
  const primaryNav = document.getElementById("primaryNav");
  const guestNav = document.getElementById("guestNav");
  const userPill = document.getElementById("userPill");
  const logoutButton = document.getElementById("logoutButton");
  const toastRegion = document.getElementById("toastRegion");

  if (!app || !skipLink || !primaryNav || !guestNav || !userPill || !logoutButton || !toastRegion) {
    return;
  }

  const config = window.APP_CONFIG || {};
  const authConfig = config.auth || {};
  const uploadConfig = config.uploads || {};
  const processingConfig = config.processing || {};
  const feedConfig = config.feed || {};
  const profileConfig = config.profile || {};

  const routes = {
    login: "#/login",
    signup: "#/signup",
    feed: "#/feed",
    upload: "#/upload",
    profile: "#/profile"
  };

  const protectedRoutes = new Set([routes.feed, routes.upload, routes.profile]);
  const accessTokenStorageKey = authConfig.accessTokenStorageKey || "voxxly_access_token";
  const refreshTokenStorageKey = authConfig.refreshTokenStorageKey || "voxxly_refresh_token";
  const deviceIdStorageKey = authConfig.deviceIdStorageKey || "voxxly_device_id";

  let currentUser = null;
  let activeRoute = null;
  let authNotice = null;
  let accessTokenMemory = safeStorageGet(window.localStorage, accessTokenStorageKey);
  let refreshTokenMemory = safeStorageGet(window.localStorage, refreshTokenStorageKey);
  let refreshPromise = null;
  let authGeneration = 0;
  let toastTimer = null;
  let sessionGeneration = 0;
  let pendingProtectedHash = "";
  let feedPlayerObserver = null;
  let feedSentinelObserver = null;
  let feedVisibilityRatios = new Map();
  let creatorCache = new Map();
  let feedWatchRecords = new Map();

  function createFeedState(sharedClipId) {
    return {
      items: [],
      page: 0,
      loading: false,
      started: false,
      hasMore: true,
      usingFallback: false,
      fallbackAttempted: false,
      sharedClipId: sharedClipId || getHashQueryParam("clip"),
      sharedClipLoaded: false,
      error: "",
      sessionId: randomId("soundbites")
    };
  }

  function createProfileState() {
    return {
      clips: [],
      counts: null,
      loading: false,
      loaded: false,
      error: ""
    };
  }

  let feedState = createFeedState();
  let profileState = createProfileState();
  let uploadState = {
    items: [],
    host: "",
    guestCsv: "",
    isUploading: false,
    summary: null
  };

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.payload = payload;
    }
  }

  function safeStorageGet(storage, key) {
    try {
      return storage.getItem(key) || "";
    } catch (error) {
      return "";
    }
  }

  function safeStorageSet(storage, key, value) {
    try {
      if (value) {
        storage.setItem(key, value);
      } else {
        storage.removeItem(key);
      }
    } catch (error) {
      // In-memory auth still works when storage is unavailable.
    }
  }

  function randomId(prefix) {
    const generated = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    return `${prefix}-${generated}`;
  }

  function getOrCreateDeviceId() {
    const existing = safeStorageGet(window.localStorage, deviceIdStorageKey);
    if (existing) {
      return existing;
    }

    const deviceId = randomId("web");
    safeStorageSet(window.localStorage, deviceIdStorageKey, deviceId);
    return deviceId;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
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
      .reduce(function (value, key) {
        return value == null ? undefined : value[key];
      }, source);
  }

  function getApiUrl(path) {
    const rawPath = String(path || "");
    if (/^https?:\/\//i.test(rawPath)) {
      return rawPath;
    }

    const base = String(config.apiBaseUrl || window.location.origin).replace(/\/$/, "") + "/";
    return new URL(rawPath.replace(/^\//, ""), base).toString();
  }

  function getSafeMediaUrl(value, fallbackPath) {
    const candidate = value || fallbackPath;
    if (!candidate) {
      return "";
    }

    try {
      const url = new URL(getApiUrl(candidate));
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
    } catch (error) {
      return "";
    }
  }

  function fillPathTemplate(template, values) {
    return Object.keys(values || {}).reduce(function (path, key) {
      return path.replaceAll(`{${key}}`, encodeURIComponent(values[key]));
    }, template);
  }

  function getAccessToken() {
    return accessTokenMemory;
  }

  function getRefreshToken() {
    return refreshTokenMemory;
  }

  function storeTokens(payload) {
    const accessToken = getValueByPath(
      payload,
      authConfig.accessTokenResponseField || authConfig.tokenResponseField || "accessToken"
    );
    const refreshToken = getValueByPath(payload, authConfig.refreshTokenResponseField || "refreshToken");

    if (accessToken) {
      authGeneration += 1;
      accessTokenMemory = accessToken;
      safeStorageSet(window.localStorage, accessTokenStorageKey, accessToken);
    }

    if (refreshToken) {
      refreshTokenMemory = refreshToken;
      safeStorageSet(window.localStorage, refreshTokenStorageKey, refreshToken);
    }

    return Boolean(accessToken);
  }

  function clearTokens() {
    authGeneration += 1;
    refreshPromise = null;
    accessTokenMemory = "";
    refreshTokenMemory = "";
    safeStorageSet(window.localStorage, accessTokenStorageKey, "");
    safeStorageSet(window.localStorage, refreshTokenStorageKey, "");
  }

  async function parseResponse(response) {
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
    const candidates = [
      payload && payload.message,
      payload && payload.error,
      payload && payload.detail,
      payload && payload.details,
      payload && payload.raw
    ];
    const message = candidates.find(function (value) {
      return typeof value === "string" && value.trim();
    });
    return message || fallback;
  }

  function buildAuthHeaders(headers) {
    const resolved = new window.Headers(headers || {});
    const token = getAccessToken();
    if (token) {
      const headerName = authConfig.authHeaderName || "Authorization";
      const scheme = authConfig.authScheme || "Bearer";
      resolved.set(headerName, scheme ? `${scheme} ${token}` : token);
    }
    return resolved;
  }

  async function refreshAccessToken() {
    if (refreshPromise) {
      return refreshPromise;
    }

    const refreshToken = getRefreshToken();
    const refreshGeneration = authGeneration;
    if (!refreshToken) {
      throw new ApiError("Your session has expired.", 401, null);
    }

    const pendingRefresh = (async function () {
      const response = await window.fetch(getApiUrl(authConfig.refreshPath || "/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: authConfig.withCredentials ? "include" : "same-origin",
        body: JSON.stringify({
          refreshToken: refreshToken,
          deviceId: getOrCreateDeviceId()
        })
      });
      const payload = await parseResponse(response);
      if (authGeneration !== refreshGeneration || getRefreshToken() !== refreshToken) {
        throw new ApiError("The active session changed while refreshing.", 409, { staleAuth: true });
      }
      if (!response.ok || !storeTokens(payload)) {
        throw new ApiError(getErrorMessage(payload, "Your session has expired."), response.status, payload);
      }
      return payload;
    })();
    refreshPromise = pendingRefresh;

    try {
      return await pendingRefresh;
    } finally {
      if (refreshPromise === pendingRefresh) {
        refreshPromise = null;
      }
    }
  }

  async function requestJson(path, options) {
    const requestOptions = options || {};
    const useAuth = requestOptions.auth !== false;
    const retryAuth = requestOptions.retryAuth !== false;
    const requestAuthGeneration = authGeneration;
    const headers = useAuth ? buildAuthHeaders(requestOptions.headers) : new window.Headers(requestOptions.headers || {});

    const response = await window.fetch(getApiUrl(path), {
      method: requestOptions.method || "GET",
      headers: headers,
      credentials: requestOptions.withCredentials || authConfig.withCredentials ? "include" : "same-origin",
      body: requestOptions.body
    });

    if ((response.status === 401 || response.status === 403) && useAuth && retryAuth && getRefreshToken()) {
      try {
        await refreshAccessToken();
        return requestJson(path, { ...requestOptions, retryAuth: false });
      } catch (error) {
        if (authGeneration !== requestAuthGeneration || getValueByPath(error, "payload.staleAuth")) {
          throw error;
        }
        if (protectedRoutes.has(getRoute())) {
          pendingProtectedHash = window.location.hash;
        }
        clearSession();
        authNotice = { type: "info", message: "Your session ended. Log in to continue." };
        if (protectedRoutes.has(getRoute())) {
          window.queueMicrotask(function () {
            navigate(routes.login);
          });
        }
        throw error;
      }
    }

    const payload = await parseResponse(response);
    if (!response.ok) {
      throw new ApiError(
        getErrorMessage(payload, `Request failed with status ${response.status}.`),
        response.status,
        payload
      );
    }
    return payload;
  }

  function renderStatus(status, id) {
    if (!status || !status.message) {
      return `<div id="${escapeHtml(id || "formStatus")}"></div>`;
    }

    const type = status.type || "info";
    const role = type === "error" ? "alert" : "status";
    return `<div id="${escapeHtml(id || "formStatus")}" class="status status-${escapeHtml(type)}" role="${role}">${escapeHtml(status.message)}</div>`;
  }

  function setStatusMessage(id, status) {
    const target = document.getElementById(id);
    if (!target) {
      return;
    }

    const type = status && status.type ? status.type : "info";
    target.className = status && status.message ? `status status-${type}` : "";
    target.setAttribute("role", type === "error" ? "alert" : "status");
    target.textContent = status && status.message ? status.message : "";
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toastRegion.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
    toastTimer = window.setTimeout(function () {
      toastRegion.innerHTML = "";
    }, 3600);
  }

  function getRoute() {
    const rawHash = window.location.hash || "";
    const route = rawHash.split("?")[0];
    return Object.values(routes).includes(route) ? route : "";
  }

  function getHashQueryParam(name, rawHash) {
    const hash = String(rawHash == null ? window.location.hash : rawHash);
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    return new URLSearchParams(query).get(name) || "";
  }

  function navigate(route) {
    if (window.location.hash !== route) {
      window.location.hash = route;
      return;
    }
    render();
  }

  function consumePostAuthRoute() {
    const destination = pendingProtectedHash || routes.feed;
    pendingProtectedHash = "";
    return destination;
  }

  function syncShell(route) {
    const isSignedIn = Boolean(currentUser);
    document.documentElement.classList.toggle("feed-route", route === routes.feed);
    primaryNav.classList.toggle("hidden", !isSignedIn);
    guestNav.classList.toggle("hidden", isSignedIn);
    userPill.classList.toggle("hidden", !isSignedIn);
    logoutButton.classList.toggle("hidden", !isSignedIn);

    if (isSignedIn) {
      userPill.textContent = `@${currentUser.username || "account"}`;
    } else {
      userPill.textContent = "";
    }

    primaryNav.querySelectorAll("[data-route]").forEach(function (link) {
      if (link.getAttribute("data-route") === route) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function focusPageHeading() {
    window.requestAnimationFrame(function () {
      const heading = app.querySelector("#loginTitle, #signupTitle, #feedTitle, #uploadTitle, #profileTitle") || app.querySelector("h1");
      if (!heading) {
        return;
      }
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    });
  }

  function resetUserData() {
    sessionGeneration += 1;
    feedState = createFeedState(getHashQueryParam("clip", pendingProtectedHash || window.location.hash));
    profileState = createProfileState();
    uploadState = {
      items: [],
      host: "",
      guestCsv: "",
      isUploading: false,
      summary: null
    };
    creatorCache = new Map();
    feedWatchRecords = new Map();
  }

  function clearSession() {
    currentUser = null;
    cleanupFeedObservers(true);
    clearTokens();
    resetUserData();
  }

  function authStoryMarkup() {
    return `
      <div class="auth-story" aria-hidden="true">
        <img class="auth-logo" src="./assets/voxxly-logo-384.png" alt="" />
        <h1>Hear the part that <span class="gradient-word">matters.</span></h1>
        <p>Voxxly turns standout podcast moments into a soundbite feed shaped around what keeps you listening.</p>
      </div>
    `;
  }

  function renderLogin() {
    const notice = authNotice;
    authNotice = null;
    app.innerHTML = `
      <section class="auth-page" aria-labelledby="loginTitle">
        ${authStoryMarkup()}
        <div class="panel auth-card">
          <div class="stack">
            <div>
              <p class="eyebrow">Welcome back</p>
              <h1 id="loginTitle" class="auth-title">Log in to Voxxly</h1>
              <p class="auth-subtitle">Pick up your recommendations and creator tools.</p>
            </div>
            ${renderStatus(notice, "loginStatus")}
            <form id="loginForm" class="stack" novalidate>
              <div class="field">
                <label for="login">Username or email</label>
                <input id="login" name="login" type="text" autocomplete="username" required />
              </div>
              <div class="field">
                <label for="password">Password</label>
                <input id="password" name="password" type="password" autocomplete="current-password" required />
              </div>
              <button id="loginSubmit" class="primary-button" type="submit">Log in</button>
            </form>
            <p class="auth-switch">New here? <a href="#/signup">Create your account</a></p>
          </div>
        </div>
      </section>
    `;

    document.getElementById("loginForm").addEventListener("submit", handleLoginSubmit);
  }

  function getYesterdayDate() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  function renderSignup() {
    app.innerHTML = `
      <section class="auth-page" aria-labelledby="signupTitle">
        ${authStoryMarkup()}
        <div class="panel auth-card">
          <div class="stack">
            <div>
              <p class="eyebrow">Join the conversation</p>
              <h1 id="signupTitle" class="auth-title">Create your account</h1>
              <p class="auth-subtitle">Your personalized Soundbites feed starts here.</p>
            </div>
            ${renderStatus(null, "signupStatus")}
            <form id="signupForm" class="stack" novalidate>
              <div class="field">
                <label for="signupUsername">Username</label>
                <input id="signupUsername" name="username" type="text" autocomplete="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]{3,32}" placeholder="your.handle" required />
                <span class="helper">3–32 letters, numbers, periods, underscores, or dashes.</span>
              </div>
              <div class="field">
                <label for="signupEmail">Email</label>
                <input id="signupEmail" name="email" type="email" autocomplete="email" required />
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="signupPassword">Password</label>
                  <input id="signupPassword" name="password" type="password" autocomplete="new-password" minlength="8" required />
                </div>
                <div class="field">
                  <label for="signupConfirmPassword">Confirm password</label>
                  <input id="signupConfirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
                </div>
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="signupDob">Date of birth</label>
                  <input id="signupDob" name="dob" type="date" autocomplete="bday" max="${getYesterdayDate()}" required />
                </div>
                <div class="field">
                  <label for="signupGender">Gender</label>
                  <select id="signupGender" name="gender" required>
                    <option value="">Select</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </div>
              </div>
              <label class="checkbox-field">
                <input name="agreement" type="checkbox" required />
                <span>I agree to use Voxxly responsibly and confirm that the information above is accurate.</span>
              </label>
              <button id="signupSubmit" class="primary-button" type="submit">Create account</button>
            </form>
            <p class="auth-switch">Already have an account? <a href="#/login">Log in</a></p>
          </div>
        </div>
      </section>
    `;

    document.getElementById("signupForm").addEventListener("submit", handleSignupSubmit);
  }

  async function loginWithCredentials(login, password) {
    const payload = await requestJson(authConfig.loginPath || "/auth/login", {
      method: "POST",
      auth: false,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: login,
        password: password,
        deviceId: getOrCreateDeviceId()
      })
    });

    if (!storeTokens(payload)) {
      throw new ApiError("Login succeeded, but no access token was returned.", 500, payload);
    }

    currentUser = await requestJson(authConfig.mePath || "/auth/me");
    resetUserData();
    uploadState.host = currentUser.username || "";
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = document.getElementById("loginSubmit");
    const login = form.login.value.trim();
    const password = form.password.value;

    if (!login || !password) {
      setStatusMessage("loginStatus", { type: "error", message: "Enter your username or email and password." });
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Logging in…";
    setStatusMessage("loginStatus", { type: "info", message: "Signing you in…" });

    try {
      await loginWithCredentials(login, password);
      navigate(consumePostAuthRoute());
    } catch (error) {
      clearSession();
      setStatusMessage("loginStatus", {
        type: "error",
        message: error.status === 401 ? "That username/email and password combination was not recognized." : error.message || "Unable to log in."
      });
      submitButton.disabled = false;
      submitButton.textContent = "Log in";
    }
  }

  async function handleSignupSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = document.getElementById("signupSubmit");
    const username = form.username.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;
    const dob = form.dob.value;
    const gender = form.gender.value;

    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      setStatusMessage("signupStatus", { type: "error", message: "Choose a valid username with 3–32 allowed characters." });
      return;
    }
    if (!form.email.validity.valid) {
      setStatusMessage("signupStatus", { type: "error", message: "Enter a valid email address." });
      return;
    }
    if (password.length < 8) {
      setStatusMessage("signupStatus", { type: "error", message: "Use at least 8 characters for your password." });
      return;
    }
    if (password !== confirmPassword) {
      setStatusMessage("signupStatus", { type: "error", message: "Your passwords do not match." });
      return;
    }
    if (!gender) {
      setStatusMessage("signupStatus", { type: "error", message: "Select a gender to complete the required account fields." });
      return;
    }
    if (!dob || dob > getYesterdayDate()) {
      setStatusMessage("signupStatus", { type: "error", message: "Enter a valid date of birth in the past." });
      return;
    }
    if (!form.agreement.checked) {
      setStatusMessage("signupStatus", { type: "error", message: "Confirm the account agreement to continue." });
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Creating account…";
    setStatusMessage("signupStatus", { type: "info", message: "Creating your Voxxly account…" });

    const registration = { email, username, password, gender, dob };

    try {
      await requestJson(authConfig.registerPath || "/ios/users", {
        method: "POST",
        auth: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registration)
      });
    } catch (error) {
      const message = error.status === 409
        ? "That username or email is already in use. Try another, or log in instead."
        : error.message || "Unable to create your account.";
      setStatusMessage("signupStatus", { type: "error", message: message });
      submitButton.disabled = false;
      submitButton.textContent = "Create account";
      return;
    }

    try {
      await loginWithCredentials(username, password);
      showToast("Welcome to Voxxly.");
      navigate(consumePostAuthRoute());
    } catch (error) {
      clearSession();
      authNotice = {
        type: "success",
        message: "Your account was created. Log in to continue."
      };
      navigate(routes.login);
    }
  }

  function initialsFor(value) {
    const parts = String(value || "V")
      .replace(/^@/, "")
      .split(/[\s._-]+/)
      .filter(Boolean);
    return parts.slice(0, 2).map(function (part) { return part.charAt(0).toUpperCase(); }).join("") || "V";
  }

  function avatarMarkup(user, fallbackName, extraClass) {
    const photoUrl = getSafeMediaUrl(user && user.profilePhotoUrl);
    return `
      <span class="avatar ${escapeHtml(extraClass || "")}" aria-hidden="true">
        ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="" />` : escapeHtml(initialsFor((user && user.username) || fallbackName))}
      </span>
    `;
  }

  function formatCount(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat(undefined, { notation: number >= 1000 ? "compact" : "standard" }).format(number);
  }

  function pluralize(count, singular, plural) {
    return `${count} ${count === 1 ? singular : (plural || `${singular}s`)}`;
  }

  function renderFeedItem(item, index) {
    const creator = creatorCache.get(String(item.iosUserId)) || null;
    const creatorName = (creator && creator.username) || item.creatorName || "Voxxly creator";
    const streamUrl = getSafeMediaUrl(item.streamUrl, `/iosclips/${item.id}/stream`);
    const posterUrl = getSafeMediaUrl(item.thumbnailUrl);
    const fullEpisodeUrl = getSafeMediaUrl(item.fullEpisodeFilepath);
    const sourceUrl = getSafeMediaUrl(item.sourceUrl);
    const detailBits = [];

    if (item.fullEpisodeName) {
      detailBits.push(item.fullEpisodeName);
    }
    if (item.sourcePlatform) {
      detailBits.push(item.sourcePlatform);
    }
    if (Number(item.repostedByCount) > 0) {
      detailBits.push(pluralize(Number(item.repostedByCount), "repost"));
    }

    return `
      <article class="soundbite-card" data-feed-card data-clip-id="${escapeHtml(item.id)}" aria-labelledby="clipTitle-${escapeHtml(item.id)}">
        <div class="soundbite-media">
          <video
            class="soundbite-video"
            data-feed-video
            controls
            playsinline
            muted
            preload="metadata"
            src="${escapeHtml(streamUrl)}"
            ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ""}
            aria-label="Play ${escapeHtml(item.name || "soundbite")}">
          </video>
          <div class="soundbite-labels">
            <span class="badge">For you · ${index + 1}</span>
            ${item.isMature || item.mature ? `<span class="badge badge-warning">Mature${item.minimumAge ? ` · ${escapeHtml(item.minimumAge)}+` : ""}</span>` : ""}
          </div>
        </div>
        <div class="soundbite-details">
          <div>
            <div class="creator-row">
              ${avatarMarkup(creator, creatorName)}
              <div>
                <p class="creator-name">@${escapeHtml(creatorName)}</p>
                <p class="creator-meta">Recommended for you</p>
              </div>
            </div>
            <h2 id="clipTitle-${escapeHtml(item.id)}" class="soundbite-title">${escapeHtml(item.name || "Untitled soundbite")}</h2>
            <p class="soundbite-copy">${escapeHtml(detailBits.join(" · ") || "A fresh moment from your personalized Voxxly mix.")}</p>
          </div>
          <div class="soundbite-actions">
            <button class="secondary-button" type="button" data-share-clip="${escapeHtml(item.id)}">Share soundbite</button>
            ${fullEpisodeUrl
              ? `<a class="quiet-button" data-full-episode="${escapeHtml(item.id)}" href="${escapeHtml(fullEpisodeUrl)}" target="_blank" rel="noreferrer">Open full episode</a>`
              : (sourceUrl ? `<a class="quiet-button" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Open source</a>` : "")}
          </div>
        </div>
      </article>
    `;
  }

  function renderFeed(options) {
    const renderOptions = options || {};
    const savedScrollY = renderOptions.preserveScroll ? window.scrollY : null;
    cleanupFeedObservers(false);
    const hasItems = feedState.items.length > 0;
    const needsInitialLoad = !feedState.started && !feedState.error;

    let content = "";
    if (hasItems) {
      content = `<div id="feedList" class="feed-list">${feedState.items.map(renderFeedItem).join("")}</div>`;
    } else if (feedState.loading || needsInitialLoad) {
      content = `<div class="skeleton skeleton-card" role="status" aria-label="Loading your recommended Soundbites"></div>`;
    } else if (feedState.error) {
      content = `
        <section class="panel error-state">
          <div class="stack-tight">
            <h2>We couldn’t load your mix.</h2>
            <p class="muted">${escapeHtml(feedState.error)}</p>
            <div class="actions" style="justify-content:center"><button id="retryFeed" class="primary-button" type="button">Try again</button></div>
          </div>
        </section>
      `;
    } else {
      content = `
        <section class="panel empty-state">
          <div class="stack-tight">
            <h2>No Soundbites yet</h2>
            <p class="muted">Your recommendation queue is caught up. Refresh it in a moment.</p>
          </div>
        </section>
      `;
    }

    app.innerHTML = `
      <section class="feed-page" aria-labelledby="feedTitle">
        <div class="feed-heading-row">
          <div>
            <p class="page-kicker">Personalized timeline</p>
            <h1 id="feedTitle" class="page-title">Soundbites</h1>
          </div>
          <button id="refreshFeed" class="secondary-button" type="button">Refresh my mix</button>
        </div>
        ${content}
        ${hasItems ? `<div id="feedInlineStatus" class="${feedState.error ? "status status-error" : "hidden"}" role="alert" style="margin-top:18px">${escapeHtml(feedState.error)}</div>` : ""}
        ${hasItems ? `
          <div id="feedSentinel" class="feed-load-more">
            ${feedState.hasMore
              ? `<button id="loadMoreFeed" class="quiet-button" type="button" ${feedState.loading ? "disabled" : ""}>${feedState.loading ? "Loading more…" : "Load more Soundbites"}</button>`
              : `<p class="muted">You’re caught up for now.</p>`}
          </div>
        ` : ""}
      </section>
    `;

    const refreshButton = document.getElementById("refreshFeed");
    if (refreshButton) {
      refreshButton.addEventListener("click", resetFeed);
    }
    const retryButton = document.getElementById("retryFeed");
    if (retryButton) {
      retryButton.addEventListener("click", function () {
        feedState.error = "";
        loadMoreFeed();
      });
    }
    const loadMoreButton = document.getElementById("loadMoreFeed");
    if (loadMoreButton) {
      loadMoreButton.addEventListener("click", loadMoreFeed);
    }

    bindFeedItemActions();

    bindFeedPlayers();
    bindFeedSentinel();

    if (savedScrollY != null) {
      window.requestAnimationFrame(function () {
        window.scrollTo({ top: savedScrollY, behavior: "auto" });
      });
    }

    if (needsInitialLoad) {
      window.queueMicrotask(loadMoreFeed);
    }
  }

  function bindFeedItemActions() {
    app.querySelectorAll("[data-share-clip]").forEach(function (button) {
      if (button.dataset.actionBound === "true") {
        return;
      }
      button.dataset.actionBound = "true";
      button.addEventListener("click", handleShareClip);
    });
    app.querySelectorAll("[data-full-episode]").forEach(function (link) {
      if (link.dataset.actionBound === "true") {
        return;
      }
      link.dataset.actionBound = "true";
      link.addEventListener("click", function (event) {
        const clipId = event.currentTarget.getAttribute("data-full-episode");
        const record = getWatchRecord(clipId);
        reportInteraction(clipId, record.watchedSec, { hasClickedToFullEpisode: true });
      });
    });
  }

  function updateFeedFooter() {
    const status = document.getElementById("feedInlineStatus");
    if (status) {
      status.textContent = feedState.error || "";
      status.className = feedState.error ? "status status-error" : "hidden";
    }

    const sentinel = document.getElementById("feedSentinel");
    if (!sentinel) {
      return;
    }
    sentinel.innerHTML = feedState.hasMore
      ? `<button id="loadMoreFeed" class="quiet-button" type="button" ${feedState.loading ? "disabled" : ""}>${feedState.loading ? "Loading more…" : "Load more Soundbites"}</button>`
      : `<p class="muted">You’re caught up for now.</p>`;
    const loadMoreButton = document.getElementById("loadMoreFeed");
    if (loadMoreButton) {
      loadMoreButton.addEventListener("click", loadMoreFeed);
    }
    bindFeedSentinel();
  }

  async function loadCreator(userId) {
    const cacheKey = String(userId);
    const cache = creatorCache;
    const generation = sessionGeneration;
    const viewerId = currentUser && currentUser.id;
    const isCurrentRequest = function () {
      return creatorCache === cache && sessionGeneration === generation && currentUser && String(currentUser.id) === String(viewerId);
    };
    if (creatorCache.has(cacheKey)) {
      return creatorCache.get(cacheKey);
    }

    try {
      const path = fillPathTemplate(profileConfig.userPathTemplate || "/ios/users/{userId}", { userId: userId });
      const creator = await requestJson(path);
      if (isCurrentRequest()) {
        cache.set(cacheKey, creator || null);
      }
      return creator;
    } catch (error) {
      if (isCurrentRequest()) {
        cache.set(cacheKey, null);
      }
      return null;
    }
  }

  async function loadMoreFeed() {
    if (feedState.loading || !feedState.hasMore || !currentUser) {
      return;
    }

    const state = feedState;
    const generation = sessionGeneration;
    const userId = currentUser.id;
    const hadItems = state.items.length > 0;
    const isCurrentRequest = function () {
      return feedState === state && sessionGeneration === generation && currentUser && String(currentUser.id) === String(userId);
    };
    state.loading = true;
    state.started = true;
    state.error = "";
    if (getRoute() === routes.feed) {
      if (hadItems) {
        updateFeedFooter();
      } else {
        renderFeed();
      }
    }

    const batchSize = Math.max(1, Number(feedConfig.batchSize) || 10);
    const url = new URL(getApiUrl(feedConfig.path || "/iosclips/feed"));
    url.searchParams.set("userId", userId);
    url.searchParams.set("sessionId", state.sessionId);
    url.searchParams.set("batchSize", batchSize);
    if (state.page > 0) {
      url.searchParams.set("cursor", `batch-${state.page + 1}`);
    }

    try {
      let sharedItems = [];
      if (state.sharedClipId && !state.sharedClipLoaded) {
        state.sharedClipLoaded = true;
        try {
          const sharedClip = await requestJson(`/iosclips/${encodeURIComponent(state.sharedClipId)}`);
          if (!isCurrentRequest()) {
            return;
          }
          if (sharedClip && sharedClip.id) {
            sharedItems = [{
              ...sharedClip,
              streamUrl: sharedClip.streamUrl || `/iosclips/${sharedClip.id}/stream`,
              thumbnailUrl: sharedClip.thumbnailUrl || getValueByPath(sharedClip, "thumbnailImage.filepath"),
              fullEpisodeName: sharedClip.fullEpisodeName || getValueByPath(sharedClip, "fullEpisode.name"),
              fullEpisodeFilepath: sharedClip.fullEpisodeFilepath || getValueByPath(sharedClip, "fullEpisode.filepath")
            }];
          }
        } catch (error) {
          // A removed or unavailable shared clip should not block the rest of the feed.
        }
      }

      let payload;
      try {
        payload = await requestJson(url.toString());
      } catch (recommendationError) {
        if (state.fallbackAttempted) {
          throw recommendationError;
        }
        state.fallbackAttempted = true;
        const fallbackUrl = new URL(getApiUrl(feedConfig.path || "/iosclips/feed"));
        fallbackUrl.searchParams.set("viewerUserId", userId);
        payload = await requestJson(fallbackUrl.toString());
        state.usingFallback = true;
      }

      if (!isCurrentRequest()) {
        return;
      }
      if (!Array.isArray(payload)) {
        throw new ApiError("The Soundbites feed returned an unexpected response.", 500, payload);
      }

      const previousCount = state.items.length;
      const knownIds = new Set(state.items.map(function (item) { return String(item.id); }));
      const newItems = sharedItems.concat(payload).filter(function (item) {
        const id = String(item && item.id);
        if (!item || !item.id || knownIds.has(id)) {
          return false;
        }
        knownIds.add(id);
        return true;
      });

      await Promise.all(Array.from(new Set(newItems.map(function (item) { return item.iosUserId; }).filter(Boolean))).map(loadCreator));
      if (!isCurrentRequest()) {
        return;
      }
      state.items = state.items.concat(newItems);
      state.page += 1;
      state.hasMore = !state.usingFallback && payload.length >= batchSize && newItems.length > 0;

      if (hadItems && getRoute() === routes.feed) {
        const feedList = document.getElementById("feedList");
        if (feedList && newItems.length) {
          feedList.insertAdjacentHTML("beforeend", newItems.map(function (item, index) {
            return renderFeedItem(item, previousCount + index);
          }).join(""));
          bindFeedItemActions();
          bindFeedPlayers();
        }
      }
    } catch (error) {
      if (isCurrentRequest()) {
        state.error = error.message || "Unable to load recommendations right now.";
      }
    } finally {
      state.loading = false;
      if (!isCurrentRequest() || getRoute() !== routes.feed) {
        return;
      }
      if (hadItems) {
        updateFeedFooter();
      } else {
        renderFeed();
      }
    }
  }

  function resetFeed() {
    feedState = createFeedState();
    feedWatchRecords = new Map();
    renderFeed();
  }

  function getWatchRecord(clipId) {
    const key = String(clipId);
    if (!feedWatchRecords.has(key)) {
      feedWatchRecords.set(key, { startedAt: null, watchedSec: 0, reportedSec: 0 });
    }
    return feedWatchRecords.get(key);
  }

  function startWatching(clipId) {
    const record = getWatchRecord(clipId);
    if (record.startedAt == null) {
      record.startedAt = window.performance.now();
    }
  }

  function stopWatching(clipId, shouldReport) {
    const record = getWatchRecord(clipId);
    if (record.startedAt != null) {
      record.watchedSec += Math.max(0, (window.performance.now() - record.startedAt) / 1000);
      record.startedAt = null;
    }

    if (shouldReport && record.watchedSec - record.reportedSec >= 3) {
      record.reportedSec = record.watchedSec;
      reportInteraction(clipId, record.watchedSec, {});
    }
  }

  function reportInteraction(clipId, watchSec, flags) {
    if (!currentUser || !clipId) {
      return;
    }

    const extraFlags = flags || {};
    requestJson(feedConfig.interactionPath || "/iosclips/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clipId: Number(clipId),
        userId: Number(currentUser.id),
        sessionId: feedState.sessionId,
        watchSec: Number(Number(watchSec || 0).toFixed(2)),
        didVideoRepeat: Boolean(extraFlags.didVideoRepeat),
        hasClickedToFullEpisode: Boolean(extraFlags.hasClickedToFullEpisode),
        hasRepostedClip: Boolean(extraFlags.hasRepostedClip),
        hasSharedClip: Boolean(extraFlags.hasSharedClip),
        hasSavedClip: Boolean(extraFlags.hasSavedClip),
        hasLiked: Boolean(extraFlags.hasLiked)
      })
    }).catch(function () {
      // Interaction telemetry should never interrupt playback.
    });
  }

  function activateFeedCard(card) {
    app.querySelectorAll("[data-feed-card]").forEach(function (candidate) {
      const video = candidate.querySelector("[data-feed-video]");
      const isActive = candidate === card;
      candidate.classList.toggle("is-active", isActive);
      if (!video) {
        return;
      }
      if (isActive) {
        video.play().catch(function () {
          // Native controls remain available if autoplay is blocked.
        });
      } else if (!video.paused) {
        video.pause();
      }
    });
  }

  function bindFeedPlayers() {
    const cards = Array.from(app.querySelectorAll("[data-feed-card]"));
    if (!cards.length) {
      return;
    }

    if (feedPlayerObserver) {
      feedPlayerObserver.disconnect();
      feedPlayerObserver = null;
    }

    cards.forEach(function (card) {
      const video = card.querySelector("[data-feed-video]");
      const clipId = card.getAttribute("data-clip-id");
      if (!video || video.dataset.feedBound === "true") {
        return;
      }

      video.dataset.feedBound = "true";
      video.addEventListener("play", function () {
        app.querySelectorAll("[data-feed-video]").forEach(function (otherVideo) {
          if (otherVideo !== video && !otherVideo.paused) {
            otherVideo.pause();
          }
        });
        startWatching(clipId);
      });
      video.addEventListener("pause", function () {
        stopWatching(clipId, true);
      });
      video.addEventListener("ended", function () {
        stopWatching(clipId, true);
      });
    });

    if (!("IntersectionObserver" in window)) {
      activateFeedCard(cards[0]);
      return;
    }

    feedVisibilityRatios = new Map();
    feedPlayerObserver = new window.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        feedVisibilityRatios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
      });

      let bestCard = null;
      let bestRatio = 0;
      feedVisibilityRatios.forEach(function (ratio, candidate) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestCard = candidate;
        }
      });

      if (bestCard && bestRatio >= 0.62) {
        activateFeedCard(bestCard);
      } else {
        activateFeedCard(null);
      }
    }, { threshold: [0, 0.35, 0.62, 0.85] });

    cards.forEach(function (card) {
      feedPlayerObserver.observe(card);
    });
  }

  function bindFeedSentinel() {
    if (feedSentinelObserver) {
      feedSentinelObserver.disconnect();
      feedSentinelObserver = null;
    }
    const sentinel = document.getElementById("feedSentinel");
    if (!sentinel || !feedState.hasMore || feedState.loading || feedState.error || !("IntersectionObserver" in window)) {
      return;
    }

    feedSentinelObserver = new window.IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; })) {
        loadMoreFeed();
      }
    }, { rootMargin: "600px 0px" });
    feedSentinelObserver.observe(sentinel);
  }

  function cleanupFeedObservers(reportWatch) {
    if (feedPlayerObserver) {
      feedPlayerObserver.disconnect();
      feedPlayerObserver = null;
    }
    if (feedSentinelObserver) {
      feedSentinelObserver.disconnect();
      feedSentinelObserver = null;
    }

    app.querySelectorAll("[data-feed-card]").forEach(function (card) {
      const video = card.querySelector("[data-feed-video]");
      const clipId = card.getAttribute("data-clip-id");
      if (video && !video.paused) {
        video.pause();
      }
      if (reportWatch) {
        stopWatching(clipId, true);
      }
    });
    feedVisibilityRatios = new Map();
  }

  async function handleShareClip(event) {
    const clipId = event.currentTarget.getAttribute("data-share-clip");
    const clip = feedState.items.find(function (item) { return String(item.id) === String(clipId); });
    const shareUrl = new URL(window.location.href);
    shareUrl.hash = `#/feed?clip=${encodeURIComponent(clipId)}`;
    const shareData = {
      title: clip ? `${clip.name} · Voxxly` : "Voxxly Soundbite",
      text: clip ? `Listen to “${clip.name}” on Voxxly.` : "Listen to this Soundbite on Voxxly.",
      url: shareUrl.toString()
    };

    try {
      if (window.navigator.share) {
        await window.navigator.share(shareData);
      } else if (window.navigator.clipboard) {
        await window.navigator.clipboard.writeText(shareData.url);
        showToast("Soundbite link copied.");
      } else {
        throw new Error("Sharing is unavailable in this browser.");
      }
      const record = getWatchRecord(clipId);
      reportInteraction(clipId, record.watchedSec, { hasSharedClip: true });
    } catch (error) {
      if (error && error.name !== "AbortError") {
        showToast("This browser could not share the link.");
      }
    }
  }

  function getDefaultClipName(file) {
    return String(file.name || "Untitled clip").replace(/\.[^/.]+$/, "") || file.name;
  }

  function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024 * 1024) {
      return `${Math.max(1, Math.round(size / 1024))} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  function isVideoFile(file) {
    if (file.type && file.type.startsWith("video/")) {
      return true;
    }
    return /\.(mp4|mov|m4v|webm)$/i.test(file.name || "");
  }

  function createUploadItem(file) {
    return {
      id: randomId("upload"),
      file: file,
      name: getDefaultClipName(file),
      status: { type: "info", message: "Ready" },
      progress: 0,
      clipId: null,
      uploaded: false
    };
  }

  function addUploadFiles(files) {
    if (uploadState.isUploading) {
      return;
    }

    const maxBytes = (Number(uploadConfig.maxFileSizeMb) || 100) * 1024 * 1024;
    const existing = new Set(uploadState.items.map(function (item) {
      return `${item.file.name}-${item.file.size}-${item.file.lastModified}`;
    }));
    let skipped = 0;

    Array.from(files || []).forEach(function (file) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (existing.has(key)) {
        skipped += 1;
        return;
      }
      if (!isVideoFile(file) || file.size > maxBytes) {
        skipped += 1;
        return;
      }
      existing.add(key);
      uploadState.items.push(createUploadItem(file));
    });

    uploadState.summary = skipped
      ? { type: "info", message: `${pluralize(skipped, "file")} skipped because it was duplicated, not a supported video, or over the size limit.` }
      : null;
    renderUpload();
  }

  function renderUploadItem(item, index) {
    return `
      <article class="upload-item" data-upload-item="${escapeHtml(item.id)}">
        <div class="upload-item-head">
          <div style="min-width:0">
            <p class="file-name">${escapeHtml(item.file.name)}</p>
            <p class="file-meta">${escapeHtml(formatFileSize(item.file.size))} · Clip ${index + 1}</p>
          </div>
          <button class="remove-button" type="button" data-remove-upload="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.file.name)}" ${uploadState.isUploading ? "disabled" : ""}>×</button>
        </div>
        <div class="field">
          <label for="title-${escapeHtml(item.id)}">Soundbite title</label>
          <input id="title-${escapeHtml(item.id)}" data-upload-title="${escapeHtml(item.id)}" type="text" value="${escapeHtml(item.name)}" maxlength="160" required ${uploadState.isUploading || item.uploaded ? "disabled" : ""} />
        </div>
        <div class="progress-wrap" role="progressbar" aria-label="Upload progress for ${escapeHtml(item.file.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(item.progress || 0)}" aria-valuetext="${escapeHtml(item.status.message)}">
          <div class="progress-track" aria-hidden="true"><div class="progress-value" style="width:${Math.min(100, Math.max(0, item.progress || 0))}%"></div></div>
          <div class="progress-label"><span>${escapeHtml(item.status.message)}</span><span>${Math.round(item.progress || 0)}%</span></div>
        </div>
      </article>
    `;
  }

  function renderUpload(options) {
    const renderOptions = options || {};
    const savedScrollY = renderOptions.preserveScroll ? window.scrollY : null;
    const count = uploadState.items.length;
    const readyCount = uploadState.items.filter(function (item) { return !item.uploaded; }).length;

    app.innerHTML = `
      <section class="page-wrap" aria-labelledby="uploadTitle">
        <header class="page-header">
          <p class="page-kicker">Creator studio</p>
          <h1 id="uploadTitle" class="page-title">Upload once.<br />Or all at once.</h1>
          <p class="page-description">Choose one clip or build a full queue. Voxxly uploads each file safely in order and follows its processing progress.</p>
        </header>
        <div class="upload-layout">
          <aside class="panel upload-settings">
            <div class="stack">
              <div>
                <h2 class="section-title">Clip details</h2>
                <p class="section-copy">These details apply to every clip in this queue.</p>
              </div>
              <div class="creator-access-note">Uploading is currently limited by the backend to accounts with administrator upload access. Every signed-in account can still use Soundbites and Profile.</div>
              <div class="field">
                <label for="uploadHost">Host</label>
                <input id="uploadHost" type="text" value="${escapeHtml(uploadState.host || (currentUser && currentUser.username) || "")}" placeholder="Host name" ${uploadState.isUploading ? "disabled" : ""} />
              </div>
              <div class="field">
                <label for="uploadGuests">Guests <span class="muted">(optional)</span></label>
                <input id="uploadGuests" type="text" value="${escapeHtml(uploadState.guestCsv)}" placeholder="guest-one, guest-two" ${uploadState.isUploading ? "disabled" : ""} />
              </div>
              <input id="clipFiles" class="hidden" type="file" accept="video/mp4,video/quicktime,video/x-m4v,video/webm,video/*" multiple ${uploadState.isUploading ? "disabled" : ""} />
              <label id="uploadDropzone" class="upload-dropzone" for="clipFiles" tabindex="0" role="button" aria-describedby="uploadFileHelp">
                <span>
                  <span class="upload-glyph" aria-hidden="true">＋</span>
                  <span class="dropzone-title">Drop clips here or browse</span>
                  <span id="uploadFileHelp" class="dropzone-copy">MP4, MOV, M4V, or WebM · up to ${escapeHtml(uploadConfig.maxFileSizeMb || 100)} MB each</span>
                </span>
              </label>
            </div>
          </aside>
          <section class="panel upload-queue-panel" aria-labelledby="queueTitle">
            <div class="stack">
              <div class="queue-toolbar">
                <div>
                  <h2 id="queueTitle" class="section-title">Upload queue</h2>
                  <p class="queue-count">${count ? escapeHtml(pluralize(count, "clip")) : "No clips selected"}</p>
                </div>
                ${count ? `<button id="clearUploadQueue" class="quiet-button" type="button" ${uploadState.isUploading ? "disabled" : ""}>Clear</button>` : ""}
              </div>
              ${renderStatus(uploadState.summary, "uploadSummary")}
              ${count
                ? `<form id="uploadForm" class="stack"><div class="upload-list">${uploadState.items.map(renderUploadItem).join("")}</div><button id="uploadSubmit" class="primary-button" type="submit" ${uploadState.isUploading || !readyCount ? "disabled" : ""}>${uploadState.isUploading ? "Uploading queue…" : `Upload ${escapeHtml(pluralize(readyCount, "clip"))}`}</button></form>`
                : `<div class="empty-state"><div><p class="section-title">Your queue is ready when you are.</p><p class="section-copy">Select one video for a single upload or several videos for a batch.</p></div></div>`}
            </div>
          </section>
        </div>
      </section>
    `;

    const fileInput = document.getElementById("clipFiles");
    const dropzone = document.getElementById("uploadDropzone");
    const hostInput = document.getElementById("uploadHost");
    const guestsInput = document.getElementById("uploadGuests");

    if (fileInput) {
      fileInput.addEventListener("change", function (event) {
        addUploadFiles(event.currentTarget.files);
      });
    }
    if (hostInput) {
      hostInput.addEventListener("input", function (event) {
        uploadState.host = event.currentTarget.value;
      });
    }
    if (guestsInput) {
      guestsInput.addEventListener("input", function (event) {
        uploadState.guestCsv = event.currentTarget.value;
      });
    }
    if (dropzone) {
      dropzone.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (fileInput && !fileInput.disabled) {
            fileInput.click();
          }
        }
      });
      ["dragenter", "dragover"].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (event) {
          event.preventDefault();
          if (!uploadState.isUploading) {
            dropzone.classList.add("is-dragging");
          }
        });
      });
      ["dragleave", "drop"].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (event) {
          event.preventDefault();
          dropzone.classList.remove("is-dragging");
        });
      });
      dropzone.addEventListener("drop", function (event) {
        if (!uploadState.isUploading && event.dataTransfer) {
          addUploadFiles(event.dataTransfer.files);
        }
      });
    }

    app.querySelectorAll("[data-upload-title]").forEach(function (input) {
      input.addEventListener("input", function (event) {
        const item = uploadState.items.find(function (candidate) {
          return candidate.id === event.currentTarget.getAttribute("data-upload-title");
        });
        if (item) {
          item.name = event.currentTarget.value;
        }
      });
    });

    app.querySelectorAll("[data-remove-upload]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        const itemId = event.currentTarget.getAttribute("data-remove-upload");
        uploadState.items = uploadState.items.filter(function (item) { return item.id !== itemId; });
        uploadState.summary = null;
        renderUpload();
      });
    });

    const clearButton = document.getElementById("clearUploadQueue");
    if (clearButton) {
      clearButton.addEventListener("click", function () {
        uploadState.items = [];
        uploadState.summary = null;
        renderUpload();
      });
    }

    const uploadForm = document.getElementById("uploadForm");
    if (uploadForm) {
      uploadForm.addEventListener("submit", handleUploadSubmit);
    }

    if (savedScrollY != null) {
      window.requestAnimationFrame(function () {
        window.scrollTo({ top: savedScrollY, behavior: "auto" });
      });
    }
  }

  function renderUploadIfActive(options) {
    if (getRoute() === routes.upload) {
      renderUpload(options);
    }
  }

  function updateUploadItemProgress(item) {
    if (getRoute() !== routes.upload) {
      return;
    }
    const itemNode = Array.from(app.querySelectorAll("[data-upload-item]")).find(function (candidate) {
      return candidate.getAttribute("data-upload-item") === String(item.id);
    });
    if (!itemNode) {
      return;
    }

    const progress = Math.round(Math.min(100, Math.max(0, item.progress || 0)));
    const progressWrap = itemNode.querySelector(".progress-wrap");
    const progressValue = itemNode.querySelector(".progress-value");
    const progressLabels = itemNode.querySelectorAll(".progress-label span");
    if (progressWrap) {
      progressWrap.setAttribute("aria-valuenow", String(progress));
      progressWrap.setAttribute("aria-valuetext", item.status.message);
    }
    if (progressValue) {
      progressValue.style.width = `${progress}%`;
    }
    if (progressLabels[0]) {
      progressLabels[0].textContent = item.status.message;
    }
    if (progressLabels[1]) {
      progressLabels[1].textContent = `${progress}%`;
    }
  }

  function normalizeCsv(value) {
    return String(value || "")
      .split(",")
      .map(function (part) { return part.trim(); })
      .filter(Boolean)
      .join(",");
  }

  function buildClipFormData(item, uploader) {
    const formData = new window.FormData();
    formData.append(uploadConfig.iosUserIdField || "iosUserId", String(uploader.id));
    formData.append(uploadConfig.titleField || "name", item.name.trim());
    formData.append(uploadConfig.guestCsvField || "guestCsv", normalizeCsv(uploadState.guestCsv));
    formData.append(uploadConfig.hostField || "host", uploadState.host.trim() || uploader.username || "");
    formData.append(uploadConfig.singleFileField || "file", item.file);
    return formData;
  }

  function getProcessingDetails(rawStatus) {
    const status = String(rawStatus || "")
      .trim()
      .replace(/[\s-]+/g, "_")
      .toUpperCase();

    if (["COMPLETED", "DONE", "SUCCESS"].includes(status)) {
      return { type: "success", message: "Ready", progress: 100, done: true, failed: false };
    }
    if (["FAILED", "ERROR"].includes(status)) {
      return { type: "error", message: "Processing failed", progress: 70, done: false, failed: true };
    }
    if (["TRANSCRIBING", "TRANSCRIPTION"].includes(status)) {
      return { type: "info", message: "Transcribing", progress: 48, done: false, failed: false };
    }
    if (["GENERATING_METADATA", "METADATA", "ENRICHING"].includes(status)) {
      return { type: "info", message: "Creating metadata", progress: 72, done: false, failed: false };
    }
    if (["FINALIZING", "SAVING", "COMPLETING"].includes(status)) {
      return { type: "info", message: "Finalizing", progress: 90, done: false, failed: false };
    }
    return { type: "info", message: "Processing", progress: 30, done: false, failed: false };
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  async function pollClipProcessing(item, isActive) {
    const maxAttempts = Math.max(1, Number(processingConfig.maxPollAttempts) || 80);
    const interval = Math.max(750, Number(processingConfig.pollIntervalMs) || 1500);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (isActive && !isActive()) {
        return;
      }
      const url = new URL(getApiUrl(processingConfig.statusPath || "/processing/status"));
      url.searchParams.set(processingConfig.clipIdQueryParam || "clipId", item.clipId);

      try {
        const payload = await requestJson(url.toString());
        if (isActive && !isActive()) {
          return;
        }
        const rawStatus = getValueByPath(payload, processingConfig.statusResponseField || "status") || payload?.processingStatus || payload?.state;
        const details = getProcessingDetails(rawStatus);
        item.status = { type: details.type, message: details.message };
        item.progress = details.progress;
        updateUploadItemProgress(item);
        if (details.failed) {
          throw new ApiError(getErrorMessage(payload, "Clip processing failed."), 500, payload);
        }
        if (details.done) {
          return;
        }
      } catch (error) {
        if (!(error.status === 404 && attempt < 5)) {
          throw error;
        }
      }

      await wait(interval);
    }

    item.status = { type: "success", message: "Uploaded · processing continues" };
    item.progress = 96;
  }

  function uploadPermissionMessage() {
    return "This account can browse Voxxly, but the current backend limits clip uploads to accounts with administrator upload access.";
  }

  async function handleUploadSubmit(event) {
    event.preventDefault();
    if (uploadState.isUploading || !currentUser) {
      return;
    }

    const state = uploadState;
    const generation = sessionGeneration;
    const uploader = { id: currentUser.id, username: currentUser.username };
    const isCurrentRun = function () {
      return uploadState === state && sessionGeneration === generation && currentUser && String(currentUser.id) === String(uploader.id);
    };

    state.host = String(state.host || uploader.username || "").trim();
    const pendingItems = state.items.filter(function (item) { return !item.uploaded; });
    const invalidItem = pendingItems.find(function (item) { return !String(item.name || "").trim(); });
    if (invalidItem) {
      state.summary = { type: "error", message: "Give every selected clip a title before uploading." };
      renderUpload();
      return;
    }
    if (!state.host) {
      state.summary = { type: "error", message: "Enter a host name before uploading." };
      renderUpload();
      return;
    }

    state.isUploading = true;
    state.summary = { type: "info", message: `Uploading ${pluralize(pendingItems.length, "clip")} in order…` };
    renderUploadIfActive({ preserveScroll: true });
    let completed = 0;
    let failed = 0;
    let processingIssues = 0;
    let permissionDenied = false;
    const processingItems = [];

    for (let index = 0; index < pendingItems.length; index += 1) {
      if (!isCurrentRun()) {
        return;
      }
      const item = pendingItems[index];
      item.status = { type: "info", message: "Uploading" };
      item.progress = 14;
      renderUploadIfActive({ preserveScroll: true });

      try {
        // Validate the lightweight auth request first so a legitimate 403 does not
        // cause a potentially large multipart body to be transmitted twice.
        await requestJson(authConfig.mePath || "/auth/me");
        if (!isCurrentRun()) {
          return;
        }
        const payload = await requestJson(uploadConfig.singlePath || "/iosclips", {
          method: "POST",
          withCredentials: uploadConfig.withCredentials,
          retryAuth: false,
          body: buildClipFormData(item, uploader)
        });
        if (!isCurrentRun()) {
          return;
        }
        item.clipId = payload && (payload.id || payload.clipId || getValueByPath(payload, "clip.id"));
        item.uploaded = true;
        profileState.loaded = false;
        completed += 1;
        if (item.clipId) {
          item.status = { type: "info", message: "Uploaded · queued for processing" };
          item.progress = 28;
          processingItems.push(item);
        } else {
          item.status = { type: "success", message: "Uploaded" };
          item.progress = 100;
        }
      } catch (error) {
        if (!isCurrentRun()) {
          return;
        }
        failed += 1;
        item.status = {
          type: "error",
          message: error.status === 403 ? "Administrator upload access required" : (error.message || "Upload failed")
        };
        item.progress = item.progress || 0;

        if (error.status === 403) {
          permissionDenied = true;
          pendingItems.slice(index + 1).forEach(function (remaining) {
            remaining.status = { type: "error", message: "Not uploaded · administrator access required" };
            remaining.progress = 0;
          });
          failed += pendingItems.length - index - 1;
          state.summary = { type: "error", message: uploadPermissionMessage() };
          break;
        }
      }
      renderUploadIfActive({ preserveScroll: true });
    }

    if (!isCurrentRun()) {
      return;
    }

    if (processingItems.length) {
      if (!permissionDenied) {
        state.summary = {
          type: "info",
          message: `${pluralize(completed, "clip")} uploaded. Finishing ${pluralize(processingItems.length, "processing job")}…`
        };
      }
      renderUploadIfActive({ preserveScroll: true });
      const processingResults = await Promise.all(processingItems.map(async function (item) {
        try {
          await pollClipProcessing(item, isCurrentRun);
          return true;
        } catch (error) {
          if (isCurrentRun()) {
            item.status = {
              type: "error",
              message: error.message ? `Uploaded · ${error.message}` : "Uploaded · processing status unavailable"
            };
            item.progress = 100;
            updateUploadItemProgress(item);
          }
          return false;
        }
      }));
      processingIssues = processingResults.filter(function (succeeded) { return !succeeded; }).length;
    }

    if (!isCurrentRun()) {
      return;
    }

    state.isUploading = false;
    profileState.loaded = false;
    if (!permissionDenied) {
      if (failed) {
        state.summary = { type: "error", message: `${completed} uploaded, ${failed} not uploaded. Review each clip below.` };
      } else if (processingIssues) {
        state.summary = {
          type: "info",
          message: `${pluralize(completed, "clip")} uploaded. ${pluralize(processingIssues, "clip")} needs processing attention, but the media will not be uploaded again.`
        };
      } else {
        state.summary = { type: "success", message: `${pluralize(completed, "clip")} uploaded successfully. They are now available from your profile.` };
      }
    }
    renderUploadIfActive({ preserveScroll: true });
    if (completed) {
      showToast(`${pluralize(completed, "clip")} added to Voxxly.`);
    }
  }

  function getFollowCount(counts, keys) {
    for (let index = 0; index < keys.length; index += 1) {
      const value = counts && counts[keys[index]];
      if (value != null && !Number.isNaN(Number(value))) {
        return Number(value);
      }
    }
    return 0;
  }

  function renderProfileClip(clip) {
    const streamUrl = getSafeMediaUrl(clip.streamUrl, `/iosclips/${clip.id}/stream`);
    const posterUrl = getSafeMediaUrl(clip.thumbnailUrl);
    return `
      <article class="profile-clip">
        <video controls playsinline preload="metadata" src="${escapeHtml(streamUrl)}" ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ""} aria-label="Play ${escapeHtml(clip.name || "soundbite")}"></video>
        <div class="profile-clip-copy">
          <h3 title="${escapeHtml(clip.name || "Untitled soundbite")}">${escapeHtml(clip.name || "Untitled soundbite")}</h3>
          <p>Soundbite #${escapeHtml(clip.id)}</p>
        </div>
      </article>
    `;
  }

  function renderProfile() {
    const clipCount = profileState.clips.length;
    const followerCount = getFollowCount(profileState.counts, ["followerCount", "followersCount", "followers"]);
    const followingCount = getFollowCount(profileState.counts, ["followingCount", "followedCount", "following"]);
    let clipsMarkup = "";

    if ((!profileState.loaded && !profileState.error) || (profileState.loading && !profileState.loaded)) {
      clipsMarkup = `<div class="skeleton skeleton-card" role="status" aria-label="Loading your videos"></div>`;
    } else if (profileState.error) {
      clipsMarkup = `
        <div class="panel error-state">
          <div class="stack-tight">
            <h2>We couldn’t load your videos.</h2>
            <p class="muted">${escapeHtml(profileState.error)}</p>
            <div class="actions" style="justify-content:center"><button id="retryProfile" class="primary-button" type="button">Try again</button></div>
          </div>
        </div>
      `;
    } else if (clipCount) {
      clipsMarkup = `<div class="clip-grid">${profileState.clips.map(renderProfileClip).join("")}</div>`;
    } else {
      clipsMarkup = `
        <div class="panel empty-state">
          <div class="stack-tight">
            <h2>No uploads on your profile yet.</h2>
            <p class="muted">Accounts with administrator upload access can add one clip or an entire queue from the upload studio.</p>
            <div class="actions" style="justify-content:center"><a class="primary-button" href="#/upload">Open upload studio</a></div>
          </div>
        </div>
      `;
    }

    app.innerHTML = `
      <section class="page-wrap" aria-labelledby="profileTitle">
        <div class="panel profile-hero">
          ${avatarMarkup(currentUser, currentUser.username, "profile-avatar")}
          <div>
            <p class="page-kicker">Your profile</p>
            <h1 id="profileTitle" class="profile-name">${escapeHtml(currentUser.username || "Voxxly creator")}</h1>
            <p class="profile-handle">${escapeHtml(currentUser.email || "")}</p>
          </div>
          <div class="profile-stats" aria-label="Profile statistics">
            <div class="profile-stat"><strong>${formatCount(clipCount)}</strong><span>Videos</span></div>
            <div class="profile-stat"><strong>${formatCount(followerCount)}</strong><span>Followers</span></div>
            <div class="profile-stat"><strong>${formatCount(followingCount)}</strong><span>Following</span></div>
          </div>
        </div>
        <section class="profile-section" aria-labelledby="videosTitle">
          <div class="profile-section-head">
            <div>
              <p class="page-kicker">Your library</p>
              <h2 id="videosTitle" class="section-title">Uploaded videos</h2>
            </div>
            <div class="actions">
              <button id="refreshProfile" class="secondary-button" type="button" ${profileState.loading ? "disabled" : ""}>Refresh</button>
              <a class="primary-button" href="#/upload">Upload clips</a>
            </div>
          </div>
          ${clipsMarkup}
        </section>
      </section>
    `;

    const refreshButton = document.getElementById("refreshProfile");
    if (refreshButton) {
      refreshButton.addEventListener("click", function () {
        profileState.loaded = false;
        profileState.error = "";
        loadProfile();
      });
    }
    const retryButton = document.getElementById("retryProfile");
    if (retryButton) {
      retryButton.addEventListener("click", loadProfile);
    }

    if (!profileState.loaded && !profileState.loading) {
      window.queueMicrotask(loadProfile);
    }
  }

  async function loadProfile() {
    if (!currentUser || profileState.loading) {
      return;
    }

    const state = profileState;
    const generation = sessionGeneration;
    const userId = currentUser.id;
    const isCurrentRequest = function () {
      return profileState === state && sessionGeneration === generation && currentUser && String(currentUser.id) === String(userId);
    };
    state.loading = true;
    state.error = "";
    if (getRoute() === routes.profile) {
      renderProfile();
    }

    const clipsPath = fillPathTemplate(profileConfig.clipsPathTemplate || "/ios/users/{userId}/clips", { userId: userId });
    const countsPath = fillPathTemplate(profileConfig.followCountsPathTemplate || "/ios/users/{userId}/follow-counts", { userId: userId });

    try {
      const clips = await requestJson(clipsPath);
      if (!isCurrentRequest()) {
        return;
      }
      if (!Array.isArray(clips)) {
        throw new ApiError("Your profile returned an unexpected video list.", 500, clips);
      }
      const counts = await requestJson(countsPath).catch(function () { return null; });
      if (!isCurrentRequest()) {
        return;
      }
      state.clips = clips;
      state.counts = counts;
      state.loaded = true;
    } catch (error) {
      if (isCurrentRequest()) {
        state.error = error.message || "Unable to load your profile videos.";
      }
    } finally {
      state.loading = false;
      if (isCurrentRequest() && getRoute() === routes.profile) {
        renderProfile();
      }
    }
  }

  function render() {
    let route = getRoute();
    if (!route) {
      navigate(currentUser ? routes.feed : routes.login);
      return;
    }

    if (!currentUser && protectedRoutes.has(route)) {
      pendingProtectedHash = window.location.hash;
      navigate(routes.login);
      return;
    }

    if (currentUser && (route === routes.login || route === routes.signup)) {
      navigate(routes.feed);
      return;
    }

    if (activeRoute === routes.feed && route !== routes.feed) {
      cleanupFeedObservers(true);
    }

    if (route === routes.feed) {
      const nextSharedClipId = getHashQueryParam("clip");
      if (String(nextSharedClipId || "") !== String(feedState.sharedClipId || "")) {
        if (activeRoute === routes.feed) {
          cleanupFeedObservers(true);
        }
        feedState = createFeedState(nextSharedClipId);
        feedWatchRecords = new Map();
      }
    }

    activeRoute = route;
    syncShell(route);

    switch (route) {
      case routes.signup:
        renderSignup();
        break;
      case routes.feed:
        renderFeed();
        break;
      case routes.upload:
        if (!uploadState.host && currentUser) {
          uploadState.host = currentUser.username || "";
        }
        renderUpload();
        break;
      case routes.profile:
        renderProfile();
        break;
      case routes.login:
      default:
        renderLogin();
        break;
    }

    focusPageHeading();
  }

  async function handleLogout() {
    const refreshToken = getRefreshToken();
    logoutButton.disabled = true;
    if (refreshToken) {
      try {
        await requestJson(authConfig.logoutPath || "/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          retryAuth: false,
          body: JSON.stringify({ refreshToken: refreshToken })
        });
      } catch (error) {
        // Local sign-out still completes if the server session is already expired.
      }
    }

    pendingProtectedHash = "";
    clearSession();
    logoutButton.disabled = false;
    authNotice = { type: "success", message: "You’ve been logged out." };
    navigate(routes.login);
  }

  skipLink.addEventListener("click", function () {
    app.focus();
  });
  logoutButton.addEventListener("click", handleLogout);
  window.addEventListener("hashchange", render);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && getRoute() === routes.feed) {
      app.querySelectorAll("[data-feed-video]").forEach(function (video) {
        if (!video.paused) {
          video.pause();
        }
      });
    }
  });

  (async function initialize() {
    syncShell("");
    if (getAccessToken() || getRefreshToken()) {
      try {
        currentUser = await requestJson(authConfig.mePath || "/auth/me");
        uploadState.host = currentUser.username || "";
      } catch (error) {
        clearSession();
        authNotice = { type: "info", message: "Your session ended. Log in to continue." };
      }
    }
    render();
  })();
})();
