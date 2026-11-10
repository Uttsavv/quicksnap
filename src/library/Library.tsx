import { useEffect, useState } from "preact/hooks";
import { href } from "../app/router";
import { deleteProject, saveProject } from "../lib/project";
import { formatTime } from "../lib/timeline";
import type { Project } from "../lib/types";
import { projects } from "../storage/db";
import { formatBytes, readFile, storageEstimate } from "../storage/files";
import { errorText, toast } from "../ui/controls";
import { Icon } from "../ui/icons";
import { Skeleton, staggerIndex } from "../ui/motion";

function Thumb({ path }: { path?: string }) {
    const [url, setUrl] = useState<string>();
    useEffect(() => {
        if (!path) return;
        let u: string | undefined;
        readFile(path)
            .then((f) => setUrl((u = URL.createObjectURL(f))))
            .catch(() => {});
        return () => u && URL.revokeObjectURL(u);
    }, [path]);
    if (!path) return null;
    return url ? <img src={url} alt="" /> : <Skeleton />;
}

export function Library() {
    const [list, setList] = useState<Project[] | null>(null);
    const [est, setEst] = useState<{ used: number; free: number } | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);

    const load = async () => {
        setList(await projects.list());
        setEst(await storageEstimate());
    };
    useEffect(() => void load(), []);

    const remove = async (p: Project) => {
        if (!confirm(`Delete "${p.name}"? This removes the recording from this browser.`)) return;
        try {
            await deleteProject(p.id);
            await load();
        } catch (e) {
            toast(errorText(e), "error");
        }
    };

    const rename = async (p: Project, name: string) => {
        setRenaming(null);
        if (!name.trim() || name === p.name) return;
        await saveProject({ ...p, name: name.trim() });
        await load();
    };

    return (
        <main class="library">
            <div class="spread" style={{ flexWrap: "wrap" }}>
                <h1 style={{ margin: 0, fontSize: "18px" }}>Library</h1>
                <span class="small muted">
                    {list ? `${list.length} recording${list.length === 1 ? "" : "s"}` : ""}
                    {est ? ` · ${formatBytes(est.used)} used · ${formatBytes(est.free)} free` : ""}
                </span>
            </div>
            {list && list.length === 0 && (
                <div class="empty">
                    <div class="col anim-rise" style={{ alignItems: "center" }}>
                        <p style={{ margin: 0 }}>No recordings yet.</p>
                        <a class="btn primary" href="#/">
                            Start a recording
                        </a>
                    </div>
                </div>
            )}
            {!list && (
                <div class="lib-grid stagger" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => (
                        <div class="lib-card" style={staggerIndex(i)}>
                            <Skeleton class="lib-thumb" />
                            <div class="lib-body">
                                <Skeleton class="line" style={{ width: "60%" }} />
                                <Skeleton class="line" style={{ width: "85%" }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <div class="lib-grid stagger">
                {list?.map((p, i) => (
                    <article class="lib-card" key={p.id} style={staggerIndex(i)}>
                        <a class="lib-thumb" href={href({ name: "editor", id: p.id })} aria-label={`Edit ${p.name}`}>
                            <Thumb path={p.thumbnail} />
                            <span class="lib-dur">{formatTime(p.duration)}</span>
                        </a>
                        <div class="lib-body">
                            {renaming === p.id ? (
                                <input
                                    type="text"
                                    aria-label="Name"
                                    value={p.name}
                                    ref={(el) => el?.focus()}
                                    onBlur={(e) => void rename(p, (e.target as HTMLInputElement).value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                        if (e.key === "Escape") setRenaming(null);
                                    }}
                                />
                            ) : (
                                <div class="truncate" style={{ fontWeight: 600 }}>{p.name}</div>
                            )}
                            <div class="small muted">
                                {new Date(p.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                                {p.sources.map((s) => s.kind).join(" + ")}
                            </div>
                            <div class="row">
                                <a class="btn" href={href({ name: "editor", id: p.id })}>
                                    <Icon name="edit" /> Edit
                                </a>
                                <button class="btn icon" type="button" aria-label={`Rename ${p.name}`} title="Rename" onClick={() => setRenaming(p.id)}>
                                    <Icon name="rename" />
                                </button>
                                <button class="btn icon danger" type="button" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => void remove(p)}>
                                    <Icon name="trash" />
                                </button>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
        </main>
    );
}
