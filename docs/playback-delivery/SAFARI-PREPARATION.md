# One-ahead native preparation, including Safari

## Mobile controls and audio follow-up

The mobile feed volume control is four pixels lower; the action rail is shifted down 62 pixels (one Watch slot) with a short-screen clamp above navigation; captions are 12 pixels lower with eight pixels of clearance above the bottom navigation. Desktop positioning is unchanged.

Feed playback now guards each play request against stale rejections. Navigation no longer retries/unmutes the outgoing video before starting the incoming one. A genuine NotAllowedError can still require muted playback under browser policy, but it does not change the user's sound preference: a **Tap for sound** button appears, and tapping the video retries the preferred sound state rather than pausing it. Deliberate mute remains in effect through pause/resume and navigation. This is policy-aware recovery, not a bypass of Safari restrictions. WebKit documents [sound/gesture requirements](https://webkit.org/blog/6784/new-video-policies-for-ios/) and has a [swipe-versus-tap activation report](https://bugs.webkit.org/show_bug.cgi?id=212117); that historical report alone does not establish behavior on every current iPhone.

Diagnostics now put last-frame information first and include `soundRequested`, actual `muted`, `networkState`, `waitingForFirstFrameMs`, and `preparationReason`. Reasons distinguish current buffer gating, a previous native download still running, metadata-only readiness, no next clip in the batch, and canceled/disabled preparation. The live public configuration was read-only verified with `prepareNextClip: true` and version `20260920-3`; the user's remaining Safari delay is not established as a configuration issue. No buffer thresholds were blindly increased. Physical-phone diagnostics and possibly the delivery work below are still required; this follow-up does not claim to fix the reported cellular latency.

Verification: 43 unit tests passed, syntax/diff checks passed, and the Chromium playback browser suite passed with added mobile geometry, policy-muted tap recovery, stale-rejection, and intentional-mute navigation assertions. Mobile screenshots at 320 and 390 pixels were visually inspected. Latest browser artifacts: `/var/folders/vb/j0crsdq14132f72sz3m17sc40000gn/T/voxxly-playback-w7zIGY`. No deployment or backend/CDN change was made.

## What changed

`feed.prepareNextClip: true` enables an attempt to prepare the immediate next clip in the navigation direction in feed and saved/profile viewers. It no longer requires Chromium or `navigator.connection`. Missing hints are not treated as a slow link. Known Save-Data, offline, 2g/3g, estimated downlink below 1.5 Mbps, or reported memory below 4 GB prevent admission. Missing hints do **not** prove the phone is on Wi-Fi, fast cellular, or has Low Data Mode disabled.

The current video must be playing, not waiting, have readyState >= 3, and have six seconds buffered (or the remaining duration near its end), continuously for 750 ms before preparation starts. This never delays current playback startup. Preparation assigns `preload=auto` and the actual URL to **one existing native video**, without playing it. It never prepares next+2 in this mode. Returning to previously visited videos retains their existing players and sources.

The neighbor target is two buffered seconds with readyState >= 2. At that point the preload hint is lowered. Metadata-only loading is retained but is **not** reported as frame-ready. Safari may limit or ignore native preload; a source assignment is not proof of buffered frames. See [MDN's preload documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preload) and [Apple's delivery guidance](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari).

Cancellation evicts only the unused speculative entry, removes its source and calls load to release its native request. It never clears the active player's source. The navigation reconcile creates a new entry if that canceled clip is subsequently selected. The same clip/revision is not repeatedly attempted while it stays in the window.

Cancellation conditions:

- While the speculative request is still loading: current playback waits, loses its healthy buffer, or pauses; page backgrounds; connection hints become constrained; or direction changes. Already-idle buffered entries are retained. A failed candidate is evicted.
- The native request is still loading after four seconds.
- The neighbor buffers over four seconds, or continues loading >600 ms after the stop hint. Either overrun disables preparation for that pool session.

These are observed readiness/time safeguards, **not a hard byte cap**. Native requests may transfer additional bytes before events fire or cancellation takes effect. Previously visited native players can also keep downloading; no new speculation is admitted while any other offscreen player is loading. There are no MP4 blob downloads, synthetic Range-cache warming, service worker fragments, new HLS library, CORS attributes, or QUIC/WebTransport channels.

At most two actual nearby source origins are preconnected when the window is reconciled. Legacy stream routes and validated backend direct URLs retain their existing resolution. No delivery/queue flags in the backend are changed and no legacy feed fetch is issued early.

Rollback: set `feed.prepareNextClip: false`. Keep `feed.speculativeNative: false` to disable both preparation paths. Existing five-entry retention remains enabled. The independently opt-in legacy two-ahead experiment takes precedence when `speculativeNative` is true; it retains its previous Chromium-only rules.

## Testing on an actual phone after deployment

Open `https://upload.rhapsidious.com/?playbackDebug=1#/feed` and expand **Playback diagnostics**. The query flag only enables local diagnostics; no analytics are uploaded. The panel disappears when there is no player pool. Remove the query parameter to turn it off.

1. Let the current clip play for several seconds, then look at the entry with `offset: 1`.
2. `sourceAssigned: true` means preparation began. `readyState: 1` with zero buffer means metadata only, not ready playback. `readyState >= 2` plus positive `bufferedSeconds` means decoded data/buffering is actually available.
3. Swipe. `lastFrameMs` reports activation-to-first-frame; `lastFrameWarm` distinguishes warm from cold. This is separate from slide animation duration.
4. If `preparationDisabled: true`, check `lastPreparation.reason` for a native-download overrun. `current-needs-bandwidth` means the current clip was protected; `preparation-timeout` means background loading did not complete within the time window.
5. Compare several forward/back swipes on cellular and Wi-Fi. Record phone/iOS version, approximate signal, clip IDs, and screenshots of the panel. Do not share access tokens or private network logs.

With a remote console, `voxxlyPlaybackDiagnostics()` contains bounded local events for source assignment, loadedmetadata, loadeddata, activation, first-frame, preparation, cancellation, rebuffering and available native-video resource timings. Protocol/byte fields remain unknown without Timing-Allow-Origin; unknown protocol is not proof of HTTP/2. The playing+animationFrame fallback is a readiness proxy when requestVideoFrameCallback is unavailable.

## Outstanding backend/CDN work (not implemented here)

The inspected backend `docs/playback/README.md` states `hlsUrl` is null in phase one, prepared-object publication is gated by delivery approval, and compatible videos can be remuxed without reducing bitrate. Its example fixtures are not proof that prepared renditions are deployed. This web change cannot fix an oversized original or a missing fast-start moov on its own.

If Safari reports metadata-only preparation or cold cellular startup remains high, the next delivery task should:

- Verify actual served clips have leading moov and an initial keyframe; measure bitrate, dimensions and startup bytes on the real stream route, not only a fixture.
- Produce measured, appropriately sized mobile renditions; evaluate adaptive native HLS with small startup segments. Publish only real descriptors, keep MP4 fallback, and explicitly update/test source selection before activating HLS (current contract still prefers MP4).
- Preserve authorization, blocks, moderation, age restrictions, expiry and takedowns before approving cached/direct delivery. Do not bypass the existing public-delivery approval gate.
- Verify Range behavior and CDN cache status; provide exact CORS/Timing-Allow-Origin headers before any fetch/MSE-based solution. Refresh affected cache entries only with rollout authorization.

Native one-ahead preparation is a best-effort first step, not a claim of instantaneous Safari playback or proof that HLS is necessary. Physical iPhone measurements decide whether native preparation is sufficient.

## Verification

`node --test tests/*.test.js` covers current-first admission, no network-hint requirement, constrained connections, one-neighbor bounds, identity reuse, cancellation/overrun/timeout, metadata-only readiness, retry suppression, direction/revision changes and cleanup, alongside existing tests.

`tests/playback.browser.cjs` additionally checks real native-media requests before swiping, current-only playback, no speculative watch events, no next+2 request, and reuse of the prepared HTMLVideoElement/source. Network hints are removed in that phase, but the engine is Chromium—not Safari. It also runs existing forward/back, mute, queue-boundary, rollback and responsive checks. No package.json build/lint commands exist in this static project.

Safari/iPhone cellular performance is not established by desktop Chromium tests. Safari WebDriver was previously unavailable because remote automation is disabled; no system settings, backend files, CDN configuration or deployment are changed by this work.

### Recorded local verification — September 20, 2026

- 43 unit tests passed. App, playback module, configuration and browser-test syntax checks passed; `git diff --check` passed. No build/linter commands are configured.
- Full browser suite passed on installed Brave/Chromium 150.0.7871.63, including responsive checks at 320/390/430/760/768/1440/1920 widths.
- One-ahead phase removed connection hints and used a generated 270x480 H.264/AAC, 24-second MP4 (2,893,667 bytes), served from localhost in 32 KiB chunks every 80 ms. It observed a real clip-2 request before navigation, reuse of that same player/source, no clip-3 request, no speculative watch, and only one playing video. One warm activation-to-frame sample was 93.7 ms; earlier runs varied. This is not an iPhone, cellular, CDN, h2/h3 or percentile claim.
- After playable neighbor data arrived, a simulated current `waiting` event evicted only that unused neighbor. The real HTTP response was aborted after 65,536 server-written bytes, before the full file transferred. This verifies that cancellation path in Chromium, not a universal byte limit.
- Local artifacts: `/var/folders/vb/j0crsdq14132f72sz3m17sc40000gn/T/voxxly-playback-gTfMLB/one-ahead.json`, `one-ahead-diagnostics.png`, responsive screenshots and the full `telemetry.json` in the same directory. Temporary artifacts may be removed by the OS.
