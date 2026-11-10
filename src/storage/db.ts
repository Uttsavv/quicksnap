// Small IndexedDB wrapper: project documents, fallback blobs, and settings.

import type { Project } from "../lib/types";

type StoreName = "projects" | "blobs" | "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open("quicksnap", 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            db.createObjectStore("projects", { keyPath: "id" });
            db.createObjectStore("blobs");
            db.createObjectStore("kv");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export const projects = {
    list: async (): Promise<Project[]> => {
        const all = await run<Project[]>("projects", "readonly", (s) => s.getAll());
        return all.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    get: (id: string) => run<Project | undefined>("projects", "readonly", (s) => s.get(id)),
    put: (p: Project) => run("projects", "readwrite", (s) => s.put(p)),
    delete: (id: string) => run("projects", "readwrite", (s) => s.delete(id)),
};

export const blobs = {
    get: (key: string) => run<Blob | undefined>("blobs", "readonly", (s) => s.get(key)),
    put: (key: string, b: Blob) => run("blobs", "readwrite", (s) => s.put(b, key)),
    delete: (key: string) => run("blobs", "readwrite", (s) => s.delete(key)),
    keys: () => run<IDBValidKey[]>("blobs", "readonly", (s) => s.getAllKeys()),
};

export const kv = {
    get: <T>(key: string) => run<T | undefined>("kv", "readonly", (s) => s.get(key)),
    set: (key: string, v: unknown) => run("kv", "readwrite", (s) => s.put(v, key)),
};
