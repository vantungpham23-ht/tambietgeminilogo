export { createWatermarkEngine, removeWatermarkFromImage } from './browser.js';
export { removeWatermarkFromImageData, removeWatermarkFromImageDataSync } from './image-data.js';
export {
    WatermarkEngine,
    calculateWatermarkPosition,
    detectWatermarkConfig,
    removeRepeatedWatermarkLayers
} from './browser.js';

// Upscaler exports
export {
    // Main API
    upscale,
    estimateUpscaleTime,
    isAISupported,
    getRecommendedScale,
    
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
    upscaleImageBatch,
    
    // Enums
    UpscaleMode,
    UpscaleScaleOptions
} from '../core/imageUpscaler.js';
