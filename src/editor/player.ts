// Real-time preview. Plays the raw sources with media elements, follows the
// edit decisions (cuts, speed, volume), and draws each frame through the
// shared compositor.

import { clipAt, skipCut } from "../lib/timeline";
import type { Project, SourceFile } from "../lib/types";
import { CameraBlur } from "../render/cameraBlur";
import { renderFrame, stateAt } from "../render/compositor";
import { readFile } from "../storage/files";
import { playing as playingSignal, selection } from "./store";

export class Player {
    screen: HTMLVideoElement | null = null;
    camera: HTMLVideoElement | null = null;
    audio: HTMLAudioElement | null = null;
    private urls: string[] = [];
    private audioCtx: AudioContext | null = null;
    private gain: GainNode | null = null;
    private raf = 0;
    private bgImage: ImageBitmap | null = null;
    private bgImagePath: string | null = null;
    private blur: CameraBlur | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private disposed = false;
    playing = false;
    src = 0;
    /** J/K/L shuttle multiplier on top of each clip's own speed. */
    shuttle = 1;

    constructor(
        private getProject: () => Project | null,
        private onTime: (sourceTime: number) => void,
        private onEnded: () => void,
    ) {}

    async load(p: Project) {
        const mk = async <T extends HTMLMediaElement>(s: SourceFile | undefined, el: T): Promise<T | null> => {
            if (!s) return null;
            const url = URL.createObjectURL(await readFile(s.path));
            this.urls.push(url);
            el.preload = "auto";
            el.src = url;
            el.muted = true;
            if (el instanceof HTMLVideoElement) el.playsInline = true;
            await new Promise<void>((res) => {
                if (el.readyState >= 2) return res();
                el.addEventListener("loadeddata", () => res(), { once: true });
                el.addEventListener("error", () => res(), { once: true });
            });
            return el;
        };
        const find = (k: SourceFile["kind"]) => p.sources.find((s) => s.kind === k);
        [this.screen, this.camera, this.audio] = await Promise.all([
            mk(find("screen"), document.createElement("video")),
            mk(find("camera"), document.createElement("video")),
            mk(find("audio"), document.createElement("audio")),
        ]);
        if (this.audio) {
            this.audio.muted = false;
            try {
                this.audioCtx = new AudioContext();
                const node = this.audioCtx.createMediaElementSource(this.audio);
                this.gain = this.audioCtx.createGain();
                node.connect(this.gain).connect(this.audioCtx.destination);
            } catch {
                /* plain element volume as a fallback */
            }
        }
    }

    attach(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.draw();
    }

    private get master(): HTMLMediaElement | null {
        return this.screen ?? this.camera ?? this.audio;
    }

    private get elements(): HTMLMediaElement[] {
        return [this.screen, this.camera, this.audio].filter((e): e is HTMLVideoElement | HTMLAudioElement => !!e);
    }

    /** Seek to a source time. Scrubbing may land inside a cut so it can be seen and restored. */
    async seek(src: number) {
        const p = this.getProject();
        if (!p) return;
        this.src = Math.max(0, Math.min(src, p.duration));
        const target = this.src;
        await this.seekAll(target);
        if (this.src === target) this.draw();
    }

    private seekAll(src: number) {
        return Promise.all(
            this.elements.map(
                (el) =>
                    new Promise<void>((res) => {
                        if (Math.abs(el.currentTime - src) < 0.001) return res();
                        const t = setTimeout(res, 800);
                        el.addEventListener("seeked", () => (clearTimeout(t), res()), { once: true });
                        el.currentTime = Math.min(src, (el.duration || Infinity) - 0.01);
                    }),
            ),
        );
    }

    async play() {
        const p = this.getProject();
        if (!p || this.playing) return;
        void this.audioCtx?.resume();
        const resume = skipCut(p.timeline.clips, this.src);
        if (resume === null || this.src >= p.duration - 0.05) {
            this.src = p.timeline.clips.find((c) => c.enabled)?.start ?? 0;
            await this.seekAll(this.src);
        } else if (resume !== this.src) {
            this.src = resume;
            await this.seekAll(resume);
        }
        this.playing = true;
        playingSignal.value = true; // keep the transport in sync when playback starts from elsewhere (e.g. zoom Preview)
        this.applyClip();
        await Promise.all(this.elements.map((e) => e.play().catch(() => {})));
        this.loop();
    }

    pause() {
        this.playing = false;
        playingSignal.value = false;
        cancelAnimationFrame(this.raf);
        for (const e of this.elements) e.pause();
        this.draw();
    }

    private applyClip() {
        const p = this.getProject();
        if (!p) return;
        const clip = clipAt(p.timeline.clips, this.src);
        const rate = (clip?.speed ?? 1) * this.shuttle;
        for (const e of this.elements) e.playbackRate = rate;
        if (this.audio) {
            // Sped-up or slowed clips play silent; the export does the same.
            const vol = clip && clip.enabled && (clip.speed ?? 1) === 1 && !p.style.muteAudio ? clip.volume : 0;
            if (this.gain) this.gain.gain.value = vol;
            else this.audio.volume = Math.min(1, vol);
        }
    }

    private loop = () => {
        if (!this.playing) return;
        this.raf = requestAnimationFrame(this.loop);
        const p = this.getProject();
        const m = this.master;
        if (!p || !m) return;
        this.src = m.currentTime;

        const next = skipCut(p.timeline.clips, this.src);
        const end = p.timeline.clips.filter((c) => c.enabled).at(-1)?.end ?? p.duration;
        if (next === null || this.src >= end - 0.02 || m.ended) {
            this.pause();
            this.src = end;
            this.onTime(end);
            this.onEnded();
            return;
        }
        if (next !== this.src) {
            this.src = next;
            for (const e of this.elements) e.currentTime = next;
        }
        this.applyClip();
        // Keep followers in sync with the master.
        for (const e of this.elements) {
            if (e !== m && Math.abs(e.currentTime - this.src) > 0.2) e.currentTime = this.src;
        }
        this.onTime(this.src);
        this.draw();
    };

    async setBackgroundImage(path: string | null) {
        if (path === this.bgImagePath) return;
        this.bgImagePath = path;
        this.bgImage?.close();
        this.bgImage = path ? await createImageBitmap(await readFile(path)).catch(() => null) : null;
        this.draw();
    }

    async setCameraBlur(on: boolean) {
        if (!on) {
            this.blur = null;
            this.draw();
            return true;
        }
        if (this.blur) return true;
        const b = new CameraBlur();
        const ok = await b.ready();
        if (ok && !this.disposed) this.blur = b;
        this.draw();
        return ok;
    }

    draw() {
        const p = this.getProject();
        const c = this.canvas;
        if (!p || !c) return;
        const ctx = c.getContext("2d")!;
        const s = this.screen;
        const cam = this.camera;
        const sOk = !!s && s.readyState >= 2;
        const cOk = !!cam && cam.readyState >= 2;
        const camSize: [number, number] | undefined = cOk ? [cam!.videoWidth, cam!.videoHeight] : undefined;
        const camImg: CanvasImageSource | null = cOk
            ? this.blur && p.style.camera.blurBackground
                ? this.blur.process(cam!, camSize![0], camSize![1], performance.now())
                : cam
            : null;
        renderFrame(
            ctx,
            c.width,
            c.height,
            p.style,
            {
                screen: sOk ? s : null,
                screenSize: sOk ? [s!.videoWidth, s!.videoHeight] : undefined,
                camera: camImg,
                cameraSize: camSize,
                backgroundImage: this.bgImage,
                backgroundImageSize: this.bgImage ? [this.bgImage.width, this.bgImage.height] : undefined,
            },
            stateAt(this.src, { ...p.timeline, zooms: previewZooms(p), style: p.style }),
        );
    }

    dispose() {
        this.disposed = true;
        this.pause();
        for (const e of this.elements) {
            e.removeAttribute("src");
            e.load();
        }
        for (const u of this.urls) URL.revokeObjectURL(u);
        void this.audioCtx?.close();
        this.bgImage?.close();
    }
}

/** Zooms as the preview shows them: the selected suggestion plays so it can be judged before keeping it. */
export function previewZooms(p: Project) {
    if (p.style.hideZooms) return [];
    const sel = selection.value;
    if (sel?.kind !== "zoom") return p.timeline.zooms;
    return p.timeline.zooms.map((z) => (z.suggested && z.id === sel.id ? { ...z, suggested: false } : z));
}
