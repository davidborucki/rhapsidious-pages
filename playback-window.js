(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VoxxlyPlayback = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function absoluteUrl(value) {
    if (typeof value !== "string") return "";
    try {
      const url = new URL(value);
      return /^(https?:)$/.test(url.protocol) && !url.username && !url.password ? value.trim() : "";
    } catch (_) { return ""; }
  }

  // Phase-one backend contract: verified immutable MP4; HLS is currently null.
  function sourceFor(clip, legacy, nativeHls) {
    const playback = clip.playback;
    if (playback && typeof playback.version === "string" && playback.version) {
      const mp4 = absoluteUrl(playback.mp4Url);
      const hls = nativeHls && absoluteUrl(playback.hlsUrl);
      if (mp4 || hls) return mp4 || hls;
    }
    return legacy(clip);
  }

  function mediaKey(clip, source) {
    // Include source as well: a rollback/removal of the descriptor invalidates reuse.
    return JSON.stringify([String(clip.id), clip.playback && clip.playback.version || "legacy", source]);
  }

  function bufferedAhead(video) {
    const time = video.currentTime || 0;
    for (let i = 0; i < video.buffered.length; i += 1) {
      if (video.buffered.start(i) <= time + 0.05 && video.buffered.end(i) > time) {
        return video.buffered.end(i) - time;
      }
    }
    return 0;
  }

  class WindowScheduler {
    constructor(options) {
      this.options = options;
      this.entries = new Map();
      this.ordered = [];
      this.current = null;
      this.direction = 1;
      this.generation = 0;
      this.closed = false;
    }
    reconcile(clips, index, direction) {
      if (this.closed) return null;
      this.generation += 1;
      this.direction = direction < 0 ? -1 : 1;
      const desired = [];
      const ids = new Set();
      // Current wins over repeated IDs/revisions. Never render duplicate clip IDs.
      [0, -1, 1, -2, 2].forEach(offset => {
        const clip = clips[index + offset];
        if (!clip || clip.id == null || ids.has(String(clip.id))) return;
        ids.add(String(clip.id));
        desired.push({ clip, offset, key: this.options.key(clip) });
      });
      const keys = new Set(desired.map(item => item.key));
      this.entries.forEach((entry, key) => {
        if (!keys.has(key)) {
          this.options.evict(entry);
          this.entries.delete(key);
        }
      });
      this.ordered = desired.map(item => {
        let entry = this.entries.get(item.key);
        if (!entry) {
          entry = this.options.create(item.clip, item.key);
          this.entries.set(item.key, entry);
        }
        entry.clip = item.clip;
        entry.offset = item.offset;
        return entry;
      });
      this.current = this.ordered.find(entry => entry.offset === 0) || null;
      return this.current;
    }
    candidate(healthy) {
      if (!healthy || this.closed) return null;
      for (const distance of [1, 2]) {
        const entry = this.ordered.find(item => item.offset === distance * this.direction);
        if (entry && !entry.visited && !entry.failed && !entry.prepared) return entry;
      }
      return null;
    }
    guard(callback) {
      const generation = this.generation;
      return (...args) => {
        if (!this.closed && generation === this.generation) return callback(...args);
      };
    }
    destroy() {
      this.closed = true;
      this.generation += 1;
      this.entries.forEach(entry => this.options.evict(entry));
      this.entries.clear();
      this.ordered = [];
      this.current = null;
    }
  }

  function allowSpeculation(navigator, enabled) {
    const connection = navigator.connection;
    // Unknown networks, Safari/iOS, low-memory devices and data-saving modes
    // retain visited players, but never start speculative native downloads.
    return enabled === true && Boolean(connection) && !connection.saveData &&
      connection.effectiveType === "4g" && connection.downlink >= 5 &&
      !(navigator.deviceMemory && navigator.deviceMemory < 4) &&
      /Chrome|Chromium/.test(navigator.userAgent) && !/iPhone|iPad|iPod/.test(navigator.userAgent);
  }

  class NativePool {
    constructor(options) {
      this.options = options;
      this.active = null;
      this.loader = null;
      this.suspended = false;
      this.connections = new Map();
      this.samples = [];
      this.closed = false;
      this.scheduler = new WindowScheduler({
        key: clip => mediaKey(clip, options.source(clip)),
        create: (clip, key) => this.create(clip, key),
        evict: entry => this.evict(entry)
      });
      this.tick = this.tick.bind(this);
      this.timer = window.setInterval(this.tick, 300);
      if (options.telemetry && typeof PerformanceObserver !== "undefined") {
        this.observer = new PerformanceObserver(list => {
          list.getEntries().forEach(resource => {
            const entry = this.scheduler.ordered.find(item => item.source === resource.name || item.video.currentSrc === resource.name);
            if (!entry || resource.initiatorType !== "video") return;
            // Cross-origin zeros are unknown, not a cache HIT or h2 evidence.
            const visible = resource.responseStart > 0;
            this.record("transfer", entry, {
              protocol: resource.nextHopProtocol || "unknown",
              bytes: visible ? resource.transferSize : null,
              encodedBytes: visible ? resource.encodedBodySize : null,
              requestStart: visible ? resource.requestStart : null,
              firstByteMs: visible ? resource.responseStart - resource.startTime : null,
              redirectMs: visible ? resource.redirectEnd - resource.redirectStart : null,
              durationMs: resource.duration,
              cdnCacheStatus: "unknown", speculative: !entry.visited
            });
          });
        });
        this.observer.observe({ type: "resource", buffered: false });
      }
    }
    record(type, entry, data) {
      if (!this.options.telemetry) return;
      this.samples.push({ type, at: performance.now(), clipId: entry && entry.clip.id,
        revision: entry && entry.clip.playback && entry.clip.playback.version || "legacy", ...data });
      if (this.samples.length > 200) this.samples.shift();
    }
    create(clip, key) {
      const wrapper = this.options.create(clip);
      const video = wrapper.matches("video") ? wrapper : wrapper.querySelector("video");
      const entry = { clip, key, wrapper, video, source: this.options.source(clip), cleanups: [], visited: false, prepared: false, failed: false, waiting: true };
      video.preload = "none";
      video.muted = true;
      this.hide(entry);
      const on = (name, handler) => {
        video.addEventListener(name, handler);
        entry.cleanups.push(() => video.removeEventListener(name, handler));
      };
      on("waiting", () => {
        entry.waiting = true;
        if (entry === this.active) {
          if (entry.presented) entry.stallAt = performance.now();
          this.record(entry.presented ? "waiting" : "startup-waiting", entry, { bufferedSeconds: bufferedAhead(video) });
        }
        this.tick();
      });
      on("playing", () => {
        if (entry !== this.active || this.suspended || document.hidden) { video.pause(); return; }
        entry.waiting = false;
        if (entry.stallAt) {
          this.record("rebuffer", entry, { durationMs: performance.now() - entry.stallAt });
          entry.stallAt = null;
        }
        this.tick();
      });
      on("canplay", () => { entry.waiting = false; this.tick(); });
      on("progress", this.tick);
      on("suspend", this.tick);
      on("error", () => {
        entry.failed = true;
        this.record("error", entry, { code: video.error && video.error.code });
        this.tick();
      });
      on("play", () => {
        if (entry !== this.active || this.suspended || document.hidden) video.pause();
      });
      return entry;
    }
    reconcile(clips, index, direction) {
      return this.scheduler.reconcile(clips, index, direction);
    }
    ensureSource(entry) {
      if (entry.video.hasAttribute("src") || entry.failed) return;
      const origin = absoluteUrl(entry.source) && new URL(entry.source).origin;
      if (origin && origin !== location.origin && !this.connections.has(origin) && this.connections.size < 2) {
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = origin;
        document.head.appendChild(link);
        this.connections.set(origin, link);
      }
      entry.video.src = entry.source;
      this.record("source", entry, { speculative: entry !== this.active });
    }
    hide(entry) {
      entry.wrapper.hidden = true;
      entry.wrapper.inert = true;
      entry.wrapper.setAttribute("aria-hidden", "true");
      entry.video.tabIndex = -1;
    }
    show(entry, interactive) {
      entry.wrapper.hidden = false;
      entry.wrapper.inert = !interactive;
      entry.wrapper.setAttribute("aria-hidden", String(!interactive));
      entry.video.tabIndex = interactive ? 0 : -1;
    }
    activate(entry, navigationAt) {
      if (this.closed || !entry) return;
      if (this.active === entry) return;
      if (this.active) {
        this.active.video.pause();
        this.active.wrapper.inert = true;
        this.active.wrapper.setAttribute("aria-hidden", "true");
        this.active.video.tabIndex = -1;
        this.active.video.muted = true;
        this.active.video.preload = "none";
        this.cancelFrame(this.active);
      }
      this.active = entry;
      if (this.loader === entry) this.loader = null;
      const warm = entry.video.readyState >= 2 && bufferedAhead(entry.video) > 0;
      entry.visited = true;
      entry.presented = false;
      entry.activationAt = performance.now();
      entry.navigationAt = navigationAt || entry.activationAt;
      this.show(entry, true);
      entry.video.preload = "auto";
      this.ensureSource(entry);
      this.cancelFrame(entry);
      const reportFrame = method => {
        if (this.closed || this.active !== entry || this.suspended || entry.video.paused) return;
        entry.presented = true;
        this.record("first-frame", entry, {
          method, warm, activationMs: performance.now() - entry.activationAt,
          navigationMs: performance.now() - entry.navigationAt,
          bufferedSeconds: bufferedAhead(entry.video),
          entries: this.scheduler.entries.size,
          jsHeapBytes: performance.memory ? performance.memory.usedJSHeapSize : null
        });
        this.cancelFrame(entry);
      };
      if (entry.video.requestVideoFrameCallback) {
        entry.frameId = entry.video.requestVideoFrameCallback(() => reportFrame("requestVideoFrameCallback"));
      } else {
        // 'playing' plus a paint turn is only a readiness proxy, not a decoded-frame timestamp.
        entry.frameFallback = () => {
          entry.paintId = requestAnimationFrame(() => reportFrame("playing+animationFrame-proxy"));
        };
        entry.video.addEventListener("playing", entry.frameFallback, { once: true });
      }
      this.tick();
    }
    tick() {
      if (this.closed) return;
      const expired = this.scheduler.ordered.filter(entry => entry.clip._reservation && entry.clip._reservation.expiresAt <= Date.now());
      if (expired.length) {
        expired.forEach(entry => {
          this.scheduler.entries.delete(entry.key);
          this.evict(entry);
        });
        this.scheduler.ordered = this.scheduler.ordered.filter(entry => !expired.includes(entry));
        if (this.options.onExpired) this.options.onExpired();
      }
      const active = this.active;
      const healthy = active && !active.failed && !active.waiting && !active.video.paused &&
        active.video.readyState >= 3 && bufferedAhead(active.video) >= Math.min(8, Math.max(0.5, active.video.duration - active.video.currentTime));
      const enabled = !this.nativeOverrun && !this.suspended && !document.hidden && healthy && allowSpeculation(navigator, this.options.speculativeNative);
      let candidate = this.scheduler.candidate(enabled);
      if (this.loader) {
        const loader = this.loader;
        const target = Math.abs(loader.offset) === 1 ? 3 : 1.5;
        if (bufferedAhead(loader.video) >= Math.min(target, loader.video.duration || target) && loader.video.readyState >= 2) loader.prepared = true;
        if (bufferedAhead(loader.video) > target + 2) {
          // The browser ignored the stop hint. Stop admitting speculation for this
          // player session; only eviction can reliably release that native request.
          if (!this.nativeOverrun) this.record("native-preload-overrun", loader, { targetSeconds: target, actualSeconds: bufferedAhead(loader.video) });
          this.nativeOverrun = true;
        }
        if (!enabled || loader !== candidate || loader.prepared || loader.failed) loader.video.preload = "none";
        // A pause/preload change is NOT cancellation. Keep the native slot occupied
        // until the browser actually stops loading, even after reaching the target.
        if (loader.video.networkState !== 2 || loader.failed) this.loader = null;
        else return;
      }
      candidate = this.scheduler.candidate(enabled && !this.nativeOverrun);
      // Retained previous videos can still have native requests in flight.
      // Never pile a new speculative download onto those requests.
      if (!candidate || this.scheduler.ordered.some(entry => entry !== active && entry.video.networkState === 2)) return;
      this.loader = candidate;
      candidate.video.preload = "auto";
      this.ensureSource(candidate);
    }
    suspend(value) {
      this.suspended = value;
      this.scheduler.ordered.forEach(entry => {
        if (value) {
          entry.video.preload = "none";
          entry.video.pause();
          this.cancelFrame(entry);
        }
      });
      if (!value && this.active) this.active.video.preload = "auto";
      this.tick();
    }
    cancelFrame(entry) {
      if (entry.frameId != null) entry.video.cancelVideoFrameCallback(entry.frameId);
      if (entry.paintId != null) cancelAnimationFrame(entry.paintId);
      if (entry.frameFallback) entry.video.removeEventListener("playing", entry.frameFallback);
      entry.frameId = entry.paintId = entry.frameFallback = null;
    }
    evict(entry) {
      if (this.active === entry) this.active = null;
      if (this.loader === entry) this.loader = null;
      this.record("evict", entry, { unused: !entry.visited, bufferedSeconds: bufferedAhead(entry.video) });
      this.cancelFrame(entry);
      entry.cleanups.forEach(cleanup => cleanup());
      // No fetches or blob URLs are owned by this implementation.
      entry.video.pause();
      entry.video.removeAttribute("src");
      entry.video.removeAttribute("poster");
      entry.wrapper.querySelectorAll("img").forEach(image => image.removeAttribute("src"));
      entry.video.load();
      entry.wrapper.remove();
    }
    destroy() {
      this.closed = true;
      clearInterval(this.timer);
      if (this.observer) this.observer.disconnect();
      this.scheduler.destroy();
      this.connections.forEach(link => link.remove());
      this.connections.clear();
    }
  }

  return { WindowScheduler, NativePool, sourceFor, mediaKey, bufferedAhead, allowSpeculation, absoluteUrl };
});
