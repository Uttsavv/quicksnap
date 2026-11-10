// The project model. Every edit is non-destructive: raw sources live in
// storage, and everything else here describes how to render them.
//
// Times in `timeline` are SOURCE times (seconds into the raw recording), so
// zooms, layouts and captions stay attached to the content when clips are cut.

export type SourceKind = "screen" | "camera" | "audio";

export interface SourceFile {
    kind: SourceKind;
    path: string; // key in the file store
    mimeType: string;
    width?: number;
    height?: number;
    duration: number;
}

export type LayoutMode = "screen" | "bubble" | "side" | "camera";

export interface RecordingEvent {
    t: number; // recording time in seconds (pauses excluded)
    type: "scene" | "marker";
    value?: string;
}

export interface Clip {
    id: string;
    start: number;
    end: number;
    enabled: boolean; // false = cut
    speed: number; // 1 = normal; sped/slowed clips play silent
    volume: number; // 0..2
}

export type Easing = "spring" | "smooth" | "instant";

export interface ZoomSegment {
    id: string;
    start: number;
    end: number;
    scale: number;
    focus: [number, number]; // 0..1 within the screen frame
    easing: Easing;
    suggested?: boolean;
}

export interface LayoutSegment {
    id: string;
    start: number;
    end: number;
    mode: LayoutMode;
}

export interface Marker {
    id: string;
    t: number;
    label: string;
}

export interface Caption {
    id: string;
    start: number;
    end: number;
    text: string;
}

export interface Timeline {
    clips: Clip[];
    zooms: ZoomSegment[];
    layouts: LayoutSegment[];
    markers: Marker[];
    captions: Caption[];
}

export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";
export type Corner = "tl" | "tr" | "bl" | "br";

export type Background =
    | { kind: "preset"; id: string }
    | { kind: "solid"; color: string }
    | { kind: "image"; path: string }
    | { kind: "blur" };

export interface CameraStyle {
    shape: "circle" | "rounded";
    size: number; // fraction of the short side of the output
    corner: Corner;
    blurBackground: boolean;
    mirror: boolean;
}

export interface Style {
    aspect: Aspect;
    background: Background;
    padding: number; // fraction of the short side, 0..0.2
    radius: number; // px at 1080p
    shadow: number; // 0..1
    motionBlur: boolean;
    defaultLayout: LayoutMode;
    camera: CameraStyle;
    showCaptions: boolean;
    /** Track toggles (the eye/speaker on a track header): off in preview and export. */
    hideZooms?: boolean;
    muteAudio?: boolean;
}

export interface Project {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    duration: number;
    sources: SourceFile[];
    events: RecordingEvent[];
    timeline: Timeline;
    style: Style;
    thumbnail?: string; // file store path to a JPEG
}

export const ASPECTS: Record<Aspect, number> = {
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "1:1": 1,
    "4:5": 4 / 5,
};

export function defaultStyle(layout: LayoutMode = "bubble"): Style {
    return {
        aspect: "16:9",
        background: { kind: "preset", id: "sunset" },
        padding: 0.07,
        radius: 16,
        shadow: 0.6,
        motionBlur: true,
        defaultLayout: layout,
        camera: { shape: "circle", size: 0.24, corner: "br", blurBackground: false, mirror: true },
        showCaptions: true,
    };
}

const LOOK_KEY = "qs.look";
type Look = Pick<Style, "background" | "padding" | "radius" | "shadow" | "motionBlur" | "camera">;

/** The look new recordings start with: the user's saved look, else Quicksnap's. */
export function startingStyle(layout: LayoutMode = "bubble"): Style {
    const base = defaultStyle(layout);
    try {
        const saved = JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null") as Partial<Look> | null;
        if (saved) return { ...base, ...saved, camera: { ...base.camera, ...saved.camera } };
    } catch {
        /* storage unavailable or corrupt: use the default */
    }
    return base;
}

export function saveLook(style: Style) {
    // Uploaded images belong to one project, so they can't carry over.
    const background = style.background.kind === "image" ? defaultStyle().background : style.background;
    const look: Look = { background, padding: style.padding, radius: style.radius, shadow: style.shadow, motionBlur: style.motionBlur, camera: style.camera };
    try {
        localStorage.setItem(LOOK_KEY, JSON.stringify(look));
    } catch {
        /* storage unavailable */
    }
}

export function resetLook() {
    try {
        localStorage.removeItem(LOOK_KEY);
    } catch {
        /* storage unavailable */
    }
}

export function uid(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
