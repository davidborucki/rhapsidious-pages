# Web settings

Settings keeps the account header and hides the main app sidebar. Its local menu
uses a 29% left column on desktop and stacks above the detail panel at 700px.

Connected to the existing backend contracts:

- `GET /me/blocked-users` → array of `id`, `username`, `profilePhotoUrl`.
- `DELETE /users/{userId}/block` → unblock the selected account.
- `POST /support/tickets` → JSON `category`, `message`, `email`.
  The account email takes precedence on the backend. Messages are capped at
  4,000 characters. Categories mirror `SupportTicketCategory`.
- `GET /app/config` → `privacyPolicyUrl` and `termsOfServiceUrl`.
  Only absolute HTTP(S) links are accepted; documents open in a new tab.

No policy text is fabricated or copied into the application. Missing links and
network failures display a retry state. Support errors retain the draft, and
failed unblocks leave the account in the list. Requests are authenticated using
the existing web request helper. Responses are ignored after leaving Settings.

## Backend work still required

Temporary account deactivation and a per-user mature-content preference have no
endpoints in the inspected backend. Their settings sections explicitly show
that they are unavailable. They do not send requests or save misleading local
preferences. The existing permanent account deletion API is deliberately not
used as a substitute for temporary deactivation. Existing server age checks
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
navigation, legal links, support drafts, errors and successful mutations.
