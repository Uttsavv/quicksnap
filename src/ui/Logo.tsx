import { LOGO_DOT, LOGO_Q } from "./logo-paths";

/** The favicon's pixel-art Q with its red record square, drawn crisp at any size. */
export function LogoMark({ size = 22 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
            <path d={LOGO_Q} fill="currentColor" />
            <path class="logo-dot" d={LOGO_DOT} fill="#ff1900" />
        </svg>
    );
}

export function Logo({ href = "#/" }: { href?: string }) {
    return (
        <a class="logo" href={href} aria-label="Quicksnap home">
            <LogoMark />
            Quicksnap
        </a>
    );
}
