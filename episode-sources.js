(function (root) {
  "use strict";
  const names = { YOUTUBE: "YouTube", SPOTIFY: "Spotify" };
  function safeURL(value) {
    if (typeof value !== "string" || value.trim().length > 2048 || /[\u0000-\u001f\u007f-\u009f]/.test(value.trim())) return "";
    try { const url = new URL(value.trim()); return url.protocol === "https:" && !url.username && !url.password && !url.port ? url.href : ""; } catch (_) { return ""; }
  }
  function url(value, provider) {
    const safe = safeURL(value); if (!safe) return "";
    const u = new URL(safe);
    if (provider === "YOUTUBE") {
      if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(u.hostname)) return "";
      const valid = u.hostname === "youtu.be" ? /^\/[A-Za-z0-9_-]+$/.test(u.pathname)
        : (u.pathname === "/watch" && /^[A-Za-z0-9_-]+$/.test(u.searchParams.get("v") || "")) || /^\/(live|shorts|embed)\/[A-Za-z0-9_-]+$/.test(u.pathname);
      return valid ? safe : "";
    }
    return provider === "SPOTIFY" && u.hostname === "open.spotify.com" && /^\/(intl-[A-Za-z-]+\/)?episode\/[A-Za-z0-9]+$/.test(u.pathname) ? safe : "";
  }
  function valid(value, provider) { return !String(value || "").trim() || !!url(value, provider); }
  function resolve(clip, preference) {
    const youtube = url(clip.youtubeUrl, "YOUTUBE"), spotify = url(clip.spotifyUrl, "SPOTIFY");
    return (preference === "SPOTIFY" ? spotify || youtube : youtube || spotify) || safeURL(clip.fullEpisodeFilepath) || safeURL(clip.sourceUrl);
  }
  function logo(provider) {
    const path = provider === "YOUTUBE"
      ? '<path fill="currentColor" fill-rule="evenodd" d="M6 4h12a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5H6a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5Zm4 4v8l6-4Z"/>'
      : '<circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M6 8q6-2.5 12 1M6 12q6-2.5 12 1M6 16q6-2.5 12 1" fill="none" stroke="var(--source-icon-cutout, #07070d)" stroke-width="1.8" stroke-linecap="round"/>';
    return '<svg class="episode-source-logo" viewBox="0 0 24 24" aria-hidden="true">'+path+'</svg>';
  }
  const api = { names, safeURL, url, valid, resolve, logo };
  if (typeof module !== "undefined") module.exports = api;
  root.VoxxlyEpisodeSources = api;
})(typeof window === "undefined" ? globalThis : window);
