// Studio state and actions. Module-level so a recording keeps running if you
// navigate to the library and back.

import { computed, signal } from "@preact/signals";
import { navigate } from "../app/router";
import { buildProject, makeThumbnail, newProjectId, saveProject } from "../lib/project";
import type { LayoutMode, SourceFile } from "../lib/types";
import { requestPersistence } from "../storage/files";
import { errorText, toast } from "../ui/controls";
import { Mixer } from "./mixer";
import { finalizeSource, RecordingSession } from "./recorder";
import { ReplayBuffer, replaySupported } from "./replay";

export const screenStream = signal<MediaStream | null>(null);
export const cameraStream = signal<MediaStream | null>(null);
export const micStream = signal<MediaStream | null>(null);

export const cameraOn = signal(true);
export const micOn = signal(true);
export const systemAudioOn = signal(true);
export const noiseSuppression = signal(true);

export const cameras = signal<MediaDeviceInfo[]>([]);
export const mics = signal<MediaDeviceInfo[]>([]);
// The device actually in use (shown in the pickers).
export const cameraId = signal<string>("");
export const micId = signal<string>("");

export const cameraQuality = signal<"720" | "1080">("720");
export const frameRate = signal<30 | 60>(30);
export const countdownSeconds = signal<0 | 3 | 5>(3);
export const scene = signal<LayoutMode>("bubble");

export type RecState = "idle" | "countdown" | "recording" | "paused" | "finalizing";
export const recState = signal<RecState>("idle");
export const countdown = signal(0);
export const elapsed = signal(0);
export const recordedBytes = signal(0);
export const finalizeProgress = signal(0);
export const markers = signal(0);

export const replayOn = signal(false);
export const replaySeconds = signal(120);
export const replayBuffered = signal(0);

export const isRecording = computed(() => recState.value === "recording" || recState.value === "paused");

export const mixer = signal<Mixer | null>(null);
let session: RecordingSession | null = null;
let replay: ReplayBuffer | null = null;
let ticker: number | undefined;

function getMixer(): Mixer {
    if (!mixer.value) mixer.value = new Mixer();
    return mixer.value;
}

const stopTracks = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

export const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

// ── Devices ─────────────────────────────────────────────────────────────────

export async function refreshDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    cameras.value = all.filter((d) => d.kind === "videoinput" && d.deviceId);
    mics.value = all.filter((d) => d.kind === "audioinput" && d.deviceId);
}
navigator.mediaDevices?.addEventListener?.("devicechange", () => void refreshDevices());

type DeviceKind = "videoinput" | "audioinput";

// Continuity Camera / iPhone mic. Opening one wakes the phone, so we only use
// it when the user picks it.
const PHONE = /iphone|ipad|continuity/i;

// A renamed phone ("Utsav's 15 Pro") doesn't say "iPhone", but Continuity
// Camera always adds a "<phone> Desk View Camera" device, which gives away the
// name its camera and mic are listed under.
function phoneCheck(all: MediaDeviceInfo[]): (label: string) => boolean {
    const names = all.map((d) => /^(.+?)\s+desk view camera$/i.exec(d.label)?.[1]).filter((n): n is string => !!n);
    return (label) => PHONE.test(label) || /desk view/i.test(label) || names.some((n) => label.includes(n));
}

const PREF_KEY: Record<DeviceKind, string> = { videoinput: "quicksnap.camera", audioinput: "quicksnap.mic" };

function loadPref(kind: DeviceKind): string {
    try {
        return localStorage.getItem(PREF_KEY[kind]) ?? "";
    } catch {
        return "";
    }
}

function savePref(kind: DeviceKind, id: string) {
    try {
        if (id) localStorage.setItem(PREF_KEY[kind], id);
        else localStorage.removeItem(PREF_KEY[kind]);
    } catch {
        // Storage blocked: the choice just won't survive a reload.
    }
}

// The device the user picked; "" means "let us choose".
const cameraPref = signal(loadPref("videoinput"));
const micPref = signal(loadPref("audioinput"));

export function chooseCamera(id: string) {
    cameraPref.value = id;
    savePref("videoinput", id);
    void startCamera();
}

export function chooseMic(id: string) {
    micPref.value = id;
    savePref("audioinput", id);
    void startMic();
}

// The device to open when the user hasn't picked one: the system default,
// unless that's a phone. undefined = let the browser decide.
async function autoDevice(kind: DeviceKind): Promise<string | undefined> {
    const all = await navigator.mediaDevices.enumerateDevices();
    const isPhone = phoneCheck(all);
    const list = all.filter((d) => d.kind === kind && d.deviceId && d.label);
    if (!list.length) return undefined; // no permission yet, labels are hidden
    const dflt = list.find((d) => d.deviceId === "default");
    if (dflt && !isPhone(dflt.label)) return undefined;
    return list.find((d) => d.deviceId !== "default" && d.deviceId !== "communications" && !isPhone(d.label))?.deviceId;
}

async function openDevice(kind: DeviceKind, pref: string, constraints: (id?: string) => MediaTrackConstraints): Promise<MediaStream> {
    const get = (id?: string) => navigator.mediaDevices.getUserMedia(kind === "videoinput" ? { video: constraints(id) } : { audio: constraints(id) });
    if (pref) {
        try {
            return await get(pref);
        } catch (e) {
            // The chosen device went away (unplugged, phone out of range): fall back.
            if ((e as DOMException).name === "NotAllowedError") throw e;
        }
    }
    const stream = await get(await autoDevice(kind));
    // On the very first visit labels are hidden until permission is granted, so
    // the browser may have handed us the phone. Now we can see names: switch.
    const track = stream.getTracks()[0];
    if (track && phoneCheck(await navigator.mediaDevices.enumerateDevices())(track.label)) {
        const alt = await autoDevice(kind);
        if (alt && alt !== track.getSettings().deviceId) {
            stopTracks(stream);
            return get(alt);
        }
    }
    return stream;
}

export async function chooseScreen() {
    // Chrome otherwise brings the shared window or tab to the front, pulling the user out of the studio.
    const Ctl = (window as { CaptureController?: new () => { setFocusBehavior(b: string): void } }).CaptureController;
    const controller = Ctl ? new Ctl() : undefined;
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            controller,
            video: { frameRate: { ideal: frameRate.value }, width: { max: 3840 }, height: { max: 2160 } },
            audio: systemAudioOn.value
                ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
                : false,
            // Chrome-specific hints: offer the current tab last, allow system audio.
            selfBrowserSurface: "exclude",
            systemAudio: "include",
            surfaceSwitching: "include",
        } as DisplayMediaStreamOptions);
        // Must run right after the promise resolves; throws for entire-screen captures, which never move focus anyway.
        try {
            controller?.setFocusBehavior("no-focus-change");
        } catch {
            /* not a window or tab */
        }
        stopTracks(screenStream.value);
        screenStream.value = stream;
        stream.getVideoTracks()[0].addEventListener("ended", onScreenEnded);
        getMixer().set("system", stream.getAudioTracks().length ? stream : null);
    } catch (e) {
        if ((e as DOMException).name !== "NotAllowedError") toast(`Couldn't capture the screen: ${errorText(e)}`, "error");
    }
}

function onScreenEnded() {
    // The user clicked the browser's "Stop sharing".
    if (isRecording.value) void stopRecording();
    else clearScreen();
}

export function clearScreen() {
    stopTracks(screenStream.value);
    screenStream.value = null;
    mixer.value?.remove("system");
    if (replayOn.value) setReplay(false);
}

export async function startCamera() {
    stopTracks(cameraStream.value);
    cameraStream.value = null;
    if (!cameraOn.value) return;
    const h = cameraQuality.value === "1080" ? 1080 : 720;
    const video = (deviceId?: string): MediaTrackConstraints => ({
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: (h * 16) / 9 },
        height: { ideal: h },
        frameRate: { ideal: 30 },
    });
    try {
        const stream = await openDevice("videoinput", cameraPref.value, video);
        cameraStream.value = stream;
        const track = stream.getVideoTracks()[0];
        cameraId.value = track.getSettings().deviceId ?? "";
        track.addEventListener("ended", () => onDeviceLost("camera"));
        await refreshDevices();
    } catch (e) {
        cameraOn.value = false;
        toast(`Camera unavailable: ${errorText(e)}`, "error");
    }
}

function onDeviceLost(kind: "camera" | "mic") {
    if (kind === "camera" ? !cameraStream.value : !micStream.value) return;
    const name = kind === "camera" ? "Camera" : "Microphone";
    if (isRecording.value) {
        toast(`${name} disconnected. The recording continues without it.`, "error", 8000);
        return;
    }
    toast(`${name} disconnected. Switched to the default ${name.toLowerCase()}.`);
    // The saved choice stays: it's used again next time the device is around.
    if (kind === "camera") void startCamera();
    else void startMic();
}

export async function startMic() {
    stopTracks(micStream.value);
    micStream.value = null;
    mixer.value?.remove("mic");
    if (!micOn.value) return;
    const ns = noiseSuppression.value;
    const audio = (deviceId?: string): MediaTrackConstraints => ({
        deviceId: deviceId ? { exact: deviceId } : undefined,
        noiseSuppression: ns,
        echoCancellation: ns,
        autoGainControl: ns,
        channelCount: 1,
    });
    try {
        const stream = await openDevice("audioinput", micPref.value, audio);
        micStream.value = stream;
        getMixer().set("mic", stream);
        const track = stream.getAudioTracks()[0];
        micId.value = track.getSettings().deviceId ?? "";
        track.addEventListener("ended", () => onDeviceLost("mic"));
        await refreshDevices();
    } catch (e) {
        micOn.value = false;
        toast(`Microphone unavailable: ${errorText(e)}`, "error");
    }
}

export function releaseAll() {
    if (isRecording.value || recState.value === "countdown" || recState.value === "finalizing") return;
    setReplay(false);
    clearScreen();
    stopTracks(cameraStream.value);
    cameraStream.value = null;
    stopTracks(micStream.value);
    micStream.value = null;
    mixer.value?.close();
    mixer.value = null;
}

// ── Recording ───────────────────────────────────────────────────────────────

export function setScene(s: LayoutMode) {
    scene.value = s;
    session?.mark("scene", s);
}

export function addMarker() {
    if (!session || !isRecording.value) return;
    markers.value++;
    session.mark("marker", `Marker ${markers.value}`);
}

export async function startRecording() {
    if (recState.value !== "idle") return;
    const hasAudio = !!mixer.value && (mixer.value.has("mic") || mixer.value.has("system"));
    if (!screenStream.value && !cameraStream.value && !hasAudio) {
        toast("Choose a screen, or turn on the camera or microphone first.", "error");
        return;
    }
    void requestPersistence();
    if (countdownSeconds.value > 0) {
        recState.value = "countdown";
        for (let i = countdownSeconds.value; i > 0; i--) {
            countdown.value = i;
            await new Promise((r) => setTimeout(r, 1000));
            if (recState.value !== "countdown") return; // cancelled
        }
    }
    try {
        session = new RecordingSession({
            projectId: newProjectId(),
            screen: screenStream.value,
            camera: cameraStream.value,
            audio: hasAudio ? mixer.value!.track : null,
        });
        markers.value = 0;
        await session.start(scene.value);
        recState.value = "recording";
        ticker = window.setInterval(() => {
            elapsed.value = session?.elapsed ?? 0;
            recordedBytes.value = session?.bytes ?? 0;
        }, 250);
    } catch (e) {
        session = null;
        recState.value = "idle";
        toast(errorText(e), "error");
    }
}

export function cancelCountdown() {
    if (recState.value === "countdown") recState.value = "idle";
}

export function togglePause() {
    if (!session) return;
    if (recState.value === "recording") {
        session.pause();
        recState.value = "paused";
    } else if (recState.value === "paused") {
        session.resume();
        recState.value = "recording";
    }
}

export async function stopRecording() {
    if (!session || !isRecording.value) return;
    const s = session;
    session = null;
    clearInterval(ticker);
    recState.value = "finalizing";
    finalizeProgress.value = 0;
    try {
        const { sources, duration, events } = await s.stop();
        const fixed: SourceFile[] = [];
        for (let i = 0; i < sources.length; i++) {
            fixed.push(await finalizeSource(sources[i], (p) => (finalizeProgress.value = (i + p) / sources.length)));
        }
        const project = buildProject({ id: s.projectId, sources: fixed, events, duration });
        project.thumbnail = await makeThumbnail(project);
        await saveProject(project);
        elapsed.value = 0;
        recordedBytes.value = 0;
        recState.value = "idle";
        releaseAll();
        navigate({ name: "editor", id: project.id });
    } catch (e) {
        recState.value = "idle";
        toast(`Saving the recording failed: ${errorText(e)}`, "error");
    }
}

// ── Replay buffer ───────────────────────────────────────────────────────────

let replayTicker: number | undefined;

export function setReplay(on: boolean) {
    replay?.stop();
    replay = null;
    clearInterval(replayTicker);
    replayBuffered.value = 0;
    replayOn.value = false;
    if (!on) return;
    if (!replaySupported()) {
        toast("Replay needs Chrome or Edge.", "error");
        return;
    }
    const track = screenStream.value?.getVideoTracks()[0];
    if (!track) {
        toast("Choose a screen first.", "error");
        return;
    }
    replay = new ReplayBuffer(replaySeconds.value);
    const audio = mixer.value && (mixer.value.has("mic") || mixer.value.has("system")) ? mixer.value.track : null;
    void replay.start(track, audio);
    replayOn.value = true;
    replayTicker = window.setInterval(() => (replayBuffered.value = replay?.bufferedSeconds ?? 0), 500);
}

export async function saveReplay() {
    if (!replay) return;
    const id = newProjectId();
    try {
        toast("Saving replay…");
        const r = await replay.save(id);
        const sources: SourceFile[] = [
            { kind: "screen", path: r.path, mimeType: "video/webm", width: r.size[0], height: r.size[1], duration: r.duration },
        ];
        if (r.hasAudio) sources.push({ kind: "audio", path: r.path, mimeType: "video/webm", duration: r.duration });
        const project = buildProject({ id, sources, events: [{ t: 0, type: "scene", value: "screen" }], duration: r.duration });
        project.name = `Replay ${project.name.replace(/^Recording /, "")}`;
        project.thumbnail = await makeThumbnail(project);
        await saveProject(project);
        toast("Replay saved to your library.");
    } catch (e) {
        toast(`Couldn't save replay: ${errorText(e)}`, "error");
    }
}
