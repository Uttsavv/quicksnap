import "./landing.css";

/* Four small behaviours. Each runs on its own, so one failing never takes the
   others down, and the page reads fine with none of them:
     1. the header gains a solid, blurred bar once the page scrolls
     2. FAQ answers open and close with a height animation
     3. feature cards play one at a time, like clips in a playlist
     4. the hero plays a short reel of cuts: record → the take → the timeline → the result → export */

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

/* ── 4. The hero reel ──────────────────────────────────────────── */

safely("reel", () => {
    const demo = document.getElementById("demo");
    if (!demo) return;
    drawWave(demo.querySelector(".wave"));

    // The cuts are laid out at 828×640 and scaled to the stage.
    const fit = () => demo.style.setProperty("--k", String(Math.min(1, demo.clientWidth / 828)));
    new ResizeObserver(fit).observe(demo);
    fit();

    if (reduced) {
        demo.querySelector(".reel")?.remove(); // the poster frame stands still: nothing to pause
        return;
    }
    playReel(demo);
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

function playReel(demo: HTMLElement) {
    const cuts = demo.querySelector<HTMLElement>(".cuts")!;
    const cursor = demo.querySelector<HTMLElement>(".cursor")!;
    const clock = demo.querySelector<HTMLElement>(".big-clock")!;
    const recLabel = demo.querySelector<HTMLElement>(".rec-label")!;
    const label = demo.querySelector<HTMLElement>(".reel-label")!;
    const bars = [...demo.querySelectorAll<HTMLElement>(".reel-bars i")];
    const pause = demo.querySelector<HTMLButtonElement>(".reel-pause")!;

    let visible = false;
    let userPaused = false;
    const sync = () => demo.classList.toggle("is-paused", !visible || userPaused);
    onScreen(demo, (v) => {
        visible = v;
        sync();
    });
    pause.addEventListener("click", () => {
        userPaused = !userPaused;
        demo.classList.toggle("user-paused", userPaused);
        pause.setAttribute("aria-pressed", String(userPaused));
        pause.setAttribute("aria-label", userPaused ? "Play the demo" : "Pause the demo");
        sync();
    });
    const sleep = makeSleep(() => visible && !userPaused);

    const FLAGS = ["data-recording", "data-suggest", "data-accept", "data-caps", "data-zoom", "data-captions", "data-playing", "data-exporting", "data-done"] as const;
    type Flag = (typeof FLAGS)[number];
    const on = (f: Flag) => demo.setAttribute(f, "");

    /** Cut to a shot, and advance the reel's progress bar. */
    function cut(name: string, index: number, title: string, ms: number) {
        demo.dataset.cut = name;
        label.textContent = title;
        bars.forEach((b, i) => {
            b.classList.toggle("done", i < index);
            b.classList.remove("now");
        });
        void bars[index].offsetWidth;
        bars[index].style.setProperty("--dur", `${ms}ms`);
        bars[index].classList.add("now");
        cursor.classList.remove("on");
    }

    /** An element's box in the cuts' own (unscaled) coordinates. */
    function local(el: Element) {
        const k = parseFloat(demo.style.getPropertyValue("--k")) || 1;
        const r = el.getBoundingClientRect();
        const c = cuts.getBoundingClientRect();
        return { x: (r.left - c.left) / k, y: (r.top - c.top) / k, w: r.width / k, h: r.height / k };
    }
    const target = (name: string) => demo.querySelector<HTMLElement>(`[data-target="${name}"]`)!;

    /** The cursor enters from below, then every move ends in a click. */
    async function move(name: string, ms = 900) {
        if (!cursor.classList.contains("on")) {
            cursor.style.setProperty("--move", "0ms");
            cursor.style.setProperty("--x", "640px");
            cursor.style.setProperty("--y", "600px");
            void cursor.offsetWidth;
            cursor.classList.add("on");
        }
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
    demo.dataset.cut = "rec";
    void demo.offsetWidth;
    demo.classList.remove("no-anim");

    (async () => {
        for (;;) {
            // 1. Record
            reset();
            cut("rec", 0, "Record", 4200);
            await sleep(900);
            await move("record", 1000);
            await click("record");
            on("data-recording");
            recLabel.textContent = "Stop";
            for (let s = 1; s <= 8; s++) {
                await sleep(260);
                clock.textContent = fmt(s);
            }

            // 2. The take: the presenter clicks Share
            cut("take", 1, "The take", 4000);
            demo.dataset.phase = "rec";
            await sleep(4000);

            // 3. The timeline: accept the suggested zoom, add captions
            demo.dataset.phase = "edit";
            cut("tl", 2, "Smart zoom and captions", 4600);
            await sleep(700);
            on("data-suggest");
            await sleep(500);
            await move("zoom", 1000);
            await click("zoom");
            on("data-accept");
            await sleep(500);
            await move("captions", 800);
            await click("captions");
            on("data-caps");
            await sleep(1100);

            // 4. The result: the zoom lands, the captions play
            cut("take", 3, "The result", 4200);
            await sleep(700);
            on("data-zoom");
            await sleep(900);
            on("data-captions");
            await sleep(300);
            on("data-playing");
            await sleep(2300);

            // 5. Export, and hold the payoff
            cut("export", 4, "Export", 4200);
            await sleep(900);
            await move("export", 900);
            await click("export");
            on("data-exporting");
            await sleep(1400);
            on("data-done");
            await sleep(1900);
        }
    })();
}
