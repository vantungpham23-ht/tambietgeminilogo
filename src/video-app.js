import {
    DEFAULT_ADAPTIVE_ALPHA,
    DEFAULT_ALPHA_GAIN,
    DEFAULT_DENOISE_BACKEND,
    DEFAULT_EDGE_DENOISE_STRENGTH,
    DEFAULT_HIGH_QUALITY_CLEANUP,
    DEFAULT_RESIDUAL_CLEANUP_STRENGTH,
    DEFAULT_SAMPLE_COUNT,
    DEFAULT_VIDEO_BITRATE,
    VIDEO_DENOISE_BACKENDS,
    detectGeminiVideoWatermark,
    inspectGeminiVideoFile,
    removeGeminiVideoWatermark
} from './video/videoExport.js';
import { isReferenceGeminiVideoSize } from './video/videoWatermarkCatalog.js';
import {
    getAutomaticVideoPresetConfig,
    getRelocatedReviewPresetConfig
} from './video/videoPresetPolicy.js';
import { resolveAllenkFdncnnRuntimeProfile } from './video/videoDenoiseRuntimePolicy.js';
import {
    applyVideoAdaptiveAlphaDebugOverride,
    applyVideoBitrateDebugOverride
} from './video/videoDebugControlOverrides.js';
import {
    consumeDebugFileHandoff,
    getDebugFileKind,
    pickDebugUploadFile,
    saveDebugFileHandoff
} from './shared/debugFileHandoff.js';
import { createAllenkFdncnnOnnxRuntime } from './core/allenkFdncnnOnnxRuntime.js';

// Upscaler imports
import {
    upscale,
    estimateUpscaleTime,
    isAISupported,
    AIUpscaleModel
} from './core/imageUpscaler.js';

// Real-ESRGAN model URL for video upscaling
const REAL_ESRGAN_MODEL_URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/RealESRGAN_x2plus.onnx';

const $ = (id) => document.getElementById(id);
const ALLENK_FDNCNN_WASM_PATHS = Object.freeze({
    mjs: './onnxruntime/ort-wasm-simd-threaded.js',
    wasm: './onnxruntime/ort-wasm-simd-threaded.wasm'
});
const ALLENK_FDNCNN_WEBGPU_WASM_PATHS = Object.freeze({
    mjs: './onnxruntime/ort-wasm-simd-threaded.asyncify.mjs',
    wasm: './onnxruntime/ort-wasm-simd-threaded.asyncify.wasm'
});

const state = {
    file: null,
    originalUrl: null,
    processedUrl: null,
    upscaledUrl: null,
    metadata: null,
    detection: null,
    running: false,
    jobId: 0,
    syncingPlayback: false,
    // Timer
    processingStartTime: 0,
    timerInterval: null,
    // Upscale state
    upscaleEnabled: false,
    upscaleMode: 'canvas',
    upscaleScale: 2,
    upscaleQuality: 'high',
    aiModelLoaded: false,
    aiModelBytes: null
};

const allenkFdncnnRuntimePromises = new Map();

const els = {
    dropzone: $('dropzone'),
    fileInput: $('fileInput'),
    comparePlayer: $('comparePlayer'),
    afterBadge: $('afterBadge'),
    playPauseBtn: $('playPauseBtn'),
    scrubber: $('scrubber'),
    timeLabel: $('timeLabel'),
    originalVideo: $('originalVideo'),
    processedVideo: $('processedVideo'),
    originalEmpty: $('originalEmpty'),
    processedEmpty: $('processedEmpty'),
    metadata: $('metadata'),
    detection: $('detection'),
    progressBar: $('progressBar'),
    progressText: $('progressText'),
    status: $('status'),
    alphaGain: $('alphaGain'),
    alphaGainValue: $('alphaGainValue'),
    adaptiveAlpha: $('adaptiveAlpha'),
    highQualityCleanup: $('highQualityCleanup'),
    denoiseBackend: $('denoiseBackend'),
    edgeDenoiseStrength: $('edgeDenoiseStrength'),
    edgeDenoiseStrengthValue: $('edgeDenoiseStrengthValue'),
    residualCleanup: $('residualCleanup'),
    residualCleanupValue: $('residualCleanupValue'),
    videoBitrateMbps: $('videoBitrateMbps'),
    sampleCount: $('sampleCount'),
    allowLowConfidence: $('allowLowConfidence'),
    autoPresetSummary: $('autoPresetSummary'),
    processBtn: $('processBtn'),
    detectBtn: $('detectBtn'),
    downloadBtn: $('downloadBtn'),
    resetBtn: $('resetBtn'),
    relocatedReviewPresetBtn: $('relocatedReviewPresetBtn'),
    // Processing Status elements
    processingStatus: $('processingStatus'),
    processingTimer: $('processingTimer'),
    processingPercent: $('processingPercent'),
    processingProgressBar: $('processingProgressBar'),
    processingMessage: $('processingMessage'),
    stepDetect: $('stepDetect'),
    stepRemove: $('stepRemove'),
    stepUpscale: $('stepUpscale'),
    stepComplete: $('stepComplete'),
    // Upscaler elements
    upscaleSection: $('upscaleSection'),
    upscaleBadge: $('upscaleBadge'),
    upscaleOff: $('upscaleOff'),
    upscaleOn: $('upscaleOn'),
    upscaleOptions: $('upscaleOptions'),
    modeCanvas: $('modeCanvas'),
    modeAI: $('modeAI'),
    scale2x: $('scale2x'),
    scale4x: $('scale4x'),
    scale8x: $('scale8x'),
    canvasQualityGroup: $('canvasQualityGroup'),
    canvasQuality: $('canvasQuality'),
    aiModelGroup: $('aiModelGroup'),
    aiModelStatus: $('aiModelStatus'),
    aiModelProgress: $('aiModelProgress'),
    aiModelProgressFill: $('aiModelProgressFill'),
    aiModelProgressText: $('aiModelProgressText'),
    upscaleTimeEstimate: $('upscaleTimeEstimate'),
    upscaleTimeValue: $('upscaleTimeValue')
};

function setStatus(message, tone = 'info') {
    els.status.textContent = message || '';
    els.status.dataset.tone = tone;
}

// ============================================
// Processing Status Functions
// ============================================

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateProcessingTimer() {
    if (!state.processingStartTime || !els.processingTimer) return;
    const elapsed = (Date.now() - state.processingStartTime) / 1000;
    els.processingTimer.textContent = formatTime(elapsed);
}

function showProcessingStatus() {
    if (!els.processingStatus) return;
    els.processingStatus.hidden = false;
    
    // Reset all steps
    els.stepDetect?.classList.remove('done', 'active', 'waiting');
    els.stepRemove?.classList.remove('done', 'active', 'waiting');
    els.stepUpscale?.classList.remove('done', 'active', 'waiting');
    els.stepComplete?.classList.remove('done', 'active', 'waiting');
    
    // Start timer
    state.processingStartTime = Date.now();
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(updateProcessingTimer, 1000);
    updateProcessingTimer();
}

function hideProcessingStatus() {
    if (!els.processingStatus) return;
    els.processingStatus.hidden = true;
    
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
}

function setStepStatus(step, status, message = '') {
    const stepEl = step === 'detect' ? els.stepDetect 
        : step === 'remove' ? els.stepRemove 
        : step === 'upscale' ? els.stepUpscale 
        : step === 'complete' ? els.stepComplete : null;
    
    if (!stepEl) return;
    
    stepEl.classList.remove('done', 'active', 'waiting');
    stepEl.classList.add(status);
    
    const statusEl = stepEl.querySelector('.step-status');
    if (statusEl) statusEl.textContent = message;
}

function updateProcessingProgress(progress, message = '') {
    if (els.processingPercent) {
        els.processingPercent.textContent = `${Math.round(progress * 100)}%`;
    }
    if (els.processingProgressBar) {
        els.processingProgressBar.style.width = `${progress * 100}%`;
    }
    if (els.processingMessage && message) {
        els.processingMessage.textContent = message;
    }
}

function setAllStepsWaiting() {
    setStepStatus('detect', 'waiting');
    setStepStatus('remove', 'waiting');
    setStepStatus('upscale', 'waiting');
    setStepStatus('complete', 'waiting');
}

function isLikelyJavascriptMime(contentType) {
    const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
    return mime === 'application/javascript'
        || mime === 'text/javascript'
        || mime === 'application/ecmascript'
        || mime === 'text/ecmascript'
        || mime.endsWith('+javascript');
}

async function preflightWebGpuRuntimeAssets(paths) {
    try {
        const response = await fetch(paths.mjs, { cache: 'no-store' });
        if (!response.ok) {
            return {
                ok: false,
                reason: `WebGPU runtime module unavailable: ${response.status}`
            };
        }
        const contentType = response.headers.get('content-type') || '';
        if (!isLikelyJavascriptMime(contentType)) {
            return {
                ok: false,
                reason: `WebGPU runtime module is served as ${contentType || 'unknown MIME'}`
            };
        }
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            reason: error?.message || String(error)
        };
    }
}

async function loadAllenkFdncnnRuntime(runtimeProfile = resolveAllenkFdncnnRuntimeProfile()) {
    const profile = runtimeProfile || resolveAllenkFdncnnRuntimeProfile();
    if (!allenkFdncnnRuntimePromises.has(profile.id)) {
        const runtimePromise = (async () => {
            const response = await fetch(profile.modelUrl);
            if (!response.ok) {
                throw new Error(`Úi, không tải được AI model: ${response.status} 🥺`);
            }
            const modelBytes = new Uint8Array(await response.arrayBuffer());
            if (navigator.gpu && window.__gwrDisableWebGpuDenoise !== true) {
                try {
                    const preflight = await preflightWebGpuRuntimeAssets(ALLENK_FDNCNN_WEBGPU_WASM_PATHS);
                    if (!preflight.ok) {
                        console.warn('WebGPU AI runtime skipped:', preflight.reason);
                        throw new Error(preflight.reason);
                    }
                    setStatus('✨ Đang kích hoạt WebGPU AI xóa watermark... Tí xíu thôi!');
                    const webgpuOrt = await import('onnxruntime-web/webgpu');
                    return await createAllenkFdncnnOnnxRuntime({
                        ort: webgpuOrt,
                        modelBytes,
                        executionProvider: 'webgpu',
                        wasmPaths: ALLENK_FDNCNN_WEBGPU_WASM_PATHS,
                        inputName: 'fdncnn_input',
                        outputName: 'fdncnn_output',
                        inputShape: profile.inputShape,
                        outputShape: profile.outputShape
                    });
                } catch (error) {
                    console.warn('WebGPU AI runtime unavailable, falling back to WASM:', error);
                }
            }
            return createAllenkFdncnnOnnxRuntime({
                modelBytes,
                executionProvider: 'wasm',
                wasmPaths: ALLENK_FDNCNN_WASM_PATHS,
                inputName: 'fdncnn_input',
                outputName: 'fdncnn_output',
                inputShape: profile.inputShape,
                outputShape: profile.outputShape
            });
        })();
        allenkFdncnnRuntimePromises.set(profile.id, runtimePromise);
        runtimePromise.catch(() => {
            if (allenkFdncnnRuntimePromises.get(profile.id) === runtimePromise) {
                allenkFdncnnRuntimePromises.delete(profile.id);
            }
        });
    }
    return allenkFdncnnRuntimePromises.get(profile.id);
}

async function resolveExportDenoiseRuntime(denoiseBackend, runtimeProfile = resolveAllenkFdncnnRuntimeProfile()) {
    if (denoiseBackend !== VIDEO_DENOISE_BACKENDS.ALLENK_FDNCNN_BROWSER_SPIKE) {
        return null;
    }
    setStatus('🧠 Đang nạp AI FDnCNN ONNX model... lần đầu hơi lâu nha, kiên nhẫn nhé~');
    return loadAllenkFdncnnRuntime(runtimeProfile);
}

function getAllenkFdncnnTemporalReuseConfig(runtime) {
    if (!runtime || runtime.executionProvider !== 'wasm') {
        return null;
    }
    const hasThreadedWasm = Boolean(crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined');
    return {
        maxFrames: hasThreadedWasm ? 1 : 2,
        threshold: hasThreadedWasm ? 4.5 : 6.5
    };
}

function resolveDetectionAllenkFdncnnSigma(detection) {
    if (Number.isFinite(window.__gwrVideoOverrideAllenkFdncnnSigma)) {
        return Math.max(0, Math.min(150, window.__gwrVideoOverrideAllenkFdncnnSigma));
    }
    if (detection?.watermarkKind === 'veo-text') {
        return detection.template?.cleanup?.runtimeFdncnnSigma ?? 75;
    }
    return 75;
}

function resolveDetectionAllenkFdncnnPadding(detection, runtimeProfile) {
    if (Number.isFinite(window.__gwrVideoOverrideAllenkFdncnnPadding)) {
        return Math.max(0, Math.round(window.__gwrVideoOverrideAllenkFdncnnPadding));
    }
    if (detection?.watermarkKind === 'veo-text' && Number.isFinite(detection.template?.cleanup?.allenkFdncnnPadding)) {
        return detection.template.cleanup.allenkFdncnnPadding;
    }
    return runtimeProfile.padding;
}

function setProgress(progress, label) {
    const pct = Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress * 100))) : 0;
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = label || `${pct}%`;
}

function yieldToBrowserFrame() {
    return new Promise((resolve) => {
        const finish = () => setTimeout(resolve, 0);
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(finish);
        } else {
            finish();
        }
    });
}

function createDetectionProgressHandler(jobId, { start = 0, span = 1 } = {}) {
    return ({ progress = 0, step = 'detect', sampledFrames = 0, sampleCount = 0 } = {}) => {
        if (jobId !== state.jobId) return;
        const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
        const labelByStep = {
            metadata: '📖 Đọc video',
            sample: sampleCount > 0 ? `🎞️ Tách frame ${sampledFrames}/${sampleCount}` : '🎞️ Tách frame',
            score: '🎯 Khớp logo',
            done: '✅ Xong rồi!'
        };
        setProgress(start + safeProgress * span, labelByStep[step] || '🔍 Đang soi...');
        if (step === 'sample') {
            setStatus(sampleCount > 0
                ? `🔍 Đang tách frame để tìm logo: ${sampledFrames}/${sampleCount}`
                : '🔍 Đang tách frame để tìm logo...');
        } else if (step === 'score') {
            setStatus('🎯 Đang so khớp logo — trang vẫn phản hồi nha~');
        }
    };
}

function formatSeconds(value) {
    if (!Number.isFinite(value)) return 'Chưa rõ 🤔';
    return `${value.toFixed(2)}s`;
}

function formatBitrate(value) {
    if (!Number.isFinite(value)) return 'Chưa rõ 🤔';
    return `${(value / 1000 / 1000).toFixed(2)} Mbps`;
}

function formatPlaybackTime(value) {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const totalSeconds = Math.floor(value);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function updateButtons() {
    const hasFile = Boolean(state.file);
    els.detectBtn.disabled = !hasFile || state.running;
    els.processBtn.disabled = !hasFile || state.running;
    const btnLabel = els.processBtn.querySelector('.btn-label');
    if (state.running) {
        els.processBtn.classList.add('btn--loading');
        if (btnLabel) btnLabel.textContent = 'Đang xử lý…';
    } else {
        els.processBtn.classList.remove('btn--loading');
        if (btnLabel) btnLabel.textContent = 'Xóa logo ngay';
    }
    const canDownload = Boolean(state.processedUrl) && !state.running;
    els.downloadBtn.setAttribute('aria-disabled', canDownload ? 'false' : 'true');
    els.downloadBtn.tabIndex = canDownload ? 0 : -1;
    els.resetBtn.disabled = state.running;
    updatePlaybackControls();
}

function hasPlayableOriginal() {
    return Boolean(state.originalUrl) && Number.isFinite(els.originalVideo.duration);
}

function hasPlayableProcessed() {
    return Boolean(state.processedUrl);
}

function updatePlaybackControls() {
    const canPlay = Boolean(state.originalUrl);
    els.playPauseBtn.disabled = !canPlay;
    els.scrubber.disabled = !canPlay;
    els.playPauseBtn.dataset.playing = els.originalVideo.paused ? 'false' : 'true';
    els.playPauseBtn.setAttribute('aria-label', els.originalVideo.paused ? '▶️ Phát' : '⏸ Tạm dừng');

    const duration = Number.isFinite(els.originalVideo.duration) ? els.originalVideo.duration : 0;
    const currentTime = Number.isFinite(els.originalVideo.currentTime) ? els.originalVideo.currentTime : 0;
    if (duration > 0 && !els.scrubber.matches(':active')) {
        els.scrubber.value = String(Math.round((currentTime / duration) * 1000));
    }
    els.timeLabel.textContent = duration > 0
        ? `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`
        : formatPlaybackTime(currentTime);
}

function updateCompareMode() {
    const hasAfter = hasPlayableProcessed();
    els.afterBadge.hidden = !hasAfter;
    els.processedEmpty.hidden = hasAfter;
}

function syncProcessedToOriginal({ force = false } = {}) {
    if (!hasPlayableProcessed() || state.syncingPlayback) return;
    const targetTime = Number(els.originalVideo.currentTime) || 0;
    if (!force && Math.abs((Number(els.processedVideo.currentTime) || 0) - targetTime) < 0.08) return;

    state.syncingPlayback = true;
    try {
        els.processedVideo.currentTime = targetTime;
    } catch (error) {
        console.warn('sync processed video failed:', error);
    } finally {
        state.syncingPlayback = false;
    }
}

async function playComparison() {
    if (!state.originalUrl) return;
    syncProcessedToOriginal({ force: true });
    try {
        await els.originalVideo.play();
        if (hasPlayableProcessed()) {
            await els.processedVideo.play().catch((error) => {
                console.warn('processed video play failed:', error);
            });
        }
    } catch (error) {
        console.warn('original video play failed:', error);
        setStatus('🙈 Trình duyệt đang chặn phát — bấm nút play thêm lần nữa nha!', 'warn');
    } finally {
        updatePlaybackControls();
    }
}

function pauseComparison() {
    els.originalVideo.pause();
    els.processedVideo.pause();
    updatePlaybackControls();
}

function togglePlayback() {
    if (els.originalVideo.paused) {
        playComparison();
    } else {
        pauseComparison();
    }
}

function seekComparison(value) {
    const duration = Number(els.originalVideo.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const currentTime = (Number(value) / 1000) * duration;
    els.originalVideo.currentTime = currentTime;
    syncProcessedToOriginal({ force: true });
    updatePlaybackControls();
}

function renderAutoPresetSummary(preset = null) {
    if (!els.autoPresetSummary) return;
    if (!preset) {
        els.autoPresetSummary.innerHTML = `
            <strong>✨ AI xử lý tự động</strong>
            <span>Chọn video xong là mình tìm logo và dọn sạch giúp bạn luôn — không cần làm gì hết ♡</span>
        `;
        return;
    }

    els.autoPresetSummary.innerHTML = `
        <strong>${preset.label}</strong>
        <span>${preset.description}</span>
    `;
}

function renderMetadata(metadata) {
    if (!metadata) {
        els.metadata.innerHTML = '<p class="muted">⏳ Đợi bạn chọn video nha</p>';
        return;
    }
    const reference = isReferenceGeminiVideoSize(metadata.width, metadata.height);
    els.metadata.innerHTML = `
        <dl>
            <div><dt>Kích thước</dt><dd>${metadata.width} x ${metadata.height}</dd></div>
            <div><dt>Thời lượng</dt><dd>${formatSeconds(metadata.duration)}</dd></div>
            <div><dt>Số frame/giây</dt><dd>${metadata.frameRate.toFixed(2)} fps</dd></div>
            <div><dt>Bitrate video</dt><dd>${formatBitrate(metadata.averageBitrate)}</dd></div>
            <div><dt>Loại logo</dt><dd>${reference ? '1920x1080 chuẩn Gemini ✨' : 'Đoán theo tỉ lệ, thử nghiệm 🔬'}</dd></div>
        </dl>
    `;
}

function renderDetection(detection) {
    if (!detection) {
        els.detection.innerHTML = '<p class="muted">🔍 Bấm "Kiểm tra logo" trước, hoặc bạn cứ export luôn cũng được</p>';
        return;
    }

    const best = detection.summary?.best || {};
    const bestLabel = detection.watermarkKind === 'veo-text'
        ? (best.templateId || detection.template?.id || 'Veo text')
        : (best.label || best.candidateId || detection.candidate?.label || 'chưa rõ');
    const bestScore = Number.isFinite(best.meanConfidence)
        ? best.meanConfidence
        : Number.isFinite(best.meanNcc)
            ? best.meanNcc
            : null;
    els.detection.innerHTML = `
        <dl>
            <div><dt>Ứng viên</dt><dd>${bestLabel}</dd></div>
            <div><dt>Vị trí</dt><dd>${detection.position.x}, ${detection.position.y}</dd></div>
            <div><dt>Kích thước</dt><dd>${detection.position.width} x ${detection.position.height}</dd></div>
            <div><dt>Điểm tin cậy</dt><dd>${Number.isFinite(bestScore) ? bestScore.toFixed(3) : '-'}</dd></div>
            <div><dt>Số phiếu</dt><dd>${best.votes || 0}/${detection.summary?.frameCount || 0}</dd></div>
            <div><dt>Trạng thái</dt><dd>${detection.isConfident ? 'Tin tưởng được ✅' : 'Hơi mờ 😅'}</dd></div>
        </dl>
    `;
}

function cleanupUrls() {
    if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
    if (state.processedUrl) URL.revokeObjectURL(state.processedUrl);
    if (state.upscaledUrl) URL.revokeObjectURL(state.upscaledUrl);
    state.originalUrl = null;
    state.processedUrl = null;
    state.upscaledUrl = null;
}

async function setFile(file) {
    const fileKind = getDebugFileKind(file);
    if (fileKind === 'image') {
        await routeImageFile(file);
        return;
    }
    if (fileKind !== 'video') {
        setStatus('🤔 Bạn chọn ảnh hay video đều được nha! Ảnh sẽ qua trang đơn, video xử lý ở đây luôn.', 'warn');
        return;
    }

    cleanupUrls();
    state.file = file;
    state.metadata = null;
    state.detection = null;
    state.processedUrl = null;
    state.jobId++;

    state.originalUrl = URL.createObjectURL(file);
    els.originalVideo.src = state.originalUrl;
    els.originalVideo.currentTime = 0;
    els.processedVideo.removeAttribute('src');
    els.processedVideo.load();
    els.downloadBtn.removeAttribute('href');
    els.downloadBtn.removeAttribute('download');
    els.originalEmpty.hidden = true;
    updateCompareMode();
    renderMetadata(null);
    renderDetection(null);
    setProgress(0, '🚀 Sẵn sàng!');
    setStatus('📖 Đang đọc thông tin video...');
    updateButtons();

    try {
        const metadata = await inspectGeminiVideoFile(file);
        state.metadata = metadata;
        renderMetadata(metadata);
        applyAutomaticPreset(null, metadata, { silent: true });
        setStatus('✅ Video đã nạp xong! Bấm "Xóa logo ngay" để AI dọn dẹp nha~');
    } catch (error) {
        console.error(error);
        setStatus(error.message || '😅 Đọc video hỏng rồi, thử file khác nha', 'error');
    } finally {
        updateButtons();
    }
}

async function routeImageFile(file) {
    try {
        setStatus('🖼️ Đang chuyển sang trang xử lý ảnh...');
        await saveDebugFileHandoff(file, 'image');
        window.location.assign('./dev-preview.html?fileHandoff=1');
    } catch (error) {
        console.error(error);
        setStatus(error.message || '😅 Chuyển trang ảnh bị lỗi — bạn mở trang đơn rồi chọn lại file nha', 'warn');
    }
}

function getDebugAlphaOptions() {
    return {
        alphaProfile: typeof window.__gwrVideoAlphaProfile === 'string'
            ? window.__gwrVideoAlphaProfile
            : undefined,
        alphaLowScale: Number.isFinite(window.__gwrVideoAlphaLowScale)
            ? window.__gwrVideoAlphaLowScale
            : undefined,
        alphaBodyScale: Number.isFinite(window.__gwrVideoAlphaBodyScale)
            ? window.__gwrVideoAlphaBodyScale
            : undefined,
        alphaEdgeBoost: Number.isFinite(window.__gwrVideoAlphaEdgeBoost)
            ? window.__gwrVideoAlphaEdgeBoost
            : undefined,
        alphaLocalRegion: typeof window.__gwrVideoAlphaLocalRegion === 'string'
            ? window.__gwrVideoAlphaLocalRegion
            : undefined,
        alphaLocalLowScale: Number.isFinite(window.__gwrVideoAlphaLocalLowScale)
            ? window.__gwrVideoAlphaLocalLowScale
            : undefined,
        alphaLocalBodyScale: Number.isFinite(window.__gwrVideoAlphaLocalBodyScale)
            ? window.__gwrVideoAlphaLocalBodyScale
            : undefined
    };
}

async function runDetection() {
    if (!state.file || state.running) return;
    const jobId = ++state.jobId;
    state.running = true;
    updateButtons();
    setProgress(0.05, '🔍 Đang soi');
    setStatus('🔎 Đang tách frame để tìm logo góc phải bên dưới...');

    try {
        await yieldToBrowserFrame();
        const result = await detectGeminiVideoWatermark(state.file, {
            ...getDebugAlphaOptions(),
            sampleCount: Number(els.sampleCount.value) || DEFAULT_SAMPLE_COUNT,
            onProgress: createDetectionProgressHandler(jobId, { start: 0.05, span: 0.9 }),
            yieldToMainThread: yieldToBrowserFrame
        });
        if (jobId !== state.jobId) return;
        state.metadata = result.metadata;
        state.detection = result.detection;
        renderMetadata(result.metadata);
        renderDetection(result.detection);
        setProgress(1, result.detection.isConfident ? '✅ Xong!' : '😐 Hơi mờ');
        const preset = applyAutomaticPreset(result.detection, result.metadata, { silent: true });
        if (preset.id === 'relocated-review') {
            setStatus('🎉 Tìm xong! Lúc export sẽ dùng AI xóa logo.', result.detection.isConfident ? 'success' : 'warn');
        } else {
            setStatus(result.detection.isConfident ? '🎉 Tìm xong rồi! Lúc export sẽ dùng AI xóa logo.' : '😐 Hơi mờ nhưng vẫn thử AI export được nha~', result.detection.isConfident ? 'success' : 'warn');
        }
    } catch (error) {
        console.error(error);
        setStatus(error.message || '😅 Soi logo thất bại rồi', 'error');
        setProgress(0, '😢 Thất bại');
    } finally {
        state.running = false;
        updateButtons();
    }
}

async function runExport() {
    if (!state.file || state.running) return;
    const jobId = ++state.jobId;
    state.running = true;
    updateButtons();

    // Show processing status panel
    showProcessingStatus();
    setAllStepsWaiting();
    setStepStatus('detect', 'active');
    updateProcessingProgress(0, 'Đang khởi động...');
    setStatus('🛠️ Đang xử lý từng frame ngay tại máy bạn — cứ mở tab là được, không cần chờ nhé!');

    try {
        let detectionPayload = state.detection ? { metadata: state.metadata, detection: state.detection } : null;
        if (!detectionPayload) {
            updateProcessingProgress(0.02, '🔍 Đang soi logo...');
            setStatus('🔎 Đang tìm logo cho bạn...');
            await yieldToBrowserFrame();
            const detected = await detectGeminiVideoWatermark(state.file, {
                ...getDebugAlphaOptions(),
                sampleCount: Number(els.sampleCount.value) || DEFAULT_SAMPLE_COUNT,
                onProgress: createDetectionProgressHandler(jobId, { start: 0.02, span: 0.08 }),
                yieldToMainThread: yieldToBrowserFrame
            });
            if (jobId !== state.jobId) return;
            state.metadata = detected.metadata;
            state.detection = detected.detection;
            renderMetadata(detected.metadata);
            renderDetection(detected.detection);
            detectionPayload = { metadata: detected.metadata, detection: detected.detection };
            applyAutomaticPreset(detected.detection, detected.metadata, { silent: true });
            updateProcessingProgress(0.10, '✅ Đã tìm thấy logo!');
        } else {
            applyAutomaticPreset(detectionPayload.detection, detectionPayload.metadata, { silent: true });
            setStepStatus('detect', 'done', 'Đã có');
        }
        
        // Mark detect done, start remove
        setStepStatus('detect', 'done', 'Xong');
        setStepStatus('remove', 'active');
        
        applyDebugControlOverrides();
        const denoiseBackend = els.denoiseBackend.value || DEFAULT_DENOISE_BACKEND;
        const allenkFdncnnRuntimeProfile = resolveAllenkFdncnnRuntimeProfile(detectionPayload?.detection?.position);
        const allenkFdncnnSigma = resolveDetectionAllenkFdncnnSigma(detectionPayload?.detection);
        const allenkFdncnnPadding = resolveDetectionAllenkFdncnnPadding(
            detectionPayload?.detection,
            allenkFdncnnRuntimeProfile
        );
        const allenkFdncnnRuntime = await resolveExportDenoiseRuntime(denoiseBackend, allenkFdncnnRuntimeProfile);
        const allenkFdncnnTemporalReuse = getAllenkFdncnnTemporalReuseConfig(allenkFdncnnRuntime);
        const debugAlphaOptions = getDebugAlphaOptions();
        if (jobId !== state.jobId) return;

        const upscaleWeight = state.upscaleEnabled ? 0.75 : 0.95;
        const result = await removeGeminiVideoWatermark(state.file, {
            alphaGain: Number(els.alphaGain.value) || DEFAULT_ALPHA_GAIN,
            adaptiveAlpha: els.adaptiveAlpha.checked,
            highQualityCleanup: els.highQualityCleanup.checked,
            denoiseBackend,
            edgeDenoiseStrength: Number(els.edgeDenoiseStrength.value) || 0,
            residualCleanupStrength: Number(els.residualCleanup.value) || 0,
            videoBitrate: Number(els.videoBitrateMbps.value) > 0
                ? Number(els.videoBitrateMbps.value) * 1000 * 1000
                : DEFAULT_VIDEO_BITRATE,
            ...debugAlphaOptions,
            sampleCount: Number(els.sampleCount.value) || DEFAULT_SAMPLE_COUNT,
            detection: detectionPayload,
            allowLowConfidence: els.allowLowConfidence.checked,
            allenkFdncnnRuntime,
            allenkFdncnnSigma,
            allenkFdncnnPadding,
            allenkFdncnnTemporalReuse,
            yieldToMainThread: yieldToBrowserFrame,
            onProgress: ({ phase, progress, processedFrames, frameEstimate, metadata, detection, aiDenoiseFrames, aiReuseFrames }) => {
                if (jobId !== state.jobId) return;
                const cliProgress = phase === 'detect'
                    ? 0.10 + progress * 0.02
                    : 0.12 + progress * upscaleWeight;
                window.__gwrVideoCliProgress = {
                    phase,
                    progress: cliProgress,
                    processedFrames,
                    frameEstimate,
                    aiDenoiseFrames,
                    aiReuseFrames
                };
                if (metadata) {
                    state.metadata = metadata;
                    renderMetadata(metadata);
                }
                if (detection) {
                    state.detection = detection;
                    renderDetection(detection);
                }
                if (phase === 'detect') {
                    updateProcessingProgress(cliProgress, '🔍 Đang soi logo...');
                } else if (phase === 'export') {
                    const exportProgress = 0.12 + progress * upscaleWeight;
                    const frames = Number.isFinite(processedFrames) ? `${processedFrames} frame` : 'đang xử lý';
                    updateProcessingProgress(exportProgress, `🎬 Đang xóa logo (${frames})...`);
                    setStatus(`🎥 Xóa logo: đã xử lý ${frames}~`);
                }
            }
        });
        if (jobId !== state.jobId) return;

        if (state.processedUrl) URL.revokeObjectURL(state.processedUrl);
        state.processedUrl = URL.createObjectURL(result.blob);
        
        const audioNote = result.audioCopied
            ? `Giữ được tiếng: ${result.audioCodec || 'không rõ'}, ${result.audioPacketCount || 0} gói.`
            : `Tiếng không giữ: ${result.audioSkipReason || 'không rõ lý do'}.`;
        const cleanupNote = result.denoiseBackend === VIDEO_DENOISE_BACKENDS.ALLENK_FDNCNN_BROWSER_SPIKE
            ? 'AI đã xóa sạch logo'
            : 'Đã xóa logo';
        
        // Mark remove done
        setStepStatus('remove', 'done', 'Xong');
        
        // Apply upscaling if enabled
        if (state.upscaleEnabled) {
            setStepStatus('upscale', 'active');
            updateProcessingProgress(0.92, '🔍 Đang tăng nét video...');
            setStatus('🔍 Đang tăng nét video...');
            
            try {
                // Add overall timeout for upscale (30 minutes max)
                const upscalePromise = upscaleVideoFile(result.blob, {
                    mode: state.upscaleMode,
                    scale: state.upscaleScale,
                    quality: state.upscaleQuality,
                    onProgress: (progress) => {
                        if (jobId !== state.jobId) return;
                        updateProcessingProgress(0.92 + progress * 0.07, `🔍 Đang tăng nét ${Math.round(progress * 100)}%...`);
                    }
                });
                
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Upscale timeout - exceeded 30 minutes')), 30 * 60 * 1000);
                });
                
                const upscaledResult = await Promise.race([upscalePromise, timeoutPromise]);
                
                if (jobId !== state.jobId) return;
                
                if (state.upscaledUrl) URL.revokeObjectURL(state.upscaledUrl);
                state.upscaledUrl = URL.createObjectURL(upscaledResult.blob);
                
                // Use upscaled video for display and download
                els.processedVideo.src = state.upscaledUrl;
                els.processedVideo.load();
                els.downloadBtn.href = state.upscaledUrl;
                els.downloadBtn.download = `${state.file.name.replace(/\.[^.]+$/, '')}_gwr_upscaled.mp4`;
                
                const scaleLabel = state.upscaleScale + '×';
                const modeLabel = state.upscaleMode === 'ai' ? 'AI' : 'Canvas';
                setStepStatus('upscale', 'done', 'Xong');
                setStepStatus('complete', 'done', 'Xong');
                updateProcessingProgress(1, '✨ Hoàn thành!');
                setStatus(`Hoàn thành! Đã tăng nét ${scaleLabel} (${modeLabel}). ${audioNote}`, 'success');
            } catch (upscaleError) {
                console.error('Upscale failed, using original:', upscaleError);
                setStepStatus('upscale', 'waiting', 'Lỗi');
                // Fallback to non-upscaled video
                els.processedVideo.src = state.processedUrl;
                els.processedVideo.load();
                els.downloadBtn.href = state.processedUrl;
                els.downloadBtn.download = `${state.file.name.replace(/\.[^.]+$/, '')}_gwr_video_mvp.mp4`;
                setStepStatus('complete', 'done', 'Xong');
                updateProcessingProgress(1, 'Hoàn thành (không tăng nét)');
                setStatus(`${cleanupNote}, xử lý ${result.processedFrames} frame. ${audioNote}`, 'success');
            }
        } else {
            // No upscaling - skip upscale step
            els.processedVideo.src = state.processedUrl;
            els.processedVideo.load();
            els.downloadBtn.href = state.processedUrl;
            els.downloadBtn.download = `${state.file.name.replace(/\.[^.]+$/, '')}_gwr_video_mvp.mp4`;
            setStepStatus('complete', 'done', 'Xong');
            updateProcessingProgress(1, 'Hoàn thành!');
            setStatus(`${cleanupNote}, xử lý ${result.processedFrames} frame. ${audioNote}`, 'success');
        }
        
        els.processedEmpty.hidden = true;
        updateCompareMode();
        syncProcessedToOriginal({ force: true });
        updateProcessingProgress(1, '🎉 Xong!');
    } catch (error) {
        console.error(error);
        setStatus(error.message || 'Xuất video thất bại rồi', 'error');
        hideProcessingStatus();
    } finally {
        state.running = false;
        updateButtons();
    }
}

function reset() {
    state.jobId++;
    cleanupUrls();
    state.file = null;
    state.metadata = null;
    state.detection = null;
    state.running = false;
    hideProcessingStatus();
    els.fileInput.value = '';
    els.originalVideo.removeAttribute('src');
    els.originalVideo.load();
    els.processedVideo.removeAttribute('src');
    els.processedVideo.load();
    els.downloadBtn.removeAttribute('href');
    els.downloadBtn.removeAttribute('download');
    els.originalEmpty.hidden = false;
    updateCompareMode();
    renderMetadata(null);
    renderDetection(null);
    renderAutoPresetSummary(null);
    setProgress(0, '⏳ Đợi video');
    setStatus('');
    updateButtons();
}

function setNumberControl(input, value) {
    if (input.hasAttribute('max') && Number(value) > Number(input.getAttribute('max'))) {
        input.setAttribute('max', String(value));
    }
    input.value = String(value);
    if (input === els.alphaGain) {
        els.alphaGainValue.textContent = Number(input.value).toFixed(2);
    } else if (input === els.residualCleanup) {
        els.residualCleanupValue.textContent = Number(input.value).toFixed(2);
    } else if (input === els.edgeDenoiseStrength) {
        els.edgeDenoiseStrengthValue.textContent = Number(input.value).toFixed(2);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyPresetToControls(preset) {
    if (!preset) return;
    setNumberControl(els.alphaGain, preset.alphaGain ?? DEFAULT_ALPHA_GAIN);
    els.adaptiveAlpha.checked = preset.adaptiveAlpha ?? DEFAULT_ADAPTIVE_ALPHA;
    els.highQualityCleanup.checked = preset.highQualityCleanup ?? DEFAULT_HIGH_QUALITY_CLEANUP;
    els.denoiseBackend.value = Object.values(VIDEO_DENOISE_BACKENDS).includes(preset.denoiseBackend)
        ? preset.denoiseBackend
        : DEFAULT_DENOISE_BACKEND;
    els.denoiseBackend.dispatchEvent(new Event('change', { bubbles: true }));
    setNumberControl(els.edgeDenoiseStrength, preset.edgeDenoiseStrength ?? DEFAULT_EDGE_DENOISE_STRENGTH);
    setNumberControl(els.residualCleanup, preset.residualCleanupStrength ?? DEFAULT_RESIDUAL_CLEANUP_STRENGTH);
    els.sampleCount.value = String(preset.sampleCount ?? DEFAULT_SAMPLE_COUNT);
    els.videoBitrateMbps.value = Number(preset.videoBitrateMbps) > 0
        ? String(preset.videoBitrateMbps)
        : '';
    els.allowLowConfidence.checked = preset.allowLowConfidence === true;
    renderAutoPresetSummary(preset);
}

function applyAutomaticPreset(detection = state.detection, metadata = state.metadata, { silent = false } = {}) {
    const preset = getAutomaticVideoPresetConfig(detection, metadata);
    applyPresetToControls(preset);
    if (!silent) {
        setStatus(`🎯 Mình chọn sẵn cho bạn: ${preset.label}~`, preset.allowLowConfidence ? 'warn' : 'success');
    }
    return preset;
}

function applyDebugControlOverrides() {
    applyVideoAdaptiveAlphaDebugOverride({
        windowObject: window,
        adaptiveAlphaInput: els.adaptiveAlpha
    });
    if (typeof window.__gwrVideoOverrideDenoiseBackend === 'string') {
        if (els.denoiseBackend.value !== window.__gwrVideoOverrideDenoiseBackend) {
            els.denoiseBackend.value = window.__gwrVideoOverrideDenoiseBackend;
            els.denoiseBackend.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
    if (typeof window.__gwrVideoOverrideAllowLowConfidence === 'boolean') {
        els.allowLowConfidence.checked = window.__gwrVideoOverrideAllowLowConfidence;
    }
    if (Number.isFinite(window.__gwrVideoOverrideEdgeDenoiseStrength)) {
        setNumberControl(
            els.edgeDenoiseStrength,
            Math.max(0, Math.min(3, window.__gwrVideoOverrideEdgeDenoiseStrength))
        );
    }
    if (Number.isFinite(window.__gwrVideoOverrideResidualCleanupStrength)) {
        setNumberControl(
            els.residualCleanup,
            Math.max(0, Math.min(1.8, window.__gwrVideoOverrideResidualCleanupStrength))
        );
    }
    applyVideoBitrateDebugOverride({
        windowObject: window,
        videoBitrateInput: els.videoBitrateMbps,
        setNumberControl
    });
}

function applyRelocatedReviewPreset() {
    const preset = getRelocatedReviewPresetConfig();
    applyPresetToControls(preset);
    setStatus('🔍 Đã bật preset kiểm tra neo — dùng để review thôi nha, không phải mặc định đâu~', 'warn');
}

// ============================================
// Upscaler Functions
// ============================================

function setupUpscalerEvents() {
    // Enable toggle
    els.upscaleOff?.addEventListener('change', () => {
        state.upscaleEnabled = false;
        els.upscaleOptions.hidden = true;
        updateUpscaleBadge();
        updateUpscalerSteps();
    });
    
    els.upscaleOn?.addEventListener('change', () => {
        state.upscaleEnabled = true;
        els.upscaleOptions.hidden = false;
        updateUpscaleBadge();
        updateUpscalerSteps();
    });

    // Mode selection
    els.modeCanvas?.addEventListener('change', () => {
        state.upscaleMode = 'canvas';
        updateUpscalerUI();
        updateUpscaleTimeEstimate();
    });
    
    els.modeAI?.addEventListener('change', () => {
        state.upscaleMode = 'ai';
        updateUpscalerUI();
        updateUpscaleTimeEstimate();
    });

    // Scale selection
    els.scale2x?.addEventListener('change', () => {
        state.upscaleScale = 2;
        updateUpscaleTimeEstimate();
    });
    
    els.scale4x?.addEventListener('change', () => {
        state.upscaleScale = 4;
        updateUpscaleTimeEstimate();
    });
    
    els.scale8x?.addEventListener('change', () => {
        state.upscaleScale = 8;
        updateUpscaleTimeEstimate();
    });

    // Quality selection
    els.canvasQuality?.addEventListener('change', () => {
        state.upscaleQuality = els.canvasQuality.value;
        updateUpscaleTimeEstimate();
    });

    // Initial UI state
    if (els.upscaleOptions) els.upscaleOptions.hidden = !state.upscaleEnabled;
    updateUpscalerUI();
    updateUpscalerSteps();
    updateUpscaleTimeEstimate();

    // Check AI support
    if (!isAISupported() && els.modeAI) {
        els.modeAI.disabled = true;
        els.modeAI.parentElement?.classList.add('disabled');
    }
}

function updateUpscalerUI() {
    // Show/hide canvas quality
    if (els.canvasQualityGroup) {
        els.canvasQualityGroup.hidden = state.upscaleMode !== 'canvas';
    }
    
    // Show/hide AI status
    if (els.aiModelGroup) {
        els.aiModelGroup.hidden = state.upscaleMode !== 'ai';
    }
    
    // Enable/disable 8x for AI mode
    if (els.scale8x) {
        const isAIMode = state.upscaleMode === 'ai';
        els.scale8x.disabled = isAIMode;
        const label = els.scale8x.parentElement?.querySelector(`label[for="scale8x"]`);
        if (label) {
            label.classList.toggle('disabled', isAIMode);
        }
    }
}

function updateUpscaleTimeEstimate() {
    if (!els.upscaleTimeValue || !els.upscaleTimeEstimate) return;
    
    // Default to HD size for estimation
    const width = 1920;
    const height = 1080;
    
    const ms = estimateUpscaleTime(width, height, state.upscaleMode, state.upscaleScale);
    
    let timeText;
    if (ms < 1000) {
        timeText = '<1 giây';
    } else if (ms < 60000) {
        timeText = `~${Math.round(ms / 1000)} giây`;
    } else {
        timeText = `~${Math.round(ms / 60000)} phút`;
    }
    
    els.upscaleTimeValue.textContent = timeText;
    els.upscaleTimeEstimate.hidden = false;
}

function updateUpscaleBadge() {
    if (!els.upscaleBadge) return;
    
    if (!state.upscaleEnabled) {
        els.upscaleBadge.hidden = true;
        return;
    }
    
    const scaleLabel = state.upscaleScale + '×';
    const modeLabel = state.upscaleMode === 'ai' ? 'AI' : 'Canvas';
    els.upscaleBadge.textContent = `${scaleLabel} ${modeLabel}`;
    els.upscaleBadge.hidden = false;
}

function updateUpscalerSteps() {
    // Show/hide upscale step based on whether upscale is enabled
    if (els.stepUpscale) {
        if (state.upscaleEnabled) {
            els.stepUpscale.classList.remove('hidden');
            els.stepUpscale.style.display = '';
        } else {
            els.stepUpscale.classList.add('hidden');
            els.stepUpscale.style.display = 'none';
        }
    }
}

async function loadAIModel() {
    if (state.aiModelLoaded && state.aiModelBytes) {
        return state.aiModelBytes;
    }

    if (els.aiModelStatus) {
        els.aiModelStatus.textContent = 'Đang tải...';
        els.aiModelStatus.className = 'ai-model-badge loading';
    }
    
    if (els.aiModelProgress) {
        els.aiModelProgress.hidden = false;
    }

    try {
        const response = await fetch(REAL_ESRGAN_MODEL_URL, {
            headers: { 'Accept': 'application/octet-stream' }
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

            if (total > 0 && els.aiModelProgressFill) {
                const percent = Math.round((loaded / total) * 100);
                els.aiModelProgressFill.style.width = `${percent}%`;
                if (els.aiModelProgressText) {
                    els.aiModelProgressText.textContent = `Đang tải model... ${percent}%`;
                }
            }
        }

        const blob = new Blob(chunks);
        state.aiModelBytes = new Uint8Array(await blob.arrayBuffer());
        state.aiModelLoaded = true;

        if (els.aiModelStatus) {
            els.aiModelStatus.textContent = 'Sẵn sàng';
            els.aiModelStatus.className = 'ai-model-badge loaded';
        }
        
        if (els.aiModelProgress) {
            els.aiModelProgress.hidden = true;
        }

        return state.aiModelBytes;
    } catch (error) {
        console.error('Failed to load AI model:', error);
        if (els.aiModelStatus) {
            els.aiModelStatus.textContent = 'Lỗi tải';
            els.aiModelStatus.className = 'ai-model-badge';
        }
        throw error;
    }
}

async function upscaleVideoFile(videoBlob, options = {}) {
    const {
        mode = 'canvas',
        scale = 2,
        quality = 'high',
        onProgress = () => {}
    } = options;

    // Get video dimensions first
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const videoUrl = URL.createObjectURL(videoBlob);
    video.src = videoUrl;

    await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
    });

    const originalWidth = video.videoWidth;
    const originalHeight = video.videoHeight;
    const duration = video.duration;

    URL.revokeObjectURL(videoUrl);

    // Use the unified upscale function - it handles video processing internally
    // videoUpscaler.js uses onProgress(currentFrame, totalFrames)
    try {
        const result = await upscale(videoBlob, {
            mode,
            scale,
            quality,
            onProgress: (currentFrame, totalFrames) => {
                if (typeof totalFrames === 'number' && totalFrames > 0) {
                    onProgress(currentFrame / totalFrames);
                } else if (typeof currentFrame === 'number') {
                    // Loading model progress
                    onProgress(currentFrame < 0 ? 0 : currentFrame);
                }
            }
        });

        return {
            blob: result.blob,
            width: result.width || originalWidth * scale,
            height: result.height || originalHeight * scale,
            duration,
            originalWidth,
            originalHeight
        };
    } catch (error) {
        console.error('Upscale failed:', error);
        throw error;
    }
}

function setupEvents() {
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            els.fileInput.click();
        }
    });
    els.fileInput.addEventListener('change', (event) => {
        const file = pickDebugUploadFile(event.target.files);
        if (file) setFile(file);
    });

    for (const eventName of ['dragenter', 'dragover']) {
        els.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            els.dropzone.dataset.dragging = 'true';
        });
    }
    for (const eventName of ['dragleave', 'drop']) {
        els.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            els.dropzone.dataset.dragging = 'false';
        });
    }
    els.dropzone.addEventListener('drop', (event) => {
        const file = pickDebugUploadFile(event.dataTransfer?.files);
        if (file) setFile(file);
    });

    els.alphaGain.addEventListener('input', () => {
        els.alphaGainValue.textContent = Number(els.alphaGain.value).toFixed(2);
    });
    els.residualCleanup.addEventListener('input', () => {
        els.residualCleanupValue.textContent = Number(els.residualCleanup.value).toFixed(2);
    });
    els.edgeDenoiseStrength.addEventListener('input', () => {
        els.edgeDenoiseStrengthValue.textContent = Number(els.edgeDenoiseStrength.value).toFixed(2);
    });
    els.denoiseBackend.addEventListener('change', () => {
        if (els.denoiseBackend.value !== VIDEO_DENOISE_BACKENDS.ALLENK_FDNCNN_BROWSER_SPIKE) return;
        setNumberControl(els.edgeDenoiseStrength, 1.8);
    });
    els.detectBtn.addEventListener('click', runDetection);
    els.processBtn.addEventListener('click', runExport);
    els.resetBtn.addEventListener('click', reset);
    els.relocatedReviewPresetBtn.addEventListener('click', applyRelocatedReviewPreset);
    els.downloadBtn.addEventListener('click', (event) => {
        if (!state.processedUrl || state.running) event.preventDefault();
    });
    els.playPauseBtn.addEventListener('click', togglePlayback);
    els.scrubber.addEventListener('input', (event) => {
        seekComparison(event.target.value);
    });

    // Upscaler event listeners
    setupUpscalerEvents();
    els.originalVideo.addEventListener('loadedmetadata', () => {
        updatePlaybackControls();
    });
    els.originalVideo.addEventListener('timeupdate', () => {
        if (!els.originalVideo.paused) syncProcessedToOriginal();
        updatePlaybackControls();
    });
    els.originalVideo.addEventListener('pause', () => {
        if (!els.processedVideo.paused) els.processedVideo.pause();
        updatePlaybackControls();
    });
    els.originalVideo.addEventListener('ended', () => {
        pauseComparison();
    });
    els.processedVideo.addEventListener('loadedmetadata', () => {
        syncProcessedToOriginal({ force: true });
        updateCompareMode();
    });
    window.addEventListener('beforeunload', cleanupUrls);
}

async function consumePendingVideoHandoff() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fileHandoff') !== '1') return;

    try {
        const record = await consumeDebugFileHandoff('video');
        if (!record?.file) return;
        await setFile(record.file);
        window.history.replaceState(null, '', window.location.pathname);
    } catch (error) {
        console.warn('video handoff unavailable:', error);
        setStatus(error.message || '🤔 Đọc file tạm hỏng — bạn chọn lại file giúp mình nha', 'warn');
    }
}

async function init() {
    applyPresetToControls(getAutomaticVideoPresetConfig());

    if (!('VideoDecoder' in window) || !('VideoEncoder' in window)) {
        setStatus('🤨 Trình duyệt chưa có WebCodecs — bạn dùng Chrome hoặc Edge bản mới giúp mình nha~', 'error');
    }

    renderMetadata(null);
    renderDetection(null);
    updateCompareMode();
    setProgress(0, '⏳ Đợi video');
    setupEvents();
    updateButtons();
    await consumePendingVideoHandoff();
}

init();
