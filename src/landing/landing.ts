import "./landing.css";

/* Four small behaviours. Each runs on its own, so one failing never takes the
   others down, and the page reads fine with none of them:
     1. the header gains a solid, blurred bar once the page scrolls
     2. FAQ answers open and close with a height animation
     3. feature cards loop together, and pause while off screen
     4. the hero walks through the process in the editor: record → stop → accept zoom → captions → export */

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function safely(name: string, fn: () => void) {
    try {
        fn();
    } catch (err) {
        console.error(`[landing] ${name}:`, err);
    }
}

/** A clock that only advances while `running()` is true; requestAnimationFrame also stops in hidden tabs. */
function makeSleep(running: () => boolean) {
    return (ms: number) =>
        new Promise<void>((done) => {
            let last = performance.now();
            const tick = (now: number) => {
                if (running()) ms -= now - last;
                last = now;
                if (ms <= 0) done();
                else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
}

function onScreen(el: Element, cb: (visible: boolean) => void) {
    new IntersectionObserver(([e]) => cb(e.isIntersecting), { threshold: 0.25 }).observe(el);
}

/* ── 1. Header ──────────────────────────────────────────────────── */

safely("header", () => {
    const head = document.querySelector(".l-head");
    if (!head) return;
    const sync = () => head.classList.toggle("scrolled", scrollY > 8);
    addEventListener("scroll", sync, { passive: true });
    sync();
});

/* ── 2. FAQ ─────────────────────────────────────────────────────── */

safely("faq", () => {
    if (reduced) return; // native, instant open and close
    for (const details of document.querySelectorAll<HTMLDetailsElement>(".qa details")) {
        const summary = details.querySelector("summary")!;
        let anim: Animation | null = null;

        summary.addEventListener("click", (e) => {
            e.preventDefault();
            const start = details.getBoundingClientRect().height;
            anim?.cancel();
            const closing = details.open && !details.classList.contains("closing");

            if (closing) {
                details.classList.add("closing");
                const end = summary.offsetHeight;
                anim = details.animate({ height: [`${start}px`, `${end}px`] }, { duration: 320, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
            } else {
                details.classList.remove("closing");
                details.open = true;
                const end = details.scrollHeight;
                anim = details.animate({ height: [`${start}px`, `${end}px`] }, { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
            }
            anim.onfinish = () => {
                if (closing) details.open = false;
                details.classList.remove("closing");
                anim = null;
            };
        });
    }
});

/* ── 3. Feature cards: all loop at once, paused off screen ─────── */

safely("cards", () => {
    const grid = document.querySelector(".cards");
    if (!grid) return;
    onScreen(grid, (v) => grid.classList.toggle("is-paused", !v));
});

/* ── 3b. Hero → features: playhead scrubs the ruler, the section rises in ── */

/** Sets --p on `el` from 0 to 1 as it scrolls from the bottom of the screen up to the top third. */
function scrub(el: HTMLElement, onProgress?: (p: number) => void) {
    if (reduced) {
        el.style.setProperty("--p", "1");
        onProgress?.(1);
        return;
    }
    let queued = false;
    const sync = () => {
        queued = false;
        const top = el.getBoundingClientRect().top;
        const p = Math.min(1, Math.max(0, (innerHeight - top) / (innerHeight * 0.66)));
        el.style.setProperty("--p", p.toFixed(4));
        onProgress?.(p);
    };
    const queue = () => {
        if (!queued) (queued = true), requestAnimationFrame(sync);
    };
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    sync();
}

/** Hides a section until it scrolls in, then lets it rise. Skipped when it's already on screen (deep links). */
function riseIn(section: HTMLElement) {
    if (reduced || section.getBoundingClientRect().top <= innerHeight * 0.85) return;
    section.classList.add("pre");
    const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        section.classList.remove("pre");
        io.disconnect();
    }, { rootMargin: "0px 0px -20% 0px" });
    io.observe(section);
}

safely("seam", () => {
    const seam = document.querySelector<HTMLElement>(".seam");
    if (seam) scrub(seam);
    const features = document.querySelector<HTMLElement>(".features");
    if (features) riseIn(features);
});

/* ── 3c. Features → FAQ: a voice track plays and its caption lands word by word ── */

safely("voice", () => {
    const voice = document.querySelector<HTMLElement>(".seam-voice");
    if (!voice) return;
    let d = "";
    for (let i = 0; i < 120; i++) {
        // Three spoken words: louder in the middle of each, quiet in the gaps.
        const word = Math.max(0, Math.sin((i / 120) * Math.PI * 3 - 0.3));
        const h = 1.5 + 20 * word * (0.5 + 0.5 * Math.abs(Math.sin(i * 1.3) * Math.cos(i * 0.47)));
        d += `M${i * 2 + 0.4} ${12 - h / 2}h1.2v${h}h-1.2z`;
    }
    for (const svg of voice.querySelectorAll("svg")) svg.innerHTML = `<path d="${d}"/>`;
    const words = [...voice.querySelectorAll<HTMLElement>(".seam-cap span")];
    scrub(voice, (p) => words.forEach((w, k) => w.classList.toggle("said", p >= ((k + 0.6) / words.length) * 0.92)));
    const faq = document.querySelector<HTMLElement>(".faq");
    if (faq) riseIn(faq);
});

/* ── 4. The hero demo: the process, step by step ───────────── */

safely("demo", () => {
    const demo = document.getElementById("demo");
    if (!demo) return;
    drawWave(demo.querySelector(".wave"));

    // The editor is laid out at full size and scaled to the stage; on desktop a
    // little of the inspector bleeds off the right edge.
    const compact = matchMedia("(max-width: 720px)");
    const win = demo.querySelector<HTMLElement>(".win")!;
    const fit = () => {
        const w = demo.clientWidth;
        const h = win.offsetHeight; // unscaled
        // Desktop: about 880px of the window across the column (the inspector bleeds off), and never taller
        // than the screen allows, so the whole editor shows beside the copy.
        const k = compact.matches ? w / 720 : Math.min(1, w / 880, (innerHeight - 140) / h);
        demo.style.setProperty("--k", String(k));
        demo.style.setProperty("--h", `${Math.round(h * k)}px`);
        // The part of the window past the screen edge, in window pixels. The top bar's
        // actions (Export, New recording) are pulled in by this much so the cursor never
        // has to leave the screen to reach them.
        const visible = (document.documentElement.clientWidth - demo.getBoundingClientRect().left) / k;
        demo.style.setProperty("--bleed", `${Math.max(0, Math.ceil(win.offsetWidth - visible + 16))}px`);
    };
    addEventListener("resize", fit);
    new ResizeObserver(fit).observe(demo);
    fit();

    if (!reduced) playDemo(demo); // with reduced motion the poster frame stands still
});

function drawWave(svg: SVGSVGElement | null) {
    if (!svg) return;
    let d = "";
    for (let i = 0; i < 60; i++) {
        // A voice: phrases and gaps, deterministic so every load looks the same.
        const phrase = Math.sin(i * 0.33) * 0.5 + 0.5;
        const h = 2 + 16 * phrase * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7)));
        d += `M${i * 2 + 0.3} ${10 - h / 2}h1.2v${h}h-1.2z`;
    }
    svg.innerHTML = `<path d="${d}"/>`;
}

function playDemo(demo: HTMLElement) {
    const win = demo.querySelector<HTMLElement>(".win")!;
    const cursor = demo.querySelector<HTMLElement>(".cursor")!;
    const clock = demo.querySelector<HTMLElement>(".clock")!;
    const recLabel = demo.querySelector<HTMLElement>(".rec-label")!;

    // The demo only runs while it's on screen.
    let visible = false;
    onScreen(demo, (v) => {
        visible = v;
        demo.classList.toggle("is-paused", !v);
    });
    const sleep = makeSleep(() => visible);

    const FLAGS = ["data-suggest", "data-accept", "data-caps", "data-zoom", "data-captions", "data-playing", "data-exporting", "data-done"] as const;
    type Flag = (typeof FLAGS)[number];
    const on = (f: Flag) => demo.setAttribute(f, "");
    const focus = (zone: "top" | "viewer" | "bottom" | null) => (zone ? (demo.dataset.focus = zone) : demo.removeAttribute("data-focus"));

    /** Steps are named in the script below so the story reads top to bottom. */
    const step = (_index: number, _name: string, _ms: number) => {};

    /** An element's box in the window's own (unscaled) coordinates. */
    function local(el: Element) {
        const k = parseFloat(demo.style.getPropertyValue("--k")) || 1;
        const r = el.getBoundingClientRect();
        const w = win.getBoundingClientRect();
        return { x: (r.left - w.left) / k, y: (r.top - w.top) / k, w: r.width / k, h: r.height / k };
    }
    const target = (name: string) => demo.querySelector<HTMLElement>(`[data-target="${name}"]`)!;
    async function move(name: string, ms = 900) {
        const b = local(target(name));
        cursor.style.setProperty("--move", `${ms}ms`);
        cursor.style.setProperty("--x", `${b.x + b.w * 0.55}px`);
        cursor.style.setProperty("--y", `${b.y + b.h * 0.55}px`);
        await sleep(ms + 60);
    }
    async function click(name: string) {
        const el = target(name);
        cursor.classList.add("down");
        el.classList.add("is-pressed");
        await sleep(140);
        cursor.classList.remove("down");
        el.classList.remove("is-pressed");
    }
    const fmt = (s: number) => `00:00:${String(s).padStart(2, "0")}`;

    function reset() {
        demo.dataset.phase = "studio";
        for (const f of FLAGS) demo.removeAttribute(f);
        clock.textContent = fmt(0);
        recLabel.textContent = "Record";
    }

    // Start from the empty studio without animating the poster away.
    demo.classList.add("no-anim");
    reset();
    focus("bottom");
    void demo.offsetWidth;
    demo.classList.remove("no-anim");

    (async () => {
        await sleep(700);
        cursor.classList.add("on");
        for (;;) {
            // 1. Record: one click, then the take runs
            step(0, "Hit Record", 5200);
            focus("bottom");
            await sleep(500);
            await move("record", 1000);
            await click("record");
            demo.dataset.phase = "rec";
            recLabel.textContent = "Stop";
            await sleep(400);
            focus("viewer");
            for (let s = 1; s <= 12; s++) {
                await sleep(260);
                clock.textContent = fmt(s);
            }

            // 2. Stop: the editor opens with the take
            step(1, "Stop when you're done", 2400);
            focus("bottom");
            await move("record", 800);
            await click("record");
            demo.dataset.phase = "edit";
            await sleep(1300);

            // 3. Quicksnap found the click; accept its zoom
            step(2, "Accept the suggested zoom", 4200);
            on("data-suggest");
            await sleep(600);
            await move("zoom", 900);
            await click("zoom");
            on("data-accept");
            await sleep(300);
            focus("viewer");
            on("data-zoom");
            await sleep(2000);

            // 4. Captions in one click
            step(3, "Add captions in one click", 4600);
            focus("bottom");
            await move("captions", 900);
            await click("captions");
            on("data-caps");
            await sleep(400);
            focus("viewer");
            on("data-captions");
            await sleep(300);
            on("data-playing");
            await sleep(2600);

            // 5. Export
            step(4, "Export. No watermark.", 5200);
            focus("top");
            await move("export", 1000);
            await click("export");
            on("data-exporting");
            await sleep(1400);
            on("data-done");
            await sleep(1200);
            focus(null);
            await sleep(1600);
            await move("again", 700);
            await click("again");
            reset();
            await sleep(600);
        }
    })();
}
