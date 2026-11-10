// Pure timeline math. Clips are contiguous, sorted, and cover [0, duration].
// "Source" time = seconds into the raw recording. "Output" time = seconds into
// the exported video (cut clips removed, speed applied).

import { uid, type Clip, type Timeline } from "./types";

const EPS = 1e-6;

export function initialClips(duration: number): Clip[] {
    return [{ id: uid(), start: 0, end: duration, enabled: true, speed: 1, volume: 1 }];
}

export function emptyTimeline(duration: number): Timeline {
    return { clips: initialClips(duration), zooms: [], layouts: [], markers: [], captions: [] };
}

export function outputDuration(clips: Clip[]): number {
    let d = 0;
    for (const c of clips) if (c.enabled) d += (c.end - c.start) / c.speed;
    return d;
}

export function clipAt(clips: Clip[], src: number): Clip | undefined {
    for (const c of clips) if (src >= c.start - EPS && src < c.end - EPS) return c;
    return clips[clips.length - 1];
}

/** Output time → source time and the clip playing there. */
export function outputToSource(clips: Clip[], t: number): { src: number; clip: Clip } | null {
    let acc = 0;
    let last: Clip | null = null;
    for (const c of clips) {
        if (!c.enabled) continue;
        const len = (c.end - c.start) / c.speed;
        if (t < acc + len - EPS) return { src: c.start + (t - acc) * c.speed, clip: c };
        acc += len;
        last = c;
    }
    return last ? { src: last.end, clip: last } : null;
}

/** Source time → output time. Times inside a cut snap to where the cut sits. */
export function sourceToOutput(clips: Clip[], src: number): number {
    let acc = 0;
    for (const c of clips) {
        if (src < c.start) break;
        const inside = src < c.end;
        if (c.enabled) acc += ((inside ? src : c.end) - c.start) / c.speed;
        if (inside) break;
    }
    return acc;
}

/** If `src` is inside a cut, the source time where playback should resume. */
export function skipCut(clips: Clip[], src: number): number | null {
    const c = clipAt(clips, src);
    if (!c || c.enabled) return src;
    const idx = clips.indexOf(c);
    for (let i = idx + 1; i < clips.length; i++) if (clips[i].enabled) return clips[i].start;
    return null; // nothing playable after this point
}

export function splitAt(clips: Clip[], src: number, minLen = 0.05): Clip[] {
    const out: Clip[] = [];
    for (const c of clips) {
        if (src > c.start + minLen && src < c.end - minLen) {
            out.push({ ...c, end: src }, { ...c, id: uid(), start: src });
        } else out.push(c);
    }
    return out;
}

/** Remove the clip with `id` (mark it cut). */
export function setClip(clips: Clip[], id: string, patch: Partial<Clip>): Clip[] {
    return clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

/** Move the boundary between clip `i` and `i + 1` to `src`. */
export function moveBoundary(clips: Clip[], i: number, src: number, minLen = 0.1): Clip[] {
    if (i < 0 || i >= clips.length - 1) return clips;
    const a = clips[i];
    const b = clips[i + 1];
    const t = Math.min(Math.max(src, a.start + minLen), b.end - minLen);
    const out = clips.slice();
    out[i] = { ...a, end: t };
    out[i + 1] = { ...b, start: t };
    return out;
}

/** Cut the given source ranges (e.g. detected silences). */
export function cutRanges(clips: Clip[], ranges: { start: number; end: number }[]): Clip[] {
    let out = clips;
    for (const r of ranges) {
        out = splitAt(splitAt(out, r.start, 0.01), r.end, 0.01);
        out = out.map((c) =>
            c.start >= r.start - EPS && c.end <= r.end + EPS ? { ...c, enabled: false } : c,
        );
    }
    return mergeAdjacent(out);
}

/** Merge neighbouring clips that are identical apart from their range. */
export function mergeAdjacent(clips: Clip[]): Clip[] {
    const out: Clip[] = [];
    for (const c of clips) {
        const p = out[out.length - 1];
        if (p && !p.enabled && !c.enabled) out[out.length - 1] = { ...p, end: c.end };
        else out.push(c);
    }
    return out;
}

/** Re-sync clips to a new duration (e.g. after a replay-buffer save). */
export function clampClips(clips: Clip[], duration: number): Clip[] {
    const out = clips.filter((c) => c.start < duration).map((c) => ({ ...c, end: Math.min(c.end, duration) }));
    if (out.length) out[out.length - 1].end = duration;
    return out.length ? out : initialClips(duration);
}

export function formatTime(s: number, withMs = false): string {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const base = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    if (!withMs) return base;
    return `${base}.${String(Math.floor((s % 1) * 100)).padStart(2, "0")}`;
}

export function formatClock(s: number): string {
    const h = Math.floor(s / 3600);
    return `${String(h).padStart(2, "0")}:${formatTime(s % 3600)}`;
}
