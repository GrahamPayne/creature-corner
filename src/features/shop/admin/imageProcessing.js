/**
 * Client-side image validation and resize/re-encode, run entirely in the
 * browser before anything is uploaded. No server-side image processing
 * exists or is needed for this.
 */

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB, per-original-file
export const MAX_LONG_EDGE = 2200; // px — within the suggested 2000-2500 range
export const WEBP_QUALITY = 0.9; // high quality; favors looking good over file size

/**
 * @param {File} file
 * @returns {{ok: boolean, error?: string}}
 */
export function validateImageFile(file) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: `"${file.name}" isn't a supported image type. Use JPG, PNG, or WebP.` };
  }
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return { ok: false, error: `"${file.name}" is ${mb}MB, which is over the 10MB limit.` };
  }
  return { ok: true };
}

/**
 * Pure dimension math: scales width/height down so the long edge is at most
 * maxLongEdge, preserving aspect ratio. Never upscales a smaller source
 * image — a 1200px photo stays 1200px, it doesn't get stretched up to 2200.
 * @param {number} width
 * @param {number} height
 * @param {number} maxLongEdge
 */
export function computeResizedDimensions(width, height, maxLongEdge) {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function loadDrawable(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation: 'from-image' applies EXIF rotation automatically,
      // so a photo taken on a phone doesn't upload sideways.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Some browsers/file types don't support this path; fall through.
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return img;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Image processing failed.'));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

/**
 * Resizes (if needed) and re-encodes an image file as WebP for upload.
 * Falls back to JPEG if the browser can't encode WebP (rare, older Safari).
 * @param {File} file
 * @param {{maxLongEdge?: number, quality?: number}} [opts]
 * @returns {Promise<{blob: Blob, extension: string}>}
 */
export async function resizeImageForUpload(file, opts = {}) {
  const maxLongEdge = opts.maxLongEdge ?? MAX_LONG_EDGE;
  const quality = opts.quality ?? WEBP_QUALITY;

  const source = await loadDrawable(file);
  const { width, height } = computeResizedDimensions(source.width, source.height, maxLongEdge);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);

  const webp = await canvasToBlob(canvas, 'image/webp', quality);
  if (webp.type === 'image/webp') return { blob: webp, extension: 'webp' };

  // Browser silently gave back something other than WebP (no encoder support).
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob: jpeg, extension: 'jpg' };
}
