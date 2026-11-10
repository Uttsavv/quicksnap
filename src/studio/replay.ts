// Replay buffer (the OBS feature): keeps the last N seconds of screen + audio
// encoded in memory, and saves them on demand. Uses WebCodecs directly so we
// can always cut on a keyframe. Chrome/Edge only (needs MediaStreamTrackProcessor).

import { EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, Output, StreamTarget, WebMOutputFormat } from "mediabunny";
import { createWriter } from "../storage/files";

interface Packet<M> {
    chunk: EncodedVideoChunk | EncodedAudioChunk;
    meta?: M;
}

export const replaySupported = () =>
    typeof MediaStreamTrackProcessor !== "undefined" && typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";

export class ReplayBuffer {
    private video: Packet<EncodedVideoChunkMetadata>[] = [];
    private audio: Packet<EncodedAudioChunkMetadata>[] = [];
    private videoConfig?: VideoDecoderConfig;
    private audioConfig?: AudioDecoderConfig;
    private venc?: VideoEncoder;
    private aenc?: AudioEncoder;
    private stopped = false;
    private lastKey = -Infinity;
    size: [number, number] = [0, 0];

    constructor(private seconds: number) {}

    async start(screenTrack: MediaStreamTrack, audioTrack?: MediaStreamTrack | null) {
        const s = screenTrack.getSettings();
        const width = (s.width ?? 1920) & ~1;
        const height = (s.height ?? 1080) & ~1;
        this.size = [width, height];
        const config: VideoEncoderConfig = { codec: "vp09.00.10.08", width, height, bitrate: 6e6, framerate: 30, latencyMode: "realtime" };
        if (!(await VideoEncoder.isConfigSupported(config)).supported) config.codec = "vp8";

        this.venc = new VideoEncoder({
            output: (chunk, meta) => {
                if (meta?.decoderConfig) this.videoConfig = meta.decoderConfig;
                this.video.push({ chunk, meta });
                this.trim();
            },
            error: (e) => console.error("Replay video encoder", e),
        });
        this.venc.configure(config);
        void this.pump(new MediaStreamTrackProcessor({ track: screenTrack.clone() as MediaStreamVideoTrack }).readable, (frame: VideoFrame) => {
            if (!this.venc || this.venc.state !== "configured") return frame.close();
            if (this.venc.encodeQueueSize > 4) return frame.close(); // drop frames rather than lag
            const t = frame.timestamp / 1e6;
            const key = t - this.lastKey >= 2;
            if (key) this.lastKey = t;
            this.venc.encode(frame, { keyFrame: key });
            frame.close();
        });

        if (audioTrack) {
            this.aenc = new AudioEncoder({
                output: (chunk, meta) => {
                    if (meta?.decoderConfig) this.audioConfig = meta.decoderConfig;
                    this.audio.push({ chunk, meta });
                },
                error: (e) => console.error("Replay audio encoder", e),
            });
            const as = audioTrack.getSettings();
            this.aenc.configure({ codec: "opus", sampleRate: as.sampleRate ?? 48000, numberOfChannels: as.channelCount ?? 2, bitrate: 128000 });
            void this.pump(new MediaStreamTrackProcessor({ track: audioTrack.clone() as MediaStreamAudioTrack }).readable, (data: AudioData) => {
                if (this.aenc?.state === "configured") this.aenc.encode(data);
                data.close();
            });
        }
    }

    private async pump<T>(readable: ReadableStream<T>, fn: (v: T) => void) {
        const reader = readable.getReader();
        while (!this.stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            fn(value);
        }
        reader.cancel().catch(() => {});
    }

    /** Drop video older than the window, always keeping a keyframe at the start. */
    private trim() {
        const latest = this.video[this.video.length - 1]?.chunk.timestamp ?? 0;
        const cutoff = latest - this.seconds * 1e6;
        let firstKeep = 0;
        for (let i = 0; i < this.video.length; i++) {
            const c = this.video[i].chunk;
            if (c.timestamp > cutoff) break;
            if (c.type === "key") firstKeep = i;
        }
        if (firstKeep > 0) this.video.splice(0, firstKeep);
        const vStart = this.video[0]?.chunk.timestamp ?? 0;
        while (this.audio.length && this.audio[0].chunk.timestamp < vStart) this.audio.shift();
    }

    get bufferedSeconds() {
        if (this.video.length < 2) return 0;
        return (this.video[this.video.length - 1].chunk.timestamp - this.video[0].chunk.timestamp) / 1e6;
    }

    /** Write the buffer to `<projectId>/replay.webm`; returns its path and duration. */
    async save(projectId: string): Promise<{ path: string; duration: number; hasAudio: boolean; size: [number, number] }> {
        await this.venc?.flush();
        await this.aenc?.flush();
        const video = this.video.slice();
        const audio = this.audio.slice();
        if (!video.length || !this.videoConfig) throw new Error("Replay buffer is empty");
        const t0 = video[0].chunk.timestamp;
        const path = `${projectId}/replay.webm`;
        const writer = await createWriter(path);
        const output = new Output({
            format: new WebMOutputFormat(),
            target: new StreamTarget(
                new WritableStream<{ type: "write"; data: Uint8Array; position: number }>({
                    write: (c) => writer.writeAt(c.data, c.position),
                }) as WritableStream,
            ),
        });
        const vsrc = new EncodedVideoPacketSource(this.videoConfig.codec.startsWith("vp09") ? "vp9" : "vp8");
        output.addVideoTrack(vsrc, { frameRate: 30 });
        const asrc = audio.length && this.audioConfig ? new EncodedAudioPacketSource("opus") : null;
        if (asrc) output.addAudioTrack(asrc);
        await output.start();
        const rebase = (c: EncodedVideoChunk | EncodedAudioChunk) => {
            const p = EncodedPacket.fromEncodedChunk(c);
            return new EncodedPacket(p.data, p.type, Math.max(0, (c.timestamp - t0) / 1e6), p.duration);
        };
        // Interleave by timestamp so the muxer doesn't buffer one track.
        let vi = 0;
        let ai = 0;
        let firstV = true;
        let firstA = true;
        while (vi < video.length || (asrc && ai < audio.length)) {
            const nextV = video[vi]?.chunk.timestamp ?? Infinity;
            const nextA = asrc ? (audio[ai]?.chunk.timestamp ?? Infinity) : Infinity;
            if (nextV <= nextA) {
                await vsrc.add(rebase(video[vi].chunk), firstV ? { decoderConfig: this.videoConfig } : undefined);
                firstV = false;
                vi++;
            } else if (asrc) {
                if (audio[ai].chunk.timestamp >= t0) {
                    await asrc.add(rebase(audio[ai].chunk), firstA ? { decoderConfig: this.audioConfig! } : undefined);
                    firstA = false;
                }
                ai++;
            }
        }
        await output.finalize();
        await writer.close();
        const duration = (video[video.length - 1].chunk.timestamp - t0) / 1e6;
        return { path, duration, hasAudio: !!asrc && !firstA, size: this.size };
    }

    stop() {
        this.stopped = true;
        try {
            this.venc?.close();
        } catch {
            /* already closed */
        }
        try {
            this.aenc?.close();
        } catch {
            /* already closed */
        }
        this.video = [];
        this.audio = [];
    }
}
