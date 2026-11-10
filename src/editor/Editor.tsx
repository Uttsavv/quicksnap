import { useEffect, useRef, useState } from "preact/hooks";
import { href } from "../app/router";
import { ExportDialog } from "../export/ExportDialog";
import { clipAt, formatTime, outputDuration, skipCut, sourceToOutput } from "../lib/timeline";
import { canvasToScreen, layoutAt, outputSize, zoomAt } from "../render/compositor";
import { projects } from "../storage/db";
import { errorText, Segmented, toast } from "../ui/controls";
import { Icon } from "../ui/icons";
import { LogoMark } from "../ui/Logo";
import * as A from "./actions";
import { Inspector, tab } from "./Inspector";
import { Player } from "./player";
import * as St from "./store";
import { Timeline } from "./Timeline";

const PREVIEW_SHORT = 720;

function isTyping(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    return el.tagName === "INPUT" && !["checkbox", "range", "radio"].includes((el as HTMLInputElement).type);
}

export function Editor({ id }: { id: string }) {
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const playerRef = useRef<Player | null>(null);
    const [tlHeight, setTlHeight] = useState(() => {
        const v = Number(localStorage.getItem("qs.tlHeight"));
        return v >= 160 ? v : 300;
    });
    const [dragging, setDragging] = useState(false);
    const startResize = (e: PointerEvent) => {
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        const y0 = e.clientY;
        const h0 = tlHeight;
        let h = h0;
        const move = (ev: PointerEvent) => {
            h = Math.round(Math.min(window.innerHeight * 0.7, Math.max(160, h0 - (ev.clientY - y0))));
            setTlHeight(h);
        };
        const up = () => {
            el.removeEventListener("pointermove", move as EventListener);
            el.removeEventListener("pointerup", up);
            setDragging(false);
            try {
                localStorage.setItem("qs.tlHeight", String(h));
            } catch {
                /* storage unavailable */
            }
        };
        el.addEventListener("pointermove", move as EventListener);
        el.addEventListener("pointerup", up);
    };
    const canvas = useRef<HTMLCanvasElement>(null);

    // Load the project and its media.
    useEffect(() => {
        let disposed = false;
        (async () => {
            const p = await projects.get(id);
            if (!p) throw new Error("This recording doesn't exist in this browser.");
            St.load(p);
            const player = new Player(
                () => St.project.value,
                (src) => (St.playhead.value = src),
                () => (St.playing.value = false),
            );
            await player.load(p);
            if (disposed) return player.dispose();
            playerRef.current = player;
            if (p.style.background.kind === "image") await player.setBackgroundImage(p.style.background.path);
            if (p.style.camera.blurBackground) void player.setCameraBlur(true);
            setReady(true);
            void A.loadLevels();
        })().catch((e) => setError(errorText(e)));
        return () => {
            disposed = true;
            playerRef.current?.dispose();
            playerRef.current = null;
            void St.flushSave();
            St.project.value = null;
        };
    }, [id]);

    const p = St.project.value;
    const player = playerRef.current;

    // Redraw whenever the edit changes while paused.
    useEffect(() => {
        if (player && !St.playing.value) player.draw();
    }, [p, player]);

    // Attach the canvas (size follows the aspect ratio).
    const [cw, ch] = p ? outputSize(p.style.aspect, PREVIEW_SHORT) : [1280, 720];
    useEffect(() => {
        if (player && canvas.current) player.attach(canvas.current);
    }, [player, cw, ch, ready]);

    const togglePlay = async () => {
        if (!player) return;
        if (St.playing.value) {
            player.pause();
            St.playing.value = false;
        } else {
            St.playing.value = true;
            await player.play();
        }
    };

    const seekTo = (src: number) => {
        St.playhead.value = Math.max(0, Math.min(src, St.project.value?.duration ?? 0));
        void player?.seek(St.playhead.value);
    };

    // Keyboard shortcuts.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (exporting || isTyping(e) || !St.project.value) return;
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === "z") {
                e.preventDefault();
                if (e.shiftKey) St.redo();
                else St.undo();
                return;
            }
            if (mod && e.key.toLowerCase() === "y") {
                e.preventDefault();
                St.redo();
                return;
            }
            if (mod || e.altKey) return;
            const step = e.shiftKey ? 1 : 1 / 30;
            switch (e.key) {
                case " ":
                    e.preventDefault();
                    void togglePlay();
                    break;
                case "s":
                case "S":
                    A.split();
                    break;
                case "Backspace":
                case "Delete":
                    e.preventDefault();
                    if (St.selection.value) A.deleteSelection();
                    else A.toggleClipAtPlayhead();
                    break;
                case "z":
                case "Z":
                    A.addZoom();
                    tab.value = "zoom";
                    break;
                case "l":
                case "L":
                    if (St.project.value.sources.some((s) => s.kind === "camera")) {
                        A.addLayout();
                        tab.value = "camera";
                    }
                    break;
                case "m":
                case "M":
                    A.addMarker();
                    break;
                case "ArrowLeft":
                    e.preventDefault();
                    seekTo(St.playhead.value - step);
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    seekTo(St.playhead.value + step);
                    break;
                case "Home":
                    seekTo(0);
                    break;
                case "End":
                    seekTo(St.project.value.duration);
                    break;
                case "Escape":
                    St.selection.value = null;
                    break;
            }
        };
        addEventListener("keydown", onKey);
        return () => removeEventListener("keydown", onKey);
    }, [player, exporting]);

    // Selecting something opens the relevant inspector tab.
    const sel = St.selection.value;
    useEffect(() => {
        if (sel?.kind === "zoom") tab.value = "zoom";
        else if (sel?.kind === "layout") tab.value = "camera";
        else if (sel?.kind === "caption") tab.value = "captions";
    }, [sel?.kind, sel?.id]);

    if (error)
        return (
            <div class="empty">
                <p>{error}</p>
                <a class="btn" href={href({ name: "library" })}>
                    Back to library
                </a>
            </div>
        );
    if (!p || !ready || !player) return <div class="empty">Opening recording…</div>;

    const outDur = outputDuration(p.timeline.clips);
    const outNow = sourceToOutput(p.timeline.clips, St.playhead.value);
    const cutTotal = p.duration - p.timeline.clips.filter((c) => c.enabled).reduce((n, c) => n + c.end - c.start, 0);
    const inCut = !clipAt(p.timeline.clips, St.playhead.value)?.enabled;
    const selZoom = sel?.kind === "zoom" ? p.timeline.zooms.find((z) => z.id === sel.id) : undefined;

    const onPreviewClick = (e: MouseEvent) => {
        // Clicking the preview sets the focus point of the selected zoom.
        if (!selZoom || !player.screen || !canvas.current) return;
        const c = canvas.current;
        const r = c.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * c.width;
        const py = ((e.clientY - r.top) / r.height) * c.height;
        const t = St.playhead.value;
        // Measure in the unzoomed frame when the playhead is outside the zoom.
        const zoom = t >= selZoom.start && t <= selZoom.end ? zoomAt(p.timeline.zooms, t) : { scale: 1, focus: [0.5, 0.5] as [number, number] };
        const pt = canvasToScreen(
            px,
            py,
            c.width,
            c.height,
            p.style,
            [player.screen.videoWidth, player.screen.videoHeight],
            !!player.camera,
            layoutAt(p.timeline.layouts, p.style.defaultLayout, t),
            zoom,
        );
        if (!pt) return;
        St.setTimeline((tl) => ({ zooms: tl.zooms.map((z) => (z.id === selZoom.id ? { ...z, focus: pt, suggested: false } : z)) }));
    };

    const stepFrame = (dir: number) => seekTo(St.playhead.value + dir / 30);

    return (
        <>
            <header class="appbar">
                <div class="row" style={{ gap: "12px", minWidth: 0 }}>
                    <a class="btn icon ghost" href={href({ name: "library" })} aria-label="Back to library" title="Library">
                        <Icon name="back" />
                    </a>
                    <a class="logo" href="#/" aria-label="Quicksnap Studio" title="Studio">
                        <LogoMark />
                    </a>
                    <div style={{ minWidth: 0 }}>
                        {editingName ? (
                            <input
                                type="text"
                                aria-label="Recording name"
                                value={p.name}
                                style={{ width: "280px" }}
                                ref={(el) => el?.focus()}
                                onBlur={(e) => {
                                    const v = (e.target as HTMLInputElement).value.trim();
                                    if (v && v !== p.name) St.commit(() => ({ name: v }));
                                    setEditingName(false);
                                }}
                                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                            />
                        ) : (
                            <button type="button" class="btn ghost" style={{ height: "auto", padding: "0 4px", fontWeight: 600, fontSize: "13.5px" }} onClick={() => setEditingName(true)} title="Rename">
                                {p.name}
                            </button>
                        )}
                        <div class="small muted" style={{ paddingLeft: "4px" }}>
                            {St.saveState.value === "saving" ? "Saving…" : St.saveState.value === "error" ? "Couldn't save" : "Saved on this device"}
                        </div>
                    </div>
                </div>
                <div class="row">
                    <button class="btn icon" type="button" aria-label="Undo" title="Undo (⌘Z)" disabled={!St.canUndo.value} onClick={St.undo}>
                        <Icon name="undo" />
                    </button>
                    <button class="btn icon" type="button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!St.canRedo.value} onClick={St.redo}>
                        <Icon name="redo" />
                    </button>
                    <button
                        class="btn primary"
                        type="button"
                        onClick={() => {
                            player.pause();
                            St.playing.value = false;
                            setExporting(true);
                        }}
                    >
                        <Icon name="download" /> Export
                    </button>
                </div>
            </header>

            <div class="editor" style={{ "--tl-h": `${tlHeight}px` }}>
                <section class="panel viewer" aria-label="Program monitor">
                    <div class="viewer-stage">
                        <canvas
                            ref={canvas}
                            width={cw}
                            height={ch}
                            onClick={onPreviewClick}
                            style={{ cursor: selZoom ? "crosshair" : "default", aspectRatio: `${cw} / ${ch}` }}
                            aria-label={selZoom ? "Preview. Click to set the zoom focus point." : "Preview"}
                        />
                    </div>
                    <div class="transport">
                        <div class="row">
                            <span class="timecode">
                                {formatTime(outNow, true)}
                                <span class="of"> / {formatTime(outDur, true)}</span>
                            </span>
                            {cutTotal > 0.05 && <span class="small muted">{cutTotal.toFixed(1)} s cut</span>}
                            {inCut && !St.playing.value && (
                                <button
                                    class="btn"
                                    type="button"
                                    onClick={() => {
                                        const next = skipCut(p.timeline.clips, St.playhead.value);
                                        if (next != null) seekTo(next);
                                    }}
                                >
                                    In a cut · skip
                                </button>
                            )}
                        </div>
                        <div class="row" style={{ gap: "4px" }}>
                            <button class="btn icon ghost" type="button" aria-label="Go to start" title="Start (Home)" onClick={() => seekTo(0)}>
                                <Icon name="start" size={14} />
                            </button>
                            <button class="btn icon ghost" type="button" aria-label="Back one frame" title="Back one frame (←)" onClick={() => stepFrame(-1)}>
                                <Icon name="stepBack" size={14} />
                            </button>
                            <button class="btn icon play" type="button" aria-label={St.playing.value ? "Pause" : "Play"} title="Play/pause (Space)" onClick={() => void togglePlay()}>
                                <Icon name={St.playing.value ? "pause" : "play"} size={14} />
                            </button>
                            <button class="btn icon ghost" type="button" aria-label="Forward one frame" title="Forward one frame (→)" onClick={() => stepFrame(1)}>
                                <Icon name="stepFwd" size={14} />
                            </button>
                            <button class="btn icon ghost" type="button" aria-label="Go to end" title="End (End)" onClick={() => seekTo(p.duration)}>
                                <Icon name="end" size={14} />
                            </button>
                        </div>
                        <Segmented
                            label="Aspect ratio"
                            value={p.style.aspect}
                            options={(["16:9", "9:16", "1:1", "4:5"] as const).map((a) => ({ value: a, label: a }))}
                            onChange={(a) => St.setStyle(() => ({ aspect: a }))}
                        />
                    </div>
                </section>

                <Inspector player={player} />

                <section class="panel timeline" aria-label="Timeline">
                    <div
                        class={`splitter${dragging ? " active" : ""}`}
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="Resize timeline"
                        onPointerDown={startResize}
                    />
                    <Timeline player={player} />
                </section>
            </div>

            {exporting && <ExportDialog onClose={() => setExporting(false)} />}
        </>
    );
}

// Surface unexpected errors from async handlers.
addEventListener("unhandledrejection", (e) => {
    const msg = errorText(e.reason);
    if (msg && !/abort/i.test(msg)) toast(msg, "error");
});
