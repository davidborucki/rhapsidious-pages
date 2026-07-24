# Voxxly Web

A dependency-free web client for Voxxly. It uses the existing Spring Boot API for accounts, authentication, creator uploads, profile videos, and the personalized Soundbites feed.

## Features

- Voxxly branding with the supplied logo and Helvetica-first typography
- Account creation followed by automatic JWT sign-in
- Access-token refresh and server logout
- Personalized, continuously loaded Soundbites recommendations
- Automatic play/pause behavior with recommendation watch, save, and repost signals
- Saved Soundbites in a dedicated playback library
- Live username search with public posts, reposts, follow controls, and follower/following lists
- A profile library with playable posts and a separate reposts view
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
- `POST /ios/saved-clips` / `DELETE /ios/saved-clips` — save or remove a clip
- `POST /ios/reposted-clips` / `DELETE /ios/reposted-clips` — repost or remove a repost
- `GET /ios/users/search?q=...` — search public profiles
- `POST /ios/follows` / `DELETE /ios/follows` — follow or unfollow a profile
- `GET /ios/users/{userId}/clips` — load profile videos
- `GET /ios/users/{userId}/reposted-clips` — load public reposts
- `GET /ios/users/{userId}/follow-counts` — load profile statistics
- `GET /ios/users/{userId}/followers` — load followers
- `GET /ios/users/{userId}/following` — load followed profiles

The current backend only authorizes accounts with administrator access to upload clips. New accounts are regular accounts, so they can use Soundbites and Profile immediately but will receive a clear administrator-access message if they attempt an upload. Changing that authorization policy requires a separate backend change.

Before production, the backend should also return a public user-summary DTO for search/profile requests and enforce the authenticated user on save, repost, and follow mutations. The web UI only renders `id`, `username`, and `profilePhotoUrl`, but the current raw user responses contain additional account fields and the social controllers presently trust IDs supplied by the client.

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
