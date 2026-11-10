// Scenes in the editor: a continuous strip of layout segments that covers the
// whole recording, so every moment has exactly one visible scene. There is no
// hidden default and segments never overlap or leave gaps.

import { uid, type LayoutMode, type LayoutSegment, type Project, type RecordingEvent } from "./types";

/** Shortest scene an edge drag can leave behind (seconds). */
export const SCENE_MIN = 0.3;
/** Pieces shorter than this are folded into their neighbour (seconds). */
const SLIVER = 0.05;

/** Merge neighbours that show the same scene and drop slivers. */
function tidy(runs: LayoutSegment[]): LayoutSegment[] {
    const out: LayoutSegment[] = [];
    for (const r of runs) {
        const prev = out[out.length - 1];
        if (prev && (prev.mode === r.mode || r.end - r.start < SLIVER)) prev.end = r.end;
        else out.push({ ...r });
    }
    // A sliver at the very start joins the scene after it.
    if (out.length > 1 && out[0].end - out[0].start < SLIVER) {
        out[1] = { ...out[1], start: out[0].start };
        out.shift();
    }
    return out;
}

/**
 * Turn any layout list (sparse, overlapping, unsorted) plus its fallback into
 * a continuous strip covering 0..duration that plays back exactly the same.
 */
export function normalizeScenes(layouts: LayoutSegment[], fallback: LayoutMode, duration: number): LayoutSegment[] {
    const cuts = new Set([0, duration]);
    for (const l of layouts)
        for (const t of [l.start, l.end]) if (t > 0 && t < duration) cuts.add(t);
    const pts = [...cuts].sort((a, b) => a - b);
    const runs: LayoutSegment[] = [];
    const used = new Set<string>();
    for (let i = 0; i < pts.length - 1; i++) {
        const s = pts[i];
        const e = pts[i + 1];
        const mid = (s + e) / 2;
        // Same rule as layoutAt: the first matching segment in list order wins.
        const src = layouts.find((l) => mid >= l.start && mid < l.end);
        const id = src && !used.has(src.id) ? src.id : uid();
        used.add(id);
        runs.push({ id, start: s, end: e, mode: src?.mode ?? fallback });
    }
    if (!runs.length) return [{ id: uid(), start: 0, end: Math.max(0, duration), mode: fallback }];
    return tidy(runs);
}

/** True when the strip already covers 0..duration with no gaps, overlaps or repeats. */
export function isNormalized(runs: LayoutSegment[], duration: number): boolean {
    if (!runs.length || runs[0].start !== 0 || Math.abs(runs[runs.length - 1].end - duration) > 1e-6) return false;
    for (let i = 1; i < runs.length; i++) if (runs[i].start !== runs[i - 1].end || runs[i].mode === runs[i - 1].mode) return false;
    return true;
}

export function sceneIndexAt(runs: LayoutSegment[], t: number): number {
    const i = runs.findIndex((r) => t >= r.start && t < r.end);
    return i >= 0 ? i : runs.length - 1;
}

/** Switch scene from time t until the next scene change, like switching while recording. */
export function switchSceneAt(runs: LayoutSegment[], t: number, mode: LayoutMode): { runs: LayoutSegment[]; id: string } {
    const i = sceneIndexAt(runs, t);
    const r = runs[i];
    if (r.mode === mode) return { runs, id: r.id };
    let next: LayoutSegment[];
    if (t - r.start < SLIVER || r.end - t < SLIVER) next = runs.map((x) => (x.id === r.id ? { ...x, mode } : x));
    else next = [...runs.slice(0, i), { ...r, end: t }, { id: uid(), start: t, end: r.end, mode }, ...runs.slice(i + 1)];
    next = tidy(next);
    return { runs: next, id: next[sceneIndexAt(next, t)].id };
}

/** Change one scene section. Returns the id of the section that now covers it. */
export function setSceneMode(runs: LayoutSegment[], id: string, mode: LayoutMode): { runs: LayoutSegment[]; id: string } {
    const r = runs.find((x) => x.id === id);
    if (!r || r.mode === mode) return { runs, id };
    const next = tidy(runs.map((x) => (x.id === id ? { ...x, mode } : x)));
    return { runs: next, id: next[sceneIndexAt(next, (r.start + r.end) / 2)].id };
}

/** Remove a section: the scene before it carries on (the first one hands over to the next). */
export function removeScene(runs: LayoutSegment[], id: string): LayoutSegment[] {
    const i = runs.findIndex((x) => x.id === id);
    if (i < 0 || runs.length < 2) return runs;
    const next = runs.map((x) => ({ ...x }));
    if (i > 0) next[i - 1].end = next[i].end;
    else next[1].start = 0;
    next.splice(i, 1);
    return tidy(next);
}

/** Move the edge between section i and section i + 1. */
export function moveSceneEdge(runs: LayoutSegment[], i: number, t: number): LayoutSegment[] {
    if (i < 0 || i >= runs.length - 1) return runs;
    const lo = runs[i].start + SCENE_MIN;
    const hi = runs[i + 1].end - SCENE_MIN;
    if (lo > hi) return runs;
    const at = Math.min(hi, Math.max(lo, t));
    return runs.map((x, k) => (k === i ? { ...x, end: at } : k === i + 1 ? { ...x, start: at } : x));
}

export function wholeVideo(mode: LayoutMode, duration: number): LayoutSegment[] {
    return [{ id: uid(), start: 0, end: duration, mode }];
}

/** The scene a recording starts in when no switch was logged. */
export function startScene(hasCamera: boolean, hasScreen: boolean): LayoutMode {
    return hasCamera ? (hasScreen ? "bubble" : "camera") : "screen";
}

/** The scenes exactly as they were switched during recording. */
export function recordedScenes(events: RecordingEvent[], fallback: LayoutMode, duration: number): LayoutSegment[] {
    const switches = events.filter((e) => e.type === "scene");
    if (!switches.length) return wholeVideo(fallback, duration);
    const raw: LayoutSegment[] = switches.map((s, i) => ({
        id: uid(),
        start: i === 0 ? 0 : Math.min(duration, s.t),
        end: Math.min(duration, switches[i + 1]?.t ?? duration),
        mode: s.value as LayoutMode,
    }));
    return normalizeScenes(raw.filter((r) => r.end > r.start), raw[0].mode, duration);
}

/** Same scenes at the same times, ignoring ids. */
export function sameScenes(a: LayoutSegment[], b: LayoutSegment[]): boolean {
    return a.length === b.length && a.every((r, i) => r.mode === b[i].mode && Math.abs(r.start - b[i].start) < 1e-3 && Math.abs(r.end - b[i].end) < 1e-3);
}

/** Projects saved before the scene strip get converted on open; playback is unchanged. */
export function withSceneStrip(p: Project): Project {
    if (!p.sources.some((s) => s.kind === "camera") || isNormalized(p.timeline.layouts, p.duration)) return p;
    const layouts = normalizeScenes(p.timeline.layouts, p.style.defaultLayout, p.duration);
    return { ...p, timeline: { ...p.timeline, layouts }, style: { ...p.style, defaultLayout: layouts[layouts.length - 1].mode } };
}
