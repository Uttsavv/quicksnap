// Records each source to its own file, streaming chunks to storage as they
// arrive. Nothing here depends on the page being visible, so switching to the
// app you're recording doesn't freeze the capture.

import type { RecordingEvent, SourceFile, SourceKind } from "../lib/types";
import { createWriter, deleteFile, readFile, type FileWriter } from "../storage/files";

const VIDEO_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1", "video/mp4"];
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];

export function pickMime(kind: "video" | "audio"): string {
    const list = kind === "video" ? VIDEO_TYPES : AUDIO_TYPES;
    return list.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

const extFor = (mime: string) => (mime.includes("mp4") ? "mp4" : "webm");

interface Track {
    kind: SourceKind;
    recorder: MediaRecorder;
    writer: FileWriter;
    path: string;
    mime: string;
    size?: [number, number];
    done: Promise<void>;
}

export interface SessionInput {
    projectId: string;
    screen?: MediaStream | null;
    camera?: MediaStream | null;
    audio?: MediaStreamTrack | null;
}

export class RecordingSession {
    readonly projectId: string;
    readonly events: RecordingEvent[] = [];
    private tracks: Track[] = [];
    private startedAt = 0;
    private pausedAt = 0;
    private pausedTotal = 0;
    state: "idle" | "recording" | "paused" | "stopped" = "idle";

    constructor(private input: SessionInput) {
        this.projectId = input.projectId;
    }

    async start(initialScene: string) {
        const { screen, camera, audio, projectId } = this.input;
        const add = async (kind: SourceKind, stream: MediaStream, bitrate: number) => {
            const isAudio = kind === "audio";
            const mime = pickMime(isAudio ? "audio" : "video");
            const path = `${projectId}/${kind}.raw.${extFor(mime)}`;
            const writer = await createWriter(path);
            const recorder = new MediaRecorder(stream, {
                mimeType: mime || undefined,
                ...(isAudio ? { audioBitsPerSecond: bitrate } : { videoBitsPerSecond: bitrate }),
            });
            const s = stream.getVideoTracks()[0]?.getSettings();
            let resolve!: () => void;
            const done = new Promise<void>((r) => (resolve = r));
            let pending = Promise.resolve();
            recorder.ondataavailable = (e) => {
                if (e.data.size) pending = pending.then(() => writer.write(e.data));
            };
            recorder.onstop = () => void pending.then(() => writer.close()).then(resolve, resolve);
            this.tracks.push({ kind, recorder, writer, path, mime: recorder.mimeType || mime, size: s?.width && s.height ? [s.width, s.height] : undefined, done });
        };

        if (screen?.getVideoTracks().length) {
            const s = screen.getVideoTracks()[0].getSettings();
            const px = (s.width ?? 1920) * (s.height ?? 1080);
            await add("screen", new MediaStream(screen.getVideoTracks()), Math.min(16e6, Math.max(4e6, px * 3)));
        }
        if (camera?.getVideoTracks().length) await add("camera", new MediaStream(camera.getVideoTracks()), 3e6);
        if (audio) await add("audio", new MediaStream([audio]), 160e3);
        if (!this.tracks.length) throw new Error("Nothing to record. Turn on a screen, camera or microphone.");

        for (const t of this.tracks) t.recorder.start(1000);
        this.startedAt = performance.now();
        this.state = "recording";
        this.events.push({ t: 0, type: "scene", value: initialScene });
    }

    /** Recording time in seconds, excluding pauses. */
    get elapsed(): number {
        if (this.state === "idle") return 0;
        const now = this.state === "paused" || this.state === "stopped" ? this.pausedAt : performance.now();
        return (now - this.startedAt - this.pausedTotal) / 1000;
    }

    get bytes(): number {
        return this.tracks.reduce((n, t) => n + t.writer.bytes, 0);
    }

    pause() {
        if (this.state !== "recording") return;
        for (const t of this.tracks) if (t.recorder.state === "recording") t.recorder.pause();
        this.pausedAt = performance.now();
        this.state = "paused";
    }

    resume() {
        if (this.state !== "paused") return;
        for (const t of this.tracks) if (t.recorder.state === "paused") t.recorder.resume();
        this.pausedTotal += performance.now() - this.pausedAt;
        this.state = "recording";
    }

    mark(type: RecordingEvent["type"], value?: string) {
        if (this.state === "recording" || this.state === "paused") this.events.push({ t: this.elapsed, type, value });
    }

    async stop(): Promise<{ sources: SourceFile[]; duration: number; events: RecordingEvent[] }> {
        if (this.state === "recording") this.pausedAt = performance.now();
        else if (this.state === "paused") {
            /* pausedAt already set */
        }
        const duration = this.elapsed;
        this.state = "stopped";
        for (const t of this.tracks) if (t.recorder.state !== "inactive") t.recorder.stop();
        await Promise.all(this.tracks.map((t) => t.done));
        const sources: SourceFile[] = this.tracks.map((t) => ({
            kind: t.kind,
            path: t.path,
            mimeType: t.mime,
            width: t.size?.[0],
            height: t.size?.[1],
            duration,
        }));
        return { sources, duration, events: this.events };
    }

    async cancel() {
        for (const t of this.tracks) if (t.recorder.state !== "inactive") t.recorder.stop();
        await Promise.all(this.tracks.map((t) => t.done));
        await Promise.all(this.tracks.map((t) => deleteFile(t.path)));
        this.state = "stopped";
    }
}

/**
 * MediaRecorder files have no duration or seek index. Remux each one (no
 * re-encode) so the editor can seek instantly, and read exact sizes/durations.
 */
export async function finalizeSource(src: SourceFile, onProgress?: (p: number) => void): Promise<SourceFile> {
    const file = await readFile(src.path);
    const { ALL_FORMATS, BlobSource, Conversion, Input, Mp4OutputFormat, Output, StreamTarget, WebMOutputFormat } = await import("mediabunny");
    const isMp4 = src.mimeType.includes("mp4");
    const outPath = src.path.replace(".raw.", ".");
    try {
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const writer = await createWriter(outPath);
        const writable = new WritableStream<{ type: "write"; data: Uint8Array; position: number }>({
            write: (c) => writer.writeAt(c.data, c.position),
        });
        const output = new Output({
            format: isMp4 ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
            target: new StreamTarget(writable as WritableStream),
        });
        const conv = await Conversion.init({ input, output, showWarnings: false });
        if (onProgress) conv.onProgress = onProgress;
        await conv.execute();
        await writer.close();
        const v = await input.getPrimaryVideoTrack();
        const fixed = new Input({ source: new BlobSource(await readFile(outPath)), formats: ALL_FORMATS });
        const duration = await fixed.computeDuration();
        const result: SourceFile = {
            ...src,
            path: outPath,
            duration,
            width: v ? await v.getDisplayWidth() : src.width,
            height: v ? await v.getDisplayHeight() : src.height,
        };
        input.dispose();
        fixed.dispose();
        await deleteFile(src.path);
        return result;
    } catch (err) {
        console.warn("Remux failed, keeping the raw file", err);
        await deleteFile(outPath).catch(() => {});
        return src;
    }
}
