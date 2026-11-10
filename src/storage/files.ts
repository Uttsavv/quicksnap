// Large media files. Uses the Origin Private File System when it supports
// streaming writes (Chrome, Edge, Firefox), otherwise IndexedDB blobs (Safari).
// Paths look like "<projectId>/screen.webm".

import { blobs } from "./db";

export interface FileWriter {
    write(chunk: Blob | Uint8Array): Promise<void>;
    /** Positional write, used by the MP4 muxer. */
    writeAt(data: Uint8Array, position: number): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
    readonly bytes: number;
}

let opfsOk: Promise<boolean> | null = null;

async function supportsOpfsWritable(): Promise<boolean> {
    try {
        const root = await navigator.storage.getDirectory();
        const h = await root.getFileHandle(".probe", { create: true });
        if (typeof (h as FileSystemFileHandle).createWritable !== "function") return false;
        const w = await h.createWritable();
        await w.close();
        await root.removeEntry(".probe");
        return true;
    } catch {
        return false;
    }
}

function useOpfs() {
    opfsOk ??= supportsOpfsWritable();
    return opfsOk;
}

async function dirFor(path: string, create: boolean) {
    const parts = path.split("/");
    const name = parts.pop()!;
    let dir = await navigator.storage.getDirectory();
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return { dir, name };
}

export async function createWriter(path: string): Promise<FileWriter> {
    if (await useOpfs()) {
        const { dir, name } = await dirFor(path, true);
        const handle = await dir.getFileHandle(name, { create: true });
        const w = await handle.createWritable();
        let bytes = 0;
        // Serialize writes: MediaRecorder can fire dataavailable faster than we flush.
        let queue = Promise.resolve();
        const enqueue = (fn: () => Promise<void>) => (queue = queue.then(fn));
        return {
            get bytes() {
                return bytes;
            },
            write: (chunk) =>
                enqueue(async () => {
                    bytes += chunk instanceof Blob ? chunk.size : chunk.byteLength;
                    await w.write(chunk as FileSystemWriteChunkType);
                }),
            writeAt: (data, position) =>
                enqueue(async () => {
                    bytes = Math.max(bytes, position + data.byteLength);
                    await w.write({ type: "write", position, data: data as Uint8Array<ArrayBuffer> });
                }),
            close: () => enqueue(() => w.close()),
            abort: () => enqueue(() => w.abort()),
        };
    }

    // Fallback: keep in memory, persist to IndexedDB on close.
    const parts: BlobPart[] = [];
    let buffer: Uint8Array | null = null; // for positional writes
    let bytes = 0;
    return {
        get bytes() {
            return bytes;
        },
        async write(chunk) {
            parts.push(chunk as BlobPart);
            bytes += chunk instanceof Blob ? chunk.size : chunk.byteLength;
        },
        async writeAt(data, position) {
            const need = position + data.byteLength;
            if (!buffer || buffer.byteLength < need) {
                const next = new Uint8Array(Math.max(need, (buffer?.byteLength ?? 0) * 2, 1 << 20));
                if (buffer) next.set(buffer);
                buffer = next;
            }
            buffer.set(data, position);
            bytes = Math.max(bytes, need);
        },
        async close() {
            const blob = buffer ? new Blob([buffer.slice(0, bytes)]) : new Blob(parts);
            await blobs.put(path, blob);
        },
        async abort() {
            parts.length = 0;
            buffer = null;
        },
    };
}

export async function readFile(path: string): Promise<File | Blob> {
    if (await useOpfs()) {
        try {
            const { dir, name } = await dirFor(path, false);
            return await (await dir.getFileHandle(name)).getFile();
        } catch {
            /* fall through: may have been stored as a blob */
        }
    }
    const b = await blobs.get(path);
    if (!b) throw new Error(`Missing file: ${path}`);
    return b;
}

export async function writeFile(path: string, data: Blob): Promise<void> {
    const w = await createWriter(path);
    await w.write(data);
    await w.close();
}

export async function deleteFile(path: string): Promise<void> {
    if (await useOpfs()) {
        try {
            const { dir, name } = await dirFor(path, false);
            await dir.removeEntry(name);
        } catch {
            /* already gone */
        }
    }
    await blobs.delete(path).catch(() => {});
}

export async function deleteDir(prefix: string): Promise<void> {
    if (await useOpfs()) {
        try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(prefix, { recursive: true });
        } catch {
            /* already gone */
        }
    }
    for (const k of await blobs.keys()) if (String(k).startsWith(prefix + "/")) await blobs.delete(String(k));
}

export async function storageEstimate(): Promise<{ used: number; free: number } | null> {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { used: e.usage ?? 0, free: (e.quota ?? 0) - (e.usage ?? 0) };
}

export async function requestPersistence() {
    try {
        if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch {
        /* best effort */
    }
}

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    const u = ["KB", "MB", "GB", "TB"];
    let i = -1;
    do {
        n /= 1024;
        i++;
    } while (n >= 1024 && i < u.length - 1);
    return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}
