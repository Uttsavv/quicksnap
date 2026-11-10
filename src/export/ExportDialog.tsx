import { useEffect, useRef, useState } from "preact/hooks";
import { outputDuration, formatTime } from "../lib/timeline";
import { outputSize } from "../render/compositor";
import { project, setStyle } from "../editor/store";
import { formatBytes } from "../storage/files";
import { Check, Segmented, errorText, toast } from "../ui/controls";
import { Icon } from "../ui/icons";
import { download, estimateSize, exportSrt, exportVideo, isCancelled, safeName, type ExportFormat, type ExportQuality } from "./exporter";

type SaveFilePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;

export function ExportDialog({ onClose }: { onClose: () => void }) {
    const p = project.value!;
    const screen = p.sources.find((s) => s.kind === "screen") ?? p.sources.find((s) => s.kind === "camera");
    const sourceShort = screen?.width && screen.height ? Math.min(screen.width, screen.height) : 1080;
    const [format, setFormat] = useState<ExportFormat>("mp4");
    const [height, setHeight] = useState(Math.min(1080, sourceShort >= 1080 ? 1080 : 720));
    const [fps, setFps] = useState(30);
    const [quality, setQuality] = useState<ExportQuality>("high");
    const [srt, setSrt] = useState(p.timeline.captions.length > 0);
    const [progress, setProgress] = useState<{ p: number; eta: number | null } | null>(null);
    const abort = useRef<AbortController | null>(null);
    const dur = outputDuration(p.timeline.clips);
    const [w, h] = outputSize(p.style.aspect, format === "gif" ? Math.min(height, 480) : height);
    const busy = !!progress;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
        addEventListener("keydown", onKey);
        return () => removeEventListener("keydown", onKey);
    }, [busy]);

    const run = async () => {
        const name = safeName(p.name);
        const ext = format;
        let handle: FileSystemFileHandle | null = null;
        // Stream straight to disk when the browser allows it (must happen in the click).
        const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
        if (picker && format !== "gif") {
            try {
                handle = await picker({
                    suggestedName: `${name}.${ext}`,
                    types: [{ description: ext.toUpperCase(), accept: { [ext === "mp4" ? "video/mp4" : "video/webm"]: [`.${ext}`] } }],
                });
            } catch (e) {
                if ((e as DOMException).name === "AbortError") return;
                handle = null;
            }
        }
        abort.current = new AbortController();
        setProgress({ p: 0, eta: null });
        try {
            const blob = await exportVideo(p, {
                format,
                height,
                fps: format === "gif" ? Math.min(fps, 15) : fps,
                quality,
                fileHandle: handle,
                signal: abort.current.signal,
                onProgress: (pp, eta) => setProgress({ p: pp, eta }),
            });
            if (blob) download(blob, `${name}.${ext}`);
            if (srt && p.timeline.captions.length) download(exportSrt(p), `${name}.srt`);
            toast(handle ? `Saved ${handle.name}` : "Export finished.", "success");
            onClose();
        } catch (e) {
            if (!isCancelled(e)) toast(`Export failed: ${errorText(e)}`, "error");
        } finally {
            setProgress(null);
            abort.current = null;
        }
    };

    const heights = [720, 1080, 1440, 2160].filter((x) => x <= Math.max(720, sourceShort * 1.5));

    return (
        <div class="modal-back" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
                <div class="panel-head" style={{ height: "48px", textTransform: "none", letterSpacing: 0 }}>
                    <div>
                        <h2 id="export-title" style={{ margin: 0, fontSize: "15px", color: "var(--text)" }}>
                            Export
                        </h2>
                        <div class="small muted" style={{ fontWeight: 400 }}>
                            {p.name} · {formatTime(dur)}
                        </div>
                    </div>
                    <button class="btn icon ghost" type="button" aria-label="Close" disabled={busy} onClick={onClose}>
                        <Icon name="close" />
                    </button>
                </div>

                <div class="panel-body">
                    <div class="field">
                        <span class="field-head">Format</span>
                        <Segmented<ExportFormat>
                            label="Format"
                            value={format}
                            options={[
                                { value: "mp4", label: "MP4 · plays everywhere" },
                                { value: "webm", label: "WebM · smaller" },
                                { value: "gif", label: "GIF" },
                            ]}
                            onChange={setFormat}
                        />
                        {format === "gif" && dur > 30 && <span class="small warn-text">GIFs get very large past 30 seconds. Trim first, or export MP4.</span>}
                    </div>
                    <div class="field">
                        <span class="field-head">Aspect ratio</span>
                        <Segmented
                            label="Aspect ratio"
                            value={p.style.aspect}
                            options={(["16:9", "9:16", "1:1", "4:5"] as const).map((a) => ({ value: a, label: a }))}
                            onChange={(a) => setStyle(() => ({ aspect: a }))}
                        />
                    </div>
                    <div class="row-wrap" style={{ gap: "24px" }}>
                        <div class="field">
                            <span class="field-head">Resolution</span>
                            <Segmented
                                label="Resolution"
                                value={String(height)}
                                options={heights.map((x) => ({ value: String(x), label: x === 2160 ? "4K" : `${x}p` }))}
                                onChange={(v) => setHeight(Number(v))}
                            />
                        </div>
                        <div class="field">
                            <span class="field-head">Frame rate</span>
                            <Segmented
                                label="Frame rate"
                                value={String(fps)}
                                options={[
                                    { value: "30", label: "30 fps" },
                                    { value: "60", label: "60 fps" },
                                ]}
                                onChange={(v) => setFps(Number(v))}
                            />
                        </div>
                        {format !== "gif" && (
                            <div class="field">
                                <span class="field-head">Quality</span>
                                <Segmented<ExportQuality>
                                    label="Quality"
                                    value={quality}
                                    options={[
                                        { value: "medium", label: "Medium" },
                                        { value: "high", label: "High" },
                                        { value: "very-high", label: "Best" },
                                    ]}
                                    onChange={setQuality}
                                />
                            </div>
                        )}
                    </div>
                    <div class="small muted">
                        {w}×{h} · about {formatBytes(estimateSize(p, { format, height, fps, quality }))}
                    </div>
                    {p.timeline.captions.length > 0 && <Check label="Also save captions as .srt" checked={srt} onChange={setSrt} />}

                    {progress && (
                        <div class="callout">
                            <div class="spread small">
                                <span>Encoding on this device…</span>
                                <span class="mono muted">
                                    {Math.round(progress.p * 100)}%{progress.eta != null ? ` · ${Math.ceil(progress.eta)} s left` : ""}
                                </span>
                            </div>
                            <div class="progress">
                                <div style={{ width: `${progress.p * 100}%` }} />
                            </div>
                            <span class="small muted">Keep this tab open until it finishes.</span>
                        </div>
                    )}

                    <div class="row-wrap">
                        {busy ? (
                            <button class="btn lg danger" type="button" onClick={() => abort.current?.abort()}>
                                Cancel export
                            </button>
                        ) : (
                            <>
                                <button class="btn lg primary" type="button" onClick={() => void run()}>
                                    <Icon name="download" /> Export {format.toUpperCase()}
                                </button>
                                {p.timeline.captions.length > 0 && (
                                    <button class="btn lg" type="button" onClick={() => download(exportSrt(p), `${safeName(p.name)}.srt`)}>
                                        Captions only (.srt)
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
