import "./landing.css";

/* Four small behaviours. Each runs on its own, so one failing never takes the
   others down, and the page reads fine with none of them:
     1. the header gains a solid, blurred bar once the page scrolls
     2. FAQ answers open and close with a height animation
     3. feature cards play one at a time, like clips in a playlist
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

/* ── 3. Feature cards: one take at a time ──────────────────────── */

safely("cards", () => {
    const cards = [...document.querySelectorAll<HTMLElement>(".card")];
    if (!cards.length || reduced) return;
    const TAKE = 3200;
    const GAP = 500;
    let visible = false;
    let hovered: HTMLElement | null = null;
    let i = 0;
    const sleep = makeSleep(() => visible && !hovered);

    function play(card: HTMLElement) {
        for (const c of cards) c.classList.remove("play");
        void card.offsetWidth; // restart the take
        card.classList.add("play");
    }

    onScreen(document.querySelector(".cards")!, (v) => (visible = v));
    for (const card of cards) {
        card.addEventListener("pointerenter", () => {
            hovered = card;
            play(card);
        });
        card.addEventListener("pointerleave", () => {
            if (hovered === card) hovered = null;
        });
    }

    (async () => {
        for (;;) {
            await sleep(GAP);
            play(cards[i]);
            await sleep(TAKE);
            cards[i].classList.remove("play");
            i = (i + 1) % cards.length;
        }
    })();
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
