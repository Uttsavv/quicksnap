# Quicksnap — Product & Technical Plan

A browser-only screen recorder with an OBS-style studio for recording and a
Screen Studio-style editor for polish. No install, no upload: everything is
captured, edited and exported on the user's machine.

---

## 1. Where we are (v1)

`src/main.ts` does screen + facecam + audio → one `<canvas>` (720×480) →
`MediaRecorder` → `recording.webm` download.

### Bugs to fix before building on it

| # | Problem | Why it matters | Fix |
|---|---------|----------------|-----|
| 1 | Compositing runs on `requestAnimationFrame` | Chrome pauses rAF when the Quicksnap tab is hidden, which is exactly when the user switches to the app they are recording. The video freezes. | Record each source raw (no live canvas). Composite in the editor. |
| 2 | Canvas fixed at 720×480 | 16:9 screens get squashed and downscaled | Size the canvas from `track.getSettings()`; composite at export |
| 3 | Several audio tracks passed to one `MediaRecorder` | Chrome records only the first audio track, so mic and system audio never both make it in | Mix with Web Audio (`MediaStreamAudioDestinationNode`) |
| 4 | No `track.onended` handler | Clicking the browser's **Stop sharing** leaves the recorder running | Stop on the `ended` event of the screen track |
| 5 | Facecam `<video>` is not muted | The mic plays through the speakers, causing echo and feedback | `muted = true` on preview elements |
| 6 | `revokeObjectURL` runs right after `click()` | Some browsers cancel the download | Revoke after a delay, or keep the URL until the next recording |
| 7 | Mic only requested along with the camera | Audio-only and screen+mic recordings don't work | Ask for the mic with its own `getUserMedia` call |

---

## 2. What the browser can and can't do

Knowing this up front decides which "Screen Studio" features are real.

| Capability | API | Status |
|---|---|---|
| Capture a screen, window or tab | `getDisplayMedia` | All modern browsers |
| Tab audio | `getDisplayMedia({audio:true})` | Chrome/Edge |
| System audio | same | Chrome on Windows/ChromeOS. macOS: tab audio only, or system audio on newer Chrome + macOS 14.2+ (check per release) |
| Camera / mic, device picking | `getUserMedia`, `enumerateDevices` | All |
| Built-in noise suppression / AGC / echo cancel | constraints | All (quality varies) |
| Floating always-on-top controls + camera bubble | **Document Picture-in-Picture** | Chrome/Edge 116+ |
| Crop a tab capture to an element | Region Capture `cropTo` / Element Capture | Chrome |
| Frame-accurate decode/encode | **WebCodecs** | Chrome, Edge, Safari (partial), Firefox 130+ |
| Mux MP4/WebM in the browser | Mediabunny (JS lib) | Any WebCodecs browser |
| Large files without RAM blowups | **OPFS** (Origin Private File System) | All modern |
| Background removal / blur on camera | MediaPipe Selfie Segmentation (WASM/WebGPU) | All. Chrome also has a native `backgroundBlur` constraint on some platforms |
| On-device captions | Whisper via transformers.js (WebGPU) | Chrome/Edge best |
| **OS cursor position / clicks outside the tab** | none | **Not possible.** This is the main gap compared with Screen Studio |
| Hide the cursor in captured video | `cursor: "never"` constraint | In the spec, but Chrome ignores it |

### How this shapes Screen Studio-style effects

- **Backgrounds, padding, rounded corners, shadow, camera bubble, aspect ratios** —
  fully doable. They are rendering, not capture.
- **Zoom & pan with smooth easing** — fully doable as *manual* zoom segments in the editor.
- **Auto-zoom** — no cursor data, so we **infer it**: frame-difference the screen
  track at low resolution, find regions of activity (typing, clicks, scrolling),
  and *suggest* zoom segments the user can accept or delete. Label it
  "Smart zoom (beta)".
- **Cursor smoothing, enlarged cursor, click ripples** — not possible. The cursor
  is baked into the pixels. Possible later through an optional extension, but
  only for web pages.

---

## 3. Product shape

Three screens:

1. **Studio** (OBS-inspired): pick sources and a layout, check levels, then record.
2. **Editor** (Screen Studio-inspired): trim, cut, zoom, style. Non-destructive.
3. **Export**: format, resolution, aspect ratio, quality, with progress.

Plus a lightweight **Library** of past recordings, stored in OPFS.

### 3.1 Studio — inspired by OBS

- **Sources panel**: Screen/Window/Tab, Camera, Mic, System audio. Each has a
  device picker, an on/off toggle and a live thumbnail.
- **Scenes = layout presets**: *Screen only*, *Screen + bubble*, *Side by side*,
  *Camera only*. Switching scenes while recording (hotkeys 1–4) is saved as a
  **layout event** on the timeline. It is not baked in, so it can be changed in the editor.
- **Audio mixer**: per-source VU meter (Web Audio `AnalyserNode`), gain slider,
  mute, noise-suppression toggle.
- **Recording controls**: 3-2-1 countdown, pause/resume, elapsed timer, and a
  file-size and disk-quota indicator.
- **Floating control bar** (Document PiP): stop, pause, and a camera bubble that
  stays on top while the user works in another app. This is also our answer to
  "hotkeys only work while the tab has focus".
- **Replay buffer** (OBS feature): keep the last N minutes in a ring buffer and
  save it on demand. Optional.
- **Markers**: press `M` to drop a chapter marker that shows up in the editor.

### 3.2 Editor — inspired by Screen Studio

**Basic editing (v1 of editor)**
- Player with frame-accurate scrubbing (WebCodecs decode)
- Trim start/end, split at playhead (`S`), delete segment (`Backspace`)
- Speed segments (0.5×–4×)
- Mute or adjust audio volume per segment
- Undo/redo, auto-save to IndexedDB

**Polish (the "Screen Studio feel")**
- **Background**: wallpapers, gradients, solid colour, blurred screen, custom image
- **Frame**: padding, corner radius, drop shadow, inset
- **Zoom segments**: drag on the zoom track. Each has a zoom level, a focus point
  (click on the preview), and easing (spring, ease-in-out or none), plus optional
  motion blur during transitions
- **Smart zoom suggestions** (see §2)
- **Camera track**: bubble shape (circle, rounded square), size, corner position,
  and a per-segment layout (hide, bubble, full screen, side by side). Optional
  background blur or removal
- **Aspect ratio**: 16:9, 9:16, 1:1, 4:5. The screen is re-framed rather than stretched
- **Captions** (later): on-device Whisper, editable, burned in or exported as `.srt`
- **Silence removal** (later): detect silent stretches in the audio and offer
  them as cut segments

### 3.3 Export
- MP4 (H.264 + AAC) via WebCodecs + Mediabunny. WebM (VP9 + Opus) as fallback
- GIF for short clips
- 720p / 1080p / 4K (capped at source resolution), 30/60 fps
- Runs on the main thread (async, so the UI stays responsive) with a progress bar and ETA. Cancellable.
  Chrome/Edge stream the file straight to disk via the File System Access save dialog.

---

## 4. Architecture

```
            ┌─────────── Studio ───────────┐
 getDisplayMedia ─┐                        │
 getUserMedia ────┼─► per-source MediaRecorder (timeslice 1s) ─► OPFS chunks
 Web Audio mix ───┘          + event log (scenes, markers, pauses) ─► IndexedDB
            └──────────────────────────────┘
                              │
            ┌─────────── Editor ───────────┐
 OPFS ─► Mediabunny demux ─► WebCodecs decode ─► Compositor(project, t) ─► <canvas>
            Project JSON (cuts, zooms, layouts, style) ◄─ timeline UI
            └──────────────────────────────┘
                              │
            ┌─────────── Export ───────────┐
 same Compositor(project, t) on OffscreenCanvas ─► VideoEncoder ─► Mediabunny mux ─► file
            └──────────────────────────────┘
```

Key decisions:

1. **Record raw, composite later.** Screen, camera and audio are recorded as separate files.
   This fixes bug #1 and makes every effect non-destructive.
2. **One pure compositor.** `render(project, time, ctx)` is used by both the preview
   and the export, so the preview always matches the exported file.
   Start with Canvas 2D; move to WebGL if motion blur or performance needs it.
3. **Write to OPFS while recording** (`MediaRecorder` with a timeslice). A long
   recording won't run out of RAM, and a crash doesn't lose it.
4. **Project file** (stored in IndexedDB):

```ts
type Project = {
  id: string; createdAt: number; duration: number;
  sources: { id: string; kind: "screen" | "camera" | "mic" | "system";
             opfsPath: string; width?: number; height?: number; offsetMs: number }[];
  events: { t: number; type: "scene" | "marker" | "pause" | "resume"; value?: string }[];
  timeline: {
    cuts:   { start: number; end: number }[];
    speed:  { start: number; end: number; rate: number }[];
    zooms:  { start: number; end: number; scale: number; focus: [number, number];
              easing: "spring" | "ease" | "none" }[];
    layout: { start: number; end: number; mode: "screen" | "bubble" | "side" | "camera" }[];
  };
  style: { aspect: "16:9" | "9:16" | "1:1" | "4:5"; background: Background;
           padding: number; radius: number; shadow: number;
           camera: { shape: "circle" | "rounded"; size: number; corner: Corner; blurBg: boolean } };
};
```

5. **UI stack** (decided): **Preact + @preact/signals** on the existing Vite + TS setup.
   Signals let the playhead update at 60 fps without re-rendering the whole timeline.
   Decoding, compositing and export stay plain TS, outside the framework.
   No heavy UI kit; keep the existing CSS tokens.

### Proposed folder layout

```
src/
  studio/      capture.ts, mixer.ts, scenes.ts, pip.ts, recorder.ts
  editor/      player.ts, timeline/, inspector/, smartZoom.ts, history.ts
  render/      compositor.ts, easing.ts, backgrounds.ts
  export/      export.worker.ts, mux.ts
  storage/     opfs.ts, db.ts
  ui/          shared components, tokens.css
```

---

## 5. Roadmap

| Phase | Goal | Scope | Done when |
|---|---|---|---|
| **0. Foundations** | Make recording solid | Fix bugs 1–7, separate-source recording, OPFS streaming, MIME detection (Safari = mp4), countdown, timer, pause/resume, device pickers | A 30-min screen+cam+mic recording survives tab switching and produces correct files |
| **1. Studio** | OBS-style recording | Sources panel, scene presets + hotkeys, audio mixer + meters, Document PiP control bar, markers | User can switch layouts mid-recording and see that in the event log |
| **2. Editor basics** | Cut & export | Player, timeline (video/audio tracks), trim, split, delete, speed, undo/redo, MP4/WebM export | Trimmed export plays everywhere and matches the preview |
| **3. Polish** | Screen Studio feel | Backgrounds, padding/radius/shadow, zoom segments + spring easing, camera layouts track, aspect ratios, smart-zoom suggestions | A 16:9 recording exports as a polished 9:16 clip with zooms |
| **4. Niceties** | Delight | Library, captions (Whisper), silence removal, GIF export, camera bg blur, replay buffer, PWA install/offline | — |

Phases 0 and 2 are the critical path. Phase 3 is where it starts to feel like Screen Studio.

---

## 6. Decisions

1. **Framework**: Preact + signals.
2. **Hosting**: Cloudflare Pages (`npm run deploy`). `public/_headers` sets
   COOP/COEP so WASM features can use threads; Netlify reads the same file.
   Every build file must stay under Pages' 25 MiB limit, which is why
   `vite.config.ts` drops the unused onnxruntime WASM (transformers.js loads it from its CDN).
3. **Browsers**: Chrome/Edge get everything. Firefox/Safari get recording,
   editing and export. Floating controls and the replay buffer are Chrome/Edge only.
4. **Smart zoom**: shipped as suggestions (dashed on the timeline) that you keep or discard.
5. **Export runs on the main thread**, not a Worker. Camera background blur
   (MediaPipe) needs the same setup as the preview, and the work is mostly
   waiting on the hardware encoder.
6. **Out of scope**: cursor effects through a browser extension.

## 7. Status (2026-11-10)

All phases (0–4) are implemented. See `README.md` for the code map.
Covered by tests: the timeline math, zoom/layout timing and silence
detection. Still needs hands-on testing in real browsers: recording,
playback sync, export output, smart zoom quality, captions and background blur.
