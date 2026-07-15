window.APP_CONFIG = {
  apiBaseUrl: "https://dev-backend-withered-thunder-4589.fly.dev",
  auth: {
    loginPath: "/auth/login",
    registerPath: "/ios/users",
    refreshPath: "/auth/refresh",
    logoutPath: "/auth/logout",
    mePath: "/auth/me",
    mode: "bearer",
    accessTokenResponseField: "accessToken",
    refreshTokenResponseField: "refreshToken",
    accessTokenStorageKey: "voxxly_web_access_token",
    refreshTokenStorageKey: "voxxly_web_refresh_token",
    deviceIdStorageKey: "voxxly_web_device_id",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
    withCredentials: false
  },
  uploads: {
    singlePath: "/iosclips",
    iosUserIdField: "iosUserId",
    titleField: "name",
    singleFileField: "file",
    guestCsvField: "guestCsv",
    hostField: "host",
    maxFileSizeMb: 100,
    withCredentials: false
  },
  processing: {
    statusPath: "/processing/status",
    clipIdQueryParam: "clipId",
    statusResponseField: "status",
    pollIntervalMs: 1500,
    maxPollAttempts: 80
  },
  feed: {
    path: "/iosclips/feed",
    interactionPath: "/iosclips/interactions",
    batchSize: 10
  },
  profile: {
    clipsPathTemplate: "/ios/users/{userId}/clips",
    followCountsPathTemplate: "/ios/users/{userId}/follow-counts",
    userPathTemplate: "/ios/users/{userId}"
  }
};
