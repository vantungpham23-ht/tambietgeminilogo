/**
 * Upscaler UI Controller
 * Handles upscale panel interactions and integrates with the main app flow.
 */

import {
  upscale,
  estimateUpscaleTime,
  isAISupported,
  AIUpscaleModel,
  UpscaleMode
} from '../core/imageUpscaler.js';

// CDN URL for Real-ESRGAN ONNX model
const REAL_ESRGAN_MODEL_URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/RealESRGAN_x2plus.onnx';

export class UpscalerController {
  constructor(options = {}) {
    this.options = {
      onUpscaleStart: options.onUpscaleStart || (() => {}),
      onUpscaleProgress: options.onUpscaleProgress || (() => {}),
      onUpscaleComplete: options.onUpscaleComplete || (() => {}),
      onUpscaleError: options.onUpscaleError || (() => {})
    };

    this.currentMode = 'canvas';
    this.currentScale = 2;
    this.currentQuality = 'high';
    this.aiModelLoaded = false;
    this.modelBytes = null;
    this.modelLoading = false;

    this.elements = {};
    this.boundHandlers = {};
  }

  /**
   * Initialize the controller and bind UI elements.
   */
  init() {
    this.cacheElements();
    this.bindEvents();
    this.updateUI();
    
    // Check AI support
    if (!isAISupported()) {
      this.disableAIMode();
    }
  }

  cacheElements() {
    this.elements = {
      section: document.getElementById('upscaleSection'),
      badge: document.getElementById('upscaleBadge'),
      modeCanvas: document.getElementById('modeCanvas'),
      modeAI: document.getElementById('modeAI'),
      scale2x: document.getElementById('scale2x'),
      scale4x: document.getElementById('scale4x'),
      scale8x: document.getElementById('scale8x'),
      canvasQualityGroup: document.getElementById('canvasQualityGroup'),
      canvasQuality: document.getElementById('canvasQuality'),
      aiModelGroup: document.getElementById('aiModelGroup'),
      aiModelStatus: document.getElementById('aiModelStatus'),
      aiModelProgress: document.getElementById('aiModelProgress'),
      aiModelProgressFill: document.getElementById('aiModelProgressFill'),
      aiModelProgressText: document.getElementById('aiModelProgressText'),
      timeEstimate: document.getElementById('upscaleTimeEstimate'),
      timeValue: document.getElementById('upscaleTimeValue')
    };
  }

  bindEvents() {
    // Mode selection
    this.boundHandlers.modeChange = () => this.onModeChange();
    this.elements.modeCanvas?.addEventListener('change', this.boundHandlers.modeChange);
    this.elements.modeAI?.addEventListener('change', this.boundHandlers.modeChange);

    // Scale selection
    this.boundHandlers.scaleChange = () => this.onScaleChange();
    this.elements.scale2x?.addEventListener('change', this.boundHandlers.scaleChange);
    this.elements.scale4x?.addEventListener('change', this.boundHandlers.scaleChange);
    this.elements.scale8x?.addEventListener('change', this.boundHandlers.scaleChange);

    // Canvas quality
    this.boundHandlers.qualityChange = () => this.onQualityChange();
    this.elements.canvasQuality?.addEventListener('change', this.boundHandlers.qualityChange);
  }

  onModeChange() {
    this.currentMode = this.elements.modeAI?.checked ? 'ai' : 'canvas';
    this.updateUI();
    this.updateTimeEstimate();
  }

  onScaleChange() {
    if (this.elements.scale2x?.checked) {
      this.currentScale = 2;
      this.update8xAvailability();
    } else if (this.elements.scale4x?.checked) {
      this.currentScale = 4;
    }
    this.updateUI();
    this.updateTimeEstimate();
  }

  onQualityChange() {
    this.currentQuality = this.elements.canvasQuality?.value || 'high';
    this.updateTimeEstimate();
  }

  updateUI() {
    // Show/hide mode-specific groups
    if (this.elements.canvasQualityGroup) {
      this.elements.canvasQualityGroup.hidden = this.currentMode !== 'canvas';
    }
    if (this.elements.aiModelGroup) {
      this.elements.aiModelGroup.hidden = this.currentMode !== 'ai';
    }

    // Update badge
    if (this.elements.badge) {
      if (this.currentMode === 'ai') {
        this.elements.badge.textContent = 'AI';
        this.elements.badge.hidden = false;
      } else if (this.currentScale > 1) {
        this.elements.badge.textContent = `${this.currentScale}×`;
        this.elements.badge.hidden = false;
      } else {
        this.elements.badge.hidden = true;
      }
    }

    // Update 8x scale button
    if (this.currentMode === 'ai') {
      if (this.elements.scale8x) {
        this.elements.scale8x.disabled = true;
        this.elements.scale8x.parentElement?.querySelector('label')?.classList.add('disabled');
      }
    } else {
      this.update8xAvailability();
    }
  }

  update8xAvailability() {
    if (this.elements.scale8x) {
      this.elements.scale8x.disabled = false;
      this.elements.scale8x.parentElement?.querySelector('label')?.classList.remove('disabled');
    }
  }

  updateTimeEstimate(width = 1920, height = 1080) {
    if (!this.elements.timeValue) return;

    const ms = estimateUpscaleTime(width, height, this.currentMode, this.currentScale);
    
    if (ms < 1000) {
      this.elements.timeValue.textContent = `<1 giây`;
    } else if (ms < 60000) {
      this.elements.timeValue.textContent = `${Math.round(ms / 1000)} giây`;
    } else {
      this.elements.timeValue.textContent = `${Math.round(ms / 60000)} phút`;
    }

    if (this.elements.timeEstimate) {
      this.elements.timeEstimate.hidden = false;
    }
  }

  disableAIMode() {
    if (this.elements.modeAI) {
      this.elements.modeAI.disabled = true;
      this.elements.modeAI.parentElement?.querySelector('label')?.classList.add('disabled');
    }
    if (this.elements.modeCanvas) {
      this.elements.modeCanvas.checked = true;
    }
    this.currentMode = 'canvas';
    this.updateUI();
  }

  async loadAIModel(signal) {
    if (this.aiModelLoaded && this.modelBytes) {
      return this.modelBytes;
    }

    if (this.modelLoading) {
      // Wait for existing load to complete
      return new Promise((resolve, reject) => {
        const checkLoaded = setInterval(() => {
          if (this.aiModelLoaded && this.modelBytes) {
            clearInterval(checkLoaded);
            resolve(this.modelBytes);
          }
          if (!this.modelLoading) {
            clearInterval(checkLoaded);
            reject(new Error('Model loading failed'));
          }
        }, 100);
      });
    }

    this.modelLoading = true;
    this.updateAIStatus('loading');

    if (this.elements.aiModelProgress) {
      this.elements.aiModelProgress.hidden = false;
    }

    try {
      // Use a cached fetch or load from CDN
      const response = await fetch(REAL_ESRGAN_MODEL_URL, {
        signal,
        headers: {
          'Accept': 'application/octet-stream'
        }
      });

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

        if (total > 0 && this.elements.aiModelProgressFill) {
          const percent = Math.round((loaded / total) * 100);
          this.elements.aiModelProgressFill.style.width = `${percent}%`;
          if (this.elements.aiModelProgressText) {
            this.elements.aiModelProgressText.textContent = `Đang tải model... ${percent}%`;
          }
        }
      }

      const blob = new Blob(chunks);
      this.modelBytes = new Uint8Array(await blob.arrayBuffer());
      this.aiModelLoaded = true;
      this.modelLoading = false;

      this.updateAIStatus('loaded');

      if (this.elements.aiModelProgress) {
        this.elements.aiModelProgress.hidden = true;
      }

      return this.modelBytes;
    } catch (error) {
      this.modelLoading = false;
      this.updateAIStatus('error');
      throw error;
    }
  }

  updateAIStatus(status) {
    if (!this.elements.aiModelStatus) return;

    const statusMap = {
      loading: { text: 'Đang tải...', class: 'loading' },
      loaded: { text: 'Sẵn sàng', class: 'loaded' },
      error: { text: 'Lỗi tải', class: '' }
    };

    const info = statusMap[status] || { text: 'Chưa tải', class: '' };
    this.elements.aiModelStatus.textContent = info.text;
    this.elements.aiModelStatus.className = `ai-model-badge ${info.class}`;
  }

  /**
   * Check if upscale is enabled.
   */
  isEnabled() {
    return this.currentScale > 1;
  }

  /**
   * Get current upscale settings.
   */
  getSettings() {
    return {
      mode: this.currentMode,
      scale: this.currentScale,
      quality: this.currentQuality,
      enabled: this.isEnabled()
    };
  }

  /**
   * Upscale an image.
   * @param {ImageData|Blob|HTMLImageElement} input
   * @param {Object} options - Additional options
   * @param {AbortSignal} [signal]
   */
  async upscale(input, options = {}, signal) {
    if (!this.isEnabled()) {
      return input;
    }

    this.options.onUpscaleStart(this.currentMode, this.currentScale);

    try {
      let result;

      if (this.currentMode === 'ai') {
        // Load AI model if needed
        const modelBytes = await this.loadAIModel(signal);

        result = await upscale(input, {
          mode: 'ai',
          scale: this.currentScale,
          modelType: AIUpscaleModel.REAL_ESRGAN_X2,
          modelBytes,
          onProgress: (current, total, info) => {
            this.options.onUpscaleProgress(current, total, info);
          }
        }, signal);
      } else {
        result = await upscale(input, {
          mode: 'canvas',
          scale: this.currentScale,
          quality: this.currentQuality,
          onProgress: (current, total) => {
            this.options.onUpscaleProgress(current, total);
          }
        }, signal);
      }

      this.options.onUpscaleComplete(result);
      return result;
    } catch (error) {
      this.options.onUpscaleError(error);
      throw error;
    }
  }

  /**
   * Dispose of resources.
   */
  dispose() {
    // Unbind events
    this.elements.modeCanvas?.removeEventListener('change', this.boundHandlers.modeChange);
    this.elements.modeAI?.removeEventListener('change', this.boundHandlers.modeChange);
    this.elements.scale2x?.removeEventListener('change', this.boundHandlers.scaleChange);
    this.elements.scale4x?.removeEventListener('change', this.boundHandlers.scaleChange);
    this.elements.scale8x?.removeEventListener('change', this.boundHandlers.scaleChange);
    this.elements.canvasQuality?.removeEventListener('change', this.boundHandlers.qualityChange);

    // Clear model
    this.modelBytes = null;
    this.aiModelLoaded = false;
  }
}

/**
 * Create a default upscaler controller instance.
 */
export function createUpscalerController(options = {}) {
  return new UpscalerController(options);
}
