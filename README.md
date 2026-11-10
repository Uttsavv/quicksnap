# Quicksnap

Record your screen, camera and mic in the browser, then polish the recording
with zooms, backgrounds, layouts and captions, and export it as MP4, WebM or GIF.
Nothing is uploaded: recordings stay in the browser's storage.

Works best in Chrome or Edge. Firefox and Safari support recording, editing and
export, but not the floating controls or the replay buffer.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build in dist/
npm run preview    # serve dist/ locally
```

## Deploy (Cloudflare Pages)

```sh
npx wrangler login     # once
npm run deploy         # builds and uploads dist/ to the "quicksnap" Pages project
```

`public/_headers` sets the cross-origin isolation headers (COOP/COEP) that let
the speech model and the background-blur model use threads. Netlify reads the
same file, so deploying there needs no changes.

## How it works

- **Studio** records each source (screen, camera, mixed audio) to its own
  file with `MediaRecorder`, streaming chunks into the Origin Private File
  System. Recording keeps going when the Quicksnap tab is in the background.
  Scene switches and markers are saved as events.
- **Editor** is non-destructive. The project (in IndexedDB) holds clips (cuts,
  speed, volume), zoom segments, layout segments, captions and style.
  Times are stored as *source* time, so effects stay attached to the content when you cut.
- **Renderer** (`src/render/compositor.ts`) is the only drawing code. The live
  preview, the editor preview and the exporter all call it, so the export
  matches the preview.
- **Export** decodes frames with WebCodecs (via Mediabunny), draws them,
  encodes and muxes them. In Chrome/Edge it writes straight to the file you pick.

## Code map

| Path | What |
|---|---|
| `src/studio/` | Capture, mixer, recorder, replay buffer, floating controls (Document PiP), Studio UI |
| `src/editor/` | Editor UI, timeline, inspector, preview player, undo/redo store, smart zoom, silence detection, Whisper captions |
| `src/render/` | Compositor, easing, backgrounds, camera background blur (MediaPipe) |
| `src/export/` | MP4/WebM/GIF exporter, export dialog |
| `src/storage/` | OPFS file store (IndexedDB fallback for Safari), IndexedDB projects |
| `src/lib/` | Project types and timeline math |
| `docs/PLAN.md` | Product plan, browser limits, decisions |

## Keyboard shortcuts

| Studio | | Editor | |
|---|---|---|---|
| `⌥R` | Start/stop recording | `Space` | Play/pause |
| `⌥P` | Pause/resume | `S` | Split at playhead |
| `M` | Marker | `⌫` | Delete selection, or cut/restore the clip under the playhead |
| `1`–`4` | Switch scene | `Z` / `L` / `M` | Add zoom / layout / marker |
| | | `⌘Z`, `⇧⌘Z` | Undo, redo |
| | | `←` `→` | Step one frame (`⇧` = 1 s) |
