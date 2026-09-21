# Prompt for the backend task

Implement the backend portion of faster Voxxly clip playback in
`/Users/daveborucki/rhapsidious-backend`. Inspect current files and AGENTS.md first;
preserve unrelated/uncommitted work. Modify this repository only. Do not deploy,
change paid services or Cloudflare settings, or bulk rewrite/delete production
media without my separate approval. Produce runnable changes and a deployment
checklist, not just a proposal.

Goal: current clip gets priority while iOS/web retain two previous clips and
prepare two upcoming clips. Use ordinary HTTPS media delivery with HTTP/3/QUIC
where negotiated and HTTP/2 fallback, not a custom QUIC server or WebTransport.
Near-instant warm navigation comes mainly from client reuse, media layout, and
caching; don't promise it from QUIC alone.

Inspect `IOSClipService`, `IOSClipController`, `IOSClipFeedDTO`, R2Properties,
thumbnail jobs, RecommendationService, recommendation sessions, and watch-event
processing. The inspected upload path stored original media in R2 and the DTO
returned a stream endpoint that 302-redirects to clips.rhapsidious.com. A public
sample had its moov index at the end. Reverify rather than assuming nothing changed.

Implement Phase 1:

1. Add a backward-compatible optional playback descriptor and creator summary
   to every shared clip DTO mapper, including recommended feed, fallback feed,
   profiles, saved and reposted clips. Keep all existing fields and meanings,
   especially `streamUrl`, `thumbnailUrl`, moderation, rights, and full-episode
   fields. Publish exact JSON fixtures for both client teams. Proposed fields:

   ```json
   {
     "playback": {
       "version": "immutable-media-revision",
       "mp4Url": "https://clips.rhapsidious.com/clips/123/revision/playback.mp4",
       "hlsUrl": null,
       "durationMs": 54000,
       "width": 720,
       "height": 1280,
       "byteLength": 12000000,
       "mimeType": "video/mp4"
     },
     "creator": {
       "id": 45,
       "username": "example",
       "profilePhotoUrl": "https://images.rhapsidious.com/example.jpg"
     }
   }
   ```

   This is a proposed contract, not an existing API. Optional values may be null;
   don't manufacture duration/dimensions. Reuse actual DTO naming conventions if
   necessary, but publish the final contract before clients integrate. Resolve
   creator summaries with batched queries rather than introducing a DB N+1.

2. Create an idempotent background media-preparation job. Probe inputs, remux
   suitable MP4s with faststart, and transcode incompatible source codecs only
   when necessary into a documented broadly compatible playback variant. Check
   orientation, aspect ratio, audio, codec/profile/pixel format, first keyframe,
   moov placement, process limits, cancellation, and failures. Never upscale or
   stretch. Keep originals. Use revisioned keys, correct Content-Type/length,
   explicit cache metadata, and atomic readiness publication. Until ready,
   clients retain legacy streamUrl fallback. Keep this off feed-request latency.
   Add a dry-run/restartable backfill tool; do not run a production backfill yet.

3. For approved public media, expose a validated direct CDN playback URL to
   remove the redirect round trip. For local or unresolved assets keep the old
   route. First audit who may access each asset: moderation, blocked users,
   deleted accounts, rights and age restrictions. A hidden feed entry alone
   does not protect a public URL. Do not weaken existing restrictions or imply
   CORS is authorization. Document any existing bypasses found. If actual media
   access must be private, stop the public-URL rollout and propose an edge
   authorization design with auth checked before serving cached bytes.

4. Define safe queue prefetch semantics. Returned recommendations currently
   affect session-shown state and exhaustion can clear seen history. Add an
   additive/versioned reservation or cursor contract if required, keeping old
   clients compatible. Fetching/preparing a clip is not a watch, skip, or view.
   Bound and deduplicate reservations, handle abandoned batches, and retain
   idempotent real interaction reporting. Clients must be able to prepare the
   next batch before exhaustion without prematurely resetting a cycle. The
   actual final clip's watch report must be settled before rebuilding an exhausted
   cycle. Include concurrency/retry tests and a client handoff describing this.

5. Produce a Cloudflare/R2 read-only audit and proposed configuration. Inspect
   available account access without printing secrets. Verify the real buckets,
   custom domains, zone HTTP/3 setting, DNS HTTPS/ALPN discovery, actual h3
   traffic, cache rules, object-size limits, CORS, ETags, Range/206/416 and cache
   HIT behavior. A public sample range already showed HIT with max-age=14400;
   don't assume caching is absent from a HEAD response. No Alt-Svc was observed
   in those samples, which is inconclusive by itself.

   Scope caching to media, not authenticated/personalized JSON. Propose immutable
   public asset TTLs only with an explicit takedown/revocation policy. Cache keys
   must retain object version. Authenticated media must not leak through shared
   cache keys or alternate public domains. Do not put an R2 S3 presigned URL on
   a custom domain by changing its host. Review Workers/WAF options only if
   private delivery requires them; ask before adding paid infrastructure.

   Configure/propose exact web origins for GET/HEAD and required Range headers;
   expose Content-Range, Accept-Ranges, ETag, and cache diagnostics as appropriate.
   Add Timing-Allow-Origin for approved frontend telemetry origins. CORS changes
   may require targeted refresh of cached headers. Do not purge unrelated assets.

6. Evaluate Phase 2 HLS/CMAF against actual clip size/bitrate/network metrics.
   Recommend a source-appropriate ladder (e.g. 360p/540p/720p where justified),
   independent aligned segments, VOD playlists, and MP4 fallback. Measure segment
   duration tradeoffs rather than blindly using live LL-HLS. Do not silently add
   a large transcoding rollout; report cost and migration plan for approval.

Verification: DTO compatibility; direct-vs-legacy URLs; failed preparation and
atomic readiness; codec/faststart output; no original overwrite; privacy/rights
regressions; queue prefetch not generating views; cursor/retry/cycle behavior;
Range and cache headers. Measure first-byte and redirect overhead. Distinguish
public tests from authenticated Cloudflare inspection and actual h3 negotiation.
Run existing tests/builds. Deliver the exact client contract, rollout/rollback
flags, migration commands in dry-run mode, required Cloudflare changes and what
could not be verified. Do not declare mocks proof of improved playback latency.

References:
- https://developers.cloudflare.com/speed/optimization/protocol/http3/
- https://developers.cloudflare.com/r2/buckets/public-buckets/
- https://developers.cloudflare.com/r2/buckets/cors/
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- https://www.ffmpeg.org/ffmpeg-formats.html
- https://developer.apple.com/streaming/
