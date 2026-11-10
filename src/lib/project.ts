import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";
import { projects } from "../storage/db";
import { deleteDir, readFile, writeFile } from "../storage/files";
import { emptyTimeline } from "./timeline";
import { defaultStyle, uid, type LayoutMode, type LayoutSegment, type Project, type RecordingEvent, type SourceFile } from "./types";

export function buildProject(opts: {
    id: string;
    name?: string;
    sources: SourceFile[];
    events: RecordingEvent[];
    duration: number;
}): Project {
    const { id, sources, events } = opts;
    const duration = Math.max(opts.duration, ...sources.map((s) => s.duration || 0));
    const hasCamera = sources.some((s) => s.kind === "camera");
    const hasScreen = sources.some((s) => s.kind === "screen");

    // Scene switches during recording become editable layout segments.
    const scenes = events.filter((e) => e.type === "scene");
    const initial = (scenes[0]?.value as LayoutMode) ?? (hasCamera ? (hasScreen ? "bubble" : "camera") : "screen");
    const layouts: LayoutSegment[] = [];
    for (let i = 1; i < scenes.length; i++) {
        const start = scenes[i].t;
        const end = scenes[i + 1]?.t ?? duration;
        if (end - start > 0.05 && scenes[i].value !== initial)
            layouts.push({ id: uid(), start, end, mode: scenes[i].value as LayoutMode });
    }

    const timeline = emptyTimeline(duration);
    timeline.layouts = layouts;
    timeline.markers = events
        .filter((e) => e.type === "marker")
        .map((e, i) => ({ id: uid(), t: e.t, label: e.value || `Marker ${i + 1}` }));

    const now = Date.now();
    return {
        id,
        name: opts.name ?? defaultName(now),
        createdAt: now,
        updatedAt: now,
        duration,
        sources,
        events,
        timeline,
        style: defaultStyle(initial),
    };
}

export function defaultName(t: number) {
    const d = new Date(t);
    return `Recording ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export async function openInput(path: string) {
    const file = await readFile(path);
    return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

export async function makeThumbnail(p: Project): Promise<string | undefined> {
    const src = p.sources.find((s) => s.kind === "screen") ?? p.sources.find((s) => s.kind === "camera");
    if (!src) return;
    try {
        const input = await openInput(src.path);
        const track = await input.getPrimaryVideoTrack();
        if (!track) return;
        const sink = new VideoSampleSink(track);
        const sample = await sink.getSample(Math.min(1, p.duration / 2));
        if (!sample) return;
        const w = 480;
        const h = Math.round((w * sample.displayHeight) / sample.displayWidth);
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d")!;
        sample.draw(ctx, 0, 0, w, h);
        sample.close();
        input.dispose();
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
        const path = `${p.id}/thumb.jpg`;
        await writeFile(path, blob);
        return path;
    } catch (e) {
        console.warn("Thumbnail failed", e);
        return;
    }
}

export async function saveProject(p: Project) {
    p.updatedAt = Date.now();
    await projects.put(p);
}

export async function deleteProject(id: string) {
    await projects.delete(id);
    await deleteDir(id);
}

export const newProjectId = () => `p_${uid()}`;
