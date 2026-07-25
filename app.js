(function () {
  "use strict";

  const app = document.getElementById("app");
  const brandLink = document.getElementById("brandLink");
  const primaryNav = document.getElementById("primaryNav");
  const guestNav = document.getElementById("guestNav");
  const accountLink = document.getElementById("accountLink");
  const logoutButton = document.getElementById("logoutButton");
  const toastRegion = document.getElementById("toastRegion");

  if (!app || !brandLink || !primaryNav || !guestNav || !accountLink || !logoutButton || !toastRegion) {
    return;
  }

  const config = window.APP_CONFIG || {};
  const authConfig = config.auth || {};
  const uploadConfig = config.uploads || {};
  const processingConfig = config.processing || {};
  const feedConfig = config.feed || {};
  const socialConfig = config.social || {};
  const searchConfig = config.search || {};
  const profileConfig = config.profile || {};

  const routes = {
    login: "#/login",
    signup: "#/signup",
    feed: "#/feed",
    saved: "#/saved",
    search: "#/search",
    upload: "#/upload",
    profile: "#/profile",
    connections: "#/connections"
  };

  const protectedRoutes = new Set([routes.feed, routes.saved, routes.search, routes.upload, routes.profile, routes.connections]);
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
      likedIds: new Set(),
      error: "",
      sessionId: randomId("soundbites")
    };
  }

  function createProfileState(userId) {
    return {
      userId: userId ? String(userId) : "",
      user: null,
      clips: [],
      reposts: [],
      repostsVersion: 0,
      counts: null,
      following: false,
      followStateKnown: false,
      followPending: false,
      activeTab: "posts",
      loading: false,
      loaded: false,
      error: ""
    };
  }

  function createSocialState() {
    return {
      savedClips: [],
      repostedClips: [],
      savedIds: new Set(),
      repostedIds: new Set(),
      pendingSaves: new Set(),
      pendingReposts: new Set(),
      loadPromise: null,
      loading: false,
      loaded: false,
      error: ""
    };
  }

  function createSearchState() {
    return {
      query: "",
      results: [],
      loading: false,
      searched: false,
      error: "",
      requestId: 0
    };
  }

  function createConnectionsState(userId, type) {
    return {
      userId: userId ? String(userId) : "",
      type: type === "following" ? "following" : "followers",
      owner: null,
      items: [],
      loading: false,
      loaded: false,
      error: ""
    };
  }

  let feedState = createFeedState();
  let profileState = createProfileState();
  let socialState = createSocialState();
  let searchState = createSearchState();
  let searchDebounceTimer = null;
  let connectionsState = createConnectionsState();
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

    const shouldRetryAuth = response.status === 401 || (response.status === 403 && requestOptions.retryForbidden !== false);
    if (shouldRetryAuth && useAuth && retryAuth && getRefreshToken()) {
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
    brandLink.href = isSignedIn ? routes.feed : routes.login;
    brandLink.setAttribute("aria-label", isSignedIn ? "Voxxly Soundbites" : "Voxxly login");
    primaryNav.classList.toggle("hidden", !isSignedIn);
    guestNav.classList.toggle("hidden", isSignedIn);
    accountLink.classList.toggle("hidden", !isSignedIn);
    logoutButton.classList.toggle("hidden", !isSignedIn);

    if (isSignedIn) {
      accountLink.innerHTML = avatarMarkup(currentUser, currentUser.username, "header-avatar");
      accountLink.setAttribute("aria-label", `Open @${currentUser.username || "your"} profile`);
      accountLink.setAttribute("title", `@${currentUser.username || "profile"}`);
    } else {
      accountLink.innerHTML = "";
      accountLink.removeAttribute("title");
    }

    const profileUserId = getHashQueryParam("userId");
    const isOwnProfile = route === routes.profile && (!profileUserId || (currentUser && String(profileUserId) === String(currentUser.id)));
    if (isOwnProfile) {
      accountLink.setAttribute("aria-current", "page");
    } else {
      accountLink.removeAttribute("aria-current");
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
      const heading = app.querySelector("#loginTitle, #signupTitle, #feedTitle, #savedTitle, #searchTitle, #uploadTitle, #profileTitle, #connectionsTitle") || app.querySelector("h1");
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
    socialState = createSocialState();
    searchState = createSearchState();
    connectionsState = createConnectionsState();
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
        <h1>Find the moment worth <span class="gradient-word">hearing.</span></h1>
        <p>Standout podcast clips, shaped into a personal feed that learns what keeps you listening.</p>
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
              <p class="auth-subtitle">Continue to your personalized Soundbites.</p>
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
              <button id="loginSubmit" class="primary-button auth-submit" type="submit">Log in</button>
            </form>
            <div class="auth-switch">
              <span>Don’t have an account?</span>
              <a href="#/signup">Create one</a>
            </div>
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

  function getProfileRoute(userId, tab) {
    const params = new URLSearchParams();
    if (userId) {
      params.set("userId", String(userId));
    }
    if (tab === "reposts") {
      params.set("tab", "reposts");
    }
    const query = params.toString();
    return `${routes.profile}${query ? `?${query}` : ""}`;
  }

  function renderSocialButton(kind, clipId) {
    const isSave = kind === "save";
    const active = isSave ? socialState.savedIds.has(String(clipId)) : socialState.repostedIds.has(String(clipId));
    const actionPending = isSave ? socialState.pendingSaves.has(String(clipId)) : socialState.pendingReposts.has(String(clipId));
    const statePending = !socialState.loaded && !socialState.error;
    const pending = actionPending || statePending;
    const label = isSave ? (active ? "Saved" : "Save") : (active ? "Reposted" : "Repost");
    const dataName = isSave ? "save-clip" : "repost-clip";
    const iconName = isSave ? "bookmark" : "repeat-2";
    return `<button class="social-action${active ? " is-active" : ""}" type="button" data-${dataName}="${escapeHtml(clipId)}" aria-label="${label} clip" aria-pressed="${active}" ${statePending ? 'aria-busy="true"' : ""} ${pending ? "disabled" : ""}><span class="feed-action-icon feed-action-icon-${iconName}" aria-hidden="true"></span><span data-social-label>${label}</span></button>`;
  }

  function renderLikeButton(clipId) {
    const active = feedState.likedIds.has(String(clipId));
    const label = active ? "Liked" : "Like";
    return `<button class="social-action${active ? " is-active" : ""}" type="button" data-like-clip="${escapeHtml(clipId)}" aria-label="${label} clip" aria-pressed="${active}"><span class="feed-action-icon feed-action-icon-heart" aria-hidden="true"></span><span data-like-label>${label}</span></button>`;
  }

  function renderFeedItem(item) {
    const creator = creatorCache.get(String(item.iosUserId)) || null;
    const creatorName = (creator && creator.username) || item.creatorName || "Voxxly creator";
    const streamUrl = getSafeMediaUrl(item.streamUrl, `/iosclips/${item.id}/stream`);
    const posterUrl = getSafeMediaUrl(item.thumbnailUrl);
    const fullEpisodeUrl = getSafeMediaUrl(item.fullEpisodeFilepath);
    const sourceUrl = getSafeMediaUrl(item.sourceUrl);
    const episodeUrl = fullEpisodeUrl || sourceUrl;
    const creatorRoute = getProfileRoute(item.iosUserId);

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
          ${item.isMature || item.mature
            ? `<div class="soundbite-labels"><span class="badge badge-warning">Mature${item.minimumAge ? ` · ${escapeHtml(item.minimumAge)}+` : ""}</span></div>`
            : ""}
          <div class="feed-video-copy">
            <a class="feed-overlay-creator" href="${escapeHtml(creatorRoute)}" aria-label="View @${escapeHtml(creatorName)} profile">@${escapeHtml(creatorName)}</a>
            <h2 id="clipTitle-${escapeHtml(item.id)}" class="feed-overlay-title">${escapeHtml(item.name || "Untitled soundbite")}</h2>
            ${episodeUrl
              ? `<a class="feed-full-episode" data-full-episode="${escapeHtml(item.id)}" href="${escapeHtml(episodeUrl)}" target="_blank" rel="noreferrer">Full episode</a>`
              : ""}
          </div>
          <aside class="feed-action-rail" aria-label="Soundbite actions">
            <a class="feed-avatar-link" href="${escapeHtml(creatorRoute)}" aria-label="View @${escapeHtml(creatorName)} profile">
              ${avatarMarkup(creator, creatorName, "feed-creator-avatar")}
            </a>
            ${renderLikeButton(item.id)}
            ${renderSocialButton("save", item.id)}
            ${renderSocialButton("repost", item.id)}
          </aside>
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
            <h1 id="feedTitle" class="page-title">Soundbites</h1>
          </div>
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

    if (!socialState.loaded && !socialState.loading && !socialState.error) {
      window.queueMicrotask(loadSocialCollections);
    }

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
    app.querySelectorAll("[data-like-clip]").forEach(function (button) {
      if (button.dataset.actionBound === "true") {
        return;
      }
      button.dataset.actionBound = "true";
      button.addEventListener("click", handleLikeToggle);
    });
    app.querySelectorAll("[data-save-clip]").forEach(function (button) {
      if (button.dataset.actionBound === "true") {
        return;
      }
      button.dataset.actionBound = "true";
      button.addEventListener("click", function (event) {
        handleSocialToggle(event, "save");
      });
    });
    app.querySelectorAll("[data-repost-clip]").forEach(function (button) {
      if (button.dataset.actionBound === "true") {
        return;
      }
      button.dataset.actionBound = "true";
      button.addEventListener("click", function (event) {
        handleSocialToggle(event, "repost");
      });
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

  function handleLikeToggle(event) {
    const button = event.currentTarget;
    const clipId = String(button.getAttribute("data-like-clip") || "");
    if (!currentUser || !clipId) {
      return;
    }

    const wasLiked = feedState.likedIds.has(clipId);
    if (wasLiked) {
      feedState.likedIds.delete(clipId);
    } else {
      feedState.likedIds.add(clipId);
      const record = getWatchRecord(clipId);
      reportInteraction(clipId, record.watchedSec, { hasLiked: true });
    }

    button.classList.toggle("is-active", !wasLiked);
    button.setAttribute("aria-pressed", String(!wasLiked));
    button.setAttribute("aria-label", `${wasLiked ? "Like" : "Liked"} clip`);
    const label = button.querySelector("[data-like-label]");
    if (label) {
      label.textContent = wasLiked ? "Like" : "Liked";
    }
  }

  function updateSocialActionButtons(clipId) {
    const selector = clipId
      ? `[data-save-clip="${String(clipId)}"], [data-repost-clip="${String(clipId)}"]`
      : "[data-save-clip], [data-repost-clip]";
    app.querySelectorAll(selector).forEach(function (button) {
      const isSave = button.hasAttribute("data-save-clip");
      const id = String(button.getAttribute(isSave ? "data-save-clip" : "data-repost-clip"));
      const active = isSave ? socialState.savedIds.has(id) : socialState.repostedIds.has(id);
      const actionPending = isSave ? socialState.pendingSaves.has(id) : socialState.pendingReposts.has(id);
      const statePending = !socialState.loaded && !socialState.error;
      const pending = actionPending || statePending;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = pending;
      if (statePending) {
        button.setAttribute("aria-busy", "true");
      } else {
        button.removeAttribute("aria-busy");
      }
      const label = button.querySelector("[data-social-label]");
      if (label) {
        const nextLabel = isSave ? (active ? "Saved" : "Save") : (active ? "Reposted" : "Repost");
        label.textContent = nextLabel;
        button.setAttribute("aria-label", `${nextLabel} clip`);
      }
    });
  }

  function findKnownClip(clipId) {
    const id = String(clipId);
    return feedState.items.concat(socialState.savedClips, socialState.repostedClips, profileState.clips, profileState.reposts).find(function (clip) {
      return clip && String(clip.id) === id;
    }) || null;
  }

  function loadSocialCollections() {
    if (!currentUser || socialState.loaded) {
      return Promise.resolve();
    }
    if (socialState.loading) {
      return socialState.loadPromise || Promise.resolve();
    }

    const state = socialState;
    const generation = sessionGeneration;
    const userId = currentUser.id;
    const isCurrentRequest = function () {
      return socialState === state && sessionGeneration === generation && currentUser && String(currentUser.id) === String(userId);
    };
    state.loading = true;
    state.error = "";
    updateSocialActionButtons();
    if (getRoute() === routes.saved) {
      renderSaved();
    }
    const savedPath = fillPathTemplate(socialConfig.savedListPathTemplate || "/ios/users/{userId}/saved-clips", { userId: userId });
    const repostedPath = fillPathTemplate(socialConfig.repostedListPathTemplate || "/ios/users/{userId}/reposted-clips", { userId: userId });
    const task = (async function () {
      try {
        const results = await Promise.all([requestJson(savedPath), requestJson(repostedPath)]);
        if (!isCurrentRequest()) {
          return;
        }
        if (!Array.isArray(results[0]) || !Array.isArray(results[1])) {
          throw new ApiError("Your social collections returned an unexpected response.", 500, results);
        }
        await Promise.all(Array.from(new Set(results[0].concat(results[1]).map(function (clip) {
          return clip && clip.iosUserId;
        }).filter(Boolean))).map(loadCreator));
        if (!isCurrentRequest()) {
          return;
        }
        state.savedClips = results[0];
        state.repostedClips = results[1];
        state.savedIds = new Set(results[0].map(function (clip) { return String(clip.id); }));
        state.repostedIds = new Set(results[1].map(function (clip) { return String(clip.id); }));
        state.loaded = true;
      } catch (error) {
        if (isCurrentRequest()) {
          state.error = error.message || "Unable to load your saved clips and reposts.";
        }
      } finally {
        state.loading = false;
        if (state.loadPromise === task) {
          state.loadPromise = null;
        }
        if (!isCurrentRequest()) {
          return;
        }
        updateSocialActionButtons();
        if (getRoute() === routes.saved) {
          renderSaved();
        }
      }
    })();
    state.loadPromise = task;
    return task;
  }

  async function handleSocialToggle(event, kind) {
    const button = event.currentTarget;
    const isSave = kind === "save";
    const clipId = String(button.getAttribute(isSave ? "data-save-clip" : "data-repost-clip"));
    if (!currentUser || !clipId) {
      return;
    }

    const neededStateSync = !socialState.loaded;
    if (neededStateSync) {
      await loadSocialCollections();
    }
    if (!currentUser || !socialState.loaded) {
      showToast(socialState.error || "Your social actions are unavailable right now.");
      return;
    }
    if (neededStateSync) {
      showToast("Save and repost status updated. Choose your action again.");
      return;
    }

    const state = socialState;
    const generation = sessionGeneration;
    const userId = currentUser.id;
    const activeSet = isSave ? state.savedIds : state.repostedIds;
    const pendingSet = isSave ? state.pendingSaves : state.pendingReposts;
    if (pendingSet.has(clipId)) {
      return;
    }
    const wasActive = activeSet.has(clipId);
    pendingSet.add(clipId);
    updateSocialActionButtons(clipId);

    try {
      const path = isSave ? (socialConfig.savedPath || "/ios/saved-clips") : (socialConfig.repostedPath || "/ios/reposted-clips");
      await requestJson(path, {
        method: wasActive ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iosUserId: Number(userId), iosClipId: Number(clipId) })
      });
      if (socialState !== state || sessionGeneration !== generation || !currentUser || String(currentUser.id) !== String(userId)) {
        return;
      }

      const collection = isSave ? state.savedClips : state.repostedClips;
      if (wasActive) {
        activeSet.delete(clipId);
        const filtered = collection.filter(function (clip) { return String(clip.id) !== clipId; });
        if (isSave) {
          state.savedClips = filtered;
        } else {
          state.repostedClips = filtered;
        }
      } else {
        activeSet.add(clipId);
        const clip = findKnownClip(clipId);
        if (clip && !collection.some(function (candidate) { return String(candidate.id) === clipId; })) {
          collection.unshift(clip);
        }
        const record = getWatchRecord(clipId);
        reportInteraction(clipId, record.watchedSec, isSave ? { hasSavedClip: true } : { hasRepostedClip: true });
      }

      if (!isSave && profileState.userId === String(userId)) {
        profileState.reposts = state.repostedClips.slice();
        profileState.repostsVersion += 1;
      }
    } catch (error) {
      showToast(error.message || `Unable to ${isSave ? "save" : "repost"} this clip.`);
    } finally {
      if (socialState === state) {
        pendingSet.delete(clipId);
        updateSocialActionButtons(clipId);
        if (getRoute() === routes.saved) {
          renderSaved();
        } else if (getRoute() === routes.profile && profileState.userId === String(userId)) {
          renderProfile();
        }
      }
    }
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
          feedList.insertAdjacentHTML("beforeend", newItems.map(renderFeedItem).join(""));
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

  function renderSavedClip(clip) {
    const streamUrl = getSafeMediaUrl(clip.streamUrl, `/iosclips/${clip.id}/stream`);
    const posterUrl = getSafeMediaUrl(clip.thumbnailUrl);
    const creator = creatorCache.get(String(clip.iosUserId)) || null;
    const creatorName = (creator && creator.username) || clip.creatorName || "Voxxly creator";
    return `
      <article class="profile-clip saved-clip">
        <video controls playsinline preload="metadata" src="${escapeHtml(streamUrl)}" ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ""} aria-label="Play ${escapeHtml(clip.name || "soundbite")}"></video>
        <div class="profile-clip-copy">
          <a class="clip-creator-link" href="${escapeHtml(getProfileRoute(clip.iosUserId))}">@${escapeHtml(creatorName)}</a>
          <h3 title="${escapeHtml(clip.name || "Untitled soundbite")}">${escapeHtml(clip.name || "Untitled soundbite")}</h3>
        </div>
      </article>
    `;
  }

  function renderSaved() {
    let content = "";
    if (socialState.loading && !socialState.loaded) {
      content = `<div class="skeleton skeleton-card" role="status" aria-label="Loading saved clips"></div>`;
    } else if (socialState.error && !socialState.loaded) {
      content = `
        <div class="panel error-state">
          <div class="stack-tight">
            <h2>We couldn’t load your saved clips.</h2>
            <p class="muted">${escapeHtml(socialState.error)}</p>
            <div class="actions" style="justify-content:center"><button id="retrySaved" class="primary-button" type="button">Try again</button></div>
          </div>
        </div>
      `;
    } else if (socialState.savedClips.length) {
      content = `<div class="clip-grid">${socialState.savedClips.map(renderSavedClip).join("")}</div>`;
    } else {
      content = `
        <div class="panel empty-state">
          <div class="stack-tight">
            <h2>No saved clips yet.</h2>
            <p class="muted">Save a Soundbite and it will appear here.</p>
            <div class="actions" style="justify-content:center"><a class="primary-button" href="#/feed">Browse Soundbites</a></div>
          </div>
        </div>
      `;
    }

    app.innerHTML = `
      <section class="page-wrap" aria-labelledby="savedTitle">
        <div class="simple-page-header">
          <div>
            <h1 id="savedTitle" class="page-title">Saved</h1>
            <p class="page-description">The clips you want to come back to.</p>
          </div>
        </div>
        ${content}
      </section>
    `;

    const retryButton = document.getElementById("retrySaved");
    if (retryButton) {
      retryButton.addEventListener("click", function () {
        socialState.error = "";
        loadSocialCollections();
      });
    }
    if (!socialState.loaded && !socialState.loading && !socialState.error) {
      window.queueMicrotask(loadSocialCollections);
    }
  }

  function renderSearchResult(user) {
    return `
      <a class="user-result" href="${escapeHtml(getProfileRoute(user.id))}">
        ${avatarMarkup(user, user.username, "user-result-avatar")}
        <span><strong>${escapeHtml(user.username || "Voxxly user")}</strong><small>@${escapeHtml(user.username || "user")}</small></span>
        <span class="result-arrow" aria-hidden="true">→</span>
      </a>
    `;
  }

  function getSearchResultsMarkup() {
    let results = "";
    if (searchState.loading) {
      results = `<div class="search-loading" role="status">Searching profiles…</div>`;
    } else if (searchState.error) {
      results = `<div class="status status-error" role="alert">${escapeHtml(searchState.error)}</div>`;
    } else if (searchState.results.length) {
      results = `<div class="user-results">${searchState.results.map(renderSearchResult).join("")}</div>`;
    } else if (searchState.searched) {
      results = `<div class="panel empty-state"><div><h2>No profiles found.</h2><p class="muted">Try the beginning of another username.</p></div></div>`;
    } else {
      results = `<div class="search-prompt"><p>Search by username to find people and explore their posts and reposts.</p></div>`;
    }
    return results;
  }

  function updateSearchResults() {
    const results = document.querySelector(".search-results");
    if (results) {
      results.innerHTML = getSearchResultsMarkup();
    }
    const submitButton = document.querySelector("#profileSearchForm button[type='submit']");
    if (submitButton) {
      submitButton.disabled = searchState.loading;
    }
  }

  function renderSearch() {
    app.innerHTML = `
      <section class="page-wrap search-page" aria-labelledby="searchTitle">
        <header class="page-header">
          <h1 id="searchTitle" class="page-title">Search</h1>
          <p class="page-description">Find people on Voxxly.</p>
        </header>
        <form id="profileSearchForm" class="search-form" role="search">
          <label class="sr-only" for="profileSearchInput">Search usernames</label>
          <input id="profileSearchInput" name="query" type="search" autocomplete="off" value="${escapeHtml(searchState.query)}" placeholder="Search @username" maxlength="33" required />
          <button class="primary-button" type="submit" ${searchState.loading ? "disabled" : ""}>Search</button>
        </form>
        <div class="search-results" aria-live="polite">${getSearchResultsMarkup()}</div>
      </section>
    `;

    document.getElementById("profileSearchForm").addEventListener("submit", handleProfileSearch);
    document.getElementById("profileSearchInput").addEventListener("input", handleProfileSearchInput);
  }

  function normalizeProfileSearchQuery(value) {
    return String(value || "").trim().replace(/^@+/, "");
  }

  function validateProfileSearchQuery(query) {
    if (!query || query.length > 32 || !/^[A-Za-z0-9._-]+$/.test(query)) {
      return query ? "Use 1–32 letters, numbers, periods, underscores, or dashes." : "";
    }
    return "";
  }

  function handleProfileSearchInput(event) {
    window.clearTimeout(searchDebounceTimer);
    const query = normalizeProfileSearchQuery(event.currentTarget.value);
    const validationError = validateProfileSearchQuery(query);

    searchState.requestId += 1;
    searchState.query = query;
    searchState.results = [];
    searchState.loading = Boolean(query && !validationError);
    searchState.searched = Boolean(query);
    searchState.error = validationError;
    updateSearchResults();

    if (!query || validationError) {
      return;
    }

    searchDebounceTimer = window.setTimeout(function () {
      searchProfiles(query);
    }, 250);
  }

  function handleProfileSearch(event) {
    event.preventDefault();
    window.clearTimeout(searchDebounceTimer);
    const query = normalizeProfileSearchQuery(event.currentTarget.elements.query.value);
    const validationError = validateProfileSearchQuery(query);

    if (!query || validationError) {
      searchState.requestId += 1;
      searchState.query = query;
      searchState.results = [];
      searchState.loading = false;
      searchState.searched = Boolean(query);
      searchState.error = validationError;
      updateSearchResults();
      return;
    }

    searchProfiles(query);
  }

  async function searchProfiles(query) {
    const state = searchState;
    const generation = sessionGeneration;
    const userId = currentUser && currentUser.id;
    const requestId = state.requestId + 1;
    state.requestId = requestId;
    state.query = query;
    state.loading = true;
    state.searched = true;
    state.error = "";
    updateSearchResults();

    try {
      const url = new URL(getApiUrl(searchConfig.usersPath || "/ios/users/search"));
      url.searchParams.set("q", query);
      const payload = await requestJson(url.toString());
      if (searchState !== state || state.requestId !== requestId || sessionGeneration !== generation || !currentUser || String(currentUser.id) !== String(userId)) {
        return;
      }
      if (!Array.isArray(payload)) {
        throw new ApiError("Profile search returned an unexpected response.", 500, payload);
      }
      state.results = payload.filter(function (user) {
        return user && user.id != null && typeof user.username === "string" && user.username.length > 0;
      }).map(function (user) {
        return { id: user.id, username: user.username, profilePhotoUrl: user.profilePhotoUrl };
      });
    } catch (error) {
      if (searchState === state && state.requestId === requestId) {
        state.results = [];
        state.error = error.message || "Unable to search profiles right now.";
      }
    } finally {
      if (searchState === state && state.requestId === requestId) {
        state.loading = false;
        if (getRoute() === routes.search) {
          updateSearchResults();
        }
      }
    }
  }

  function renderProfileClip(clip, options) {
    const renderOptions = options || {};
    const streamUrl = getSafeMediaUrl(clip.streamUrl, `/iosclips/${clip.id}/stream`);
    const posterUrl = getSafeMediaUrl(clip.thumbnailUrl);
    const creator = creatorCache.get(String(clip.iosUserId)) || null;
    const creatorName = (creator && creator.username) || clip.creatorName || "Voxxly creator";
    return `
      <article class="profile-clip">
        <video controls playsinline preload="metadata" src="${escapeHtml(streamUrl)}" ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ""} aria-label="Play ${escapeHtml(clip.name || "soundbite")}"></video>
        <div class="profile-clip-copy">
          ${renderOptions.showCreator ? `<a class="clip-creator-link" href="${escapeHtml(getProfileRoute(clip.iosUserId))}">@${escapeHtml(creatorName)}</a>` : ""}
          <h3 title="${escapeHtml(clip.name || "Untitled soundbite")}">${escapeHtml(clip.name || "Untitled soundbite")}</h3>
        </div>
      </article>
    `;
  }

  function renderProfile() {
    const state = profileState;
    const targetUserId = state.userId || (currentUser && String(currentUser.id)) || "";
    const isOwnProfile = currentUser && String(currentUser.id) === String(targetUserId);
    const knownUser = state.user || (isOwnProfile ? currentUser : null);

    if (!knownUser) {
      const unavailable = Boolean(state.error);
      app.innerHTML = `
        <section class="page-wrap" aria-labelledby="profileTitle">
          <header class="page-header">
            <h1 id="profileTitle" class="page-title">${unavailable ? "Profile unavailable" : "Profile"}</h1>
          </header>
          ${unavailable
            ? `<div class="panel error-state"><div class="stack-tight"><h2>We couldn’t load this profile.</h2><p class="muted">${escapeHtml(state.error)}</p><div class="actions" style="justify-content:center"><a class="secondary-button" href="#/search">Back to Search</a><button id="retryProfile" class="primary-button" type="button">Try again</button></div></div></div>`
            : `<div class="skeleton skeleton-card" role="status" aria-label="Loading profile"></div>`}
        </section>
      `;

      const retryButton = document.getElementById("retryProfile");
      if (retryButton) {
        retryButton.addEventListener("click", function () {
          state.error = "";
          loadProfile();
        });
      }
      if (!state.loaded && !state.loading && !state.error) {
        window.queueMicrotask(loadProfile);
      }
      return;
    }

    const user = knownUser;
    const clipCount = state.clips.length;
    const followerCount = getFollowCount(state.counts, ["followerCount", "followersCount", "followers"]);
    const followingCount = getFollowCount(state.counts, ["followingCount", "followedCount", "following"]);
    const followerDisplay = state.counts ? formatCount(followerCount) : "—";
    const followingDisplay = state.counts ? formatCount(followingCount) : "—";
    const activeCollection = state.activeTab === "reposts" ? state.reposts : state.clips;
    let clipsMarkup = "";

    if ((!state.loaded && !state.error) || (state.loading && !state.loaded)) {
      clipsMarkup = `<div class="skeleton skeleton-card" role="status" aria-label="Loading profile clips"></div>`;
    } else if (state.error) {
      clipsMarkup = `
        <div class="panel error-state">
          <div class="stack-tight">
            <h2>We couldn’t load this profile.</h2>
            <p class="muted">${escapeHtml(state.error)}</p>
            <div class="actions" style="justify-content:center"><button id="retryProfile" class="primary-button" type="button">Try again</button></div>
          </div>
        </div>
      `;
    } else if (activeCollection.length) {
      clipsMarkup = `<div class="clip-grid">${activeCollection.map(function (clip) {
        return renderProfileClip(clip, { showCreator: state.activeTab === "reposts" });
      }).join("")}</div>`;
    } else {
      const emptyTitle = state.activeTab === "reposts" ? "No reposts yet." : "No posts yet.";
      const emptyCopy = state.activeTab === "reposts"
        ? `${isOwnProfile ? "Clips you repost" : "Clips reposted by this user"} will appear here.`
        : (isOwnProfile ? "Your uploaded clips will appear here." : "This user has not posted any clips yet.");
      clipsMarkup = `
        <div class="panel empty-state">
          <div class="stack-tight">
            <h2>${escapeHtml(emptyTitle)}</h2>
            <p class="muted">${escapeHtml(emptyCopy)}</p>
          </div>
        </div>
      `;
    }

    app.innerHTML = `
      <section class="page-wrap" aria-labelledby="profileTitle">
        <div class="panel profile-hero">
          ${avatarMarkup(user, user.username, "profile-avatar")}
          <div class="profile-identity">
            <h1 id="profileTitle" class="profile-name">${escapeHtml(user.username || "Voxxly creator")}</h1>
            <p class="profile-handle">@${escapeHtml(user.username || "creator")}</p>
            ${!isOwnProfile && state.loaded
              ? (state.followStateKnown
                ? `<button id="followProfile" class="${state.following ? "secondary-button" : "primary-button"} follow-button" type="button" aria-pressed="${state.following}" ${state.followPending ? "disabled" : ""}>${state.followPending ? "Updating…" : (state.following ? "Following" : "Follow")}</button>`
                : `<button class="secondary-button follow-button" type="button" disabled>Follow unavailable</button>`)
              : ""}
          </div>
          <div class="profile-stats" aria-label="Profile statistics">
            <div class="profile-stat"><strong>${formatCount(clipCount)}</strong><span>Posts</span></div>
            <a class="profile-stat" href="${routes.connections}?userId=${encodeURIComponent(targetUserId)}&type=followers"><strong>${followerDisplay}</strong><span>Followers</span></a>
            <a class="profile-stat" href="${routes.connections}?userId=${encodeURIComponent(targetUserId)}&type=following"><strong>${followingDisplay}</strong><span>Following</span></a>
          </div>
        </div>
        <section class="profile-section" aria-labelledby="profileClipsTitle">
          <div class="profile-section-head">
            <nav class="profile-tabs" aria-label="Profile clips">
              <a class="profile-tab${state.activeTab === "posts" ? " is-active" : ""}" href="${escapeHtml(getProfileRoute(targetUserId))}" ${state.activeTab === "posts" ? 'aria-current="page"' : ""}>Posts <span>${formatCount(state.clips.length)}</span></a>
              <a class="profile-tab${state.activeTab === "reposts" ? " is-active" : ""}" href="${escapeHtml(getProfileRoute(targetUserId, "reposts"))}" ${state.activeTab === "reposts" ? 'aria-current="page"' : ""}>Reposts <span>${formatCount(state.reposts.length)}</span></a>
            </nav>
            <h2 id="profileClipsTitle" class="sr-only">${state.activeTab === "reposts" ? "Reposted clips" : "Posted clips"}</h2>
          </div>
          ${clipsMarkup}
        </section>
      </section>
    `;

    const retryButton = document.getElementById("retryProfile");
    if (retryButton) {
      retryButton.addEventListener("click", function () {
        state.error = "";
        loadProfile();
      });
    }

    const followButton = document.getElementById("followProfile");
    if (followButton) {
      followButton.addEventListener("click", handleFollowToggle);
    }

    if (!profileState.loaded && !profileState.loading && !profileState.error) {
      window.queueMicrotask(loadProfile);
    }
  }

  async function loadProfile() {
    if (!currentUser || profileState.loading || !profileState.userId) {
      return;
    }

    const state = profileState;
    const generation = sessionGeneration;
    const viewerId = currentUser.id;
    const targetUserId = state.userId;
    const repostsVersion = state.repostsVersion;
    const isCurrentRequest = function () {
      return profileState === state && sessionGeneration === generation && currentUser && String(currentUser.id) === String(viewerId) && state.userId === String(targetUserId);
    };
    state.loading = true;
    state.error = "";
    if (getRoute() === routes.profile) {
      renderProfile();
    }

    const userPath = fillPathTemplate(profileConfig.userPathTemplate || "/ios/users/{userId}", { userId: targetUserId });
    const clipsPath = fillPathTemplate(profileConfig.clipsPathTemplate || "/ios/users/{userId}/clips", { userId: targetUserId });
    const repostedPath = fillPathTemplate(profileConfig.repostedClipsPathTemplate || "/ios/users/{userId}/reposted-clips", { userId: targetUserId });
    const countsPath = fillPathTemplate(profileConfig.followCountsPathTemplate || "/ios/users/{userId}/follow-counts", { userId: targetUserId });
    const followStatePath = fillPathTemplate(socialConfig.followStatePathTemplate || "/ios/users/{viewerId}/follows/{creatorId}", { viewerId: viewerId, creatorId: targetUserId });

    try {
      const results = await Promise.all([
        String(targetUserId) === String(viewerId) ? Promise.resolve(currentUser) : requestJson(userPath),
        requestJson(clipsPath),
        requestJson(repostedPath),
        requestJson(countsPath).catch(function () { return null; }),
        String(targetUserId) === String(viewerId) ? Promise.resolve({ following: false }) : requestJson(followStatePath).catch(function () { return null; })
      ]);
      if (!isCurrentRequest()) {
        return;
      }
      if (!Array.isArray(results[1]) || !Array.isArray(results[2])) {
        throw new ApiError("This profile returned an unexpected clip list.", 500, results);
      }
      await Promise.all(Array.from(new Set(results[2].map(function (clip) { return clip.iosUserId; }).filter(Boolean))).map(loadCreator));
      if (!isCurrentRequest()) {
        return;
      }
      state.user = { id: results[0].id, username: results[0].username, profilePhotoUrl: results[0].profilePhotoUrl };
      state.clips = results[1];
      if (state.repostsVersion === repostsVersion) {
        state.reposts = results[2];
      }
      state.counts = results[3];
      state.followStateKnown = String(targetUserId) === String(viewerId) || Boolean(results[4] && typeof results[4].following === "boolean");
      state.following = Boolean(results[4] && results[4].following);
      state.loaded = true;
    } catch (error) {
      if (isCurrentRequest()) {
        state.error = error.message || "Unable to load this profile.";
      }
    } finally {
      state.loading = false;
      if (isCurrentRequest() && getRoute() === routes.profile) {
        renderProfile();
      }
    }
  }

  async function handleFollowToggle() {
    if (!currentUser || !profileState.followStateKnown || profileState.followPending || !profileState.userId || String(profileState.userId) === String(currentUser.id)) {
      return;
    }

    const state = profileState;
    const generation = sessionGeneration;
    const viewerId = currentUser.id;
    const targetUserId = state.userId;
    const wasFollowing = state.following;
    const activeButton = document.getElementById("followProfile");
    state.followPending = true;
    if (activeButton) {
      activeButton.disabled = true;
      activeButton.textContent = "Updating…";
    }

    try {
      const payload = await requestJson(socialConfig.followPath || "/ios/follows", {
        method: wasFollowing ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        retryForbidden: false,
        body: JSON.stringify({ followerUserId: Number(viewerId), followedUserId: Number(targetUserId) })
      });
      if (profileState !== state || sessionGeneration !== generation || !currentUser || String(currentUser.id) !== String(viewerId)) {
        return;
      }
      state.following = payload && typeof payload.following === "boolean" ? payload.following : !wasFollowing;
      if (state.counts) {
        const currentCount = getFollowCount(state.counts, ["followerCount", "followersCount", "followers"]);
        const followDelta = Number(state.following) - Number(wasFollowing);
        state.counts = { ...state.counts, followerCount: Math.max(0, currentCount + followDelta) };
      }
      const cachedListChanged = (
        connectionsState.userId === String(targetUserId) && connectionsState.type === "followers"
      ) || (
        connectionsState.userId === String(viewerId) && connectionsState.type === "following"
      );
      if (cachedListChanged) {
        connectionsState = createConnectionsState(connectionsState.userId, connectionsState.type);
      }
      showToast(state.following ? `Following @${state.user.username}.` : `Unfollowed @${state.user.username}.`);
    } catch (error) {
      showToast(error.message || "Unable to update this follow right now.");
    } finally {
      if (profileState === state) {
        state.followPending = false;
        if (getRoute() === routes.profile) {
          renderProfile();
          window.requestAnimationFrame(function () {
            const nextButton = document.getElementById("followProfile");
            if (nextButton) {
              nextButton.focus({ preventScroll: true });
            }
          });
        }
      }
    }
  }

  function renderConnectionRow(user) {
    return `
      <a class="user-result" href="${escapeHtml(getProfileRoute(user.id))}">
        ${avatarMarkup(user, user.username, "user-result-avatar")}
        <span><strong>${escapeHtml(user.username || "Voxxly user")}</strong><small>@${escapeHtml(user.username || "user")}</small></span>
        <span class="result-arrow" aria-hidden="true">→</span>
      </a>
    `;
  }

  function renderConnections() {
    const state = connectionsState;
    const ownerName = (state.owner && state.owner.username) || "profile";
    const label = state.type === "following" ? "Following" : "Followers";
    let content = "";
    if (state.loading && !state.loaded) {
      content = `<div class="search-loading" role="status">Loading ${label.toLowerCase()}…</div>`;
    } else if (state.error) {
      content = `
        <div class="panel error-state">
          <div class="stack-tight">
            <h2>We couldn’t load this list.</h2>
            <p class="muted">${escapeHtml(state.error)}</p>
            <div class="actions" style="justify-content:center"><button id="retryConnections" class="primary-button" type="button">Try again</button></div>
          </div>
        </div>
      `;
    } else if (state.items.length) {
      content = `<div class="user-results">${state.items.map(renderConnectionRow).join("")}</div>`;
    } else if (state.loaded) {
      content = `<div class="panel empty-state"><div><h2>No ${label.toLowerCase()} yet.</h2><p class="muted">This list will update as connections are made.</p></div></div>`;
    }

    app.innerHTML = `
      <section class="page-wrap connections-page" aria-labelledby="connectionsTitle">
        <a class="back-link" href="${escapeHtml(getProfileRoute(state.userId))}">← Back to @${escapeHtml(ownerName)}</a>
        <header class="page-header">
          <h1 id="connectionsTitle" class="page-title">${label}</h1>
          <p class="page-description">@${escapeHtml(ownerName)}</p>
        </header>
        ${content}
      </section>
    `;

    const retryButton = document.getElementById("retryConnections");
    if (retryButton) {
      retryButton.addEventListener("click", function () {
        state.error = "";
        loadConnections();
      });
    }

    if (!state.loaded && !state.loading && !state.error) {
      window.queueMicrotask(loadConnections);
    }
  }

  async function loadConnections() {
    if (!currentUser || connectionsState.loading || !connectionsState.userId) {
      return;
    }
    const state = connectionsState;
    const generation = sessionGeneration;
    const viewerId = currentUser.id;
    const userId = state.userId;
    const isCurrentRequest = function () {
      return connectionsState === state && sessionGeneration === generation && currentUser && String(currentUser.id) === String(viewerId);
    };
    state.loading = true;
    state.error = "";
    renderConnections();

    const userPath = fillPathTemplate(profileConfig.userPathTemplate || "/ios/users/{userId}", { userId: userId });
    const listTemplate = state.type === "following"
      ? (profileConfig.followingPathTemplate || "/ios/users/{userId}/following")
      : (profileConfig.followersPathTemplate || "/ios/users/{userId}/followers");
    const listPath = fillPathTemplate(listTemplate, { userId: userId });

    try {
      const results = await Promise.all([
        String(userId) === String(viewerId) ? Promise.resolve(currentUser) : requestJson(userPath),
        requestJson(listPath)
      ]);
      if (!isCurrentRequest()) {
        return;
      }
      if (!Array.isArray(results[1])) {
        throw new ApiError("This connection list returned an unexpected response.", 500, results[1]);
      }
      state.owner = { id: results[0].id, username: results[0].username, profilePhotoUrl: results[0].profilePhotoUrl };
      state.items = results[1].map(function (user) {
        return { id: user.id, username: user.username, profilePhotoUrl: user.profilePhotoUrl };
      });
      state.loaded = true;
    } catch (error) {
      if (isCurrentRequest()) {
        state.error = error.message || "Unable to load this connection list.";
      }
    } finally {
      state.loading = false;
      if (isCurrentRequest() && getRoute() === routes.connections) {
        renderConnections();
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

    if (activeRoute === routes.search && route !== routes.search) {
      window.clearTimeout(searchDebounceTimer);
      searchState.requestId += 1;
      searchState.loading = false;
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

    if (route === routes.profile && currentUser) {
      const targetUserId = getHashQueryParam("userId") || String(currentUser.id);
      const targetTab = getHashQueryParam("tab") === "reposts" ? "reposts" : "posts";
      if (profileState.userId !== String(targetUserId)) {
        profileState = createProfileState(targetUserId);
      }
      profileState.activeTab = targetTab;
    }

    if (route === routes.connections && currentUser) {
      const targetUserId = getHashQueryParam("userId") || String(currentUser.id);
      const listType = getHashQueryParam("type") === "following" ? "following" : "followers";
      if (connectionsState.userId !== String(targetUserId) || connectionsState.type !== listType) {
        connectionsState = createConnectionsState(targetUserId, listType);
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
      case routes.saved:
        renderSaved();
        break;
      case routes.search:
        renderSearch();
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
      case routes.connections:
        renderConnections();
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
