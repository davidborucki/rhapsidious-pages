# Rhapsidious Upload Admin

Small static admin app for `upload.rhapsidious.com`.

## What it does

- Requires login first
- Shows only two primary actions after login
- Supports single clip upload with title + file
- Supports multi-clip upload with upload progress
- Displays clear success and error states
- Can be deployed as static files or from the included Nginx container

## Spring Boot integration

Update [`config.js`](/Users/daveborucki/rhapsidious-pages/config.js) to match your backend:

- `apiBaseUrl`: Spring Boot API origin
- `auth.loginPath`: login endpoint
- `auth.tokenResponseField`: JSON field containing the token
- `uploads.singlePath`: single clip upload endpoint
- `uploads.multiPath`: multi-clip upload endpoint
- `uploads.titleField`, `uploads.singleFileField`, `uploads.multiFileField`: multipart field names expected by your controller

Default assumptions:

- `POST /api/admin/auth/login`
- JSON body with `username` and `password`
- JSON response with `token`
- `POST /api/admin/clips` accepts multipart `title` + `file`
- `POST /api/admin/clips/bulk` accepts multipart `files`
- Bearer token auth

If your backend uses cookies instead of bearer tokens, set:

```js
auth: {
  mode: "cookie",
  withCredentials: true
}
```

And enable `uploads.withCredentials`.

## Local run

Open [`index.html`](/Users/daveborucki/rhapsidious-pages/index.html) directly, or serve the directory with any static web server.

## Deploy

### Static hosting

Deploy the files at the repo root to `upload.rhapsidious.com`.

### Docker / Nginx

```bash
docker build -t rhapsidious-upload-admin .
docker run -p 8080:80 rhapsidious-upload-admin
```

Point your subdomain to the container or reverse proxy it through your existing Nginx setup.
