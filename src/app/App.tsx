import { lazy, Suspense } from "preact/compat";
import { Toasts } from "../ui/controls";
import { Icon } from "../ui/icons";
import { Logo } from "../ui/Logo";
import { Library } from "../library/Library";
import { Studio } from "../studio/Studio";
import { href, route } from "./router";

const Editor = lazy(() => import("../editor/Editor").then((m) => ({ default: m.Editor })));

function AppBar() {
    const r = route.value.name;
    return (
        <header class="appbar">
            <div class="row" style={{ gap: "20px" }}>
                <Logo />
                <nav class="nav" aria-label="Main">
                    <a href={href({ name: "studio" })} aria-current={r === "studio" ? "page" : undefined}>
                        Studio
                    </a>
                    <a href={href({ name: "library" })} aria-current={r === "library" ? "page" : undefined}>
                        Library
                    </a>
                </nav>
            </div>
            <span class="row small muted">
                <Icon name="lock" size={14} /> Everything stays in your browser
            </span>
        </header>
    );
}

export function App() {
    const r = route.value;
    return (
        <>
            {r.name !== "editor" && <AppBar />}
            {r.name === "studio" && <Studio />}
            {r.name === "library" && <Library />}
            {r.name === "editor" && (
                <Suspense fallback={<div class="empty">Loading editor…</div>}>
                    <Editor key={r.id} id={r.id} />
                </Suspense>
            )}
            <Toasts />
        </>
    );
}
