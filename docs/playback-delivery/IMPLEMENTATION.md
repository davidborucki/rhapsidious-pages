# Web playback window — implementation and rollout

Implementation date: September 20, 2026. Plain JavaScript; no framework, player library, backend/iOS edit, deployment, bucket write, or account configuration change. No AGENTS.md was found in the project or applicable ancestors. The preexisting untracked delivery-prompt documents were preserved.

## What ships enabled

`APP_CONFIG.feed.playbackWindow: true` retains up to five logical entries (two previous, current, two upcoming). Each entry owns its actual HTMLVideoElement and, on the feed, its complete animated slide including the action rail. Only the current entry plays. Warm activation does not assign `src`, call `load()`, or rebuild the slide. Hidden entries are `hidden`, inert, aria-hidden, and not keyboard-focusable. The saved/profile viewer uses the same pool, with its existing controls and design. Grids remain image-only.

Entries deduplicate by clip ID and revision/source identity; the current occurrence wins when a cycle repeats an ID. A repeated ID is not rendered twice. Source/revision changes evict the old entry. Legacy end-of-feed rebuilding keeps the prior two clips in metadata and retains their player instances when they remain in the five-slot window. Route exit/logout release media sources, posters, timers, callbacks, preconnects and player wrappers. Pending speculative/private feed requests are aborted; genuine queue watch acknowledgments may drain for at most five seconds on route exit (logout waits up to two seconds, then aborts remaining scoped work). A failed final watch drain is not falsely marked successful.

Creator summaries are used when supplied; missing creator requests are deduplicated. The first feed is published before creator enrichment completes. Feed enrichment loads only nearby creators, rather than every feed/saved creator. Metadata updates preserve the active player. At most two preconnects are added, for actual requested media origins, and removed with the pool.

## Deliberate rollout gates

| Config flag | Default | Behavior |
| --- | --- | --- |
| `feed.playbackWindow` | `true` | Retain native players; `false` restores the single-player creation/removal flow and legacy queue mode. |
| `feed.speculativeNative` | `false` | Opt-in future-media preparation after device/network qualification. Retention of visited players works without this flag. |
| `feed.queueV2` | `false` | Opt-in exact backend reservation API after its schema/feature flag is deployed. Never probes or speculatively fetches the legacy reset API. Shared-clip links keep their legacy endpoint flow. |
| `feed.playbackTelemetry` | `false` | Bounded in-memory diagnostics (last 200 events); no automatic analytics upload. |

Future preparation is implemented but **not enabled by default**. Local native-transfer testing confirmed that the browser can keep downloading a speculative MP4 past its target. Turning it on requires measured acceptance of that behavior. Setting `preload=none` or pausing is not a reliable download cancellation. The implementation does not claim a fixed byte budget.

With speculation opted in, admission additionally requires Chromium, a reported 4g connection with at least 5 Mbps estimated downlink, no Save-Data, and no reported low-memory device. Safari/iOS and absent connection hints do not speculate. Current playback starts immediately when native playback permits; the approximate eight-second current buffer is only an admission threshold for background work, not a startup requirement. The next target is three seconds, followed by 1.5 seconds for next+2. Direction changes reorder admission. Previously visited entries are retained without speculative redownload.

Only one speculative native loader is admitted. An in-flight native request continues occupying the slot even after the preload hint is lowered. Other retained players still downloading also prevent new speculative admission. Waiting/low current buffer, backgrounding, and constrained conditions defer admission. An observed overshoot of more than two seconds past a neighbor target disables further speculative admission for that pool session. This cannot undo bytes the browser has already requested; eviction releases the source. No fetch blobs, service workers, cache-busters, arbitrary Range warming, HLS dependency, MSE, WebTransport, or raw QUIC channels were added.

## Backend contract used

Read the backend's final `Backend/backend/docs/playback/README.md`, the playback descriptor/creator/queue Java records, and the three golden JSON fixtures. Identical fixtures are checked into `tests/fixtures/playback/` for reproducible client tests; their URLs are illustrative and are never requested by the tests.

Existing normalization retains all properties, including nullable `playback` and `creator`, without manufacturing measurements or changing `streamUrl`. Valid absolute HTTP(S) direct MP4 URLs require a nonempty supplied media version. Otherwise playback resolves the existing `streamUrl`. HLS is selected only when supplied and natively supported, and only if no MP4 URL is supplied; phase-one backend HLS remains null. Malformed URLs do not become image/media URLs. Thumbnails remain validated posters and image-only grid assets. No `crossorigin` attribute was introduced.

Opt-in queue v2 uses exactly:

- `POST /iosclips/queue/v2/reserve`: `{requestId, sessionId, cursor}`.
- `POST /iosclips/queue/v2/ack`: `{eventId, reservationId, cycleId, sessionId, watchSec, skipped}`.

The three outstanding backend reservations are merged by reservation ID and clip ID; the two previous players are local history, not new reservations. Reserve retries reuse their original UUID and body; a 409 reconnects with null cursor and a new reserve UUID. Watch retries preserve the original event UUID and cumulative watch snapshot. Warming, unused reservations, and cancellation never acknowledge a watch. Only an actually displayed clip can acknowledge a real watch or explicit zero-second skip. Queue watches are not also posted to the legacy interaction endpoint; existing social flags retain their endpoint with zero watch seconds. Real watch timing starts on `playing`, stops during buffering/pauses, and retains the legacy repeat/social behavior.

The final acknowledgment must succeed before refilling an exhausted cycle. Loading/rubber-band UI remains. Responses are guarded by route/session/queue identity and wait for an in-progress swipe animation before modifying queue metadata. Expired reservations are evicted, metadata is revalidated, and invalid acknowledgment responses do not become new watch events. 429 responses honor Retry-After. Queue rollback never silently maps speculative reservations onto legacy feed requests.

## Delivery and access dependencies

- Backend queue schema and `PLAYBACK_QUEUE_ENABLED` are not assumed live; web opt-in remains off.
- Prepared MP4 publication still depends on backend public-delivery approval, processing/backfill and descriptor flags. This web change does not make illustrative fixture URLs live or fix tail-moov legacy MP4s.
- The backend's proposed R2 CORS JSON currently lists `rhapsidious.com` and `www.rhapsidious.com`, **not `https://upload.rhapsidious.com`**. Infra must confirm the actual web origins, add approved origins, allow GET/HEAD and required Range/conditional request headers, expose relevant response headers, and configure Timing-Allow-Origin separately. Existing cached objects need an approved targeted cache refresh after header changes. Nothing was applied here.
- Native video can work without fetch-readable CORS. Do not enable cross-origin JS fetch/HLS/MSE merely because native playback works. Private API requests use `cache: no-store`; no shared/private-response cache was introduced.
- Browser/CDN HTTPS negotiation chooses h3/h2. No web code can guarantee HTTP/3. Empty protocol/transfer fields are unknown. Public URLs cannot be revoked by client eviction; immediate takedown/block/age enforcement of already cached bytes requires the backend/edge access-policy work. The client honors revised/removed queue entries, expiration and scoped eviction but cannot discover an unannounced moderation change offline.

## Diagnostics and verification

With telemetry enabled, run `window.voxxlyPlaybackDiagnostics()` in developer tools. It reports clip ID/revision (not tokens or signed URLs), first-frame method, warm/cold status, activation-to-first-frame and navigation-to-first-frame, buffer seconds, startup waiting separately from rebuffering, eviction/unused-entry state, resource count, and JS heap size where exposed. Navigation timing includes synchronous slide preparation; activation timing excludes it. Playback now starts in the navigation gesture alongside the animation, without the former delay of up to 150 ms. Animation completion no longer calls play a second time, so it cannot override a pause made during the transition. `requestVideoFrameCallback` measures a rendered frame. The documented fallback is `playing` plus an animation frame, explicitly labeled a readiness proxy.

PerformanceResourceTiming records are matched to actual native `video` requests, never an unrelated fetch. Where timing is exposed they include transfer/encoded bytes, first-byte/redirect timing, duration and negotiated protocol. Cross-origin restricted fields and CDN cache status remain unknown; no HEAD request is used to pretend it measures video playback. JS heap is not native decoder memory. In-flight transfers may not have a completed timing entry. Exact unused transfer bytes and h2-versus-h3 CDN comparisons require staging/network tracing; buffered seconds are not a byte estimate.

Commands:

```sh
node --test tests/*.test.js
node --check app.js
node --check playback-window.js
node --check playback-queue.js
node --check config.js
node --check tests/playback.browser.cjs
git diff --check
```

With Playwright installed, set `NODE_PATH` to its runtime and `PLAYBACK_BROWSER_PATH` to the Chromium executable, then run `node tests/playback.browser.cjs`. The test creates a temporary H264/AAC MP4 with FFmpeg and a local Range-capable HTTP server; it does not download or mutate production media. Generated screenshots/transfer and frame logs are written to a printed temporary artifact directory. The existing settings browser test is also run against a local static server.

Browser coverage includes native object identity/source/load-call preservation forward/back two, real Range transfer counts, one-swipe-one-clip, current-only audio, mute + pause/resume, a real cold network failure without a retry storm, a slower local link, synthetic visibility changes, feed exit/logout, saved and profile viewer reuse, queue cycle/final-ack sequencing, duplicate DOM IDs, explicit simulated autoplay rejection, reduced motion, rollback and responsive overflow checks. API fixtures and forced network hints are mocks; the video decoder and local HTTP media transfers are real.

Responsive feed checks: 390, 768, 1440 and 1920 pixels wide, each 900 pixels tall: no long document scroll page or horizontal overflow. Existing settings checks cover 390/768/1440 widths. These are desktop viewport checks, not physical-device tests.

Safari 26.5 is installed, but creating a WebDriver session was rejected because “Allow remote automation” is disabled. No Safari setting was changed. Firefox/Playwright WebKit are not installed. Safari, physical iOS, Firefox, real tab lifecycle, constrained mobile network behavior and production h2/h3 latency remain unverified. No npm/package.json build or linter command exists in this static project. Docker is unavailable on this host; the Docker COPY manifest was corrected to include every referenced JS dependency and is unit-tested, but an image build was not claimed.

### Recorded local results (before the immediate-activation follow-up)

- **30 unit tests passed**, no failures/skips. All listed syntax checks and `git diff --check` passed.
- Playback integration suite passed on Chromium **150.0.7871.63** (installed Brave). Existing settings browser suite passed.
- Latest playback run: generated 270×480 H264/AAC, 24-second, 2,893,667-byte MP4; localhost HTTP/1.1, server writes 32 KiB every 10 ms, with slower/failure phases. Tests force 4g/10 Mbps connection hints to exercise opt-in scheduling; this is not a WAN/CDN benchmark.

| Readiness at activation | Samples | Activation-to-frame p50 / sample p95 | Navigation-to-frame p50 / sample p95 |
| --- | ---: | --- | --- |
| Warm (actual readyState/buffer) | 7 | 35.4 / 85.6 ms | 187.9 / 238.7 ms |
| Cold/not yet buffered | 5 | 34.8 / 294.8 ms | 188.1 / 294.8 ms |

These small-sample percentiles are not statistically qualified performance claims. The animation still runs separately (340–560 ms according to input velocity, or effectively immediate for reduced motion). No production h2/h3 comparison is available. Repeated test runs varied; do not promise universal p50/p95 from localhost results.

Only media 1 and 2 were requested before the first swipe in this run. Neighbor 2 crossed its three-second target to 5.435 buffered seconds, triggering the overshoot safeguard; next+2 was not admitted. The full suite recorded 20 local media requests and 24,800,338 server-written bytes across navigation, failure, reopening and rollback scenarios. Those totals include repeated test phases and are not a five-player byte cap. Returning two clips backward preserved object identity and produced no replacement request for the retained first source.

Temporary verification artifacts (not deployed): [frame/transfer logs](/var/folders/vb/j0crsdq14132f72sz3m17sc40000gn/T/voxxly-playback-IFrtO4/telemetry.json), [390px screenshot](/var/folders/vb/j0crsdq14132f72sz3m17sc40000gn/T/voxxly-playback-IFrtO4/feed-390.png), [1440px screenshot](/var/folders/vb/j0crsdq14132f72sz3m17sc40000gn/T/voxxly-playback-IFrtO4/feed-1440.png). Temporary files may be removed by the OS. The 390px and 1440px layouts were also visually inspected from a prior passing run with the same layout.

### Immediate-activation follow-up

Removed the intentional wait of up to 150 ms between a swipe and incoming playback/source loading. Activation now happens synchronously alongside the existing slide animation, preserving its easing. Animation completion does not activate again. Muted autoplay retry is restricted to `NotAllowedError`; canceling a pending play with pause no longer restarts the clip.

31 unit tests, syntax/diff checks and the Chromium playback suite passed after this change. Added checks verify activation/source assignment during the navigation event and that a pause during animation stays paused, including rollback mode. The latest local run measured seven warm activation-to-frame samples: p50 27.5 ms, sample p95 76.8 ms, under the same localhost conditions above. Logs: `/var/folders/vb/j0crsdq14132f72sz3m17sc40000gn/T/voxxly-playback-UA2aA2/telemetry.json`. This removes deliberate client waiting, not cold network/decode latency. Speculative downloading and queue-v2 rollout defaults are unchanged; no deployment was performed.

## Files changed

- `app.js`: native pool integration, nonblocking/deduplicated nearby creator enrichment, compatible playback source selection, viewer reuse, queue integration and lifecycle/watch guards.
- `playback-window.js`: testable scheduler, native adapter, admission gates and local telemetry.
- `playback-queue.js`: exact opt-in reservation/ack client.
- `config.js`: independent rollback, speculation, queue and telemetry flags.
- `index.html`: new module loading and app asset revision.
- `styles.css`: hidden retained slide/video display rule; no redesign.
- `Dockerfile`: complete static-script packaging.
- `tests/playback-window.test.js`: scheduler, contract/fixtures, queue, URL, retry and packaging tests.
- `tests/playback.browser.cjs`: native-media integration and responsive checks.
- `tests/fixtures/playback/{clip-ready,clip-fallback,queue-reserved}.json`: exact backend golden fixtures.
- `tests/clip-viewer-fixture.html`: loads the new native pool modules.
- This implementation report. Existing audit/prompt files are unchanged.

References: [MDN preload hints](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preload), [MDN protocol timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/nextHopProtocol), [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/), [Cloudflare HTTP/3](https://developers.cloudflare.com/speed/optimization/protocol/http3/).
