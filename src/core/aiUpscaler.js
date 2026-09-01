/**
 * AI-powered image upscaler using ONNX Runtime.
 * Uses Real-ESRGAN or similar super-resolution models.
 * 
 * Model options:
 * - RealESRGAN_x2plus (2x upscale, ~2MB)
 * - RealESRGAN_x4plus (4x upscale, ~4MB)
 * - Swin2SR (versatile, ~10MB)
 */

import * as wasmOrt from 'onnxruntime-web/wasm';

export const AIUpscaleModel = {
  REAL_ESRGAN_X2: 'RealESRGAN_x2plus',
  REAL_ESRGAN_X4: 'RealESRGAN_x4plus',
  SWIN2SR_X2: 'Swin2SR_SRx2_Compact'
};

/**
 * @typedef {Object} AIUpscalerOptions
 * @property {string} modelType - Model to use
 * @property {ArrayBuffer|Uint8Array} [modelBytes] - Pre-loaded model bytes
 * @property {string} [modelUrl] - URL to load model from (if not pre-loaded)
 * @property {string} executionProvider - 'wasm' or 'wasm-simd'
 * @property {number} numThreads - Number of threads for processing
 */

const DEFAULT_OPTIONS = {
  modelType: AIUpscaleModel.REAL_ESRGAN_X2,
  executionProvider: 'wasm',
  numThreads: 'auto'
};

/**
 * Normalize model input for ESRGAN-style models.
 * ESRGAN expects: [1, 3, H, W] in RGB format
 */
function normalizeEsrganInput(imageData) {
  const { width, height, data } = imageData;
  
  // Convert RGBA to RGB planar format
  const rgbData = new Float32Array(3 * height * width);
  
  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * 4;
    rgbData[i] = data[srcIdx] / 255.0;           // R
    rgbData[i + width * height] = data[srcIdx + 1] / 255.0; // G
    rgbData[i + 2 * width * height] = data[srcIdx + 2] / 255.0; // B
  }
  
  return rgbData;
}

/**
 * Denormalize ESRGAN output back to RGBA ImageData.
 */
function denormalizeEsrganOutput(outputData, width, height, scale) {
  const newWidth = width * scale;
  const newHeight = height * scale;
  const pixels = new Uint8ClampedArray(newWidth * newHeight * 4);
  
  for (let i = 0; i < newWidth * newHeight; i++) {
    const r = Math.round(Math.max(0, Math.min(1, outputData[i])) * 255);
    const g = Math.round(Math.max(0, Math.min(1, outputData[i + newWidth * newHeight])) * 255);
    const b = Math.round(Math.max(0, Math.min(1, outputData[i + 2 * newWidth * newHeight])) * 255);
    
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  
  return new ImageData(pixels, newWidth, newHeight);
}

/**
 * AI Upscaler class using ONNX Runtime.
 */
export class AIUpscaler {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.session = null;
    this.ort = null;
    this.scale = this._getScaleFromModel(this.options.modelType);
    this.inputName = 'input';
    this.outputName = 'output';
  }

  _getScaleFromModel(modelType) {
    if (modelType.includes('x2')) return 2;
    if (modelType.includes('x4')) return 4;
    return 2; // default
  }

  /**
   * Initialize the ONNX session.
   * @param {AbortSignal} [signal] - Abort signal
   */
  async init(signal) {
    if (this.session) return;

    this.ort = await wasmOrt;
    
    // Set up WASM paths if needed
    const wasmOptions = {};
    if (this.options.wasmPaths) {
      wasmOptions.graalHeapMode = false;
      wasmOptions.hashAssets = true;
      wasmOptions.ignoredPaths = [this.options.wasmPaths];
    }

    const sessionOptions = {
      executionProviders: [this.options.executionProvider],
      graphOptimizationLevel: 'all'
    };

    if (this.options.numThreads !== 'auto') {
      sessionOptions.graphOptimizationLevel = this.options.numThreads;
    }

    // Model bytes should be provided or loaded from URL
    if (!this.options.modelBytes) {
      throw new Error('AI Upscaler requires modelBytes or modelUrl to be specified');
    }

    try {
      this.session = await this.ort.InferenceSession.create(
        this.options.modelBytes,
        sessionOptions
      );
      
      // Get input/output names
      const inputOutputNames = this.session.inputNames;
      const outputNames = this.session.outputNames;
      
      if (inputOutputNames && inputOutputNames.length > 0) {
        this.inputName = inputOutputNames[0];
      }
      if (outputNames && outputNames.length > 0) {
        this.outputName = outputNames[0];
      }
    } catch (error) {
      console.error('[AIUpscaler] Failed to initialize ONNX session:', error);
      throw error;
    }
  }

  /**
   * Upscale an ImageData using AI model.
   * @param {ImageData} imageData
   * @param {AbortSignal} [signal]
   * @returns {Promise<ImageData>}
   */
  async upscale(imageData, signal) {
    if (!this.session) {
      await this.init(signal);
    }

    const { width, height } = imageData;
    
    // Preprocess
    const normalizedInput = normalizeEsrganInput(imageData);
    
    // Create input tensor [1, 3, H, W]
    const inputTensor = new this.ort.Tensor(
      'float32',
      normalizedInput,
      [1, 3, height, width]
    );

    // Run inference
    const feeds = { [this.inputName]: inputTensor };
    const results = await this.session.run(feeds, { signal });
    
    const outputTensor = results[this.outputName];
    const outputData = outputTensor.data;

    // Postprocess
    const upscaled = denormalizeEsrganOutput(
      outputData,
      width,
      height,
      this.scale
    );

    return upscaled;
  }

  /**
   * Clean up resources.
   */
  dispose() {
    if (this.session) {
      this.session = null;
    }
  }
}

/**
 * Load a model from URL.
 * @param {string} url - URL to ONNX model
 * @param {Function} onProgress - Progress callback (0-100)
 * @param {AbortSignal} [signal]
 */
export async function loadModel(url, onProgress, signal) {
  const response = await fetch(url, { signal });
  
  if (!response.ok) {
    throw new Error(`Failed to load model: ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = parseInt(contentLength || '0', 10);
  
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    
    if (done) break;
    
    chunks.push(value);
    loaded += value.length;
    
    if (onProgress && total > 0) {
      onProgress(Math.round((loaded / total) * 100));
    }
  }

  const blob = new Blob(chunks);
  const arrayBuffer = await blob.arrayBuffer();
  
  return new Uint8Array(arrayBuffer);
}

/**
 * Factory function for creating pre-configured upscalers.
 */
export async function createAIUpscaler(modelType, modelUrl, onProgress, signal) {
  const modelBytes = await loadModel(modelUrl, onProgress, signal);
  
  return new AIUpscaler({
    modelType,
    modelBytes
  });
}
