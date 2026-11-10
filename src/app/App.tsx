import { lazy, Suspense } from "preact/compat";
import { Toasts } from "../ui/controls";
import { Icon } from "../ui/icons";
import { Logo } from "../ui/Logo";
import { Loader } from "../ui/motion";
import { Library } from "../library/Library";
import { Studio } from "../studio/Studio";
import { href, route } from "./router";

const DesignSystem = lazy(() => import("../design/DesignSystem").then((m) => ({ default: m.DesignSystem })));
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
                    {import.meta.env.DEV && (
                        <a href={href({ name: "design" })} aria-current={r === "design" ? "page" : undefined}>
                            Design
                        </a>
                    )}
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
            {r.name === "design" && (
                <Suspense fallback={<Loader />}>
                    <DesignSystem />
                </Suspense>
            )}
            {r.name === "editor" && (
                <Suspense fallback={<Loader label="Loading editor" />}>
                    <Editor key={r.id} id={r.id} />
                </Suspense>
            )}
            <Toasts />
        </>
    );
}
