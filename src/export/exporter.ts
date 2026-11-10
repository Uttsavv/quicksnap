// Frame-accurate export: decode sources with WebCodecs, draw every frame with
// the shared compositor, encode, and mux to MP4 / WebM — or quantize to GIF.

import { GIFEncoder, applyPalette, quantize } from "gifenc";
import {
    AudioSample,
    AudioSampleSink,
    AudioSampleSource,
    BufferTarget,
    CanvasSource,
    getFirstEncodableAudioCodec,
    getFirstEncodableVideoCodec,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    QUALITY_LOW,
    QUALITY_MEDIUM,
    QUALITY_VERY_HIGH,
    StreamTarget,
    VideoSampleSink,
    WebMOutputFormat,
    type InputAudioTrack,
    type VideoSample,
} from "mediabunny";
import { toSrt } from "../editor/captions";
import { openInput } from "../lib/project";
import { outputDuration, outputToSource, sourceToOutput } from "../lib/timeline";
import type { Project } from "../lib/types";
import { CameraBlur } from "../render/cameraBlur";
import { outputSize, renderFrame, stateAt } from "../render/compositor";
import { readFile } from "../storage/files";

export type ExportFormat = "mp4" | "webm" | "gif";
export type ExportQuality = "low" | "medium" | "high" | "very-high";

export interface ExportOptions {
    format: ExportFormat;
    height: number; // short side in px
    fps: number;
    quality: ExportQuality;
    /** Where to write. Null = keep in memory and return a Blob. */
    fileHandle?: FileSystemFileHandle | null;
    signal: AbortSignal;
    onProgress: (p: number, etaSeconds: number | null) => void;
}

const QUALITY = { low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH, "very-high": QUALITY_VERY_HIGH };

class Cancelled extends Error {
    constructor() {
        super("Export cancelled");
    }
}
export const isCancelled = (e: unknown) => e instanceof Cancelled;

/** Rough output size estimate in bytes, for the UI. */
export function estimateSize(p: Project, o: Pick<ExportOptions, "format" | "height" | "fps" | "quality">) {
    const [w, h] = outputSize(p.style.aspect, o.height);
    const dur = outputDuration(p.timeline.clips);
    if (o.format === "gif") return (w * h * dur * o.fps * 0.12) | 0;
    const q = { low: 0.04, medium: 0.07, high: 0.11, "very-high": 0.17 }[o.quality];
    return ((w * h * o.fps * q * dur) / 8 + (128000 * dur) / 8) | 0;
}

// ── Frames ──────────────────────────────────────────────────────────────────

interface FrameSource {
    next(src: number): Promise<{ img: CanvasImageSource; size: [number, number] } | null>;
    close(): void;
}

/** Walks a video track forward, holding the latest frame at or before each time. */
async function frameSource(path: string | undefined, times: number[]): Promise<FrameSource | null> {
    if (!path) return null;
    const input = await openInput(path);
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const sink = new VideoSampleSink(track);
    const it = sink.samplesAtTimestamps(times)[Symbol.asyncIterator]();
    let current: VideoSample | null = null;
    let img: CanvasImageSource | null = null;
    return {
        async next() {
            const r = await it.next();
            if (!r.done && r.value) {
                current?.close();
                current = r.value;
                img = current.toCanvasImageSource();
            }
            return current && img ? { img, size: [current.displayWidth, current.displayHeight] } : null;
        },
        close() {
            current?.close();
            void it.return?.(undefined);
            input.dispose();
        },
    };
}

async function prepareFrames(p: Project, fps: number) {
    const dur = outputDuration(p.timeline.clips);
    const count = Math.max(1, Math.round(dur * fps));
    const srcTimes = Array.from({ length: count }, (_, i) => outputToSource(p.timeline.clips, i / fps)?.src ?? 0);
    const find = (k: string) => p.sources.find((s) => s.kind === k)?.path;
    const [screen, camera] = await Promise.all([frameSource(find("screen"), srcTimes), frameSource(find("camera"), srcTimes)]);
    const bg = p.style.background.kind === "image" ? await createImageBitmap(await readFile(p.style.background.path)).catch(() => null) : null;
    let blur: CameraBlur | null = null;
    if (camera && p.style.camera.blurBackground) {
        blur = new CameraBlur();
        if (!(await blur.ready())) blur = null;
    }
    return { dur, count, srcTimes, screen, camera, bg, blur };
}

async function drawFrames(
    p: Project,
    W: number,
    H: number,
    fps: number,
    ctx: OffscreenCanvasRenderingContext2D,
    o: Pick<ExportOptions, "signal" | "onProgress">,
    onFrame: (i: number, t: number) => Promise<void>,
) {
    const f = await prepareFrames(p, fps);
    const started = performance.now();
    try {
        for (let i = 0; i < f.count; i++) {
            if (o.signal.aborted) throw new Cancelled();
            const src = f.srcTimes[i];
            const [s, c] = await Promise.all([f.screen?.next(src), f.camera?.next(src)]);
            const camImg = c && f.blur ? f.blur.process(c.img, c.size[0], c.size[1], (i * 1000) / fps) : c?.img;
            renderFrame(
                ctx,
                W,
                H,
                p.style,
                {
                    screen: s?.img ?? null,
                    screenSize: s?.size,
                    camera: camImg ?? null,
                    cameraSize: c?.size,
                    backgroundImage: f.bg,
                    backgroundImageSize: f.bg ? [f.bg.width, f.bg.height] : undefined,
                },
                stateAt(src, { ...p.timeline, style: p.style }),
            );
            await onFrame(i, i / fps);
            const done = (i + 1) / f.count;
            const elapsed = (performance.now() - started) / 1000;
            o.onProgress(done, i > 10 ? (elapsed / done) * (1 - done) : null);
        }
    } finally {
        f.screen?.close();
        f.camera?.close();
        f.bg?.close();
    }
    return f.dur;
}

// ── Audio ───────────────────────────────────────────────────────────────────

/** Yields output-time audio: kept clips at normal speed, silence for cut/sped clips. */
async function* editedAudio(p: Project, track: InputAudioTrack): AsyncGenerator<AudioSample> {
    const sink = new AudioSampleSink(track);
    const rate = await track.getSampleRate();
    const channels = await track.getNumberOfChannels();
    const FADE = Math.round(rate * 0.01);
    let out = 0; // output time in seconds

    const silence = function* (seconds: number) {
        let left = Math.round(seconds * rate);
        while (left > 0) {
            const n = Math.min(left, rate);
            yield new AudioSample({ data: new Float32Array(n * channels), format: "f32-planar", numberOfChannels: channels, sampleRate: rate, timestamp: out });
            out += n / rate;
            left -= n;
        }
    };

    for (const clip of p.timeline.clips) {
        if (!clip.enabled) continue;
        const len = (clip.end - clip.start) / clip.speed;
        if (clip.speed !== 1 || clip.volume === 0) {
            yield* silence(len);
            continue;
        }
        const clipOut = out;
        const totalFrames = Math.round((clip.end - clip.start) * rate);
        let written = 0;
        for await (const s of sink.samples(clip.start, clip.end)) {
            const startFrame = Math.max(0, Math.round((clip.start - s.timestamp) * rate));
            const endFrame = Math.min(s.numberOfFrames, Math.round((clip.end - s.timestamp) * rate));
            const n = Math.min(endFrame - startFrame, totalFrames - written);
            if (n <= 0) {
                s.close();
                continue;
            }
            const data = new Float32Array(n * channels);
            for (let c = 0; c < channels; c++) {
                const plane = data.subarray(c * n, (c + 1) * n);
                s.copyTo(plane, { planeIndex: c, format: "f32-planar", frameOffset: startFrame, frameCount: n });
                for (let k = 0; k < n; k++) {
                    const pos = written + k;
                    // Short fades at clip edges avoid clicks at cuts.
                    const fade = Math.min(1, pos / FADE, (totalFrames - pos) / FADE);
                    plane[k] *= clip.volume * fade;
                }
            }
            s.close();
            yield new AudioSample({ data, format: "f32-planar", numberOfChannels: channels, sampleRate: rate, timestamp: clipOut + written / rate });
            written += n;
        }
        out = clipOut + written / rate;
        // Pad if the audio track ended early.
        if (written < totalFrames) yield* silence((totalFrames - written) / rate);
        out = clipOut + len;
    }
}

// ── Video export ────────────────────────────────────────────────────────────

export async function exportVideo(p: Project, o: ExportOptions): Promise<Blob | null> {
    if (o.format === "gif") return exportGif(p, o);
    const [W, H] = outputSize(p.style.aspect, o.height);
    const isMp4 = o.format === "mp4";

    const vcodec = await getFirstEncodableVideoCodec(isMp4 ? ["avc", "hevc", "av1", "vp9"] : ["vp9", "av1", "vp8"], { width: W, height: H });
    if (!vcodec) throw new Error(`This browser can't encode ${o.format.toUpperCase()} at ${W}×${H}. Try WebM or a lower resolution.`);

    const audioPath = p.sources.find((s) => s.kind === "audio")?.path;
    const audioInput = audioPath ? await openInput(audioPath) : null;
    const audioTrack = audioInput ? await audioInput.getPrimaryAudioTrack() : null;
    const acodec = audioTrack ? await getFirstEncodableAudioCodec(isMp4 ? ["aac", "opus"] : ["opus", "vorbis"]) : null;

    let writable: FileSystemWritableFileStream | null = null;
    let target: BufferTarget | StreamTarget;
    if (o.fileHandle) {
        writable = await o.fileHandle.createWritable();
        const w = writable;
        target = new StreamTarget(
            new WritableStream<{ type: "write"; data: Uint8Array; position: number }>({
                write: (c) => w.write({ type: "write", position: c.position, data: c.data as Uint8Array<ArrayBuffer> }),
            }) as WritableStream,
            { chunked: true },
        );
    } else target = new BufferTarget();

    const output = new Output({
        format: isMp4 ? new Mp4OutputFormat({ fastStart: o.fileHandle ? false : "in-memory" }) : new WebMOutputFormat(),
        target,
    });
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const video = new CanvasSource(canvas, { codec: vcodec, quality: QUALITY[o.quality], keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: o.fps });
    const audio = audioTrack && acodec ? new AudioSampleSource({ codec: acodec, quality: QUALITY[o.quality] }) : null;
    if (audio) output.addAudioTrack(audio);
    await output.start();

    const audioIt = audio && audioTrack ? editedAudio(p, audioTrack)[Symbol.asyncIterator]() : null;
    let audioTime = 0;
    let audioDone = !audioIt;
    const pumpAudio = async (until: number) => {
        while (audioIt && !audioDone && audioTime < until) {
            const r = await audioIt.next();
            if (r.done) {
                audioDone = true;
                break;
            }
            audioTime = r.value.timestamp + r.value.duration;
            await audio!.add(r.value);
            r.value.close();
        }
    };

    try {
        const dur = await drawFrames(p, W, H, o.fps, ctx, o, async (_i, t) => {
            await video.add(t, 1 / o.fps);
            await pumpAudio(t + 1); // keep audio slightly ahead so the muxer can interleave
        });
        await pumpAudio(dur + 1);
        await output.finalize();
        if (writable) {
            await writable.close();
            return null;
        }
        const mime = isMp4 ? "video/mp4" : "video/webm";
        return new Blob([(target as BufferTarget).buffer!], { type: mime });
    } catch (e) {
        await output.cancel().catch(() => {});
        await writable?.abort().catch(() => {});
        throw e;
    } finally {
        audioInput?.dispose();
    }
}

// ── GIF ─────────────────────────────────────────────────────────────────────

async function exportGif(p: Project, o: ExportOptions): Promise<Blob> {
    const fps = Math.min(o.fps, 15);
    const short = Math.min(o.height, 480);
    const [W, H] = outputSize(p.style.aspect, short);
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false })!;
    const gif = GIFEncoder();
    const delay = Math.round(1000 / fps);
    await drawFrames(p, W, H, fps, ctx, o, async () => {
        const { data } = ctx.getImageData(0, 0, W, H);
        const palette = quantize(data, 256);
        gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay });
        // Yield so the UI stays responsive; quantizing is CPU-bound.
        await new Promise((r) => setTimeout(r, 0));
    });
    gif.finish();
    return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: "image/gif" });
}

// ── Captions ────────────────────────────────────────────────────────────────

export function captionsForOutput(p: Project) {
    const clips = p.timeline.clips;
    return p.timeline.captions
        .map((c) => ({ start: sourceToOutput(clips, c.start), end: sourceToOutput(clips, c.end), text: c.text }))
        .filter((c) => c.end - c.start > 0.05)
        .sort((a, b) => a.start - b.start);
}

export function exportSrt(p: Project): Blob {
    return new Blob([toSrt(captionsForOutput(p))], { type: "application/x-subrip" });
}

export function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke later: revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function safeName(name: string) {
    return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "quicksnap";
}
