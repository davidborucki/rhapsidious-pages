# Voxxly Web

A dependency-free web client for Voxxly. It uses the existing Spring Boot API for accounts, authentication, creator uploads, profile videos, and the personalized Soundbites feed.

## Features

- Voxxly branding with the supplied logo and Helvetica-first typography
- Account creation followed by automatic JWT sign-in
- Access-token refresh and server logout
- Personalized, continuously loaded Soundbites recommendations
- Automatic play/pause behavior and recommendation watch/share signals
- A profile library with playable videos for the signed-in account
- One unified upload queue for either a single clip or multiple clips
- Per-clip names, sequential progress, processing status, and clear errors
- Keyboard-accessible forms, native video controls, visible focus states, and reduced-motion support

## Backend integration

Update `config.js` when the API origin or contract changes. The current client uses:

- `POST /ios/users` — create an account
- `POST /auth/login` — obtain access and refresh tokens
- `POST /auth/refresh` — rotate an expired session
- `POST /auth/logout` — revoke a refresh token
- `GET /auth/me` — load the signed-in account
- `POST /iosclips` — upload one clip at a time
- `GET /processing/status?clipId=...` — follow post-upload processing
- `GET /iosclips/feed?userId=...&sessionId=...` — load recommendations
- `POST /iosclips/interactions` — record recommendation signals
- `GET /ios/users/{userId}/clips` — load profile videos
- `GET /ios/users/{userId}/follow-counts` — load profile statistics

The current backend only authorizes accounts with administrator access to upload clips. New accounts are regular accounts, so they can use Soundbites and Profile immediately but will receive a clear administrator-access message if they attempt an upload. Changing that authorization policy requires a separate backend change.

## Local run

Serve the directory so browser routing and API requests use an HTTP origin:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8080`.

## Container deployment

```bash
docker build -t voxxly-pages .
docker run --rm -p 8080:80 voxxly-pages
```

## Verification

```bash
node --check app.js
node --check config.js
git diff --check
```
