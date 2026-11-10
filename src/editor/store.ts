// Editor state: the open project, undo/redo history, selection and playhead.

import { batch, computed, signal } from "@preact/signals";
import { saveProject } from "../lib/project";
import { outputDuration } from "../lib/timeline";
import type { Project, Style, Timeline } from "../lib/types";

export type Selection =
    | { kind: "clip" | "zoom" | "layout" | "caption" | "marker"; id: string }
    | null;

interface Snapshot {
    timeline: Timeline;
    style: Style;
    name: string;
}

export const project = signal<Project | null>(null);
export const selection = signal<Selection>(null);
export const playhead = signal(0); // SOURCE seconds; the transport shows the output time
export const playing = signal(false);
export const pxPerSecond = signal(40);
export const saveState = signal<"saved" | "saving" | "error">("saved");

const past = signal<Snapshot[]>([]);
const future = signal<Snapshot[]>([]);
export const canUndo = computed(() => past.value.length > 0);
export const canRedo = computed(() => future.value.length > 0);

export const duration = computed(() => (project.value ? outputDuration(project.value.timeline.clips) : 0));

let saveTimer: number | undefined;
function scheduleSave() {
    clearTimeout(saveTimer);
    saveState.value = "saving";
    saveTimer = window.setTimeout(async () => {
        const p = project.value;
        if (!p) return;
        try {
            await saveProject(p);
            saveState.value = "saved";
        } catch {
            saveState.value = "error";
        }
    }, 400);
}

const snap = (p: Project): Snapshot => ({ timeline: p.timeline, style: p.style, name: p.name });

export function load(p: Project) {
    batch(() => {
        project.value = p;
        past.value = [];
        future.value = [];
        selection.value = null;
        playhead.value = 0;
        playing.value = false;
    });
}

// Gesture support: begin() captures the state before a drag or slider move,
// update() changes it live, end() records one undo step for the whole gesture.
let gestureStart: Snapshot | null = null;

export function begin() {
    if (project.value && !gestureStart) gestureStart = snap(project.value);
}

export function update(fn: (p: Project) => Partial<Pick<Project, "timeline" | "style" | "name">>) {
    const p = project.value;
    if (!p) return;
    project.value = { ...p, ...fn(p) };
    scheduleSave();
}

export function end() {
    const p = project.value;
    if (!p || !gestureStart) return;
    const before = gestureStart;
    gestureStart = null;
    if (before.timeline === p.timeline && before.style === p.style && before.name === p.name) return;
    past.value = [...past.value.slice(-99), before];
    future.value = [];
}

/** A discrete edit: one undo step. */
export function commit(fn: (p: Project) => Partial<Pick<Project, "timeline" | "style" | "name">>) {
    begin();
    update(fn);
    end();
}

export const setTimeline = (fn: (t: Timeline) => Partial<Timeline>) => commit((p) => ({ timeline: { ...p.timeline, ...fn(p.timeline) } }));
export const setStyle = (fn: (s: Style) => Partial<Style>) => commit((p) => ({ style: { ...p.style, ...fn(p.style) } }));
export const liveStyle = (fn: (s: Style) => Partial<Style>) => update((p) => ({ style: { ...p.style, ...fn(p.style) } }));
export const liveTimeline = (fn: (t: Timeline) => Partial<Timeline>) => update((p) => ({ timeline: { ...p.timeline, ...fn(p.timeline) } }));

export function undo() {
    const p = project.value;
    const prev = past.value[past.value.length - 1];
    if (!p || !prev) return;
    batch(() => {
        past.value = past.value.slice(0, -1);
        future.value = [...future.value, snap(p)];
        project.value = { ...p, ...prev };
        selection.value = null;
    });
    scheduleSave();
}

export function redo() {
    const p = project.value;
    const next = future.value[future.value.length - 1];
    if (!p || !next) return;
    batch(() => {
        future.value = future.value.slice(0, -1);
        past.value = [...past.value, snap(p)];
        project.value = { ...p, ...next };
        selection.value = null;
    });
    scheduleSave();
}

export async function flushSave() {
    clearTimeout(saveTimer);
    if (project.value) await saveProject(project.value);
    saveState.value = "saved";
}
