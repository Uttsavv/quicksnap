import type { SVGAttributes } from "preact";

const PATHS = {
    screen: "M3 4h18v12H3z M8 20h8 M12 16v4",
    camera: "M3 7h12v10H3z M15 10l6-3v10l-6-3",
    mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3",
    speaker: "M11 5 6 9H2v6h4l5 4z M15.5 8.5a5 5 0 0 1 0 7",
    mute: "M11 5 6 9H2v6h4l5 4z M22 9l-6 6 M16 9l6 6",
    play: "M7 4.5v15l13-7.5z",
    pause: "M6 5h4v14H6z M14 5h4v14h-4z",
    stop: "M6 6h12v12H6z",
    back: "m15 18-6-6 6-6",
    undo: "M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
    redo: "m15 14 5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3",
    download: "M12 3v12 m-5-5 5 5 5-5 M5 21h14",
    scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M20 4 8.1 15.9 M14.5 14.5 20 20 M8.1 8.1 12 12",
    trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6",
    zoom: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-5-5 M11 8v6 M8 11h6",
    flag: "M5 21V4h11l-2 4 2 4H5",
    sparkle: "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8",
    pip: "M3 4h18v14H3z M12 11h7v5h-7z",
    replay: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 2",
    lock: "M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4",
    disk: "M4 5c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3z M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    plus: "M12 5v14 M5 12h14",
    close: "M6 6l12 12 M18 6 6 18",
    speed: "M12 14l4-4 M4 18a9 9 0 1 1 16 0",
    captions: "M3 5h18v14H3z M7 13h3 M14 13h3 M7 9h10",
    wave: "M3 12h2 M7 8v8 M11 5v14 M15 9v6 M19 11v2",
    edit: "M4 20h4L19 9l-4-4L4 16z",
    rename: "M4 7V5h16v2 M12 5v14 M9 19h6",
    start: "M6 5v14 M19 5 9 12l10 7z",
    end: "M18 5v14 M5 5l10 7-10 7z",
    stepBack: "M17 6 9 12l8 6z M7 6v12",
    stepFwd: "M7 6l8 6-8 6z M17 6v12",
    style: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.9-.7-1.3-.7-2.2 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4c0-4.7-4-8.7-9-8.7z M7.5 11.5h.01 M10.5 7.5h.01 M15.5 8.5h.01",
    clip: "M3 6h18v12H3z M8 6v12 M16 6v12",
    image: "M3 5h18v14H3z M8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M21 16l-5-5-9 8",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & Omit<SVGAttributes<SVGSVGElement>, "name">) {
    const filled = name === "play" || name === "pause" || name === "stop" || name === "start" || name === "end" || name === "stepBack" || name === "stepFwd";
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? "currentColor" : "none"}
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            {...rest}
        >
            <path d={PATHS[name]} />
        </svg>
    );
}
