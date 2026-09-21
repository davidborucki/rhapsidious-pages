# Prompt for voxxly-frontend / iOS

Implement a bounded, current-first playback window in the actual Voxxly Swift
app. I identified `/Users/daveborucki/Programs/Swift/Rhapsidious` as the target,
but its inspected `AudacityFM/Config.swift` uses demo mode and ngrok. Another
directory `/Users/daveborucki/Programs/Swift/AudacityFM` has the Fly configuration
and a more developed player. FIRST confirm the active Xcode project/repo with
me if this discrepancy remains; do not edit both or silently switch projects.
Inspect AGENTS.md and preserve existing work. No backend/web changes or deployment.

Use the backend task's implemented playback/creator/queue contract and fixture.
The proposed additions are optional `playback` containing `version`, `mp4Url`,
nullable `hlsUrl`, durationMs/width/height/byteLength/mimeType, and optional
`creator` containing id/username/profilePhotoUrl. Keep decoding old responses and
fall back to existing streamUrl. Don't invent backend endpoints or force-disable
demo mode. All media traffic remains normal HTTPS with supported HTTP/3
negotiation and HTTP/2 fallback; no custom QUIC transport.

The inspected SoundbitesView creates per-page PlayerViewModels, tears them down
on disappearance, waits for all creator fetches before publishing the feed,
sets preferredForwardBufferDuration=1, and disables automatic stall waiting.
Reinspect the actual target, then implement:

1. A tested playback coordinator, separated from SwiftUI cell lifecycle, keyed
   by clip ID AND media revision. Maintain five logical slots: current-2,
   current-1, current, current+1, current+2. Retain the previous two usable
   items/buffered state for quick reversal instead of clearing them on every
   disappearance. Promote the already-prepared next entry into playback.
   Deduplicate preparation. Preserve expected resume/restart semantics.

2. Current-first scheduling: only one audible/playing video. Initially aim for
   6–10 seconds buffered for current; once healthy, prime next for ~2–4 seconds,
   then next+2 for ~1–2 seconds. Use one speculative media operation at a time.
   Values are configurable experimental targets, not guaranteed AVPlayer limits.
   Start current playback as soon as ready, not after accumulating the full
   target buffer; use the buffer target to gate background speculation.
   If playback stalls or buffer falls below a low watermark, cancel/defer
   speculative work. Rapid swipes and direction changes immediately reprioritize
   and cancel work outside the window. Avoid five concurrently active decoders.

3. Use supported AVFoundation preparation/preroll, checking readiness and rate=0
   before preroll and cancelling obsolete prerolls. Observe item readiness,
   timeControlStatus, waiting reason, loaded ranges, first visible frame, and
   errors. Test the automatic-waiting/default-buffer policy instead of assuming
   a one-second buffer and disabling waiting make playback smoother. Preserve
   looping, pause state, audio session behavior and user mute/volume.

4. Retained AVPlayer resources are not a guaranteed persistent disk cache.
   Do not assume warming URLSession/URLCache warms AVPlayer's own media pipeline.
   Begin with native item/player reuse; verify bytes actually reused on revisits.
   Keep posters and avatar images in a bounded deduplicated cache. If durable
   compressed-byte caching is required after measurement, propose a separately
   tested supported media-cache design with Range correctness, atomic writes,
   eviction, revision keys, expiry, auth and cancellation; don't download every
   entire MP4 twice or use a custom URL scheme without proving transport and
   playback compatibility. Don't enable HLS offline downloads just to preload
   two clips. Native buffer hints are not enforceable byte ceilings.

5. Render initial clips as soon as their feed JSON arrives. Prefer embedded
   creator summaries; otherwise deduplicate bounded creator requests and update
   placeholders independently. One avatar failure must not fail the feed or
   delay playback. Prefetch thumbnail/avatar images only for nearby entries.

6. Honor Low Data Mode, constrained/expensive paths, memory warnings, thermal/
   battery pressure, backgrounding, and logout. Shrink to current+next or current
   only as necessary and release observers/tasks/resources correctly. Report
   measured resident memory and network usage; bound owned caches by bytes and
   entry count. Don't promise exact OS-managed media memory limits.

7. Fetch upcoming metadata early with the backend's reservation/cursor contract,
   not by marking upcoming clips watched. Preserve the final watch report before
   exhausted-feed rebuilds. Keep two previous clips across batch/cycle boundaries,
   without duplicate watch reports or duplicate IDs corrupting player slots.
   Test repeated/reordered clips and removals. Cached access must not bypass
   moderation, entitlement, blocked-user or age rules.

8. Measure actual transport: URLSession task metrics for requests it owns and
   appropriate Instruments/player diagnostics for AVPlayer media. An h3 metadata
   request does not prove the player used h3. Preserve fallback when UDP is
   blocked. Do not pin the app to HTTP/3 or require Java to terminate QUIC.

Tests: window shifts both directions, fast swipes, reversals, first/last clips,
batch extension, duplicate/revised media, failed preload, stale callbacks,
cancel-before-ready, logout, background/foreground, low-data and memory pressure,
one audible player, no speculative analytics, old/new API fixtures. Profile and
saved viewers should reuse the coordinator where appropriate without fetching
videos for thumbnail-only grids. Run unit/UI/build checks and real-device tests
where available.

Record baseline vs new cold/warm time-to-first-visible-frame, rebuffer ratio,
cache reuse, bytes never watched, h2/h3, peak memory and dropped frames. Initial
warm-neighbor target on a declared capable device/network: p50 ≤100 ms and
p95 ≤250 ms, measuring intent and activation separately from swipe animations.
Report results and unmet targets honestly; do not call simulations real device
measurements. Ship behind a rollback flag and document limits.

References:
- https://developer.apple.com/documentation/technotes/tn3102-http3-in-your-app
- https://developer.apple.com/documentation/avfoundation/avplayeritem/preferredforwardbufferduration
- https://developer.apple.com/documentation/avfoundation/avplayer/preroll(atrate:completionhandler:)
