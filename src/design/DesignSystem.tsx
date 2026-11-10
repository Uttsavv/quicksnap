import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Check, Meter, Segmented, Slider, toast } from "../ui/controls";
import { Icon } from "../ui/icons";
import { Loader, Skeleton, staggerIndex } from "../ui/motion";

/** Live reference for the design system: tokens, components and the motion collection.
 *  Values are read from CSS at runtime, so this page can't drift from tokens.css. */

const COLORS: [string, string[]][] = [
    ["Brand", ["accent", "accent-hover", "accent-soft", "accent-text", "record", "record-btn"]],
    ["Surface", ["app", "panel", "raised", "hover", "viewer"]],
    ["Content", ["text", "text-2", "muted", "line", "line-2", "ok", "warn"]],
    ["Timeline", ["clip", "zoom", "layout", "caption", "wave"]],
];
const TYPE = ["micro", "label", "xs", "sm", "ui", "base", "md", "lg", "xl", "2xl"];
const SPACE = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
const RADII = ["xs", "sm", "", "lg", "xl"];
const EASES = ["ease-out", "ease-in", "ease-in-out", "ease-spring"];
const DURS = ["dur-press", "dur-state", "dur-enter", "dur-emph", "dur-loop"];

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

function Section({ title, children }: { title: string; children: ComponentChildren }) {
    return (
        <section class="panel ds-section">
            <div class="panel-head">{title}</div>
            <div class="panel-body">{children}</div>
        </section>
    );
}

/** Remounts its children on click so the entrance animation plays again. */
function Demo({ name, note, children, tall }: { name: string; note: string; children: ComponentChildren; tall?: boolean }) {
    const [n, setN] = useState(0);
    return (
        <div class="ds-demo">
            <div class={`ds-stage${tall ? " tall" : ""}`} key={n}>
                {children}
            </div>
            <div class="spread">
                <div>
                    <div class="small" style={{ fontWeight: 600 }}>{name}</div>
                    <div class="small muted">{note}</div>
                </div>
                <button class="btn icon ghost" type="button" aria-label={`Replay ${name}`} title="Replay" onClick={() => setN(n + 1)}>
                    <Icon name="replay" />
                </button>
            </div>
        </div>
    );
}

function Ticker() {
    const [v, setV] = useState(3);
    useEffect(() => {
        const t = setInterval(() => setV((x) => (x === 1 ? 3 : x - 1)), 1000);
        return () => clearInterval(t);
    }, []);
    return (
        <span class="ds-count">
            <span class="tick" key={v}>{v}</span>
        </span>
    );
}

export function DesignSystem() {
    const [, force] = useState(0);
    useEffect(() => force(1), []); // read CSS vars after styles apply
    const [seg, setSeg] = useState<"a" | "b" | "c">("a");
    const [slider, setSlider] = useState(40);
    const [check, setCheck] = useState(true);
    const [p, setP] = useState(0.35);
    const [db, setDb] = useState(-30);
    useEffect(() => {
        const t = setInterval(() => {
            setP((x) => (x >= 1 ? 0 : x + 0.05));
            setDb(-60 + Math.random() * 55);
        }, 220);
        return () => clearInterval(t);
    }, []);

    return (
        <main class="library ds">
            <div class="spread">
                <h1 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>Design system</h1>
                <span class="small muted">src/styles/tokens.css · src/styles/motion.css · src/ui/motion.tsx</span>
            </div>

            <Section title="Colour">
                {COLORS.map(([group, names]) => (
                    <div class="group">
                        <h3 class="group-title">{group}</h3>
                        <div class="ds-swatches">
                            {names.map((n) => (
                                <div class="ds-swatch">
                                    <span style={{ background: `var(--${n})` }} />
                                    <code class="small">--{n}</code>
                                    <code class="small muted">{cssVar(n)}</code>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </Section>

            <div class="ds-cols">
                <Section title="Type">
                    {TYPE.map((t) => (
                        <div class="spread">
                            <span style={{ fontSize: `var(--fs-${t})` }}>Record, trim, export</span>
                            <code class="small muted">--fs-{t} · {cssVar(`fs-${t}`)}</code>
                        </div>
                    ))}
                </Section>
                <Section title="Space · radius · elevation">
                    {SPACE.map((s) => (
                        <div class="row">
                            <code class="small muted" style={{ width: "64px" }}>--sp-{s}</code>
                            <span class="ds-bar" style={{ width: `var(--sp-${s})` }} />
                        </div>
                    ))}
                    <div class="row-wrap">
                        {RADII.map((r) => (
                            <div class="ds-radius" style={{ borderRadius: `var(--r${r ? `-${r}` : ""})` }}>
                                <code class="small">--r{r ? `-${r}` : ""}</code>
                            </div>
                        ))}
                    </div>
                    <div class="row-wrap">
                        {[1, 2, 3].map((s) => (
                            <div class="ds-radius" style={{ boxShadow: `var(--shadow-${s})`, background: "var(--raised)" }}>
                                <code class="small">--shadow-{s}</code>
                            </div>
                        ))}
                    </div>
                </Section>
            </div>

            <Section title="Components">
                <div class="row-wrap">
                    <button class="btn primary" type="button">Primary</button>
                    <button class="btn" type="button">Default</button>
                    <button class="btn ghost" type="button">Ghost</button>
                    <button class="btn suggest" type="button"><Icon name="sparkle" /> Suggest</button>
                    <button class="btn danger" type="button"><Icon name="trash" /> Danger</button>
                    <button class="btn" type="button" aria-pressed="true">Pressed</button>
                    <button class="btn" type="button" disabled>Disabled</button>
                    <button class="btn icon" type="button" aria-label="Edit"><Icon name="edit" /></button>
                    <button class="btn record rec-main" type="button"><span class="dot" /> Record</button>
                    <button class="btn record rec-main live" type="button"><Icon name="stop" /> Stop</button>
                    <button class="btn play icon" type="button" aria-label="Play"><Icon name="play" /></button>
                </div>
                <div class="ds-cols">
                    <div class="col">
                        <Segmented label="Demo" value={seg} onChange={setSeg} options={[{ value: "a", label: "MP4" }, { value: "b", label: "WebM" }, { value: "c", label: "GIF" }]} />
                        <Slider label="Padding" value={slider} min={0} max={100} display={`${slider}%`} onInput={setSlider} />
                        <Check label="Also save captions" checked={check} onChange={setCheck} />
                        <input type="text" placeholder="Recording name" />
                    </div>
                    <div class="col">
                        <div class="progress"><div style={{ width: `${p * 100}%` }} /></div>
                        <div class="progress indeterminate"><div /></div>
                        <Meter db={db} />
                        <div class="callout small">Callouts hold in-progress work and tips.</div>
                        <div class="row small muted"><kbd>⌥R</kbd> record <kbd>J</kbd><kbd>K</kbd><kbd>L</kbd> shuttle</div>
                    </div>
                </div>
            </Section>

            <Section title="Motion tokens">
                <div class="ds-cols">
                    <div class="col">
                        {EASES.map((e) => (
                            <div class="ds-track">
                                <span class="ds-ball" style={{ transitionTimingFunction: `var(--${e})` }} />
                                <code class="small muted">--{e}</code>
                            </div>
                        ))}
                        <span class="small muted">Hover the tracks to run each curve.</span>
                    </div>
                    <div class="col">
                        {DURS.map((d) => (
                            <div class="spread">
                                <code class="small">--{d}</code>
                                <code class="small muted">{cssVar(d)}</code>
                            </div>
                        ))}
                        <div class="spread">
                            <code class="small">--stagger</code>
                            <code class="small muted">{cssVar("stagger")}</code>
                        </div>
                    </div>
                </div>
            </Section>

            <Section title="Animation collection">
                <div class="ds-demos">
                    <Demo name="Loader" note="<Loader label> · pixel Q scans, dot breathes" tall>
                        <Loader label="Opening recording" size={40} />
                    </Demo>
                    <Demo name="Skeleton" note="<Skeleton> · shimmer while data loads" tall>
                        <div class="col" style={{ width: "70%" }}>
                            <Skeleton style={{ aspectRatio: "16/9", display: "block" }} />
                            <Skeleton class="line" style={{ width: "60%", display: "block" }} />
                        </div>
                    </Demo>
                    <Demo name="Rise" note=".anim-rise · default entrance">
                        <div class="ds-chip anim-rise">Hello</div>
                    </Demo>
                    <Demo name="Pop" note=".anim-pop · spring, for small things">
                        <div class="ds-chip anim-pop">Saved</div>
                    </Demo>
                    <Demo name="Drop" note=".anim-drop · tags and markers from above">
                        <span class="monitor-tag" style={{ position: "static" }}><span class="rec-dot" /> Recording</span>
                    </Demo>
                    <Demo name="Shake" note=".anim-shake · rejected input">
                        <div class="ds-chip anim-shake" style={{ borderColor: "var(--record)" }}>Nope</div>
                    </Demo>
                    <Demo name="Stagger" note=".stagger + --i · siblings in sequence">
                        <div class="row stagger">
                            {[0, 1, 2, 3, 4].map((i) => <span class="ds-chip" style={staggerIndex(i)}>{i + 1}</span>)}
                        </div>
                    </Demo>
                    <Demo name="Countdown" note=".countdown .tick · re-keyed each second">
                        <Ticker />
                    </Demo>
                    <Demo name="Live" note=".rec-dot, .btn.record.live · halo while recording">
                        <button class="btn record rec-main live" type="button"><Icon name="stop" /> Stop</button>
                    </Demo>
                    <Demo name="Track item" note=".tl-item · grows in from its start">
                        <div style={{ position: "relative", width: "80%", height: "28px" }}>
                            <span class="tl-item zoom" style={{ left: 0, width: "60%" }}>Zoom 2×</span>
                        </div>
                    </Demo>
                    <Demo name="Toasts" note="toast(text, kind) · rise in, sink out">
                        <div class="row">
                            <button class="btn" type="button" onClick={() => toast("Marker added")}>Info</button>
                            <button class="btn" type="button" onClick={() => toast("Export finished.", "success")}>Success</button>
                            <button class="btn" type="button" onClick={() => toast("Permission was denied.", "error")}>Error</button>
                        </div>
                    </Demo>
                    <Demo name="Dialog" note=".modal-back + .modal · fade and pop">
                        <div class="modal" style={{ width: "80%", padding: "var(--sp-6)" }}>
                            <div class="small">Export · 0:42</div>
                        </div>
                    </Demo>
                </div>
            </Section>
        </main>
    );
}
