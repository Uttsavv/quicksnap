import { useEffect, useRef } from "preact/hooks";
import { formatTimecode, moveBoundary, setClip, sourceToOutput, splitAt } from "../lib/timeline";
import type { Clip, Timeline as TL } from "../lib/types";
import { Segmented } from "../ui/controls";
import { Icon } from "../ui/icons";
import * as A from "./actions";
import { LEVEL_STEP } from "./analysis";
import type { Player } from "./player";
import { autoFit, begin, end, fitRequest, liveTimeline, playhead, project, pxPerSecond, selection, setTimeline } from "./store";

const LABEL_W = 112; // sticky track-header column
const PAD = 0;

type SegKey = "zooms" | "layouts" | "captions";
type SegKind = "zoom" | "layout" | "caption";

function useDrag() {
    return (e: PointerEvent, onMove: (dt: number) => void, onUp?: (moved: boolean) => void) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget as Element;
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        let moved = false;
        const move = (ev: PointerEvent) => {
            if (Math.abs(ev.clientX - x0) > 2) moved = true;
            if (moved) onMove((ev.clientX - x0) / pxPerSecond.value);
        };
        const up = () => {
            el.removeEventListener("pointermove", move as EventListener);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
            onUp?.(moved);
        };
        el.addEventListener("pointermove", move as EventListener);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
    };
}

function snapper(tl: TL, ignore: string) {
    const pts: number[] = [playhead.value];
    for (const c of tl.clips) pts.push(c.start, c.end);
    for (const z of [...tl.zooms, ...tl.layouts]) if (z.id !== ignore) pts.push(z.start, z.end);
    return (t: number) => {
        const tol = 6 / pxPerSecond.value;
        let best = t;
        let d = tol;
        for (const p of pts) if (Math.abs(p - t) < d) (d = Math.abs(p - t)), (best = p);
        return best;
    };
}

function tickStep(pps: number) {
    for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pps >= 70) return s;
    return 1200;
}

function Waveform({ width }: { width: number }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const lv = A.levels.value;
    const p = project.value!;
    const clips = p.timeline.clips;
    useEffect(() => {
        const c = ref.current;
        if (!c || !lv) return;
        const w = Math.min(Math.round(width), 16000);
        c.width = w;
        c.height = 80;
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, w, 80);
        const css = getComputedStyle(document.documentElement);
        const on = css.getPropertyValue("--wave").trim() || "#4fc27c";
        const off = css.getPropertyValue("--wave-off").trim() || "#4a4a4a";
        const perPx = p.duration / w;
        for (let x = 0; x < w; x++) {
            const t0 = x * perPx;
            const a = Math.floor(t0 / LEVEL_STEP);
            const b = Math.max(a + 1, Math.floor((t0 + perPx) / LEVEL_STEP));
            let m = 0;
            for (let i = a; i < b && i < lv.peak.length; i++) m = Math.max(m, lv.peak[i]);
            const h = Math.max(1, Math.min(1, m * 1.6) * 74);
            const clip = clips.find((cl) => t0 >= cl.start && t0 < cl.end);
            ctx.fillStyle = !clip || !clip.enabled || clip.speed !== 1 || clip.volume === 0 ? off : on;
            ctx.fillRect(x, 40 - h / 2, 1, h);
        }
    }, [lv, width, clips, p.duration]);
    if (!lv) return <span class="small muted" style={{ position: "absolute", left: "10px", top: "12px" }}>Analyzing audio…</span>;
    return <canvas ref={ref} class="tl-wave" aria-hidden="true" />;
}

function ClipLane() {
    const p = project.value!;
    const pps = pxPerSecond.value;
    const drag = useDrag();
    const clips = p.timeline.clips;
    const sel = selection.value;

    const dragBoundary = (e: PointerEvent, prepare: (cl: Clip[]) => { clips: Clip[]; i: number }) => {
        begin();
        const prepared = prepare(project.value!.timeline.clips);
        const base = prepared.clips[prepared.i].end;
        const snap = snapper(project.value!.timeline, "");
        drag(
            e,
            (dt) => liveTimeline(() => ({ clips: moveBoundary(prepared.clips, prepared.i, snap(base + dt)) })),
            () => end(),
        );
    };

    return (
        <div class="tl-lane tall" style={{ width: `${p.duration * pps}px` }}>
            {clips.map((c, i) => {
                const label = !c.enabled ? "cut" : [c.speed !== 1 ? `${c.speed}×` : "", c.volume === 0 ? "muted" : c.volume !== 1 ? `${Math.round(c.volume * 100)}%` : ""].filter(Boolean).join(" · ") || (i === 0 ? "Screen" : "");
                const isSel = sel?.kind === "clip" && sel.id === c.id;
                return (
                    <button
                        key={c.id}
                        type="button"
                        class={`tl-item clip${c.enabled ? "" : " cut"}${isSel ? " selected" : ""}`}
                        style={{ left: `${c.start * pps}px`, width: `${Math.max(2, (c.end - c.start) * pps - 1)}px` }}
                        onClick={(e) => {
                            e.stopPropagation();
                            selection.value = { kind: "clip", id: c.id };
                        }}
                        aria-label={`Clip ${i + 1}${c.enabled ? "" : " (cut)"}`}
                    >
                        {label}
                        {i === 0 && c.enabled && (
                            <span
                                class="tl-handle l"
                                title="Trim start"
                                onPointerDown={(e) =>
                                    dragBoundary(e, (cl) => {
                                        const first = cl[0];
                                        const at = Math.min(first.start + 0.2, first.end - 0.1);
                                        const s = splitAt(cl, at, 0.05);
                                        return { clips: s.length > cl.length ? setClip(s, s[0].id, { enabled: false }) : cl, i: 0 };
                                    })
                                }
                            />
                        )}
                        {(i < clips.length - 1 || c.enabled) && (
                            <span
                                class="tl-handle r"
                                title={i === clips.length - 1 ? "Trim end" : "Move edit point"}
                                onPointerDown={(e) =>
                                    dragBoundary(e, (cl) => {
                                        if (i < cl.length - 1) return { clips: cl, i };
                                        const last = cl[cl.length - 1];
                                        const s = splitAt(cl, Math.max(last.end - 0.2, last.start + 0.1), 0.05);
                                        if (s.length === cl.length) return { clips: cl, i: cl.length - 2 };
                                        return { clips: setClip(s, s[s.length - 1].id, { enabled: false }), i: s.length - 2 };
                                    })
                                }
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
}

function SegLane(props: { k: SegKey; kind: SegKind; cls: string; label: (s: TL[SegKey][number]) => string; onEmptyDouble?: (t: number) => void }) {
    const p = project.value!;
    const pps = pxPerSecond.value;
    const drag = useDrag();
    const items = p.timeline[props.k] as { id: string; start: number; end: number; suggested?: boolean }[];
    const sel = selection.value;

    const change = (id: string, s: number, e: number) =>
        liveTimeline((tl) => ({ [props.k]: (tl[props.k] as typeof items).map((x) => (x.id === id ? { ...x, start: s, end: e } : x)) }));

    const startDrag = (ev: PointerEvent, item: (typeof items)[number], mode: "move" | "l" | "r") => {
        selection.value = { kind: props.kind, id: item.id };
        begin();
        const snap = snapper(project.value!.timeline, item.id);
        const len = item.end - item.start;
        const dur = p.duration;
        drag(
            ev,
            (dt) => {
                if (mode === "move") {
                    let s = snap(Math.min(Math.max(0, item.start + dt), dur - len));
                    if (s + len > dur) s = dur - len;
                    change(item.id, s, s + len);
                } else if (mode === "l") change(item.id, Math.min(snap(Math.max(0, item.start + dt)), item.end - 0.3), item.end);
                else change(item.id, item.start, Math.max(snap(Math.min(dur, item.end + dt)), item.start + 0.3));
            },
            () => end(),
        );
    };

    return (
        <div
            class="tl-lane"
            style={{ width: `${p.duration * pps}px` }}
            onDblClick={(e) => {
                if (e.target !== e.currentTarget || !props.onEmptyDouble) return;
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                props.onEmptyDouble((e.clientX - r.left) / pps);
            }}
            title={props.onEmptyDouble ? "Double-click to add" : undefined}
        >
            {items.map((it) => {
                const isSel = sel?.kind === props.kind && sel.id === it.id;
                return (
                    <button
                        key={it.id}
                        type="button"
                        class={`tl-item ${props.cls}${it.suggested ? " suggested" : ""}${isSel ? " selected" : ""}`}
                        style={{ left: `${it.start * pps}px`, width: `${Math.max(6, (it.end - it.start) * pps)}px` }}
                        onPointerDown={(e) => startDrag(e, it, "move")}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={props.label(it as never)}
                    >
                        <span class="tl-handle l" onPointerDown={(e) => startDrag(e, it, "l")} />
                        {props.label(it as never)}
                        <span class="tl-handle r" onPointerDown={(e) => startDrag(e, it, "r")} />
                    </button>
                );
            })}
        </div>
    );
}

export function Timeline({ player }: { player: Player }) {
    const p = project.value!;
    const pps = pxPerSecond.value;
    const scroller = useRef<HTMLDivElement>(null);
    const width = p.duration * pps;
    const sel = selection.value;
    const selClip = sel?.kind === "clip" ? p.timeline.clips.find((c) => c.id === sel.id) : undefined;
    const hasCamera = p.sources.some((s) => s.kind === "camera");
    const hasAudio = p.sources.some((s) => s.kind === "audio");

    // Fit the whole recording to the panel, and keep fitting on resize until
    // the user zooms by hand (⇧Z or the Fit button turns it back on).
    const fit = () => {
        const w = scroller.current?.clientWidth ?? 1000;
        pxPerSecond.value = Math.max(2, Math.min(300, (w - LABEL_W - 24) / Math.max(1, p.duration)));
    };
    useEffect(() => {
        autoFit.value = true;
        fit();
    }, [p.id]);
    useEffect(() => {
        if (fitRequest.value) fit();
    }, [fitRequest.value]);
    useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const ro = new ResizeObserver(() => autoFit.value && fit());
        ro.observe(el);
        return () => ro.disconnect();
    }, [p.duration]);

    // Keep the playhead in view while playing.
    useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const x = LABEL_W + PAD + playhead.value * pps;
        if (x < el.scrollLeft + LABEL_W || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - LABEL_W - 40;
    }, [Math.floor(playhead.value * pps / 200)]);

    const seekFromEvent = (e: PointerEvent, lane: HTMLElement) => {
        const r = lane.getBoundingClientRect();
        const t = Math.max(0, Math.min(p.duration, (e.clientX - r.left) / pps));
        playhead.value = t;
        void player.seek(t);
    };

    const scrub = (e: PointerEvent) => {
        const lane = e.currentTarget as HTMLElement;
        lane.setPointerCapture(e.pointerId);
        seekFromEvent(e, lane);
        const move = (ev: PointerEvent) => seekFromEvent(ev, lane);
        const up = () => {
            lane.removeEventListener("pointermove", move as EventListener);
            lane.removeEventListener("pointerup", up);
        };
        lane.addEventListener("pointermove", move as EventListener);
        lane.addEventListener("pointerup", up);
    };

    const step = tickStep(pps);
    const ticks: number[] = [];
    for (let t = 0; t <= p.duration; t += step) ticks.push(t);

    const task = A.task.value;

    return (
        <>
            <div class="tl-tools">
                <div class="row" style={{ gap: "4px" }}>
                    <button class="btn" type="button" onClick={A.split} title="Split at playhead (S)">
                        <Icon name="scissors" /> Split <kbd>S</kbd>
                    </button>
                    <button class="btn" type="button" onClick={A.deleteSelection} disabled={!sel} title="Delete (⌫)">
                        <Icon name="trash" /> {selClip && !selClip.enabled ? "Restore" : "Delete"} <kbd>⌫</kbd>
                    </button>
                    <span class="sep" aria-hidden="true" />
                    <button class="btn" type="button" onClick={() => A.addZoom()} title="Add zoom (Z)">
                        <Icon name="zoom" /> Zoom <kbd>Z</kbd>
                    </button>
                    {hasCamera && (
                        <button class="btn" type="button" onClick={() => A.addLayout()} title="Add layout change (C)">
                            <Icon name="camera" /> Layout <kbd>C</kbd>
                        </button>
                    )}
                    <button class="btn" type="button" onClick={() => A.addMarker()} title="Add marker (M)">
                        <Icon name="flag" /> Marker <kbd>M</kbd>
                    </button>
                    {p.sources.some((s) => s.kind === "screen") && (
                        <><span class="sep" aria-hidden="true" />
                        <button class="btn suggest" type="button" onClick={() => void A.runSmartZoom()} disabled={!!task}>
                            <Icon name="sparkle" /> Suggest zooms
                        </button></>
                    )}
                    {selClip && selClip.enabled && (
                        <Segmented
                            label="Clip speed"
                            value={String(selClip.speed)}
                            options={["0.5", "1", "1.5", "2", "4"].map((v) => ({ value: v, label: `${v}×` }))}
                            onChange={(v) => setTimeline((tl) => ({ clips: setClip(tl.clips, selClip.id, { speed: Number(v) }) }))}
                        />
                    )}
                </div>
                <div class="row" style={{ gap: "10px" }}>
                    {task && (
                        <span class="row small muted" aria-live="polite">
                            {task.label} {Math.round(task.progress * 100)}%
                            <button class="btn" type="button" onClick={task.cancel}>
                                Cancel
                            </button>
                        </span>
                    )}
                    <label class="row small muted">
                        Zoom
                        <input
                            type="range"
                            min={Math.log(2)}
                            max={Math.log(400)}
                            step={0.01}
                            value={Math.log(pps)}
                            style={{ width: "120px" }}
                            aria-label="Timeline zoom"
                            onInput={(e) => {
                                autoFit.value = false;
                                pxPerSecond.value = Math.exp(Number((e.target as HTMLInputElement).value));
                            }}
                        />
                    </label>
                    <button
                        class="btn"
                        type="button"
                        aria-pressed={autoFit.value}
                        title="Fit the whole recording (⇧Z)"
                        onClick={() => {
                            autoFit.value = true;
                            fit();
                        }}
                    >
                        <Icon name="fit" /> Fit
                    </button>
                </div>
            </div>

            <div class="tl-scroll" ref={scroller}>
                <div class="tl-inner" style={{ width: `${width + LABEL_W + 40}px` }}>
                    <div class="tl-row tl-ruler-row">
                        <div class="tl-head mono">{formatTimecode(sourceToOutput(p.timeline.clips, playhead.value))}</div>
                        <div class="tl-ruler" style={{ width: `${width}px` }} onPointerDown={scrub}>
                            <div class="tl-playhead" style={{ left: `${playhead.value * pps}px` }} />
                            {ticks.map((t) => (
                                <span class="tl-tick" style={{ left: `${t * pps}px` }}>
                                    {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}
                                </span>
                            ))}
                            {p.timeline.markers.map((m) => (
                                <button
                                    type="button"
                                    class="tl-marker"
                                    style={{ left: `${m.t * pps}px` }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => {
                                        playhead.value = m.t;
                                        void player.seek(m.t);
                                        selection.value = { kind: "marker", id: m.id };
                                    }}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div class="tl-row">
                        <div class="tl-head"><Icon name="clip" size={14} />Clips</div>
                        <ClipLane />
                    </div>
                    <div class="tl-row">
                        <div class="tl-head"><Icon name="zoom" size={14} />Zoom</div>
                        <SegLane k="zooms" kind="zoom" cls="zoom" label={(z) => `${(z as { scale: number }).scale}×${(z as { suggested?: boolean }).suggested ? " suggested" : ""}`} onEmptyDouble={(t) => A.addZoom(t)} />
                    </div>
                    {hasCamera && (
                        <div class="tl-row">
                            <div class="tl-head"><Icon name="camera" size={14} />Layout</div>
                            <SegLane
                                k="layouts"
                                kind="layout"
                                cls="layout"
                                label={(l) => ({ screen: "Screen only", bubble: "Screen + bubble", side: "Side by side", camera: "Camera only" })[(l as { mode: string }).mode as "screen"]}
                                onEmptyDouble={(t) => A.addLayout(t)}
                            />
                        </div>
                    )}
                    {p.timeline.captions.length > 0 && (
                        <div class="tl-row">
                            <div class="tl-head"><Icon name="captions" size={14} />Captions</div>
                            <SegLane k="captions" kind="caption" cls="caption" label={(c) => (c as { text: string }).text} />
                        </div>
                    )}
                    {hasAudio && (
                        <div class="tl-row">
                            <div class="tl-head"><Icon name="wave" size={14} />Audio</div>
                            <div class="tl-lane tall" style={{ width: `${width}px` }} onPointerDown={scrub}>
                                <Waveform width={width} />
                            </div>
                        </div>
                    )}
                    <div class="tl-playhead" style={{ left: `${PAD + LABEL_W + playhead.value * pps}px` }} />
                </div>
            </div>
        </>
    );
}
