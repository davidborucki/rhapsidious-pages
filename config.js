window.APP_CONFIG = {
  apiBaseUrl: "https://api.rhapsidious.com",
  auth: {
    loginPath: "/auth/login",
    mePath: "/auth/me",
    mode: "bearer",
    tokenResponseField: "accessToken",
    tokenStorageKey: "rhapsidious_upload_admin_token",
    deviceIdStorageKey: "rhapsidious_upload_admin_device_id",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
    withCredentials: false
  },
  uploads: {
    singlePath: "/iosclips",
    importPath: "/iosclips/import",
    iosUserIdField: "iosUserId",
    titleField: "name",
    singleFileField: "file",
    withCredentials: false
  }
};
