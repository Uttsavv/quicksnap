import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { formatTime, setClip } from "../lib/timeline";
import { resetLook, saveLook, uid, type Corner, type Easing, type LayoutMode } from "../lib/types";
import { BACKGROUND_PRESETS, presetCss, SOLID_COLORS } from "../render/backgrounds";
import { writeFile } from "../storage/files";
import { Check, Segmented, Slider, errorText, toast } from "../ui/controls";
import { Icon, type IconName } from "../ui/icons";
import * as A from "./actions";
import type { Player } from "./player";
import { begin, end, liveStyle, liveTimeline, playhead, project, selection, setStyle, setTimeline } from "./store";

export type Tab = "style" | "zoom" | "camera" | "audio" | "captions";
export const tab = signal<Tab>("style");

const LAYOUT_NAMES: Record<LayoutMode, string> = { screen: "Screen", bubble: "Bubble", side: "Side", camera: "Camera" };

/** Slider that records one undo step per drag. */
function StyleSlider(props: { label: string; value: number; min: number; max: number; step?: number; display: string; set: (v: number) => void }) {
    return (
        <div onPointerDown={begin} onPointerUp={end} onKeyDown={begin} onKeyUp={end}>
            <Slider {...props} onInput={props.set} onCommit={end} />
        </div>
    );
}

function StyleTab({ player }: { player: Player }) {
    const p = project.value!;
    const s = p.style;
    const bg = s.background;
    const pickImage = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        try {
            const path = `${p.id}/bg-${uid()}`;
            await writeFile(path, file);
            setStyle(() => ({ background: { kind: "image", path } }));
            await player.setBackgroundImage(path);
        } catch (err) {
            toast(errorText(err), "error");
        }
    };
    return (
        <>
            <div class="group">
                <h3 class="group-title">Background</h3>
                <div class="swatches">
                    {BACKGROUND_PRESETS.map((b) => (
                        <button
                            type="button"
                            class="swatch"
                            aria-label={b.name}
                            title={b.name}
                            aria-pressed={bg.kind === "preset" && bg.id === b.id}
                            style={{ background: presetCss(b) }}
                            onClick={() => setStyle(() => ({ background: { kind: "preset", id: b.id } }))}
                        />
                    ))}
                    {SOLID_COLORS.map((c) => (
                        <button
                            type="button"
                            class="swatch"
                            aria-label={`Solid ${c}`}
                            title={c}
                            aria-pressed={bg.kind === "solid" && bg.color === c}
                            style={{ background: c }}
                            onClick={() => setStyle(() => ({ background: { kind: "solid", color: c } }))}
                        />
                    ))}
                    <button
                        type="button"
                        class="swatch dashed"
                        aria-label="Blurred screen"
                        title="Blurred screen"
                        aria-pressed={bg.kind === "blur"}
                        onClick={() => setStyle(() => ({ background: { kind: "blur" } }))}
                    >
                        <Icon name="screen" />
                    </button>
                    <label class="swatch dashed" title="Upload image" aria-pressed={bg.kind === "image"} style={{ cursor: "pointer" }}>
                        <Icon name="image" />
                        <input class="sr-only" type="file" accept="image/*" aria-label="Upload background image" onChange={(e) => void pickImage(e)} />
                    </label>
                </div>
                {bg.kind === "solid" && (
                    <label class="check">
                        <span>Custom color</span>
                        <input type="color" value={bg.color} onChange={(e) => setStyle(() => ({ background: { kind: "solid", color: (e.target as HTMLInputElement).value } }))} />
                    </label>
                )}
            </div>
            <div class="group">
                <div class="spread">
                    <h3 class="group-title">Frame</h3>
                    <button
                        class="btn ghost"
                        type="button"
                        aria-pressed={s.padding === 0 && s.radius === 0 && s.shadow === 0}
                        title="Show the recording edge to edge, with no background, corners or shadow"
                        onClick={() => setStyle(() => ({ padding: 0, radius: 0, shadow: 0 }))}
                    >
                        No frame
                    </button>
                </div>
                <StyleSlider label="Padding" min={0} max={0.2} step={0.005} value={s.padding} display={`${Math.round(s.padding * 100)}%`} set={(v) => liveStyle(() => ({ padding: v }))} />
                <StyleSlider label="Corner radius" min={0} max={48} value={s.radius} display={`${s.radius} px`} set={(v) => liveStyle(() => ({ radius: v }))} />
                <StyleSlider label="Shadow" min={0} max={1} step={0.05} value={s.shadow} display={`${Math.round(s.shadow * 100)}%`} set={(v) => liveStyle(() => ({ shadow: v }))} />
            </div>
            <div class="group">
                <h3 class="group-title">Aspect ratio</h3>
                <Segmented
                    full
                    label="Aspect ratio"
                    value={s.aspect}
                    options={(["16:9", "9:16", "1:1", "4:5"] as const).map((a) => ({ value: a, label: a }))}
                    onChange={(a) => setStyle(() => ({ aspect: a }))}
                />
            </div>
            <div class="group">
                <h3 class="group-title">New recordings</h3>
                <span class="small muted">New recordings start with Quicksnap's default look unless you save your own.</span>
                <div class="row-wrap">
                    <button
                        class="btn"
                        type="button"
                        onClick={() => {
                            saveLook(s);
                            toast("New recordings will start with this look.");
                        }}
                    >
                        Use this look for new recordings
                    </button>
                    <button
                        class="btn ghost"
                        type="button"
                        onClick={() => {
                            resetLook();
                            toast("New recordings will use Quicksnap's default look.");
                        }}
                    >
                        Reset
                    </button>
                </div>
            </div>
        </>
    );
}

function ZoomTab({ player }: { player: Player }) {
    const p = project.value!;
    const sel = selection.value;
    const z = sel?.kind === "zoom" ? p.timeline.zooms.find((x) => x.id === sel.id) : undefined;
    const suggested = p.timeline.zooms.filter((x) => x.suggested).length;
    const patch = (fn: (zz: NonNullable<typeof z>) => Partial<NonNullable<typeof z>>, live = false) => {
        if (!z) return;
        const apply = live ? liveTimeline : setTimeline;
        apply((tl) => ({ zooms: tl.zooms.map((x) => (x.id === z.id ? { ...x, ...fn(x) } : x)) }));
    };
    return (
        <>
            {z ? (
                <div class="callout">
                    <div class="spread">
                        <h3 class="group-title">
                            {z.suggested ? "Suggested zoom" : "Selected zoom"}
                        </h3>
                        <span class="mono small muted">
                            {formatTime(z.start)} – {formatTime(z.end)}
                        </span>
                    </div>
                    <StyleSlider label="Scale" min={1.1} max={4} step={0.1} value={z.scale} display={`${z.scale.toFixed(1)}×`} set={(v) => patch(() => ({ scale: Math.round(v * 10) / 10 }), true)} />
                    <div class="field">
                        <span class="field-head">Easing</span>
                        <Segmented<Easing>
                            full
                            label="Easing"
                            value={z.easing}
                            options={[
                                { value: "spring", label: "Spring" },
                                { value: "smooth", label: "Smooth" },
                                { value: "instant", label: "Instant" },
                            ]}
                            onChange={(v) => patch(() => ({ easing: v }))}
                        />
                    </div>
                    <span class="small muted">Click the preview to move the focus point.</span>
                    <div class="row-wrap">
                        {z.suggested && (
                            <button class="btn primary" type="button" onClick={() => patch(() => ({ suggested: false }))}>
                                Keep this zoom
                            </button>
                        )}
                        <button
                            class="btn"
                            type="button"
                            onClick={() => {
                                playhead.value = z.start;
                                void player.seek(z.start).then(() => player.play());
                            }}
                        >
                            <Icon name="play" /> Preview
                        </button>
                        <button class="btn danger" type="button" onClick={A.deleteSelection}>
                            <Icon name="trash" /> Remove
                        </button>
                    </div>
                </div>
            ) : (
                <p class="small muted" style={{ margin: 0 }}>
                    Select a zoom on the timeline, or press <kbd>Z</kbd> to add one at the playhead. Double-click the zoom track to add one anywhere.
                </p>
            )}
            <Check label="Motion blur during zooms" checked={p.style.motionBlur} onChange={(v) => setStyle(() => ({ motionBlur: v }))} />
            <div class="group">
                <h3 class="group-title">Smart zoom</h3>
                <p class="small muted" style={{ margin: 0 }}>
                    Browsers can't see your cursor, so Quicksnap looks for areas where something changes (typing, clicking, scrolling) and suggests zooms there.
                </p>
                <div class="row-wrap">
                    <button class="btn suggest" type="button" disabled={!!A.task.value} onClick={() => void A.runSmartZoom()}>
                        <Icon name="sparkle" /> Suggest zooms
                    </button>
                    {suggested > 0 && (
                        <>
                            <button class="btn primary" type="button" onClick={A.acceptSuggestions}>
                                Keep all {suggested}
                            </button>
                            <button class="btn" type="button" onClick={A.clearSuggestions}>
                                Discard
                            </button>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

function CameraTab() {
    const p = project.value!;
    const cam = p.style.camera;
    const sel = selection.value;
    const seg = sel?.kind === "layout" ? p.timeline.layouts.find((x) => x.id === sel.id) : undefined;
    const setCam = (patch: Partial<typeof cam>) => setStyle((s) => ({ camera: { ...s.camera, ...patch } }));
    const [blurBusy, setBlurBusy] = useState(false);
    if (!p.sources.some((s) => s.kind === "camera")) return <p class="small muted">This recording has no camera.</p>;
    const layouts = (Object.keys(LAYOUT_NAMES) as LayoutMode[]).map((m) => ({ value: m, label: LAYOUT_NAMES[m] }));
    return (
        <>
            {seg && (
                <div class="callout">
                    <div class="spread">
                        <h3 class="group-title">
                            Selected layout
                        </h3>
                        <span class="mono small muted">
                            {formatTime(seg.start)} – {formatTime(seg.end)}
                        </span>
                    </div>
                    <Segmented<LayoutMode>
                        full
                        label="Layout for this section"
                        value={seg.mode}
                        options={layouts}
                        onChange={(m) => setTimeline((tl) => ({ layouts: tl.layouts.map((l) => (l.id === seg.id ? { ...l, mode: m } : l)) }))}
                    />
                </div>
            )}
            <div class="field">
                <span class="field-head">Default layout</span>
                <Segmented<LayoutMode> full label="Default layout" value={p.style.defaultLayout} options={layouts} onChange={(m) => setStyle(() => ({ defaultLayout: m }))} />
            </div>
            <div class="field">
                <span class="field-head">Bubble shape</span>
                <Segmented
                    full
                    label="Bubble shape"
                    value={cam.shape}
                    options={[
                        { value: "circle", label: "Circle" },
                        { value: "rounded", label: "Rounded" },
                    ]}
                    onChange={(v) => setCam({ shape: v })}
                />
            </div>
            <StyleSlider
                label="Bubble size"
                min={0.12}
                max={0.45}
                step={0.01}
                value={cam.size}
                display={`${Math.round(cam.size * 100)}%`}
                set={(v) => liveStyle((s) => ({ camera: { ...s.camera, size: v } }))}
            />
            <div class="field">
                <span class="field-head">Bubble position</span>
                <div class="corner-grid" role="group" aria-label="Bubble position">
                    {(["tl", "tr", "bl", "br"] as Corner[]).map((c) => (
                        <button type="button" aria-pressed={cam.corner === c} aria-label={{ tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right" }[c]} onClick={() => setCam({ corner: c })}>
                            <span
                                style={{
                                    position: "absolute",
                                    width: "8px",
                                    height: "8px",
                                    borderRadius: "50%",
                                    background: "currentColor",
                                    [c[0] === "t" ? "top" : "bottom"]: "5px",
                                    [c[1] === "l" ? "left" : "right"]: "6px",
                                }}
                            />
                        </button>
                    ))}
                </div>
            </div>
            <Check label="Mirror camera" checked={cam.mirror} onChange={(v) => setCam({ mirror: v })} />
            <Check
                label={blurBusy ? "Blur background (loading model…)" : "Blur background"}
                checked={cam.blurBackground}
                disabled={blurBusy}
                onChange={async (v) => {
                    setCam({ blurBackground: v });
                    if (v) {
                        setBlurBusy(true);
                        const ok = await playerRef.current?.setCameraBlur(true);
                        setBlurBusy(false);
                        if (!ok) {
                            setCam({ blurBackground: false });
                            toast("Background blur couldn't load on this device.", "error");
                        }
                    }
                }}
            />
        </>
    );
}

export const playerRef: { current: Player | null } = { current: null };

function AudioTab() {
    const p = project.value!;
    const sel = selection.value;
    const clip = sel?.kind === "clip" ? p.timeline.clips.find((c) => c.id === sel.id) : undefined;
    const [thr, setThr] = useState(-42);
    const [minLen, setMinLen] = useState(1);
    if (!p.sources.some((s) => s.kind === "audio")) return <p class="small muted">This recording has no audio.</p>;
    const found = A.silencesPreview(thr, minLen);
    return (
        <>
            {clip ? (
                <div class="callout">
                    <h3 class="group-title">
                        Selected clip
                    </h3>
                    <StyleSlider
                        label="Volume"
                        min={0}
                        max={2}
                        step={0.05}
                        value={clip.volume}
                        display={clip.volume === 0 ? "Muted" : `${Math.round(clip.volume * 100)}%`}
                        set={(v) => liveTimeline((tl) => ({ clips: setClip(tl.clips, clip.id, { volume: v }) }))}
                    />
                    {clip.speed !== 1 && <span class="small muted">This clip plays at {clip.speed}×, so it's silent.</span>}
                </div>
            ) : (
                <p class="small muted" style={{ margin: 0 }}>
                    Select a clip to change its volume. Split first (<kbd>S</kbd>) to adjust just part of the recording.
                </p>
            )}
            <div class="group">
                <h3 class="group-title">Remove silences</h3>
                {!A.levels.value ? (
                    <span class="small muted">Analyzing audio…</span>
                ) : (
                    <>
                        <Slider label="Quieter than" min={-60} max={-25} value={thr} display={`${thr} dB`} onInput={setThr} />
                        <Slider label="Longer than" min={0.5} max={4} step={0.25} value={minLen} display={`${minLen} s`} onInput={setMinLen} />
                        <span class="small muted">
                            Found {found.length} silence{found.length === 1 ? "" : "s"}, {found.reduce((n, r) => n + r.end - r.start, 0).toFixed(1)} s in total.
                        </span>
                        <button class="btn" type="button" disabled={!found.length} onClick={() => A.removeSilences(thr, minLen)}>
                            <Icon name="scissors" /> Cut silences
                        </button>
                    </>
                )}
            </div>
        </>
    );
}

const LANGS = [
    ["", "Detect automatically"],
    ["english", "English"],
    ["hindi", "Hindi"],
    ["spanish", "Spanish"],
    ["french", "French"],
    ["german", "German"],
    ["portuguese", "Portuguese"],
    ["japanese", "Japanese"],
] as const;

function CaptionsTab({ player }: { player: Player }) {
    const p = project.value!;
    const [lang, setLang] = useState("");
    const caps = p.timeline.captions;
    if (!p.sources.some((s) => s.kind === "audio")) return <p class="small muted">This recording has no audio.</p>;
    return (
        <>
            <p class="small muted" style={{ margin: 0 }}>
                Captions are generated on your device with Whisper. The model (about 80 MB) downloads once.
            </p>
            <label class="field">
                <span class="field-head">Language</span>
                <select value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value)}>
                    {LANGS.map(([v, l]) => (
                        <option value={v}>{l}</option>
                    ))}
                </select>
            </label>
            <div class="row-wrap">
                <button class="btn primary" type="button" disabled={!!A.task.value} onClick={() => void A.generateCaptions(lang || undefined)}>
                    <Icon name="captions" /> {caps.length ? "Regenerate" : "Generate captions"}
                </button>
            </div>
            {A.task.value && (
                <div class="col">
                    <span class="small">{A.task.value.label}</span>
                    <div class="progress">
                        <div style={{ width: `${Math.round(A.task.value.progress * 100)}%` }} />
                    </div>
                </div>
            )}
            <Check label="Show captions in the video" checked={p.style.showCaptions} onChange={(v) => setStyle(() => ({ showCaptions: v }))} />
            {caps.length > 0 && (
                <div class="group" style={{ gap: "6px" }}>
                    {caps.map((c) => (
                        <div class="row" style={{ alignItems: "flex-start" }}>
                            <button
                                type="button"
                                class="btn ghost mono"
                                style={{ height: "32px", padding: "0 6px", fontSize: "11px" }}
                                onClick={() => {
                                    playhead.value = c.start;
                                    void player.seek(c.start);
                                    selection.value = { kind: "caption", id: c.id };
                                }}
                            >
                                {formatTime(c.start)}
                            </button>
                            <input
                                type="text"
                                aria-label={`Caption at ${formatTime(c.start)}`}
                                value={c.text}
                                onChange={(e) => {
                                    const text = (e.target as HTMLInputElement).value;
                                    setTimeline((tl) => ({ captions: tl.captions.map((x) => (x.id === c.id ? { ...x, text } : x)) }));
                                }}
                            />
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}

export function Inspector({ player }: { player: Player }) {
    playerRef.current = player;
    const tabs: [Tab, string, IconName][] = [
        ["style", "Style", "style"],
        ["zoom", "Zoom", "zoom"],
        ["camera", "Camera", "camera"],
        ["audio", "Audio", "wave"],
        ["captions", "Captions", "captions"],
    ];
    return (
        <aside class="panel inspector" aria-label="Inspector">
            <div class="inspector-tabs" role="tablist">
                {tabs.map(([id, label, icon]) => (
                    <button type="button" role="tab" id={`tab-${id}`} aria-controls="inspector-panel" aria-selected={tab.value === id} onClick={() => (tab.value = id)}>
                        <Icon name={icon} />
                        {label}
                    </button>
                ))}
            </div>
            <div class="panel-body tab-panel" key={tab.value} role="tabpanel" id="inspector-panel" aria-labelledby={`tab-${tab.value}`}>
                {tab.value === "style" && <StyleTab player={player} />}
                {tab.value === "zoom" && <ZoomTab player={player} />}
                {tab.value === "camera" && <CameraTab />}
                {tab.value === "audio" && <AudioTab />}
                {tab.value === "captions" && <CaptionsTab player={player} />}
            </div>
        </aside>
    );
}
