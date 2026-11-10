# Quicksnap design system

Tokens live in `src/styles/tokens.css`, motion in `src/styles/motion.css` and `src/ui/motion.tsx`.

| File | What it holds |
|---|---|
| `src/styles/tokens.css` | Every value: colour (dark + light), space, radius, type, elevation, z-index, motion |
| `src/styles/motion.css` | Keyframes, `.anim-*` utilities, and the animations wired to app components |
| `src/styles.css` | Components and screen layouts, built only from tokens |
| `src/ui/motion.tsx` | `<Loader>`, `<Skeleton>`, `staggerIndex()` |
| `src/landing/` | The marketing page at `/`, built from the same tokens (the app lives at `/app/`) |

## Palette
Indigo `--accent` for interaction, record red `--record` for anything live. Surfaces
stack `--app` → `--panel` → `--raised` → `--hover`. Timeline tracks each own a colour
pair (`--clip`, `--zoom`, `--layout`, `--caption`) so users learn them.

## Motion
- **Durations:** `--dur-press` 90ms (press) · `--dur-state` 160ms (hover, selection) ·
  `--dur-enter` 240ms (things appearing) · `--dur-emph` 420ms (moments: countdown, success) ·
  `--dur-loop` 1.6s (ambient loops).
- **Easing:** arrive with `--ease-out`, leave with `--ease-in`, travel with `--ease-in-out`,
  small playful things with `--ease-spring`.
- Animate only `transform` and `opacity`. Loops mean "alive": recording, loading. Nothing else loops.
- Reduced motion: duration tokens drop to 0 and loops stop. Use the tokens and you get this for free.

### The collection
| Use | How |
|---|---|
| Entrance | `.anim-rise` (default), `.anim-fade`, `.anim-pop` (spring), `.anim-drop` (from above) |
| Sequence | `.stagger` on the parent, `style={staggerIndex(i)}` on children |
| Replay on change | put the animation on an element and change its `key` (countdown, inspector tabs) |
| Loading a screen | `<Loader label="Opening recording" />` waits 180ms, so fast loads don't flash it |
| Loading content | `<Skeleton />`, `.skeleton.line` |
| Progress | `.progress` (sheen on the fill), `.progress.indeterminate` |
| Live | `.rec-dot`, `.btn.record.live` (red halo) |
| Feedback | `toast(text, "success")` draws a check, `"error"` shakes; toasts sink out on exit |
| Rejected input | `.anim-shake` |

## Editor motifs on the landing page
The landing page borrows the editor's own UI rather than decoration:
- **Markers** carry a timecode in amber (`--warn`), as on the timeline, and label each section.
- **The playhead** is record red. Feature cards play one at a time with it sweeping beneath.
- **The selection**: the hero's key word sits in a clip selection with trim handles.
