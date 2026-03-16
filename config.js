window.APP_CONFIG = {
  apiBaseUrl: "https://api.rhapsidious.com",
  auth: {
    loginPath: "/api/admin/auth/login",
    mode: "bearer",
    usernameField: "username",
    passwordField: "password",
    tokenResponseField: "token",
    tokenStorageKey: "rhapsidious_upload_admin_token",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
    withCredentials: false
  },
  uploads: {
    singlePath: "/api/admin/clips",
    multiPath: "/api/admin/clips/bulk",
    titleField: "title",
    singleFileField: "file",
    multiFileField: "files",
    withCredentials: false
  }
};
