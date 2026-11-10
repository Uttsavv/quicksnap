import { useEffect, useRef, useState } from "preact/hooks";
import { formatClock } from "../lib/timeline";
import { startingStyle, type LayoutMode } from "../lib/types";
import { renderFrame } from "../render/compositor";
import { formatBytes, storageEstimate } from "../storage/files";
import { Check, Meter, Segmented, Slider } from "../ui/controls";
import { Icon } from "../ui/icons";
import { closePip, openPip, pipOpen, pipSupported } from "./Pip";
import { replaySupported } from "./replay";
import * as S from "./state";

export const SCENES: { mode: LayoutMode; name: string; key: string }[] = [
    { mode: "screen", name: "Screen only", key: "1" },
    { mode: "bubble", name: "Screen + bubble", key: "2" },
    { mode: "side", name: "Side by side", key: "3" },
    { mode: "camera", name: "Camera only", key: "4" },
];

function SceneArt({ mode }: { mode: LayoutMode }) {
    return (
        <div class="scene-art" aria-hidden="true">
            {mode !== "camera" && <i class="s" style={mode === "side" ? { left: "6%", top: "14%", width: "58%", bottom: "14%" } : { inset: "12%" }} />}
            {mode === "bubble" && <i class="c" style={{ right: "6%", bottom: "8%", width: "22%", aspectRatio: "1", borderRadius: "50%" }} />}
            {mode === "side" && <i class="c" style={{ right: "6%", top: "14%", width: "26%", bottom: "14%", borderRadius: "2px" }} />}
            {mode === "camera" && <i class="c" style={{ inset: "12% 28%", borderRadius: "3px" }} />}
        </div>
    );
}

// Shown in the preview until a screen is shared, so scenes are visible right away.
let placeholder: HTMLCanvasElement | null = null;
function screenPlaceholder(): HTMLCanvasElement {
    if (placeholder) return placeholder;
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1000;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#2e2e2e";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#404040";
    ctx.lineWidth = 2;
    for (let x = 0; x <= c.width; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, c.height);
        ctx.stroke();
    }
    for (let y = 0; y <= c.height; y += 80) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(c.width, y);
        ctx.stroke();
    }
    ctx.fillStyle = "#b5b5b5";
    ctx.font = "600 64px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No screen shared yet", c.width / 2, c.height / 2 - 10);
    ctx.font = "44px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#8a8a8a";
    ctx.fillText("Choose a screen in Sources", c.width / 2, c.height / 2 + 70);
    placeholder = c;
    return c;
}

const sceneFlash = { name: "", until: 0 };

function switchScene(mode: LayoutMode) {
    S.setScene(mode);
    sceneFlash.name = SCENES.find((s) => s.mode === mode)!.name;
    sceneFlash.until = performance.now() + 1200;
}

export function onStudioKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    // Text fields keep their keys; selects, checkboxes and sliders don't need digits.
    if (el && (el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    if (el?.tagName === "INPUT" && !["checkbox", "range", "radio"].includes((el as HTMLInputElement).type)) return;

    if (e.altKey && e.code === "KeyR") {
        e.preventDefault();
        if (S.isRecording.value) void S.stopRecording();
        else void S.startRecording();
        return;
    }
    if (e.altKey && e.code === "KeyP") {
        e.preventDefault();
        S.togglePause();
        return;
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const digit = /^(Digit|Numpad)([1-4])$/.exec(e.code)?.[2];
    if (digit) {
        e.preventDefault(); // don't let a focused <select> jump options
        switchScene(SCENES[Number(digit) - 1].mode);
    } else if (e.code === "KeyM") S.addMarker();
    else if (e.key === "Escape") S.cancelCountdown();
}

function Monitor() {
    const canvas = useRef<HTMLCanvasElement>(null);
    const screenVideo = useRef<HTMLVideoElement>(document.createElement("video"));
    const camVideo = useRef<HTMLVideoElement>(document.createElement("video"));
    const [flash, setFlash] = useState("");
    const screen = S.screenStream.value;
    const cam = S.cameraStream.value;

    useEffect(() => {
        for (const [v, s] of [
            [screenVideo.current, screen],
            [camVideo.current, cam],
        ] as const) {
            v.muted = true;
            v.playsInline = true;
            v.srcObject = s;
            if (s) void v.play().catch(() => {});
        }
    }, [screen, cam]);

    useEffect(() => {
        let raf = 0;
        let shown = "";
        const draw = () => {
            raf = requestAnimationFrame(draw);
            const c = canvas.current;
            if (!c) return;
            const sv = screenVideo.current;
            const cv = camVideo.current;
            const hasS = !!S.screenStream.value && sv.readyState >= 2;
            const hasC = !!S.cameraStream.value && cv.readyState >= 2;
            const ph = screenPlaceholder();
            const scr: CanvasImageSource = hasS ? sv : ph;
            const scrSize: [number, number] = hasS ? [sv.videoWidth, sv.videoHeight] : [ph.width, ph.height];
            renderFrame(
                c.getContext("2d")!,
                c.width,
                c.height,
                startingStyle(S.scene.value),
                { screen: scr, screenSize: scrSize, camera: hasC ? cv : null, cameraSize: hasC ? [cv.videoWidth, cv.videoHeight] : undefined },
                { layoutFrom: S.scene.value, layoutTo: S.scene.value, layoutP: 1, zoom: { scale: 1, focus: [0.5, 0.5] } },
            );
            const f = performance.now() < sceneFlash.until ? sceneFlash.name : "";
            if (f !== shown) setFlash((shown = f));
        };
        draw();
        return () => cancelAnimationFrame(raf);
    }, []);

    const st = S.recState.value;
    return (
        <div class="monitor">
            <canvas ref={canvas} width={1280} height={720} aria-label="Live preview" />
            {(st === "recording" || st === "paused") && (
                <span class="monitor-tag">
                    <span class={`rec-dot${st === "paused" ? " paused" : ""}`} />
                    {st === "paused" ? "Paused" : "Recording"}
                </span>
            )}
            {flash && st !== "recording" && st !== "paused" && <span class="monitor-tag">{flash}</span>}
            {st === "countdown" && (
                <div class="countdown" aria-live="assertive">
                    <span class="tick" key={S.countdown.value}>
                        {S.countdown.value}
                    </span>
                </div>
            )}
            {st === "finalizing" && (
                <div class="countdown" style={{ fontSize: "14px" }}>
                    <div class="col" style={{ width: "min(320px, 80%)" }}>
                        <span>Preparing your recording…</span>
                        <div class="progress">
                            <div style={{ width: `${Math.round(S.finalizeProgress.value * 100)}%` }} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function useLevels() {
    const [levels, setLevels] = useState<Record<string, number>>({});
    useEffect(() => {
        const id = setInterval(() => {
            const m = S.mixer.value;
            setLevels(m ? { mic: m.level("mic"), system: m.level("system") } : {});
        }, 70);
        return () => clearInterval(id);
    }, []);
    return levels;
}

function DeviceSelect(props: { label: string; value: string; devices: MediaDeviceInfo[]; fallback: string; disabled: boolean; onChange: (id: string) => void }) {
    const known = props.devices.some((d) => d.deviceId === props.value);
    return (
        <select aria-label={props.label} disabled={props.disabled} value={known ? props.value : ""} onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}>
            {!known && <option value="">{props.fallback}</option>}
            {props.devices.map((d) => (
                <option value={d.deviceId}>{d.label || props.fallback}</option>
            ))}
        </select>
    );
}

function Sources() {
    const screen = S.screenStream.value;
    const st = screen?.getVideoTracks()[0]?.getSettings();
    const live = S.recState.value !== "idle";
    const levels = useLevels();
    return (
        <aside class="panel" aria-label="Sources">
            <div class="panel-head">Sources</div>
            <div class="panel-body">
                <div class="group source">
                    <div class="source-head">
                        <span class="source-icon">
                            <Icon name="screen" />
                        </span>
                        <div class="grow">
                            <div style={{ fontWeight: 600 }}>Screen</div>
                            <div class="small muted truncate">{screen ? `${screen.getVideoTracks()[0]?.label || "Shared"} · ${st?.width}×${st?.height}` : "Not shared"}</div>
                        </div>
                    </div>
                    <div class="row">
                        <button class={screen ? "btn" : "btn primary"} type="button" disabled={live} onClick={() => void S.chooseScreen()}>
                            {screen ? "Change" : "Choose screen"}
                        </button>
                        {screen && (
                            <button class="btn ghost" type="button" disabled={live} onClick={S.clearScreen}>
                                Remove
                            </button>
                        )}
                    </div>
                    <Check label={S.isMac ? "Include tab audio" : "Include system or tab audio"} checked={S.systemAudioOn.value} disabled={live} onChange={(v) => (S.systemAudioOn.value = v)} />
                    {S.systemAudioOn.value && S.isMac && <div class="small warn-text">On a Mac, sound only comes through when you share a browser tab, not a window or the whole screen.</div>}
                    {screen && S.systemAudioOn.value && !screen.getAudioTracks().length && <div class="small muted">This share has no sound. Share again and turn on “Share audio” in the picker.</div>}
                </div>

                <div class="group source">
                    <div class="source-head">
                        <span class="source-icon">
                            <Icon name="camera" />
                        </span>
                        <div class="grow" style={{ fontWeight: 600 }}>
                            Camera
                        </div>
                        <input
                            type="checkbox"
                            aria-label="Camera on"
                            checked={S.cameraOn.value}
                            disabled={live}
                            onChange={(e) => {
                                S.cameraOn.value = (e.target as HTMLInputElement).checked;
                                void S.startCamera();
                            }}
                        />
                    </div>
                    {S.cameraOn.value && (
                        <DeviceSelect
                            label="Camera device"
                            value={S.cameraId.value}
                            devices={S.cameras.value}
                            fallback="Default camera"
                            disabled={live}
                            onChange={S.chooseCamera}
                        />
                    )}
                </div>

                <div class="group source">
                    <div class="source-head">
                        <span class="source-icon">
                            <Icon name="mic" />
                        </span>
                        <div class="grow" style={{ fontWeight: 600 }}>
                            Microphone
                        </div>
                        <input
                            type="checkbox"
                            aria-label="Microphone on"
                            checked={S.micOn.value}
                            disabled={live}
                            onChange={(e) => {
                                S.micOn.value = (e.target as HTMLInputElement).checked;
                                void S.startMic();
                            }}
                        />
                    </div>
                    {S.micOn.value && (
                        <>
                            <DeviceSelect
                                label="Microphone device"
                                value={S.micId.value}
                                devices={S.mics.value}
                                fallback="Default microphone"
                                disabled={live}
                                onChange={S.chooseMic}
                            />
                            <Meter db={levels.mic ?? -Infinity} />
                        </>
                    )}
                </div>
            </div>
        </aside>
    );
}

function MixerPanel() {
    const levels = useLevels();
    const [gains, setGains] = useState<Record<string, number>>({ mic: 100, system: 100 });
    const [muted, setMuted] = useState<Record<string, boolean>>({});
    const m = S.mixer.value;
    const channels = [
        { id: "mic", name: "Microphone" },
        { id: "system", name: S.isMac ? "Tab audio" : "System audio" },
    ].filter((c) => m?.has(c.id));
    const live = S.recState.value !== "idle";

    return (
        <aside class="panel" aria-label="Audio mixer and settings">
            <div class="panel-head">Audio mixer</div>
            <div class="panel-body">
                <div class="group">
                    {channels.length === 0 && <div class="small muted">No audio sources yet.</div>}
                    {channels.map((c) => (
                        <div class="col" style={{ gap: "6px" }}>
                            <div class="spread">
                                <span style={{ fontWeight: 500 }}>{c.name}</span>
                                <span class="mono small muted">{isFinite(levels[c.id]) ? `${Math.round(levels[c.id])} dB` : "−∞ dB"}</span>
                            </div>
                            <Meter db={levels[c.id] ?? -Infinity} />
                            <div class="row">
                                <input
                                    type="range"
                                    min={0}
                                    max={200}
                                    value={gains[c.id]}
                                    aria-label={`${c.name} gain`}
                                    onInput={(e) => {
                                        const v = Number((e.target as HTMLInputElement).value);
                                        setGains({ ...gains, [c.id]: v });
                                        m?.setGain(c.id, v / 100);
                                    }}
                                />
                                <button
                                    class="btn icon"
                                    type="button"
                                    aria-label={muted[c.id] ? `Unmute ${c.name}` : `Mute ${c.name}`}
                                    aria-pressed={!!muted[c.id]}
                                    onClick={() => {
                                        const v = !muted[c.id];
                                        setMuted({ ...muted, [c.id]: v });
                                        m?.setMuted(c.id, v);
                                    }}
                                >
                                    <Icon name={muted[c.id] ? "mute" : "speaker"} />
                                </button>
                            </div>
                        </div>
                    ))}
                    <Check
                        label="Noise suppression"
                        checked={S.noiseSuppression.value}
                        disabled={live}
                        onChange={(v) => {
                            S.noiseSuppression.value = v;
                            void S.startMic();
                        }}
                    />
                </div>

                <div class="group">
                    <h3 class="group-title">Recording</h3>
                    <div class="spread">
                        <span class="small">Countdown</span>
                        <Segmented
                            label="Countdown"
                            value={String(S.countdownSeconds.value) as "0" | "3" | "5"}
                            options={[
                                { value: "0", label: "Off" },
                                { value: "3", label: "3 s" },
                                { value: "5", label: "5 s" },
                            ]}
                            onChange={(v) => (S.countdownSeconds.value = Number(v) as 0 | 3 | 5)}
                        />
                    </div>
                    <div class="spread">
                        <span class="small">Screen frame rate</span>
                        <Segmented
                            label="Screen frame rate"
                            value={String(S.frameRate.value) as "30" | "60"}
                            options={[
                                { value: "30", label: "30" },
                                { value: "60", label: "60" },
                            ]}
                            onChange={(v) => (S.frameRate.value = Number(v) as 30 | 60)}
                        />
                    </div>
                    <div class="spread">
                        <span class="small">Camera</span>
                        <Segmented
                            label="Camera quality"
                            value={S.cameraQuality.value}
                            options={[
                                { value: "720", label: "720p" },
                                { value: "1080", label: "1080p" },
                            ]}
                            onChange={(v) => {
                                S.cameraQuality.value = v;
                                if (!live) void S.startCamera();
                            }}
                        />
                    </div>
                    {replaySupported() && (
                        <Slider
                            label="Replay length"
                            min={30}
                            max={600}
                            step={30}
                            value={S.replaySeconds.value}
                            display={`${Math.round((S.replaySeconds.value / 60) * 10) / 10} min`}
                            onInput={(v) => (S.replaySeconds.value = v)}
                        />
                    )}
                    <StorageLine />
                </div>
            </div>
        </aside>
    );
}

function StorageLine() {
    const [est, setEst] = useState<{ used: number; free: number } | null>(null);
    useEffect(() => void storageEstimate().then(setEst), [S.recState.value]);
    if (!est) return null;
    return (
        <div class="row small muted">
            <Icon name="disk" size={14} /> {formatBytes(est.free)} free in browser storage
        </div>
    );
}

export function Studio() {
    useEffect(() => {
        if (!S.cameraStream.value && S.cameraOn.value) void S.startCamera();
        if (!S.micStream.value && S.micOn.value) void S.startMic();
        addEventListener("keydown", onStudioKey);
        return () => {
            removeEventListener("keydown", onStudioKey);
            if (!S.isRecording.value && !S.replayOn.value) {
                closePip();
                S.releaseAll();
            }
        };
    }, []);

    const st = S.recState.value;
    const live = st === "recording" || st === "paused";

    return (
        <>
            <main class="studio">
                <Sources />
                <section class="studio-center" aria-label="Preview and scenes">
                    <Monitor />
                    <div class="scenes" role="group" aria-label="Scenes">
                        {SCENES.map((s) => (
                            <button type="button" class="scene" aria-pressed={S.scene.value === s.mode} onClick={() => switchScene(s.mode)}>
                                <SceneArt mode={s.mode} />
                                <span class="spread small">
                                    <span class="truncate">{s.name}</span>
                                    <kbd>{s.key}</kbd>
                                </span>
                            </button>
                        ))}
                    </div>
                </section>
                <MixerPanel />
            </main>

            <footer class="dock">
                <div class="row">
                    {pipSupported() && (
                        <button class="btn" type="button" aria-pressed={pipOpen.value} onClick={() => (pipOpen.value ? closePip() : void openPip(onStudioKey))}>
                            <Icon name="pip" /> Floating controls
                        </button>
                    )}
                    {replaySupported() && (
                        <button class="btn" type="button" aria-pressed={S.replayOn.value} disabled={!S.screenStream.value} onClick={() => S.setReplay(!S.replayOn.value)} title={S.screenStream.value ? "Keep the last few minutes so you can save them afterwards" : "Choose a screen first"}>
                            <Icon name="replay" /> Replay {S.replayOn.value ? `· ${Math.round(S.replayBuffered.value)} s` : ""}
                        </button>
                    )}
                    {S.replayOn.value && (
                        <button class="btn" type="button" onClick={() => void S.saveReplay()}>
                            Save replay
                        </button>
                    )}
                </div>

                <div class="row" style={{ gap: "12px" }}>
                    <span class="clock">{formatClock(S.elapsed.value)}</span>
                    {live && (
                        <button class="btn lg icon" type="button" aria-label={st === "paused" ? "Resume" : "Pause"} onClick={S.togglePause}>
                            <Icon name={st === "paused" ? "play" : "pause"} />
                        </button>
                    )}
                    {live ? (
                        <button class={`btn record rec-main${st === "recording" ? " live" : ""}`} type="button" onClick={() => void S.stopRecording()}>
                            <Icon name="stop" /> Stop
                        </button>
                    ) : st === "countdown" ? (
                        <button class="btn record rec-main" type="button" onClick={S.cancelCountdown}>
                            Cancel
                        </button>
                    ) : (
                        <button class="btn record rec-main" type="button" disabled={st === "finalizing"} onClick={() => void S.startRecording()}>
                            <span class="dot" />
                            {st === "finalizing" ? "Saving…" : "Record"}
                        </button>
                    )}
                    {live && <span class="small muted mono">{formatBytes(S.recordedBytes.value)}</span>}
                </div>

                <div class="row small muted" style={{ gap: "12px" }}>
                    <span>
                        <kbd>⌥R</kbd> record
                    </span>
                    <span>
                        <kbd>⌥P</kbd> pause
                    </span>
                    <span>
                        <kbd>M</kbd> marker
                    </span>
                    <span>
                        <kbd>1–4</kbd> scenes
                    </span>
                </div>
            </footer>
        </>
    );
}
