// On-device analysis: audio levels (waveform + silence), smart zoom
// suggestions from screen motion, and 16 kHz audio for speech recognition.

import { AudioSampleSink, VideoSampleSink } from "mediabunny";
import { openInput } from "../lib/project";
import { uid, type ZoomSegment } from "../lib/types";

export const LEVEL_STEP = 0.05; // seconds per level bucket

export interface AudioLevels {
    peak: Float32Array; // max |x| per bucket
    rms: Float32Array; // RMS per bucket
}

/** Mix down every sample to mono and hand it to `fn`, in order. */
async function forEachMono(path: string, fn: (mono: Float32Array, sampleRate: number, timestamp: number) => void, onProgress?: (p: number) => void) {
    const input = await openInput(path);
    try {
        const track = await input.getPrimaryAudioTrack();
        if (!track) return false;
        const duration = await input.computeDuration();
        const sink = new AudioSampleSink(track);
        for await (const s of sink.samples()) {
            const n = s.numberOfFrames;
            const ch = s.numberOfChannels;
            const mono = new Float32Array(n);
            const tmp = new Float32Array(n);
            for (let c = 0; c < ch; c++) {
                s.copyTo(tmp, { planeIndex: c, format: "f32-planar" });
                for (let i = 0; i < n; i++) mono[i] += tmp[i] / ch;
            }
            fn(mono, s.sampleRate, s.timestamp);
            onProgress?.(Math.min(1, (s.timestamp + s.duration) / duration));
            s.close();
        }
        return true;
    } finally {
        input.dispose();
    }
}

export async function analyzeAudio(path: string, duration: number): Promise<AudioLevels | null> {
    const buckets = Math.ceil(duration / LEVEL_STEP) + 1;
    const peak = new Float32Array(buckets);
    const sumSq = new Float64Array(buckets);
    const count = new Uint32Array(buckets);
    const ok = await forEachMono(path, (mono, rate, ts) => {
        for (let i = 0; i < mono.length; i++) {
            const b = Math.floor((ts + i / rate) / LEVEL_STEP);
            if (b < 0 || b >= buckets) continue;
            const v = mono[i];
            const a = Math.abs(v);
            if (a > peak[b]) peak[b] = a;
            sumSq[b] += v * v;
            count[b]++;
        }
    });
    if (!ok) return null;
    const rms = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) rms[i] = count[i] ? Math.sqrt(sumSq[i] / count[i]) : 0;
    return { peak, rms };
}

/** Silent stretches longer than `minLength`, shrunk by `pad` on both sides. */
export function findSilences(levels: AudioLevels, opts = { thresholdDb: -42, minLength: 1.0, pad: 0.2 }) {
    const thr = Math.pow(10, opts.thresholdDb / 20);
    const out: { start: number; end: number }[] = [];
    let start = -1;
    const n = levels.rms.length;
    for (let i = 0; i <= n; i++) {
        const quiet = i < n && levels.rms[i] < thr;
        if (quiet && start < 0) start = i;
        if (!quiet && start >= 0) {
            const s = start * LEVEL_STEP + opts.pad;
            const e = i * LEVEL_STEP - opts.pad;
            if (e - s >= opts.minLength - 2 * opts.pad) out.push({ start: s, end: e });
            start = -1;
        }
    }
    return out;
}

/** Mono 16 kHz Float32 audio for Whisper. */
export async function audioForSpeech(path: string, onProgress?: (p: number) => void): Promise<Float32Array | null> {
    const chunks: Float32Array[] = [];
    let total = 0;
    let carry = 0; // fractional source position carried between samples
    const ok = await forEachMono(
        path,
        (mono, rate) => {
            const ratio = rate / 16000;
            const outLen = Math.floor((mono.length - carry) / ratio);
            const out = new Float32Array(Math.max(0, outLen));
            for (let j = 0; j < outLen; j++) {
                // Box filter over the source window, then pick: good enough for speech.
                const a = Math.floor(carry + j * ratio);
                const b = Math.max(a + 1, Math.floor(carry + (j + 1) * ratio));
                let sum = 0;
                for (let k = a; k < b && k < mono.length; k++) sum += mono[k];
                out[j] = sum / (b - a);
            }
            carry = carry + outLen * ratio - mono.length;
            if (carry < 0) carry = 0;
            chunks.push(out);
            total += out.length;
        },
        onProgress,
    );
    if (!ok) return null;
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
        all.set(c, o);
        o += c.length;
    }
    return all;
}

// ── Smart zoom ──────────────────────────────────────────────────────────────

const GW = 32;
const GH = 18;

export async function suggestZooms(
    path: string,
    duration: number,
    existing: ZoomSegment[],
    onProgress?: (p: number) => void,
    signal?: AbortSignal,
): Promise<ZoomSegment[]> {
    const fps = 4;
    const input = await openInput(path);
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const sink = new VideoSampleSink(track);
    const canvas = new OffscreenCanvas(GW * 2, GH * 2);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const times = Array.from({ length: Math.floor(duration * fps) }, (_, i) => i / fps);

    let prev: Float32Array | null = null;
    const frames: { t: number; cells: Uint8Array; count: number }[] = [];
    let i = 0;
    for await (const s of sink.samplesAtTimestamps(times)) {
        if (signal?.aborted) break;
        const t = times[i++];
        onProgress?.(t / duration);
        if (!s) continue;
        s.draw(ctx, 0, 0, canvas.width, canvas.height);
        s.close();
        const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const gray = new Float32Array(GW * GH);
        for (let y = 0; y < GH * 2; y++)
            for (let x = 0; x < GW * 2; x++) {
                const p = (y * GW * 2 + x) * 4;
                gray[(y >> 1) * GW + (x >> 1)] += (px[p] * 0.3 + px[p + 1] * 0.59 + px[p + 2] * 0.11) / 4;
            }
        if (prev) {
            const cells = new Uint8Array(GW * GH);
            let count = 0;
            for (let k = 0; k < cells.length; k++) {
                if (Math.abs(gray[k] - prev[k]) > 6) {
                    cells[k] = 1;
                    count++;
                }
            }
            frames.push({ t, cells, count });
        }
        prev = gray;
    }
    input.dispose();

    // Slide a 2 s window; a window is a candidate when activity is local.
    const win = 2 * fps;
    type Cand = { start: number; end: number; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number };
    const cands: Cand[] = [];
    for (let a = 0; a + win <= frames.length; a += fps / 2) {
        let x0 = GW, y0 = GH, x1 = -1, y1 = -1, sx = 0, sy = 0, n = 0, busy = 0;
        for (let f = a; f < a + win; f++) {
            const fr = frames[f];
            if (fr.count > GW * GH * 0.45) busy++; // full-screen change: scroll or app switch
            if (fr.count === 0 || fr.count > GW * GH * 0.45) continue;
            for (let k = 0; k < fr.cells.length; k++) {
                if (!fr.cells[k]) continue;
                const x = k % GW;
                const y = (k / GW) | 0;
                x0 = Math.min(x0, x); x1 = Math.max(x1, x);
                y0 = Math.min(y0, y); y1 = Math.max(y1, y);
                sx += x; sy += y; n++;
            }
        }
        if (busy > win / 3 || n < 6) continue;
        const bw = (x1 - x0 + 1) / GW;
        const bh = (y1 - y0 + 1) / GH;
        if (bw * bh > 0.3) continue;
        cands.push({ start: frames[a].t, end: frames[a + win - 1].t, x0, y0, x1, y1, cx: (sx / n + 0.5) / GW, cy: (sy / n + 0.5) / GH });
    }

    // Merge overlapping windows that focus on roughly the same spot.
    const merged: Cand[] = [];
    for (const c of cands) {
        const m = merged[merged.length - 1];
        if (m && c.start <= m.end + 0.5 && Math.hypot(c.cx - m.cx, c.cy - m.cy) < 0.18 && c.end - m.start < 14) {
            m.end = c.end;
            m.x0 = Math.min(m.x0, c.x0); m.y0 = Math.min(m.y0, c.y0);
            m.x1 = Math.max(m.x1, c.x1); m.y1 = Math.max(m.y1, c.y1);
            m.cx = (m.cx + c.cx) / 2; m.cy = (m.cy + c.cy) / 2;
        } else merged.push({ ...c });
    }

    const overlaps = (s: number, e: number) => existing.some((z) => !z.suggested && s < z.end && e > z.start);
    return merged
        .map((m) => {
            const start = Math.max(0, m.start - 0.4);
            const end = Math.min(duration, m.end + 0.8);
            const span = Math.max((m.x1 - m.x0 + 1) / GW, (m.y1 - m.y0 + 1) / GH);
            const scale = Math.round(Math.min(2.4, Math.max(1.4, 0.7 / span)) * 10) / 10;
            return { id: uid(), start, end, scale, focus: [m.cx, m.cy] as [number, number], easing: "spring" as const, suggested: true };
        })
        .filter((z) => z.end - z.start >= 1.5 && !overlaps(z.start, z.end));
}
