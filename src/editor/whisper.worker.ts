/// <reference lib="webworker" />
// Speech recognition with Whisper, fully on-device (WebGPU when available,
// otherwise multi-threaded WASM thanks to cross-origin isolation).

import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type WhisperRequest = { audio: Float32Array; language?: string };
export type WhisperMessage =
    | { type: "status"; text: string }
    | { type: "download"; progress: number }
    | { type: "progress"; progress: number }
    | { type: "segment"; start: number; end: number; text: string }
    | { type: "done" }
    | { type: "error"; text: string };

const post = (m: WhisperMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

let asr: AutomaticSpeechRecognitionPipeline | null = null;

async function load() {
    if (asr) return asr;
    const gpu = "gpu" in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
    post({ type: "status", text: "Loading speech model…" });
    const files = new Map<string, { loaded: number; total: number }>();
    asr = (await pipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
        device: gpu ? "webgpu" : "wasm",
        dtype: gpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
            if (p.status === "progress" && p.file && p.total) {
                files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
                let l = 0;
                let t = 0;
                for (const f of files.values()) {
                    l += f.loaded;
                    t += f.total;
                }
                post({ type: "download", progress: t ? l / t : 0 });
            }
        },
    })) as AutomaticSpeechRecognitionPipeline;
    return asr;
}

const RATE = 16000;
const WINDOW = 30; // Whisper's native window, in seconds

self.onmessage = async (e: MessageEvent<WhisperRequest>) => {
    try {
        const model = await load();
        const { audio, language } = e.data;
        const total = audio.length / RATE;
        post({ type: "status", text: "Transcribing…" });
        for (let off = 0; off < total; off += WINDOW) {
            const slice = audio.subarray(Math.floor(off * RATE), Math.floor(Math.min(total, off + WINDOW) * RATE));
            // Skip near-silent windows; Whisper tends to hallucinate on silence.
            let energy = 0;
            for (let i = 0; i < slice.length; i += 16) energy += slice[i] * slice[i];
            if (energy / (slice.length / 16) < 1e-6) {
                post({ type: "progress", progress: Math.min(1, (off + WINDOW) / total) });
                continue;
            }
            const out = (await model(slice, {
                return_timestamps: true,
                ...(language ? { language, task: "transcribe" } : {}),
            })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
            const chunks = out.chunks ?? [{ timestamp: [0, slice.length / RATE] as [number, number], text: out.text }];
            for (const c of chunks) {
                const text = c.text.trim();
                if (!text || /^\[.*\]$|^\(.*\)$/.test(text)) continue;
                const s = off + (c.timestamp[0] ?? 0);
                const end = off + (c.timestamp[1] ?? Math.min(WINDOW, slice.length / RATE));
                post({ type: "segment", start: s, end: Math.max(end, s + 0.3), text });
            }
            post({ type: "progress", progress: Math.min(1, (off + WINDOW) / total) });
        }
        post({ type: "done" });
    } catch (err) {
        post({ type: "error", text: err instanceof Error ? err.message : String(err) });
    }
};
