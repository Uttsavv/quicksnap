// The four scenes, named and drawn the same way in the studio and the editor.

import type { LayoutMode } from "../lib/types";

export const SCENES: { mode: LayoutMode; name: string; key: string }[] = [
    { mode: "screen", name: "Screen only", key: "1" },
    { mode: "bubble", name: "Screen + bubble", key: "2" },
    { mode: "side", name: "Side by side", key: "3" },
    { mode: "camera", name: "Camera only", key: "4" },
];

export const sceneName = (mode: LayoutMode) => SCENES.find((s) => s.mode === mode)!.name;

export function SceneArt({ mode }: { mode: LayoutMode }) {
    return (
        <div class="scene-art" aria-hidden="true">
            {mode !== "camera" && <i class="s" style={mode === "side" ? { left: "6%", top: "14%", width: "58%", bottom: "14%" } : { inset: "12%" }} />}
            {mode === "bubble" && <i class="c" style={{ right: "6%", bottom: "8%", width: "22%", aspectRatio: "1", borderRadius: "50%" }} />}
            {mode === "side" && <i class="c" style={{ right: "6%", top: "14%", width: "26%", bottom: "14%", borderRadius: "2px" }} />}
            {mode === "camera" && <i class="c" style={{ inset: "12% 28%", borderRadius: "3px" }} />}
        </div>
    );
}
