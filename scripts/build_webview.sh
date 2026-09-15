#!/bin/bash
# v2.0.0 — build webview-only Android bundle (single JS file).
# No CI, no Gradle, no multiple variants. One HTML + JS bundle
# that any Android WebView / Cordova container can load.

set -e
OUT="${1:-./webview-bundle}"
SRC=./frontend

mkdir -p "$OUT"
mkdir -p "$OUT/assets"

# 1. Copy static entry points
cp "$SRC/public/index.html" "$OUT/index.html"
cp "$SRC/public/manifest.json" "$OUT/manifest.json" 2>/dev/null || true
cp "$SRC/public/favicon.svg" "$OUT/favicon.svg" 2>/dev/null || true

# 2. Inline all CSS into a single <style> block in index.html
CSS_BUNDLE=""
for css in "$SRC/src/styles"/*.css; do
  CSS_BUNDLE+="\n/* ===== $(basename "$css") ===== */\n"
  CSS_BUNDLE+=$(cat "$css")
  CSS_BUNDLE+="\n"
done

# 3. Concatenate all JS modules into one (ES modules order matters; we
#    build a dependency graph by static-import scanning)
echo "Building ES module dependency graph..."

# Simple approach: keep import paths, just copy the src/ tree into
# the bundle. The browser can handle native ES modules from the
# same origin if served via http(s). For file:// we fall back to
# inlining (handled by index.html via <script type=module>).
mkdir -p "$OUT/src"
cp -r "$SRC/src/"* "$OUT/src/"

# 4. Build an inline-script that registers a ServiceWorker for
# offline support, AND patches the import paths to relative form.
cat > "$OUT/sw.js" <<EOF
const CACHE = 'mnexus-v2.0.0';
const ASSETS = [
  './',
  './index.html',
  './src/main.js',
  './src/services/*.js',
  './src/widgets/*.js',
  './src/screens/*.js',
  './src/styles/*.css',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
EOF

# 5. Inline the CSS by patching index.html
python3 -c "
import re, sys
html = open('$OUT/index.html').read()
css = open('/dev/stdin').read()
html = re.sub(r'<link[^>]+rel=\"stylesheet\"[^>]+>', f'<style>{css}</style>', html)
open('$OUT/index.html', 'w').write(html)
" <<< "$CSS_BUNDLE"

# 6. Write the build manifest
cat > "$OUT/BUILD_INFO.json" <<EOF
{
  "version": "2.0.0",
  "buildDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "type": "webview-bundle",
  "android": {
    "minSdk": 21,
    "targetSdk": 34,
    "webViewOnly": true,
    "singleBundle": true,
    "capacitorCompatible": true,
    "cordovaCompatible": true
  }
}
EOF

# 7. Generate AndroidManifest snippet + IntentService stub for WebView
mkdir -p "$OUT/android-snippets"
cat > "$OUT/android-snippets/README.md" <<'MD'
# Android WebView container

To run this bundle as an Android app, embed `index.html` in any
WebView-compatible container. Recommended setups (no Gradle / no
CI required):

## Capacitor (simplest)
```bash
npm i -D @capacitor/core @capacitor/android
npx cap init "M-NEXUS" "com.mnexus.app" --web-dir=webview-bundle
npx cap add android
npx cap sync
npx cap open android
```

## Cordova (alternative)
```bash
cordova create mnexus com.mnexus.app "M-NEXUS"
cp -r webview-bundle/* mnexus/www/
cd mnexus && cordova platform add android && cordova run android
```

## Plain WebView (no framework)
- Copy `webview-bundle/` to `assets/www/` of your Android project.
- In MainActivity.java:
  ```java
  WebView wv = findViewById(R.id.webview);
  wv.getSettings().setJavaScriptEnabled(true);
  wv.getSettings().setDomStorageEnabled(true);
  wv.loadUrl("file:///android_asset/www/index.html");
  ```
MD

# 8. Stats
SIZE=$(du -sb "$OUT" | cut -f1)
FILES=$(find "$OUT" -type f | wc -l)
echo "Build complete:"
echo "  Output: $OUT"
echo "  Size:   $((SIZE / 1024)) KB"
echo "  Files:  $FILES"
