import type { Easing } from "../lib/types";

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Damped spring settling at 1 with a small (~5%) overshoot. */
export const spring = (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(t * Math.PI * 1.8));

export function ease(kind: Easing, t: number): number {
    t = clamp01(t);
    if (kind === "instant") return t > 0 ? 1 : 0;
    if (kind === "spring") return spring(t);
    return easeInOutCubic(t);
}
