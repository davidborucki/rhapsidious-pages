# Prompt for the web frontend

Implement bounded, current-first clip preparation in
`/Users/daveborucki/rhapsidious-pages`. Inspect AGENTS.md and current changes first.
Keep plain JavaScript and the current design; no framework or TypeScript rewrite.
Do not modify iOS/backend or deploy. Use the backend task's final contract and
fixtures, preserving old streamUrl responses. The proposed optional additions
are `playback` with version/mp4Url/hlsUrl/durationMs/width/height/byteLength/mimeType
and `creator` with id/username/profilePhotoUrl. Never fabricate those fields or
endpoints if they aren't ready.

Goal: scrolling between the current video, two previous videos and two upcoming
videos feels ready-to-play, without loading the whole feed or starving current
playback. HTTP/3 is negotiated by the browser/CDN; don't write raw QUIC channels
or replace normal video playback with WebTransport.

Inspect `renderFeed`, `renderFeedItem`, `transitionFeedToIndex`, `bindFeedPlayers`,
`activateFeedCard`, `cleanupFeedObservers`, `loadCreator`, `loadMoreFeed`,
`refreshFeedAfterLastClip` and the profile/saved clip viewer. Currently the incoming
slide is created on swipe, the outgoing slide is removed, video uses metadata
preload, and creator requests block feed publication.

Implement:

1. A small independently testable playback-window/scheduler module keyed by
   clip ID + media revision, with at most five logical entries (i-2 through i+2).
   Reuse actual HTMLVideoElements and retained source/buffer state. Do not keep
   replacing innerHTML, src or calling load() on a warm video's activation.
   Move/reuse its wrapper in the existing animation so both video and action
   rail continue to scroll together. No duplicate IDs, listeners, audio or
   accidental focus on hidden players. Offscreen retained wrappers are inert.

2. Prioritize current playback. Start with one speculative media loader at a
   time: next, then next+2 after current is healthy. Initial targets are ~6–10s
   current, ~2–4s next and ~1–2s next+2, tuned with measurements. Keep
   first-frame startup independent of this target: current starts as soon as
   ready, not after filling 6–10 seconds. Keep the previous
   two buffered entries without speculative re-download. Stop/defer speculation
   when current is waiting or its buffer is low; reprioritize immediately on
   direction changes. A five-entry pool is not five playing videos.

3. Treat preload=auto/metadata as hints, not promises or hard byte caps. Verify
   actual buffered ranges and first-frame readiness. Pausing a native video
   does not necessarily stop its download. Use conservative entry/concurrency
   limits and measure transfer behavior; disable speculative native buffering
   on constrained platforms where it cannot be controlled. Don't claim a fixed
   byte budget that browser APIs cannot enforce. Evict by cancelling owned
   fetches, releasing src only on evicted entries, and revoking owned blob URLs.
   Preserve the active player during DOM rerenders.

4. Do not fetch whole MP4 blobs for all five entries, assume an arbitrary Range
   fetch fills the native video cache, or cache 206 fragments as complete files
   in a service worker. Begin with native element reuse and browser HTTP caching.
   If tighter control proves necessary, separately evaluate HLS/MSE with a pinned
   maintained library and a loader/cache that the actual player consumes. Use
   native HLS where supported and MP4 fallback. Don't introduce HLS as a silent
   dependency before the backend actually supplies it.

5. Prefer validated absolute direct playback URLs when provided. Fall back to
   existing streamUrl for legacy/local media. No video cache-busters. Use the
   thumbnail as poster and keep grids image-only. Embed creator summaries when
   available; otherwise deduplicate creator fetches and render placeholders
   without awaiting every creator before starting the first clip. Prime only
   nearby avatars/posters. Add a small number of preconnects for actual media
   origins, not a request per title or a separate connection per asset type.

6. Prefetch queue metadata before exhaustion only using the backend-approved
   reservation/cursor behavior. Don't trigger the current exhaustion/reset API
   early or manufacture watch events. At the real end preserve last-watch
   reporting, rubber-band/loading UX and next-ready-clip behavior. Keep two
   previous clips across rebuilds instead of dropping the previous history.
   Handle deduplication, cycles and stale responses with session/generation guards.

7. Preserve one-swipe-one-clip, animation easing, looping, pause indicator,
   user-selected mute/volume, browser autoplay restrictions, watch-time accuracy,
   optimistic social actions, keyboard navigation and reduced motion. Preparing
   an offscreen clip never starts watch tracking. Pause speculative work on
   hidden tabs; clear scoped resources on logout and feed exit. Honor Save-Data/
   connection hints where present; use conservative defaults when absent.

8. CORS preflight: on Sep 20 a small public sample request with
   Origin https://upload.rhapsidious.com lacked Access-Control-Allow-Origin and
   Timing-Allow-Origin. Existing native video can still work; JS fetch/HLS/MSE
   or media timing may not. Don't add crossorigin blindly and break playback.
   Coordinate exact CDN headers and cache refresh with the backend/infra task.
   Keep private API responses out of shared caches. Respect access expiration,
   media revisions, removals, blocked users, moderation and age restrictions.

Tests and telemetry:

- Unit-test the sliding window, ordering, priorities, cancellation, bounded
  entries, duplicate IDs/revisions, failures and stale sessions.
- Browser-test forward/back two clips, rapid repeated swipes, batch boundaries,
  autoplay rejection, muting then pause/resume, slow/lost network, backgrounding,
  logout, no double audio, no speculative watch events and no long scroll page.
- Verify reuse with object identity and actual network transfers, not just
  screenshots or count of video tags. Confirm offscreen preload doesn't keep
  fetching the entire feed. Test Safari/iOS and Chromium/Firefox where available;
  state limitations rather than extrapolating from one desktop browser.
- Measure requestVideoFrameCallback where available, with a documented fallback,
  navigation-to-first-frame, activation-to-first-frame, rebuffering, transfer
  bytes, unused preload, memory/resource counts, CDN cache status and negotiated
  protocol via nextHopProtocol when Timing-Allow-Origin permits. Empty protocol
  data is unknown, not proof of HTTP/2. An unrelated fetch is not video telemetry.
- Initial warm-neighbor target under declared device/network conditions:
  p50 ≤100ms / p95 ≤250ms. Separate cold vs warm, h2 vs h3, and animation time.
  Don't claim universal instantaneous playback or treat mocked tests as proof.
- Run existing tests, syntax checks, responsive browser checks and available
  build/lint commands. Report absent commands honestly. Add a rollback flag and
  list dependencies on backend/CDN work that are not yet implemented.

References:
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preload
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/nextHopProtocol
- https://developers.cloudflare.com/r2/buckets/cors/
- https://developers.cloudflare.com/speed/optimization/protocol/http3/
