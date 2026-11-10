import type { CSSProperties } from "preact";
import { LOGO_DOT, LOGO_Q } from "./logo-paths";

/** The logo's pixel runs as rects ("M5 0h6v1h-6z" → x5 y0 w6), so each row can animate on its own. */
const RUNS = [...LOGO_Q.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3] }));

/**
 * Full-area loading state: the pixel Q scans top to bottom like a frame being drawn
 * while the record dot breathes. Fades in after a beat so fast loads never flash it.
 */
export function Loader({ label, size = 48 }: { label?: string; size?: number }) {
    return (
        <div class="loader anim-delayed" role="status" aria-live="polite">
            <svg class="loader-mark" width={size} height={size} viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
                {RUNS.map((r) => (
                    <rect x={r.x} y={r.y} width={r.w} height={1} fill="currentColor" style={{ "--y": r.y } as CSSProperties} />
                ))}
                <path class="dot" d={LOGO_DOT} fill="var(--record)" />
            </svg>
            {label && <span class="dots">{label}</span>}
        </div>
    );
}

/** A shimmering placeholder block. Size it with class or style. */
export function Skeleton({ class: cls = "", style }: { class?: string; style?: CSSProperties }) {
    return <span class={`skeleton ${cls}`} style={style} aria-hidden="true" />;
}

/** Style helper for `.stagger` children: `<li style={staggerIndex(i)}>`. */
export const staggerIndex = (i: number) => ({ "--i": i }) as CSSProperties;
