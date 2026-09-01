/**
 * Unified image/video upscaler interface.
 * Combines canvas and AI upscaling into a single API.
 */

import { 
  canvasUpscaleImage, 
  canvasUpscaleElement, 
  canvasUpscaleBlob,
  UpscaleQuality,
  UpscaleScale 
} from './canvasUpscaler.js';

import { 
  AIUpscaler, 
  loadModel,
  AIUpscaleModel 
} from './aiUpscaler.js';

import {
  upscaleVideo,
  extractVideoFrame,
  upscaleImageBatch
} from './videoUpscaler.js';

export {
  // Canvas upscaler
  canvasUpscaleImage,
  canvasUpscaleElement,
  canvasUpscaleBlob,
  UpscaleQuality,
  UpscaleScale,
  
  // AI upscaler
  AIUpscaler,
  loadModel,
  AIUpscaleModel,
  
  // Video upscaler
  upscaleVideo,
  extractVideoFrame,
  upscaleImageBatch
};

/**
 * @typedef {Object} UpscaleOptions
 * @property {'canvas'|'ai'} mode - Upscaling mode
 * @property {number} scale - Scale factor (2, 4, 8 for canvas; 2, 4 for AI)
 * @property {string} [quality] - Canvas quality ('low', 'medium', 'high')
 * @property {string} [modelType] - AI model type
 * @property {string} [modelUrl] - URL to load AI model from
 * @property {Uint8Array} [modelBytes] - Pre-loaded model bytes
 * @property {Function} [onProgress] - Progress callback
 * @property {Function} [onFrame] - Per-frame callback for video
 */

export const UpscaleMode = {
  CANVAS: 'canvas',
  AI: 'ai'
};

export const UpscaleScaleOptions = {
  X2: 2,
  X4: 4,
  X8: 8
};

/**
 * Main upscale function - automatically detects input type.
 * @param {ImageData|HTMLImageElement|HTMLVideoElement|Blob|File} input
 * @param {UpscaleOptions} options
 * @param {AbortSignal} [signal]
 * @returns {Promise<UpscaleResult>}
 */
export async function upscale(input, options = {}, signal) {
  const {
    mode = 'canvas',
    scale = 2,
    quality = 'high',
    modelType = AIUpscaleModel.REAL_ESRGAN_X2,
    modelUrl,
    modelBytes,
    onProgress,
    onFrame
  } = options;

  // Detect input type and process accordingly
  if (input instanceof Blob || (input && input.type && input.type.startsWith('image/'))) {
    return await upscaleBlobInput(input, mode, scale, quality, modelType, modelUrl, modelBytes, onProgress, signal);
  }
  
  if (input instanceof HTMLVideoElement || (input && input.tagName === 'VIDEO')) {
    return await upscaleVideo(input, {
      mode,
      scale,
      canvasQuality: quality,
      modelType,
      modelUrl,
      onProgress,
      onFrame
    }, signal);
  }
  
  if (input instanceof HTMLImageElement || (input && input.tagName === 'IMG')) {
    return await upscaleElementInput(input, mode, scale, quality, modelType, modelUrl, modelBytes, signal);
  }
  
  if (input instanceof ImageData || (input && input.data && input.width && input.height)) {
    return await upscaleImageDataInput(input, mode, scale, quality, modelType, modelUrl, modelBytes, signal);
  }

  throw new Error(`Unsupported input type: ${typeof input}`);
}

async function upscaleBlobInput(blob, mode, scale, quality, modelType, modelUrl, modelBytes, onProgress, signal) {
  // Check if it's a video blob
  const isVideo = blob.type.startsWith('video/');
  
  if (isVideo) {
    return await upscaleVideo(blob, {
      mode,
      scale,
      canvasQuality: quality,
      modelType,
      modelUrl,
      onProgress
    }, signal);
  }
  
  // Image blob
  if (mode === 'ai' && (modelBytes || modelUrl)) {
    const bytes = modelBytes || await loadModel(modelUrl, onProgress, signal);
    const aiUpscaler = new AIUpscaler({ modelType, modelBytes: bytes });
    await aiUpscaler.init(signal);
    
    const imageBitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    const result = await aiUpscaler.upscale(imageData, signal);
    aiUpscaler.dispose();
    
    return {
      imageData: result,
      blob: await blobFromImageData(result),
      width: result.width,
      height: result.height
    };
  }
  
  return await canvasUpscaleBlob(blob, scale, quality);
}

async function upscaleElementInput(element, mode, scale, quality, modelType, modelUrl, modelBytes, signal) {
  if (mode === 'ai' && (modelBytes || modelUrl)) {
    const bytes = modelBytes || await loadModel(modelUrl, undefined, signal);
    const aiUpscaler = new AIUpscaler({ modelType, modelBytes: bytes });
    await aiUpscaler.init(signal);
    
    const canvas = new OffscreenCanvas(element.width, element.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(element, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    const result = await aiUpscaler.upscale(imageData, signal);
    aiUpscaler.dispose();
    
    return {
      imageData: result,
      blob: await blobFromImageData(result),
      width: result.width,
      height: result.height
    };
  }
  
  const result = await canvasUpscaleElement(element, scale, quality);
  return {
    imageData: result,
    blob: await blobFromImageData(result),
    width: result.width,
    height: result.height
  };
}

async function upscaleImageDataInput(imageData, mode, scale, quality, modelType, modelUrl, modelBytes, signal) {
  let upscaled;
  
  if (mode === 'ai' && (modelBytes || modelUrl)) {
    const bytes = modelBytes || await loadModel(modelUrl, undefined, signal);
    const aiUpscaler = new AIUpscaler({ modelType, modelBytes: bytes });
    await aiUpscaler.init(signal);
    upscaled = await aiUpscaler.upscale(imageData, signal);
    aiUpscaler.dispose();
  } else {
    upscaled = await canvasUpscaleImage(imageData, scale, quality);
  }
  
  return {
    imageData: upscaled,
    blob: await blobFromImageData(upscaled),
    width: upscaled.width,
    height: upscaled.height
  };
}

async function blobFromImageData(imageData) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * @typedef {Object} UpscaleResult
 * @property {ImageData} imageData - Upscaled image data
 * @property {Blob} blob - Upscaled blob
 * @property {number} width - New width
 * @property {number} height - New height
 */

/**
 * Estimate processing time for upscaling.
 * @param {number} width
 * @param {number} height
 * @param {string} mode - 'canvas' or 'ai'
 * @param {number} scale - Scale factor
 */
export function estimateUpscaleTime(width, height, mode = 'canvas', scale = 2) {
  const pixels = width * height * scale * scale;
  
  if (mode === 'canvas') {
    // Canvas is very fast: ~0.1ms per 1000 pixels
    return pixels / 1000 * 0.1;
  }
  
  // AI is slower: ~10-50ms per 1000 pixels depending on hardware
  return pixels / 1000 * 30;
}

/**
 * Check if AI upscaling is supported.
 * @returns {boolean}
 */
export function isAISupported() {
  try {
    return typeof OffscreenCanvas !== 'undefined' && 
           typeof createImageBitmap !== 'undefined' &&
           typeof WebAssembly !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Get recommended scale based on image size.
 * @param {number} width
 * @param {number} height
 */
export function getRecommendedScale(width, height) {
  const pixels = width * height;
  
  // Don't upscale images that are already large
  if (pixels >= 1920 * 1080) {
    return 1;
  }
  
  if (pixels >= 1280 * 720) {
    return 2;
  }
  
  // Small images benefit most from upscaling
  if (pixels <= 640 * 480) {
    return 4;
  }
  
  return 2;
}
