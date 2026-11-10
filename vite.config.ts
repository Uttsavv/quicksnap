import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";

// Cross-origin isolation lets WASM-heavy features (Whisper captions, camera
// background removal) use threads. The same headers ship in public/_headers.
const isolationHeaders = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
};

// onnxruntime-web references its 27 MB WASM via import.meta.url, so Vite emits
// it, but transformers.js points ONNX at its CDN copy at runtime and never
// loads ours. Dropping it keeps every file under Cloudflare Pages' 25 MiB limit.
function dropUnusedOrtWasm(): Plugin {
    return {
        name: "drop-unused-ort-wasm",
        apply: "build",
        generateBundle(_, bundle) {
            for (const key of Object.keys(bundle)) if (/ort-wasm[^/]*\.wasm$/.test(key)) delete bundle[key];
        },
    };
}

export default defineConfig({
    base: "/",
    plugins: [preact(), dropUnusedOrtWasm()],
    server: { headers: isolationHeaders },
    preview: { headers: isolationHeaders },
    worker: { format: "es" },
    optimizeDeps: { exclude: ["@huggingface/transformers"] },
    build: {
        target: "es2022",
        chunkSizeWarningLimit: 900,
        // Two pages: the static landing page at / and the app at /app/.
        rollupOptions: { input: { landing: "index.html", app: "app/index.html" } },
    },
});
