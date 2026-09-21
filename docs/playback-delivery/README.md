# Faster playback: ecosystem audit and implementation prompts

Inspected September 20, 2026. This is a proposal, not an implemented delivery change.
Only these documentation files were added; no backend, iOS, web runtime, bucket,
Cloudflare configuration, or media objects were changed.

## Recommendation

Keep R2. Deliver versioned, playback-ready media from Cloudflare's custom media
domains, negotiate HTTP/3 where available, and retain a bounded five-clip window:
two previous clips, the current clip, and two upcoming clips. The current clip
always wins bandwidth and decoder resources. Start with fast-start progressive
MP4 and player reuse. Add adaptive HLS/CMAF as a measured second phase if variable
bitrates or mobile connections still cause stalls; don't rebuild the transport
around raw QUIC or WebTransport.

HTTP/3 uses QUIC and can help on lossy connections; Cloudflare's setting covers
the client-to-edge connection, not QUIC all the way into the Java origin.
Keep HTTP/2 fallback. [Cloudflare HTTP/3 documentation](https://developers.cloudflare.com/speed/optimization/protocol/http3/).

Separate media, JSON, and image requests already give HTTP/3 independent request
streams when a connection can be reused. These are not application-managed
permanent channels. Different hostnames may use different connections; don't
assume clips, images, and the Fly API share one connection. Titles belong in the
feed JSON, not in their own request. Return creator display information there
too, so avatar/user lookups cannot delay video startup.

## What the source code actually does

### Backend: `/Users/daveborucki/rhapsidious-backend`

- Spring/Java code lives under `Backend/backend/src/main/java/audacityapp`.
- `IOSVideos/IOSClipService.java` uploads the original file to R2 using a UUID
  key, sets its content type, and builds a public media URL. Its video upload
  path does not set an explicit object Cache-Control policy or normalize to
  fast-start playback media. Thumbnail uploads have a separate cache policy.
- Configured buckets/domains: `rhapsidious-clips` at `clips.rhapsidious.com`;
  `rhapsidious-images` at `images.rhapsidious.com`. This is source configuration,
  not an authenticated inventory of the Cloudflare account.
- `IOSClipFeedDTO` emits `/iosclips/{id}/stream`. `IOSClipController.streamClip`
  redirects remote assets with HTTP 302; it supports Range itself for legacy
  local files. Thus a remote clip first reaches Fly, then Cloudflare.
- No adaptive-video packaging/transcoding pipeline was found in the inspected
  Java playback/upload code; FFmpeg is used for thumbnail generation.
- `RecommendationService` marks returned clips as session-shown and may reset
  seen state on exhaustion. Speculatively asking for more recommendations is
  not automatically a side-effect-free operation. It needs an explicit contract.

### iOS: `/Users/daveborucki/Programs/Swift/Rhapsidious`

- SwiftUI/AVFoundation, with most feed/player code in
  `AudacityFM/SoundbitesView.swift`.
- `Config.swift` currently sets `isDemo = true` and points to an ngrok URL.
  The directory also has substantial existing uncommitted work. Preserve it.
- Feed loading waits for per-clip creator enrichment using a throwing task
  group. Repeated creators aren't deduplicated there; a failing lookup can
  prevent the whole enriched feed from appearing.
- Each `ClipPageView` owns a player model; disappearing calls `stop()`, which
  clears the AVPlayerItem. There is no explicit retained five-clip pool.
- Playback uses a one-second preferred forward buffer and disables automatic
  waiting to minimize stalls. These are tuning choices, not guaranteed latency
  improvements. Apple notes the tradeoff between small buffers and rebuffering.
  [AVPlayer buffering documentation](https://developer.apple.com/documentation/avfoundation/avplayeritem/preferredforwardbufferduration).
- Another local project, `/Users/daveborucki/Programs/Swift/AudacityFM`, has a
  newer-looking player and the Fly backend configuration. Confirm which app
  is `voxxly-frontend` before implementing. The requested Rhapsidious path was
  the main iOS audit target; do not assume these projects are interchangeable.

### Web: `/Users/daveborucki/rhapsidious-pages`

- Static HTML/CSS and plain JavaScript; no React/TypeScript conversion needed.
- `renderFeedItem` uses `preload="metadata"`. `transitionFeedToIndex` constructs
  a new video-bearing slide when navigation begins and removes the old slide
  when the animation finishes. Already-buffered playback objects aren't reused.
- `loadMoreFeed` waits for all unique creator lookups before making the new
  items available. Titles already arrive in feed JSON.
- End-of-feed refresh reports the final clip, then fetches a rebuilt feed. It
  also replaces history with the last clip plus new items; retaining two prior
  clips across that boundary needs deliberate history handling.
- Browser preload is only a hint, not a promise of a ready frame or a strict
  transfer limit. [MDN preload documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preload).

## Small live checks, not a full production audit

Read-only public requests obtained a sample URL from the unauthenticated feed.
No authenticated recommendation request, playback interaction, or whole-video
download was performed. Only headers and small MP4 byte ranges were read.

Sample: `https://clips.rhapsidious.com/how_his_mom_shaped_his_worldview_720p.mp4`

- `/iosclips/2/stream` returned a 302 to that URL with `no-store` on the redirect.
- Media size: 18,768,111 bytes; content type `video/mp4`; byte ranges returned 206.
- The first atoms were `ftyp`, `free`, then `mdat`; `moov` was verified at byte
  18,710,344, at the end. A fast-start remux is a concrete opportunity for this
  clip. It avoids needing a tail-index fetch; it does not mean the existing
  player necessarily downloads the entire file before playing.
- A range GET returned `MISS`; repeating it returned `HIT`, `Age: 28`, and
  `Cache-Control: max-age=14400`. Edge caching already works for this sample.
  An earlier HEAD returned `DYNAMIC`, illustrating why HEAD alone was not enough.
- An explicit `Origin: https://upload.rhapsidious.com` range request did not
  return Access-Control-Allow-Origin or Timing-Allow-Origin. Verify/fix these
  before adding JS fetch-based media caching, MSE/HLS, or cross-origin metrics.
  Plain cross-origin video playback can work without JS-readable CORS access.
- No `Alt-Svc` header appeared in these responses. The installed curl supports
  HTTP/2 but not HTTP/3. Therefore HTTP/3 negotiation was NOT verified, nor was
  it proven disabled. Check the zone, DNS HTTPS records, and real client traffic.

The plugin-management check found no callable Cloudflare account connector.
Dashboard settings, actual bucket inventory, rules, plan limits, and analytics
remain unverified. Never paste API secrets into implementation prompts.

## Playback policy to implement

- Current: one playing/audible clip; aim for 6–10 seconds buffered when practical.
  Start as soon as playback is ready; do not wait for that whole target before
  showing the first frame. The target governs ongoing buffering and speculation.
- Next: prepare a first frame and approximately 2–4 seconds once current is safe.
- Next +2: prepare metadata/poster, then about 1–2 seconds at lower priority.
- Previous two: retain existing playable state/bytes and posters; do not eagerly
  redownload them. Keep resume position or preserve the app's current replay rule.
- Start with one speculative media load at a time. Cancel stale work when the
  window changes; promote a prefetched entry rather than requesting it twice.
- These durations are tunable initial targets, NOT strict byte caps. Native
  media stacks control much of buffering. Five logical entries do not require
  five active decoders or simultaneous full-file downloads.
- Pause speculation during current-player starvation, poor networks, Data Saver,
  Low Data Mode, backgrounding, or memory pressure. Fall back to a smaller pool.
- Warm metadata before the queue ends without fabricating a watch/skip event.
  Preserve the existing final-watch report before rebuilding exhausted feeds.

## Storage and delivery decisions

Use immutable, versioned playback objects and avoid URL cache-busters for media.
Keep originals and derived variants separately; a folder rename by itself won't
improve delivery. Fast-start MP4 moves the index to the front without requiring
re-encoding when codecs are already suitable.
[FFmpeg formats documentation](https://www.ffmpeg.org/ffmpeg-formats.html).

R2 custom domains support edge caching; r2.dev is not the production path. Your
configured domains already follow that architecture.
[Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).
Check the plan's maximum cacheable object size before choosing large progressive
variants. [Cloudflare cache defaults](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/).

Public, versioned media can use long immutable caching only after deciding the
acceptable takedown/revocation policy. Purging the edge does not erase a browser's
or device's retained bytes. Restricted media needs authorization on every media
access path, including cache hits, with appropriate token expiry/revalidation.
R2 S3 presigned URLs cannot simply be rewritten onto the custom CDN domain.
[R2 presigned URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Adaptive HLS/CMAF is the next phase if necessary: VOD manifests, independent
segments, a source-appropriate bitrate ladder, and MP4 fallback. This is prerecorded
content, so don't add low-latency live-streaming machinery by default.
[Apple HLS guidance](https://developer.apple.com/streaming/).

## Prompts and execution order

1. `01-backend-prompt.md`: backend contract, media normalization, recommendation
   prefetch semantics, and Cloudflare audit/configuration handoff.
2. Copy the backend's implemented contract/fixtures into both client tasks.
3. `02-ios-prompt.md`: confirm the app path, then build the retained playback pool.
4. `03-web-prompt.md`: implement bounded video-element reuse and preload scheduling.

Clients may begin with legacy streamUrl support while the backend work proceeds.
Do not claim HTTP/3 from a feature toggle alone. On web verify `nextHopProtocol`
with Timing-Allow-Origin; on Apple verify appropriate network metrics and the
actual player requests, not just an unrelated URLSession test.
[MDN protocol metrics](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/nextHopProtocol),
[Apple HTTP/3 testing](https://developer.apple.com/documentation/technotes/tn3102-http3-in-your-app).

Initial performance targets: warm-neighbor first frame p50 ≤100 ms / p95 ≤250 ms
on a declared capable device/network; measure from navigation intent and also
from activation, separately from the swipe animation. These are goals, not
guarantees. Record cold starts, cache HIT/MISS, h2/h3, stalls, wasted prefetch
bytes, and memory separately. Don't label mock tests as real-world speed proof.
