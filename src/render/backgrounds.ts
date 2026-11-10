export interface BackgroundPreset {
    id: string;
    name: string;
    stops: string[];
    angle: number; // degrees, CSS convention
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
    { id: "sunset", name: "Sunset", stops: ["#F7A76C", "#E2557B", "#5B47C9"], angle: 140 },
    { id: "ocean", name: "Ocean", stops: ["#3FC1C9", "#2B5FD9"], angle: 140 },
    { id: "forest", name: "Forest", stops: ["#9BD67A", "#1F7A5A"], angle: 140 },
    { id: "dusk", name: "Dusk", stops: ["#2B2F77", "#141852"], angle: 140 },
    { id: "sand", name: "Sand", stops: ["#F3E3C3", "#D9B48F"], angle: 140 },
    { id: "candy", name: "Candy", stops: ["#FBC2EB", "#A6C1EE"], angle: 135 },
    { id: "ember", name: "Ember", stops: ["#F83600", "#F9D423"], angle: 135 },
    { id: "graphite", name: "Graphite", stops: ["#3A3F4A", "#1C1F26"], angle: 160 },
];

export const SOLID_COLORS = ["#2A2E37", "#F2F1EC", "#0B0C0F", "#FFFFFF"];

export function presetCss(p: BackgroundPreset) {
    return `linear-gradient(${p.angle}deg, ${p.stops.join(", ")})`;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function fillGradient(ctx: Ctx, p: BackgroundPreset, w: number, h: number) {
    // CSS angle: 0deg points up, increasing clockwise.
    const a = ((p.angle - 90) * Math.PI) / 180;
    const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
    const cx = w / 2;
    const cy = h / 2;
    const dx = (Math.cos(a) * len) / 2;
    const dy = (Math.sin(a) * len) / 2;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    p.stops.forEach((s, i) => g.addColorStop(i / (p.stops.length - 1), s));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
}
