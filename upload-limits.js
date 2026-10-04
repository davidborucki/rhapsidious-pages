(function (root) {
  "use strict";
  const VIDEO_BYTES = 100 * 1024 * 1024, PHOTO_BYTES = 20 * 1024 * 1024, MAX_FILES = 10;
  function validTitle(value) { return typeof value === "string" && Boolean(value.trim()) && value.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
  function videoError(file, count) {
    if (count >= MAX_FILES) return "Choose up to 10 videos.";
    if (!file || !file.size || file.size > VIDEO_BYTES) return "Choose videos under 100 MB.";
    if (!(file.type || "").startsWith("video/") && !/\.(mp4|mov|m4v|webm)$/i.test(file.name || "")) return "Choose a video.";
    return "";
  }
  function imageDimensions(buffer) {
    const b = new Uint8Array(buffer), v = new DataView(buffer);
    const text = (start, length) => String.fromCharCode(...b.slice(start, start + length));
    let width, height;
    if (b.length >= 24 && text(1, 3) === "PNG" && b[0] === 137 && text(12, 4) === "IHDR") {
      width = v.getUint32(16); height = v.getUint32(20);
    } else if (b[0] === 255 && b[1] === 216) {
      let offset = 2;
      while (offset + 4 <= b.length) {
        if (b[offset++] !== 255) break;
        while (b[offset] === 255) offset++;
        const marker = b[offset++];
        if (marker === 217 || marker === 218 || offset + 2 > b.length) break;
        const length = v.getUint16(offset);
        if (length < 2 || offset + length > b.length) break;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) {
          height = v.getUint16(offset + 3); width = v.getUint16(offset + 5); break;
        }
        offset += length;
      }
    } else if (b.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
      const kind = text(12, 4);
      if (kind === "VP8X") {
        width = 1 + b[24] + (b[25] << 8) + (b[26] << 16); height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
      } else if (kind === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42) {
        width = v.getUint16(26, true) & 16383; height = v.getUint16(28, true) & 16383;
      } else if (kind === "VP8L" && b[20] === 47) {
        width = 1 + ((b[21] | b[22] << 8) & 16383); height = 1 + ((b[22] >> 6 | b[23] << 2 | b[24] << 10) & 16383);
      }
    }
    if (!width || !height) throw new Error("Choose a JPEG, PNG or WebP photo.");
    if (width > 8192 || height > 8192 || width * height > 16000000) throw new Error("Choose a photo up to 16 megapixels.");
    return { width, height };
  }
  async function validatePhoto(file) {
    if (!file || !file.size || file.size > PHOTO_BYTES) throw new Error("Choose a photo under 20 MB.");
    return imageDimensions(await file.slice(0, 512 * 1024).arrayBuffer());
  }
  const api = { VIDEO_BYTES, PHOTO_BYTES, MAX_FILES, validTitle, videoError, imageDimensions, validatePhoto };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UploadLimits = api;
})(typeof window !== "undefined" ? window : globalThis);
