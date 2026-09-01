/**
 * Video upscaler - processes video frames using canvas or AI upscaling.
 */

import { canvasUpscaleImage, canvasUpscaleElement } from './canvasUpscaler.js';
import { AIUpscaler, loadModel } from './aiUpscaler.js';

/**
 * @typedef {Object} VideoUpscaleOptions
 * @property {'canvas'|'ai'} mode - Upscaling mode
 * @property {number} scale - Scale factor (2, 4)
 * @property {string} [canvasQuality] - Quality for canvas mode
 * @property {string} [modelType] - Model type for AI mode
 * @property {string} [modelUrl] - URL to ONNX model
 * @property {Function} [onProgress] - Progress callback (currentFrame, totalFrames)
 * @property {Function} [onFrame] - Per-frame callback
 */

/**
 * Upscale a video element frame by frame.
 * @param {HTMLVideoElement|Blob|string} source - Video source
 * @param {VideoUpscaleOptions} options
 * @param {AbortSignal} [signal]
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function upscaleVideo(source, options = {}, signal) {
  const {
    mode = 'canvas',
    scale = 2,
    canvasQuality = 'high',
    onProgress,
    onFrame
  } = options;

  // Create video element if source is a blob or URL
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;

  if (source instanceof Blob) {
    video.src = URL.createObjectURL(source);
  } else if (typeof source === 'string') {
    video.src = source;
  } else {
    video.src = source.src;
  }

  // Wait for video to load
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('Failed to load video'));
    
    if (signal) {
      signal.addEventListener('abort', () => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Aborted'));
      });
    }
  });

  const originalWidth = video.videoWidth;
  const originalHeight = video.videoHeight;
  const newWidth = originalWidth * scale;
  const newHeight = originalHeight * scale;
  const duration = video.duration;
  const fps = 30; // Assume 30fps

  // Use HTMLCanvasElement instead of OffscreenCanvas because captureStream() is not supported on OffscreenCanvas
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = newWidth;
  outputCanvas.height = newHeight;
  // Hide the canvas from view but keep it functional
  outputCanvas.style.position = 'absolute';
  outputCanvas.style.left = '-9999px';
  outputCanvas.style.top = '-9999px';
  document.body.appendChild(outputCanvas);
  
  const outputCtx = outputCanvas.getContext('2d');
  outputCtx.imageSmoothingEnabled = true;
  outputCtx.imageSmoothingQuality = canvasQuality;

  // Set up mediarecorder for output - this requires HTMLCanvasElement, not OffscreenCanvas
  const stream = outputCanvas.captureStream(fps);
  
  // Use best available codec
  let mimeType = 'video/webm;codecs=vp9';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm;codecs=vp8';
  }
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm';
  }

  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // Start recording
  recorder.start();

  // Process frames
  const totalFrames = Math.ceil(duration * fps);
  let currentFrame = 0;

  // Initialize AI upscaler if needed
  let aiUpscaler = null;
  if (mode === 'ai' && options.modelUrl) {
    const modelBytes = await loadModel(options.modelUrl, (p) => {
      if (onProgress) onProgress(-1, 'Loading model...'); // Special progress value for loading
    }, signal);
    
    aiUpscaler = new AIUpscaler({
      modelType: options.modelType,
      modelBytes
    });
    await aiUpscaler.init(signal);
  }

  // Process video
  try {
    for (let time = 0; time < duration; time += 1 / fps) {
      if (signal?.aborted) {
        recorder.stop();
        if (aiUpscaler) aiUpscaler.dispose();
        throw new Error('Aborted');
      }

      video.currentTime = time;
      await new Promise(resolve => {
        video.onseeked = resolve;
      });

      // Upscale current frame
      let upscaledImageData;
      
      if (mode === 'ai' && aiUpscaler) {
        // Capture frame and upscale with AI
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = originalWidth;
        frameCanvas.height = originalHeight;
        const frameCtx = frameCanvas.getContext('2d');
        frameCtx.drawImage(video, 0, 0);
        const frameImageData = frameCtx.getImageData(0, 0, originalWidth, originalHeight);
        
        upscaledImageData = await aiUpscaler.upscale(frameImageData, signal);
      } else {
        // Canvas upscaling
        upscaledImageData = await canvasUpscaleElement(video, scale, canvasQuality);
      }

      // Draw to output canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = upscaledImageData.width;
      tempCanvas.height = upscaledImageData.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(upscaledImageData, 0, 0);
      
      outputCtx.drawImage(tempCanvas, 0, 0, newWidth, newHeight);

      currentFrame++;
      if (onProgress) {
        onProgress(currentFrame, totalFrames);
      }
      if (onFrame) {
        onFrame(currentFrame, upscaledImageData);
      }
    }
  } finally {
    // Always cleanup, even on error
    try { recorder.stop(); } catch (e) { /* ignore */ }
    if (aiUpscaler) aiUpscaler.dispose();
    document.body.removeChild(outputCanvas);
  }

  // Stop recording
  recorder.stop();

  // Wait for recording to complete
  const blob = await new Promise(resolve => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  // Final cleanup
  URL.revokeObjectURL(video.src);

  return {
    blob,
    width: newWidth,
    height: newHeight,
    duration,
    originalWidth,
    originalHeight
  };
}

/**
 * Extract a single frame from video.
 * @param {HTMLVideoElement|Blob|string} source
 * @param {number} [time=0] - Time in seconds
 */
export async function extractVideoFrame(source, time = 0) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;

  if (source instanceof Blob) {
    video.src = URL.createObjectURL(source);
  } else if (typeof source === 'string') {
    video.src = source;
  } else {
    video.src = source.src;
  }

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('Failed to load video'));
  });

  video.currentTime = time;
  await new Promise(resolve => {
    video.onseeked = resolve;
  });

  const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  URL.revokeObjectURL(video.src);

  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Upscale multiple images in batch.
 * @param {Array<ImageData>} images
 * @param {VideoUpscaleOptions} options
 * @param {AbortSignal} [signal]
 */
export async function upscaleImageBatch(images, options = {}, signal) {
  const results = [];
  const total = images.length;

  for (let i = 0; i < images.length; i++) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    let result;
    
    if (options.mode === 'ai') {
      const aiUpscaler = new AIUpscaler({
        modelType: options.modelType,
        modelBytes: options.modelBytes
      });
      await aiUpscaler.init(signal);
      result = await aiUpscaler.upscale(images[i], signal);
      aiUpscaler.dispose();
    } else {
      result = await canvasUpscaleImage(
        images[i],
        options.scale || 2,
        options.canvasQuality || 'high'
      );
    }

    results.push(result);

    if (options.onProgress) {
      options.onProgress(i + 1, total);
    }
  }

  return results;
}
