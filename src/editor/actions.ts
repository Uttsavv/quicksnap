// Editing commands shared by the toolbar, inspector and keyboard shortcuts.

import { signal } from "@preact/signals";
import { clipAt, cutRanges, setClip, splitAt } from "../lib/timeline";
import { uid, type LayoutMode, type ZoomSegment } from "../lib/types";
import { errorText, toast } from "../ui/controls";
import { analyzeAudio, findSilences, suggestZooms, type AudioLevels } from "./analysis";
import { transcribe } from "./captions";
import { playhead, project, selection, setTimeline } from "./store";

export const levels = signal<AudioLevels | null>(null);
export const task = signal<{ label: string; progress: number; cancel: () => void } | null>(null);

export async function loadLevels() {
    const p = project.value;
    const audio = p?.sources.find((s) => s.kind === "audio");
    levels.value = null;
    if (!p || !audio) return;
    try {
        levels.value = await analyzeAudio(audio.path, p.duration);
    } catch (e) {
        console.warn("Audio analysis failed", e);
    }
}

export function split() {
    const t = playhead.value;
    setTimeline((tl) => ({ clips: splitAt(tl.clips, t) }));
}

export function deleteSelection() {
    const sel = selection.value;
    if (!sel) return;
    if (sel.kind === "clip") {
        const c = project.value?.timeline.clips.find((x) => x.id === sel.id);
        if (!c) return;
        if (project.value!.timeline.clips.filter((x) => x.enabled).length === 1 && c.enabled) {
            toast("Can't cut the only remaining clip.", "error");
            return;
        }
        setTimeline((tl) => ({ clips: setClip(tl.clips, sel.id, { enabled: !c.enabled }) }));
        return;
    }
    const key = ({ zoom: "zooms", layout: "layouts", caption: "captions", marker: "markers" } as const)[sel.kind];
    setTimeline((tl) => ({ [key]: (tl[key] as { id: string }[]).filter((x) => x.id !== sel.id) }));
    selection.value = null;
}

/** Cut or restore the clip under the playhead. */
export function toggleClipAtPlayhead() {
    const p = project.value;
    if (!p) return;
    const c = clipAt(p.timeline.clips, playhead.value);
    if (c) {
        selection.value = { kind: "clip", id: c.id };
        deleteSelection();
    }
}

export function addZoom(at = playhead.value) {
    const p = project.value;
    if (!p) return;
    const start = Math.min(at, Math.max(0, p.duration - 1));
    const z: ZoomSegment = { id: uid(), start, end: Math.min(p.duration, start + 3), scale: 1.8, focus: [0.5, 0.5], easing: "spring" };
    setTimeline((tl) => ({ zooms: [...tl.zooms, z].sort((a, b) => a.start - b.start) }));
    selection.value = { kind: "zoom", id: z.id };
}

export function addLayout(at = playhead.value) {
    const p = project.value;
    if (!p) return;
    const start = Math.min(at, Math.max(0, p.duration - 1));
    const id = uid();
    const mode: LayoutMode = p.style.defaultLayout === "side" ? "bubble" : "side";
    setTimeline((tl) => ({ layouts: [...tl.layouts, { id, start, end: Math.min(p.duration, start + 5), mode }].sort((a, b) => a.start - b.start) }));
    selection.value = { kind: "layout", id };
}

export function addMarker(at = playhead.value) {
    const p = project.value;
    if (!p) return;
    const id = uid();
    setTimeline((tl) => ({ markers: [...tl.markers, { id, t: at, label: `Marker ${tl.markers.length + 1}` }].sort((a, b) => a.t - b.t) }));
}

export function acceptSuggestions() {
    setTimeline((tl) => ({ zooms: tl.zooms.map((z) => ({ ...z, suggested: false })) }));
}

export function clearSuggestions() {
    setTimeline((tl) => ({ zooms: tl.zooms.filter((z) => !z.suggested) }));
}

async function runTask<T>(label: string, fn: (progress: (p: number, l?: string) => void, signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (task.value) {
        toast("Wait for the current task to finish.", "error");
        return;
    }
    const ac = new AbortController();
    task.value = { label, progress: 0, cancel: () => ac.abort() };
    try {
        return await fn((progress, l) => (task.value = { label: l ?? label, progress, cancel: () => ac.abort() }), ac.signal);
    } catch (e) {
        if (!ac.signal.aborted) toast(`${label.replace(/…$/, "")} failed: ${errorText(e)}`, "error");
    } finally {
        task.value = null;
    }
}

export async function runSmartZoom() {
    const p = project.value;
    const screen = p?.sources.find((s) => s.kind === "screen");
    if (!p || !screen) {
        toast("Smart zoom needs a screen recording.", "error");
        return;
    }
    const found = await runTask("Looking for zoom moments…", (progress, signal) =>
        suggestZooms(screen.path, p.duration, p.timeline.zooms, progress, signal),
    );
    if (!found) return;
    setTimeline((tl) => ({ zooms: [...tl.zooms.filter((z) => !z.suggested), ...found].sort((a, b) => a.start - b.start) }));
    toast(found.length ? `Suggested ${found.length} zoom${found.length === 1 ? "" : "s"}. Accept them in the Zoom tab or delete the ones you don't want.` : "No clear zoom moments found.");
}

export function silencesPreview(thresholdDb: number, minLength: number) {
    return levels.value ? findSilences(levels.value, { thresholdDb, minLength, pad: 0.2 }) : [];
}

export function removeSilences(thresholdDb: number, minLength: number) {
    const ranges = silencesPreview(thresholdDb, minLength);
    if (!ranges.length) {
        toast("No silences found at this threshold.");
        return;
    }
    setTimeline((tl) => ({ clips: cutRanges(tl.clips, ranges) }));
    const total = ranges.reduce((n, r) => n + r.end - r.start, 0);
    toast(`Cut ${ranges.length} silence${ranges.length === 1 ? "" : "s"} (${total.toFixed(1)} s). Undo with ⌘Z.`);
}

export async function generateCaptions(language?: string) {
    const p = project.value;
    const audio = p?.sources.find((s) => s.kind === "audio");
    if (!p || !audio) {
        toast("Captions need a recording with audio.", "error");
        return;
    }
    const caps = await runTask("Preparing captions…", (progress, signal) =>
        transcribe(audio.path, (s) => progress(s.progress, s.stage), signal, language),
    );
    if (!caps) return;
    setTimeline(() => ({ captions: caps }));
    toast(caps.length ? `Added ${caps.length} captions.` : "No speech found.");
}
