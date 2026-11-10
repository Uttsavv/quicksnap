// The one renderer. The Studio preview, the Editor preview and the exporter
// all call `renderFrame`, so what you see is exactly what you export.

import { ASPECTS, type Aspect, type Caption, type LayoutMode, type LayoutSegment, type Style, type ZoomSegment } from "../lib/types";
import { BACKGROUND_PRESETS, fillGradient } from "./backgrounds";
import { clamp01, ease, easeInOutCubic, lerp } from "./easing";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface FrameInputs {
    screen?: CanvasImageSource | null;
    screenSize?: [number, number];
    camera?: CanvasImageSource | null;
    cameraSize?: [number, number];
    backgroundImage?: CanvasImageSource | null;
    backgroundImageSize?: [number, number];
}

export interface ZoomState {
    scale: number;
    focus: [number, number];
}

export interface FrameState {
    layoutFrom: LayoutMode;
    layoutTo: LayoutMode;
    layoutP: number;
    zoom: ZoomState;
    /** Zoom a moment earlier, for motion blur. */
    zoomPrev?: ZoomState;
    caption?: string;
}

interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
    a: number; // opacity
}

const LAYOUT_TRANSITION = 0.45;
const ZOOM_IN = 0.8;
const ZOOM_OUT = 0.65;

export function outputSize(aspect: Aspect, height: number): [number, number] {
    const r = ASPECTS[aspect];
    // Keep the short side at `height` so 9:16 at "1080p" is 1080×1920.
    const even = (n: number) => Math.round(n / 2) * 2;
    return r >= 1 ? [even(height * r), even(height)] : [even(height), even(height / r)];
}

// ── State at a source time ──────────────────────────────────────────────────

export function layoutAt(layouts: LayoutSegment[], fallback: LayoutMode, t: number): LayoutMode {
    for (const l of layouts) if (t >= l.start && t < l.end) return l.mode;
    return fallback;
}

export function zoomAt(zooms: ZoomSegment[], t: number): ZoomState {
    let best: ZoomState = { scale: 1, focus: [0.5, 0.5] };
    let bestAmount = 0;
    for (const z of zooms) {
        if (z.suggested) continue;
        if (t < z.start || t > z.end) continue;
        const len = z.end - z.start;
        const inDur = Math.min(ZOOM_IN, len / 2);
        const outDur = Math.min(ZOOM_OUT, len / 2);
        let a: number;
        if (z.easing === "instant") a = 1;
        else if (t < z.start + inDur) a = ease(z.easing, (t - z.start) / inDur);
        else if (t > z.end - outDur) a = 1 - easeInOutCubic((t - (z.end - outDur)) / outDur);
        else a = 1;
        if (a > bestAmount) {
            bestAmount = a;
            // Pan from the centre so zooming in feels like moving toward the focus.
            best = {
                scale: 1 + (z.scale - 1) * a,
                focus: [lerp(0.5, z.focus[0], clamp01(a)), lerp(0.5, z.focus[1], clamp01(a))],
            };
        }
    }
    return best;
}

export function stateAt(
    t: number,
    opts: { layouts: LayoutSegment[]; zooms: ZoomSegment[]; captions: Caption[]; style: Style },
): FrameState {
    const { layouts, zooms, captions, style } = opts;
    const to = layoutAt(layouts, style.defaultLayout, t);
    let from = to;
    let p = 1;
    // Find the most recent layout change and blend across it.
    const edges: number[] = [];
    for (const l of layouts) edges.push(l.start, l.end);
    for (const e of edges) {
        if (t >= e && t - e < LAYOUT_TRANSITION) {
            const before = layoutAt(layouts, style.defaultLayout, e - 1e-3);
            if (before !== to) {
                from = before;
                p = easeInOutCubic((t - e) / LAYOUT_TRANSITION);
            }
        }
    }
    let caption: string | undefined;
    if (style.showCaptions) for (const c of captions) if (t >= c.start && t < c.end) caption = c.text;
    return {
        layoutFrom: from,
        layoutTo: to,
        layoutP: p,
        zoom: zoomAt(zooms, t),
        zoomPrev: style.motionBlur ? zoomAt(zooms, t - 1 / 30) : undefined,
        caption,
    };
}

// ── Layout geometry ─────────────────────────────────────────────────────────

function fit(aw: number, ah: number, box: { x: number; y: number; w: number; h: number }) {
    const s = Math.min(box.w / aw, box.h / ah);
    const w = aw * s;
    const h = ah * s;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function boxesFor(mode: LayoutMode, W: number, H: number, style: Style, screenAR: number, hasCamera: boolean) {
    const short = Math.min(W, H);
    const k = short / 1080;
    const pad = style.padding * short;
    const area = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad };
    const radius = style.radius * k;
    const camSize = style.camera.size * short;
    const margin = Math.max(pad * 0.5, short * 0.03);
    const camRadius = style.camera.shape === "circle" ? camSize / 2 : camSize * 0.18;
    const corner = style.camera.corner;
    const bubble: Box = {
        x: corner.endsWith("l") ? margin : W - margin - camSize,
        y: corner.startsWith("t") ? margin : H - margin - camSize,
        w: camSize,
        h: camSize,
        r: camRadius,
        a: 1,
    };
    const screenFull = { ...fit(screenAR, 1, area), r: radius, a: 1 };
    const hidden = (b: Box): Box => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, w: 0, h: 0, r: 0, a: 0 });

    let screen: Box = screenFull;
    let camera: Box = hidden(bubble);

    if (mode === "bubble") camera = bubble;
    else if (mode === "side") {
        const gap = Math.max(pad * 0.5, short * 0.02);
        if (W >= H) {
            const camW = area.w * 0.3;
            screen = { ...fit(screenAR, 1, { ...area, w: area.w - camW - gap }), r: radius, a: 1 };
            const camH = Math.min(area.h, camW * 1.25);
            camera = { x: area.x + area.w - camW, y: area.y + (area.h - camH) / 2, w: camW, h: camH, r: radius, a: 1 };
        } else {
            const camH = area.h * 0.4;
            screen = { ...fit(screenAR, 1, { ...area, h: area.h - camH - gap }), r: radius, a: 1 };
            camera = { x: area.x, y: area.y + area.h - camH, w: area.w, h: camH, r: radius, a: 1 };
        }
    } else if (mode === "camera") {
        screen = { ...hidden(screenFull), r: radius };
        camera = { ...area, r: radius, a: 1 };
    }
    if (!hasCamera) {
        camera = hidden(bubble);
        if (mode === "side" || mode === "camera") screen = screenFull;
    }
    return { screen, camera };
}

const lerpBox = (a: Box, b: Box, t: number): Box => ({
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
    r: lerp(a.r, b.r, t),
    a: lerp(a.a, b.a, t),
});

// ── Drawing ─────────────────────────────────────────────────────────────────

let blurCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
function smallCanvas(): OffscreenCanvas | HTMLCanvasElement {
    if (!blurCanvas) {
        blurCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(48, 27) : document.createElement("canvas");
        blurCanvas.width = 48;
        blurCanvas.height = 27;
    }
    return blurCanvas;
}

function drawCover(ctx: Ctx, img: CanvasImageSource, iw: number, ih: number, x: number, y: number, w: number, h: number, mirror = false) {
    const s = Math.max(w / iw, h / ih);
    const sw = w / s;
    const sh = h / s;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    if (mirror) {
        ctx.save();
        ctx.translate(x + w, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        ctx.restore();
    } else ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawBackground(ctx: Ctx, W: number, H: number, style: Style, inputs: FrameInputs) {
    const bg = style.background;
    if (bg.kind === "solid") {
        ctx.fillStyle = bg.color;
        ctx.fillRect(0, 0, W, H);
    } else if (bg.kind === "image" && inputs.backgroundImage && inputs.backgroundImageSize) {
        const [iw, ih] = inputs.backgroundImageSize;
        drawCover(ctx, inputs.backgroundImage, iw, ih, 0, 0, W, H);
    } else if (bg.kind === "blur" && inputs.screen && inputs.screenSize) {
        // Cheap blur: downscale to a tiny canvas, then scale back up smoothly.
        const small = smallCanvas();
        const sctx = small.getContext("2d") as Ctx;
        sctx.drawImage(inputs.screen, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(small, 0, 0, W, H);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(0, 0, W, H);
    } else {
        const id = bg.kind === "preset" ? bg.id : "sunset";
        const p = BACKGROUND_PRESETS.find((x) => x.id === id) ?? BACKGROUND_PRESETS[0];
        fillGradient(ctx, p, W, H);
    }
}

function shadowed(ctx: Ctx, b: Box, shadow: number, k: number, draw: () => void) {
    if (b.a <= 0.001 || b.w < 1 || b.h < 1) return;
    ctx.save();
    ctx.globalAlpha = b.a;
    if (shadow > 0) {
        ctx.save();
        ctx.shadowColor = `rgba(0,0,0,${0.55 * shadow})`;
        ctx.shadowBlur = 70 * shadow * k;
        ctx.shadowOffsetY = 24 * shadow * k;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(b.r, b.w / 2, b.h / 2));
        ctx.fill();
        ctx.restore();
    }
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(b.r, b.w / 2, b.h / 2));
    ctx.clip();
    draw();
    ctx.restore();
}

function zoomCrop(z: ZoomState, sw: number, sh: number) {
    const cw = sw / z.scale;
    const ch = sh / z.scale;
    const cx = Math.min(Math.max(z.focus[0] * sw, cw / 2), sw - cw / 2);
    const cy = Math.min(Math.max(z.focus[1] * sh, ch / 2), sh - ch / 2);
    return { sx: cx - cw / 2, sy: cy - ch / 2, sw: cw, sh: ch };
}

function drawCaption(ctx: Ctx, W: number, H: number, text: string) {
    const short = Math.min(W, H);
    const size = Math.round(short * 0.042);
    ctx.save();
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxW = W * 0.82;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) {
            lines.push(line);
            line = w;
        } else line = test;
    }
    if (line) lines.push(line);
    const shown = lines.slice(-2);
    const lh = size * 1.3;
    const boxW = Math.max(...shown.map((l) => ctx.measureText(l).width)) + size * 1.2;
    const boxH = shown.length * lh + size * 0.6;
    const y = H - short * 0.06 - boxH;
    ctx.fillStyle = "rgba(10,10,12,0.72)";
    ctx.beginPath();
    ctx.roundRect(W / 2 - boxW / 2, y, boxW, boxH, size * 0.4);
    ctx.fill();
    ctx.fillStyle = "#fff";
    shown.forEach((l, i) => ctx.fillText(l, W / 2, y + size * 0.3 + lh * (i + 0.5)));
    ctx.restore();
}

export function renderFrame(ctx: Ctx, W: number, H: number, style: Style, inputs: FrameInputs, state: FrameState) {
    const k = Math.min(W, H) / 1080;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx, W, H, style, inputs);

    const [sw, sh] = inputs.screenSize ?? [16, 9];
    const hasCamera = !!inputs.camera;
    const hasScreen = !!inputs.screen;
    const fromMode = !hasScreen && hasCamera ? "camera" : state.layoutFrom;
    const toMode = !hasScreen && hasCamera ? "camera" : state.layoutTo;
    const a = boxesFor(fromMode, W, H, style, sw / sh, hasCamera);
    const b = boxesFor(toMode, W, H, style, sw / sh, hasCamera);
    const screenBox = lerpBox(a.screen, b.screen, state.layoutP);
    const camBox = lerpBox(a.camera, b.camera, state.layoutP);

    if (inputs.screen) {
        const screen = inputs.screen;
        shadowed(ctx, screenBox, style.shadow, k, () => {
            ctx.imageSmoothingQuality = "high";
            const z = state.zoom;
            const prev = state.zoomPrev;
            const moving = prev && (Math.abs(prev.scale - z.scale) > 0.004 || Math.abs(prev.focus[0] - z.focus[0]) > 0.002);
            if (moving && prev) {
                // Motion blur: average a few sub-frames between the previous and current zoom.
                const n = 4;
                for (let i = 0; i < n; i++) {
                    const t = (i + 1) / n;
                    const zz: ZoomState = {
                        scale: lerp(prev.scale, z.scale, t),
                        focus: [lerp(prev.focus[0], z.focus[0], t), lerp(prev.focus[1], z.focus[1], t)],
                    };
                    const c = zoomCrop(zz, sw, sh);
                    ctx.globalAlpha = screenBox.a * (i === 0 ? 1 : 1 / (i + 1));
                    ctx.drawImage(screen, c.sx, c.sy, c.sw, c.sh, screenBox.x, screenBox.y, screenBox.w, screenBox.h);
                }
            } else {
                const c = zoomCrop(z, sw, sh);
                ctx.drawImage(screen, c.sx, c.sy, c.sw, c.sh, screenBox.x, screenBox.y, screenBox.w, screenBox.h);
            }
        });
    }

    if (inputs.camera && inputs.cameraSize) {
        const cam = inputs.camera;
        const [cw, ch] = inputs.cameraSize;
        shadowed(ctx, camBox, style.shadow * 0.8, k, () => {
            drawCover(ctx, cam, cw, ch, camBox.x, camBox.y, camBox.w, camBox.h, style.camera.mirror);
        });
    }

    if (state.caption) drawCaption(ctx, W, H, state.caption);
    ctx.restore();
}

/**
 * Map a point on the output canvas (px) to a position on the raw screen
 * (0..1), accounting for layout and the current zoom. Null if it misses.
 */
export function canvasToScreen(
    px: number,
    py: number,
    W: number,
    H: number,
    style: Style,
    screenSize: [number, number],
    hasCamera: boolean,
    mode: LayoutMode,
    zoom: ZoomState,
): [number, number] | null {
    const [sw, sh] = screenSize;
    const box = boxesFor(mode, W, H, style, sw / sh, hasCamera).screen;
    if (box.a < 0.5) return null;
    const u = (px - box.x) / box.w;
    const v = (py - box.y) / box.h;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const c = zoomCrop(zoom, sw, sh);
    return [(c.sx + u * c.sw) / sw, (c.sy + v * c.sh) / sh];
}

/** Convenience for the time a zoom takes to settle, used by the timeline UI. */
export const ZOOM_TIMING = { in: ZOOM_IN, out: ZOOM_OUT, layout: LAYOUT_TRANSITION };
