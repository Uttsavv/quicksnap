// Floating controls in a Document Picture-in-Picture window: stays on top of
// other apps while recording, and receives hotkeys when Quicksnap isn't focused.

import { signal } from "@preact/signals";
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { formatClock } from "../lib/timeline";
import type { LayoutMode } from "../lib/types";
import { Icon } from "../ui/icons";
import {
    addMarker,
    cameraStream,
    elapsed,
    recState,
    scene,
    setScene,
    startRecording,
    stopRecording,
    togglePause,
} from "./state";

export const pipOpen = signal(false);
export const pipSupported = () => "documentPictureInPicture" in window;

const SCENES: [LayoutMode, string][] = [
    ["screen", "1"],
    ["bubble", "2"],
    ["side", "3"],
    ["camera", "4"],
];

function PipControls() {
    const video = useRef<HTMLVideoElement>(null);
    const cam = cameraStream.value;
    useEffect(() => {
        if (video.current) video.current.srcObject = cam;
    }, [cam]);
    const st = recState.value;
    const live = st === "recording" || st === "paused";
    return (
        <div class="pip">
            <div class="pip-cam">
                {cam ? <video ref={video} autoplay muted playsInline /> : <div class="monitor-empty small">Camera off</div>}
                {live && (
                    <span class="monitor-tag">
                        <span class={`rec-dot${st === "paused" ? " paused" : ""}`} />
                        {st === "paused" ? "Paused" : "REC"}
                    </span>
                )}
            </div>
            <div class="seg full" role="group" aria-label="Scene">
                {SCENES.map(([s, k]) => (
                    <button type="button" aria-pressed={scene.value === s} onClick={() => setScene(s)} title={s}>
                        {k}
                    </button>
                ))}
            </div>
            <div class="spread">
                <span class="clock" style={{ fontSize: "16px" }}>
                    {formatClock(elapsed.value)}
                </span>
                <div class="row">
                    {live ? (
                        <>
                            <button class="btn lg icon" type="button" aria-label="Add marker" onClick={addMarker}>
                                <Icon name="flag" />
                            </button>
                            <button class="btn lg icon" type="button" aria-label={st === "paused" ? "Resume" : "Pause"} onClick={togglePause}>
                                <Icon name={st === "paused" ? "play" : "pause"} />
                            </button>
                            <button class="btn lg record" type="button" onClick={() => void stopRecording()}>
                                <Icon name="stop" /> Stop
                            </button>
                        </>
                    ) : (
                        <button class="btn lg record" type="button" disabled={st !== "idle"} onClick={() => void startRecording()}>
                            {st === "countdown" ? "Starting…" : st === "finalizing" ? "Saving…" : "Record"}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

let pipWindow: Window | null = null;

export async function openPip(onKey: (e: KeyboardEvent) => void) {
    if (!window.documentPictureInPicture) return;
    if (pipWindow) {
        pipWindow.focus();
        return;
    }
    const w = await window.documentPictureInPicture.requestWindow({ width: 360, height: 300 });
    pipWindow = w;
    // Copy our styles into the PiP document.
    for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
        w.document.head.appendChild(node.cloneNode(true));
    }
    w.document.title = "Quicksnap controls";
    const root = w.document.createElement("div");
    w.document.body.appendChild(root);
    render(<PipControls />, root);
    w.addEventListener("keydown", onKey);
    w.addEventListener("pagehide", () => {
        render(null, root);
        pipWindow = null;
        pipOpen.value = false;
    });
    pipOpen.value = true;
}

export function closePip() {
    pipWindow?.close();
}
