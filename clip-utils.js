(function (root, factory) {
  "use strict";

  const clipUtils = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = clipUtils;
  }
  root.CLIP_UTILS = clipUtils;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeClip(clip) {
    if (!clip || typeof clip !== "object") {
      return clip;
    }
    return {
      ...clip,
      thumbnailUrl: clip.thumbnailUrl || null
    };
  }

  function normalizeClipList(clips) {
    return Array.isArray(clips) ? clips.map(normalizeClip) : [];
  }

  function getAbsoluteThumbnailUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
      return "";
    }
    const candidate = value.trim();
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? candidate : "";
    } catch (error) {
      return "";
    }
  }

  return {
    normalizeClip: normalizeClip,
    normalizeClipList: normalizeClipList,
    getAbsoluteThumbnailUrl: getAbsoluteThumbnailUrl
  };
});
