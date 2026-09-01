/**
 * Canvas-based image upscaler using browser's built-in interpolation.
 * Fast, free, and privacy-first - no external dependencies.
 */

export const UpscaleQuality = {
  LOW: 'low',      // Nearest neighbor - pixelated look
  MEDIUM: 'medium', // Bilinear - balanced
  HIGH: 'high'     // Bicubic - smoother
};

export const UpscaleScale = {
  X2: 2,
  X4: 4,
  X8: 8
};

/**
 * Upscale an ImageData object using canvas interpolation.
 * @param {ImageData} imageData - Source image data
 * @param {number} scale - Scale factor (2, 4, or 8)
 * @param {string} quality - Interpolation quality ('low', 'medium', 'high')
 * @returns {Promise<ImageData>} Upscaled image data
 */
export async function canvasUpscaleImage(imageData, scale = 2, quality = 'high') {
  const { width, height, data } = imageData;
  const newWidth = width * scale;
  const newHeight = height * scale;

  // Create source canvas
  const srcCanvas = new OffscreenCanvas(width, height);
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.putImageData(imageData, 0, 0);

  // Create destination canvas
  const dstCanvas = new OffscreenCanvas(newWidth, newHeight);
  const dstCtx = dstCanvas.getContext('2d');

  // Set interpolation quality
  dstCtx.imageSmoothingEnabled = true;
  
  switch (quality) {
    case 'low':
      dstCtx.imageSmoothingQuality = 'low';
      break;
    case 'medium':
      dstCtx.imageSmoothingQuality = 'medium';
      break;
    case 'high':
    default:
      dstCtx.imageSmoothingQuality = 'high';
      break;
  }

  // Scale using drawImage (uses browser's built-in interpolation)
  dstCtx.drawImage(srcCanvas, 0, 0, newWidth, newHeight);

  return dstCtx.getImageData(0, 0, newWidth, newHeight);
}

/**
 * Upscale from HTMLImageElement or HTMLCanvasElement.
 * @param {HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} source
 * @param {number} scale - Scale factor
 * @param {string} quality - Interpolation quality
 * @returns {Promise<ImageData>}
 */
export async function canvasUpscaleElement(source, scale = 2, quality = 'high') {
  const width = source.width || source.videoWidth;
  const height = source.height || source.videoHeight;
  
  if (!width || !height) {
    throw new Error('Invalid source dimensions');
  }

  const newWidth = width * scale;
  const newHeight = height * scale;

  const canvas = new OffscreenCanvas(newWidth, newHeight);
  const ctx = canvas.getContext('2d');
  
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = quality === 'low' ? 'low' : quality === 'medium' ? 'medium' : 'high';
  
  ctx.drawImage(source, 0, 0, newWidth, newHeight);

  return ctx.getImageData(0, 0, newWidth, newHeight);
}

/**
 * Upscale a Blob or File.
 * @param {Blob} blob - Image blob
 * @param {number} scale - Scale factor
 * @param {string} quality - Interpolation quality
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function canvasUpscaleBlob(blob, scale = 2, quality = 'high') {
  const imageBitmap = await createImageBitmap(blob);
  const imageData = await canvasUpscaleElement(imageBitmap, scale, quality);
  
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  
  const outputBlob = await canvas.convertToBlob({ type: 'image/png' });
  
  return {
    blob: outputBlob,
    width: imageData.width,
    height: imageData.height
  };
}
