import { uid, type Caption } from "../lib/types";
import { audioForSpeech } from "./analysis";
import type { WhisperMessage, WhisperRequest } from "./whisper.worker";

export interface CaptionProgress {
    stage: string;
    progress: number;
}

/** Split long recognizer segments into readable caption lines. */
function splitSegment(start: number, end: number, text: string, maxWords = 10): Caption[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return [{ id: uid(), start, end, text }];
    const parts = Math.ceil(words.length / maxWords);
    const per = Math.ceil(words.length / parts);
    const out: Caption[] = [];
    let w = 0;
    for (let i = 0; i < parts; i++) {
        const chunk = words.slice(i * per, (i + 1) * per);
        const s = start + ((end - start) * w) / words.length;
        w += chunk.length;
        const e = start + ((end - start) * w) / words.length;
        out.push({ id: uid(), start: s, end: e, text: chunk.join(" ") });
    }
    return out;
}

export async function transcribe(audioPath: string, onProgress: (p: CaptionProgress) => void, signal: AbortSignal, language?: string): Promise<Caption[]> {
    onProgress({ stage: "Reading audio…", progress: 0 });
    const audio = await audioForSpeech(audioPath, (p) => onProgress({ stage: "Reading audio…", progress: p }));
    if (!audio) throw new Error("This recording has no audio.");
    if (signal.aborted) return [];

    const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    const captions: Caption[] = [];
    try {
        await new Promise<void>((resolve, reject) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
            worker.onerror = (e) => reject(new Error(e.message || "Speech recognition failed"));
            worker.onmessage = (e: MessageEvent<WhisperMessage>) => {
                const m = e.data;
                if (m.type === "status") onProgress({ stage: m.text, progress: 0 });
                else if (m.type === "download") onProgress({ stage: "Downloading the speech model (first time only)…", progress: m.progress });
                else if (m.type === "progress") onProgress({ stage: "Transcribing…", progress: m.progress });
                else if (m.type === "segment") captions.push(...splitSegment(m.start, m.end, m.text));
                else if (m.type === "done") resolve();
                else if (m.type === "error") reject(new Error(m.text));
            };
            const req: WhisperRequest = { audio, language };
            worker.postMessage(req, [audio.buffer]);
        });
    } finally {
        worker.terminate();
    }
    return captions;
}

const srtTime = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    const r = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(r).padStart(3, "0")}`;
};

/** Captions with times already mapped to output time. */
export function toSrt(caps: { start: number; end: number; text: string }[]): string {
    return caps.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

export function toVtt(caps: { start: number; end: number; text: string }[]): string {
    return "WEBVTT\n\n" + caps.map((c) => `${srtTime(c.start).replace(",", ".")} --> ${srtTime(c.end).replace(",", ".")}\n${c.text}\n`).join("\n");
}
