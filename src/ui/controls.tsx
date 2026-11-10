import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";

export function Segmented<T extends string>(props: {
    value: T;
    options: { value: T; label: ComponentChildren }[];
    onChange: (v: T) => void;
    label: string;
    full?: boolean;
}) {
    return (
        <div class={props.full ? "seg full" : "seg"} role="group" aria-label={props.label}>
            {props.options.map((o) => (
                <button type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function Slider(props: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    display?: string;
    onInput: (v: number) => void;
    onCommit?: () => void;
}) {
    return (
        <label class="field">
            <span class="field-head">
                <span>{props.label}</span>
                <span class="mono">{props.display ?? props.value}</span>
            </span>
            <input
                type="range"
                min={props.min}
                max={props.max}
                step={props.step ?? 1}
                value={props.value}
                onInput={(e) => props.onInput(Number((e.target as HTMLInputElement).value))}
                onChange={() => props.onCommit?.()}
            />
        </label>
    );
}

export function Check(props: { label: ComponentChildren; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
        <label class="check">
            <span>{props.label}</span>
            <input
                type="checkbox"
                checked={props.checked}
                disabled={props.disabled}
                onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
            />
        </label>
    );
}

// ── Toasts ──────────────────────────────────────────────────────────────────

interface Toast {
    id: number;
    text: string;
    kind: "info" | "error";
}
export const toasts = signal<Toast[]>([]);
let nextToast = 1;

export function toast(text: string, kind: Toast["kind"] = "info", ms = 4500) {
    const id = nextToast++;
    toasts.value = [...toasts.value, { id, text, kind }];
    setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), ms);
}

export function errorText(e: unknown): string {
    if (e instanceof DOMException && e.name === "NotAllowedError") return "Permission was denied.";
    if (e instanceof Error) return e.message;
    return String(e);
}

export function Toasts() {
    return (
        <div class="toast-wrap" role="status" aria-live="polite">
            {toasts.value.map((t) => (
                <div key={t.id} class={`toast ${t.kind}`}>
                    {t.text}
                </div>
            ))}
        </div>
    );
}

export function Meter({ db, segments = 24 }: { db: number; segments?: number }) {
    // Map −60..0 dBFS to 0..1.
    const level = isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
    return (
        <div class="meter" aria-hidden="true">
            {Array.from({ length: segments }, (_, i) => {
                const on = i / segments < level;
                const hot = i >= segments - 3;
                return <span class={on ? (hot ? "hot" : "on") : ""} />;
            })}
        </div>
    );
}
