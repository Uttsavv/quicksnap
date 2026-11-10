// Camera background blur with MediaPipe's selfie segmenter. The model runs on a
// small copy of the frame; the mask is scaled up, which keeps it fast enough
// for live preview and export.

import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";

const MODEL_URL =
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let segmenterPromise: Promise<ImageSegmenter> | null = null;

function loadSegmenter() {
    segmenterPromise ??= (async () => {
        const { ImageSegmenter } = await import("@mediapipe/tasks-vision");
        return ImageSegmenter.createFromOptions(
            { wasmLoaderPath, wasmBinaryPath },
            {
                baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
                runningMode: "VIDEO",
                outputConfidenceMasks: true,
                outputCategoryMask: false,
            },
        );
    })();
    segmenterPromise.catch(() => (segmenterPromise = null));
    return segmenterPromise;
}

export class CameraBlur {
    private segmenter: ImageSegmenter | null = null;
    private small: OffscreenCanvas;
    private mask: OffscreenCanvas;
    private out: OffscreenCanvas;
    private bg: OffscreenCanvas;
    private lastTs = -1;
    failed = false;

    constructor() {
        this.small = new OffscreenCanvas(256, 144);
        this.mask = new OffscreenCanvas(256, 144);
        this.bg = new OffscreenCanvas(40, 23);
        this.out = new OffscreenCanvas(2, 2);
    }

    async ready() {
        try {
            this.segmenter = await loadSegmenter();
        } catch (e) {
            console.warn("Background blur unavailable", e);
            this.failed = true;
        }
        return !this.failed;
    }

    /** Returns a canvas with the background blurred, or the input if not ready. */
    process(src: CanvasImageSource, w: number, h: number, timestampMs: number): CanvasImageSource {
        if (!this.segmenter || w < 2 || h < 2) return src;
        const sh = Math.max(2, Math.round((256 * h) / w));
        if (this.small.height !== sh) {
            this.small.height = sh;
            this.mask.height = sh;
            this.bg.height = Math.max(2, Math.round((40 * h) / w));
        }
        if (this.out.width !== w || this.out.height !== h) {
            this.out.width = w;
            this.out.height = h;
        }
        const sctx = this.small.getContext("2d")!;
        sctx.drawImage(src, 0, 0, 256, sh);

        // MediaPipe requires strictly increasing timestamps.
        const ts = timestampMs <= this.lastTs ? this.lastTs + 1 : timestampMs;
        this.lastTs = ts;
        const result = this.segmenter.segmentForVideo(this.small, ts);
        const conf = result.confidenceMasks?.[0];
        if (!conf) {
            result.close();
            return src;
        }
        const data = conf.getAsFloat32Array();
        const mctx = this.mask.getContext("2d")!;
        const img = mctx.createImageData(conf.width, conf.height);
        for (let i = 0; i < data.length; i++) {
            img.data[i * 4 + 3] = Math.min(255, Math.max(0, (data[i] - 0.15) * 1.4 * 255));
        }
        result.close();
        if (this.mask.width !== img.width || this.mask.height !== img.height) {
            this.mask.width = img.width;
            this.mask.height = img.height;
        }
        mctx.putImageData(img, 0, 0);

        const octx = this.out.getContext("2d")!;
        // Person layer.
        octx.globalCompositeOperation = "source-over";
        octx.clearRect(0, 0, w, h);
        octx.drawImage(src, 0, 0, w, h);
        octx.globalCompositeOperation = "destination-in";
        octx.imageSmoothingEnabled = true;
        octx.drawImage(this.mask, 0, 0, w, h);
        // Blurred background behind it.
        const bctx = this.bg.getContext("2d")!;
        bctx.drawImage(src, 0, 0, this.bg.width, this.bg.height);
        octx.globalCompositeOperation = "destination-over";
        octx.imageSmoothingQuality = "high";
        octx.drawImage(this.bg, 0, 0, w, h);
        octx.globalCompositeOperation = "source-over";
        return this.out;
    }
}
