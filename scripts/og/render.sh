#!/usr/bin/env bash
# Renders the share cards and PNG app icons into public/. Run with: npm run og
# Cards are JPEG because WhatsApp drops link previews whose image is over ~300 KB.
set -euo pipefail
cd "$(dirname "$0")/../.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT=5288
TMP="$(mktemp -d)"
npx vite --port "$PORT" --strictPort >"$TMP/vite.log" 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null; rm -rf "$TMP"' EXIT
until curl -s "http://localhost:$PORT/" >/dev/null; do sleep 0.3; done

shot() { # url width height scale out
    "$CHROME" --headless=new --hide-scrollbars --force-prefers-reduced-motion --window-size="$2,$3" \
        --force-device-scale-factor="$4" --virtual-time-budget=6000 --screenshot="$5" "$1" 2>/dev/null
}

for card in home:og studio:og-studio; do
    shot "http://localhost:$PORT/scripts/og/og-card.html?card=${card%%:*}" 1200 630 2 "$TMP/card.png"
    sips -z 630 1200 "$TMP/card.png" --out "$TMP/card-1x.png" >/dev/null
    sips -s format jpeg -s formatOptions 86 "$TMP/card-1x.png" --out "public/${card##*:}.jpg" >/dev/null
done

# PNG icons: iOS (apple-touch-icon) and Android installs ignore SVG icons.
# Rendered once at 512 (headless Chrome won't size a smaller window), then scaled.
printf '<style>html,body{margin:0;background:#fff}img{display:block;width:100vw;height:100vh}</style><img src="/icon.svg">' >public/__icon.html
shot "http://localhost:$PORT/__icon.html" 512 512 1 "public/icon-512.png"
rm public/__icon.html
sips -z 192 192 public/icon-512.png --out public/icon-192.png >/dev/null
sips -z 180 180 public/icon-512.png --out public/apple-touch-icon.png >/dev/null

ls -la public/og*.jpg public/*icon*.png
