# Web settings

Settings opens a searchable, grouped list of rows and hides the main app sidebar.
Each row opens a separate detail screen at `#/settings?section=...`, with a back
link to Settings. Browser Back/Forward and direct links work; support drafts and
search text survive navigation between settings screens. The same single-column
layout adapts to desktop and mobile widths.

Connected to the existing backend contracts:

- `DELETE /me/account` → permanently delete the signed-in account, then clear the
  local session and return to login. A second click confirms; Cancel sends no request.
- `GET /me/blocked-users` → array of `id`, `username`, `profilePhotoUrl`.
- `DELETE /users/{userId}/block` → unblock the selected account.
- `POST /support/tickets` → JSON `category`, `message`, `email`.
  The account email takes precedence on the backend. Messages are capped at
  4,000 characters. Categories mirror `SupportTicketCategory`.
- `GET /app/config` → `privacyPolicyUrl` and `termsOfServiceUrl`.
  Only absolute HTTP(S) links are accepted; documents open in a new tab.

The public legal documents are included in the web build. Settings prefers configured
backend document URLs and falls back to the local documents if config is missing or
unavailable. These pages also work without JavaScript or a signed-in account. Support errors retain the draft, and
failed unblocks leave the account in the list. Requests are authenticated using
the existing web request helper. View updates are ignored after leaving Settings. Successful account deletion still
clears the original session after navigation, but never clears a newer session.

## Backend work still required

Temporary account deactivation and a per-user mature-content preference have no
endpoints in the inspected backend. The account panel offers permanent deletion; the mature-content panel shows
that its preference is unavailable. No temporary deactivation request is sent. Existing server age checks
are unchanged.

## Verification

- `node --test tests/*.test.js`
- `node --check app.js` and `node --check settings.js`
- Serve the site on `http://127.0.0.1:8765`, then run
  `node tests/settings.browser.cjs` with Playwright available.
  `SETTINGS_BROWSER_PATH` optionally selects an installed Chromium-based browser.
  `SETTINGS_SCREENSHOT_DIR` optionally saves responsive screenshots.

The browser test mocks backend responses: it never unblocks real users or sends
real support tickets. It checks 390px, 768px and 1440px layouts, hidden app
navigation, legal links, support drafts, errors and successful mutations. Account
deletion checks cover cancellation, retry, duplicate clicks and session cleanup.
