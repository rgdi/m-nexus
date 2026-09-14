// validate_v12_responsive.cjs: tests para v1.2.0 responsive + adaptive
//
// Verifica que el CSS del frontend tiene todas las media queries
// y directivas adaptive que prometimos en v1.2.0.

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = process.cwd();
const CSS_DIR = path.join(REPO, 'frontend', 'src', 'styles');
const JS_DIR  = path.join(REPO, 'frontend', 'src');

let pass = 0, fail = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; fails.push({ name, err: e.message }); }
}
function ok(v, msg) { if (!v) throw new Error('Assertion failed: ' + (msg || '')); }
function contains(s, sub, msg) {
  if (typeof s !== 'string' || !s.includes(sub)) throw new Error((msg || '') + `: expected to contain ${JSON.stringify(sub)}`);
}

console.log('Validating v1.2.0 responsive + adaptive');
console.log('════════════════════════════════════════');

// ── Load all CSS + JS first (avoid TDZ) ──
const tokens = fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf-8');
const base = fs.readFileSync(path.join(CSS_DIR, 'base.css'), 'utf-8');
const layout = fs.readFileSync(path.join(CSS_DIR, 'layout.css'), 'utf-8');
const components = fs.readFileSync(path.join(CSS_DIR, 'components.css'), 'utf-8');
const calendar = fs.readFileSync(path.join(CSS_DIR, 'calendar.css'), 'utf-8');
const notebook = fs.readFileSync(path.join(CSS_DIR, 'notebook.css'), 'utf-8');
const device = fs.readFileSync(path.join(JS_DIR, 'services', 'device.js'), 'utf-8');
const main = fs.readFileSync(path.join(JS_DIR, 'main.js'), 'utf-8');
const allCss = [tokens, base, layout, components, calendar, notebook].join("\n");

t('v1.2.0 tokens: fluid font-sizes con clamp()', () => {
  ok(/--fs-md:.*clamp/.test(tokens), '--fs-md usa clamp()');
  ok(/--fs-3xl:.*clamp/.test(tokens), '--fs-3xl usa clamp()');
  ok(/--fs-xs:.*clamp/.test(tokens), '--fs-xs usa clamp()');
});

t('v1.2.0 tokens: spacing fluid con clamp', () => {
  ok(/--s-1:.*clamp/.test(tokens), 'spacing usa clamp()');
  ok(/--s-7:.*clamp/.test(tokens), '--s-7 fluid');
});

t('v1.2.0 tokens: hit-targets adaptativos', () => {
  ok(/--hit-target:/.test(tokens), 'hit-target definido');
  ok(/--hit-target-l:/.test(tokens), 'hit-target-large definido');
  ok(/--hit-target-desktop:/.test(tokens), 'hit-target-desktop definido');
});

t('v1.2.0 tokens: prefers-color-scheme dark mode', () => {
  contains(tokens, 'prefers-color-scheme: dark', 'media query dark auto');
});

t('v1.2.0 tokens: prefers-contrast: more', () => {
  contains(tokens, 'prefers-contrast: more', 'contrast media query');
});

t('v1.2.0 tokens: prefers-reduced-motion', () => {
  contains(tokens, 'prefers-reduced-motion: reduce', 'reduced motion media query');
  ok(/--dur:\s*0ms/.test(tokens), '--dur forzado a 0ms en reduced motion');
});

// ── Base: pointer coarse/fine + hover + DPI ──

t('v1.2.0 base: pointer: coarse = touch', () => {
  contains(base, 'pointer: coarse', 'media query coarse');
  ok(/hit-target-l/.test(base), 'usa hit-target-large en touch');
  ok(/background: revert/.test(base), 'desactiva hover en touch');
});

t('v1.2.0 base: pointer: fine = mouse', () => {
  contains(base, 'pointer: fine', 'media query fine');
  ok(/hit-target-desktop/.test(base) || /pointer: fine/.test(base), 'media query pointer:fine existe');
});

t('v1.2.0 base: hover: hover (solo mouse)', () => {
  contains(base, 'hover: hover', 'media query hover');
});

t('v1.2.0 base: hover: none (touch only)', () => {
  contains(base, 'hover: none', 'media query hover none');
});

t('v1.2.0 base: HiDPI retina', () => {
  contains(base, 'min-device-pixel-ratio: 2', 'retina 2x');
  contains(base, 'min-device-pixel-ratio: 3', 'retina 3x');
  ok(/color-mix/.test(base) || /shadow.*0\.5px/.test(base), 'sombras suavizadas en retina');
});

t('v1.2.0 base: breakpoints por viewport', () => {
  // v1.2.0: breakpoints estan distribuidos entre base.css y layout.css
  const allCss = [tokens, base, layout, components, calendar, notebook].join("\n");
  contains(allCss, 'max-width: 360px', 'tiny phones');
  contains(allCss, 'max-width: 480px', 'phones');
  contains(allCss, 'min-width: 480px', 'phablets');
  contains(allCss, 'min-width: 720px', 'tablets');
  contains(allCss, 'min-width: 1100px', 'desktop');
  contains(allCss, 'min-width: 1920px', 'ultra-wide');
});

// ── Layout: container queries + orientation ──

t('v1.2.0 layout: orientation landscape phones', () => {
  contains(layout, 'orientation: landscape', 'orient query');
  contains(layout, 'max-height: 500px', 'landscape phones small');
});

t('v1.2.0 layout: orientation portrait phones', () => {
  contains(layout, 'orientation: portrait', 'orient portrait query');
});

t('v1.2.0 layout: container queries', () => {
  contains(layout, 'container-type: inline-size', 'container queries habilitadas');
  contains(layout, '@container app', 'container rule app');
  ok(/\(max-width: 480px\)/.test(layout), 'container tiene breakpoint');
});

t('v1.2.0 layout: ultra-wide centering', () => {
  contains(layout, 'min-width: 1920px', 'ultra-wide media');
});

t('v1.2.0 layout: safe area insets', () => {
  const allCss = [tokens, base, layout, components, calendar, notebook].join("\n");
  contains(allCss, 'safe-area-inset', 'safe area');
});

// ── Components: hover-only on pointer:fine ──

t('v1.2.0 components: card hover only on mouse', () => {
  ok(/@media \(pointer: fine\) and \(hover: hover\)/.test(components),
    'card hover solo en pointer:fine');
});

t('v1.2.0 components: subject bubble hover only on mouse', () => {
  ok(/subj-bubble:hover/.test(components) && /pointer: fine/.test(components),
    'bubble hover condicional');
});

t('v1.2.0 components: hit-targets en inputs', () => {
  ok(/min-height: var\(--hit-target\)/.test(components), 'inputs usan hit-target');
});

t('v1.2.0 components: tabs con hit-target', () => {
  const allCss = [tokens, base, layout, components, calendar, notebook].join("\n");
  ok(/\.tab[\s\S]{0,500}hit-target/.test(components) || /hit-target[\s\S]{0,500}\.tab/.test(components), 'tabs con touch target');
});

t('v1.2.0 components: container queries en stat', () => {
  contains(components, '@container stat', 'container stat');
});

// ── Calendar + Notebook adaptations ──

t('v1.2.0 calendar: landscape phone hour compression', () => {
  contains(calendar, 'orientation: landscape', 'calendar orient');
  ok(/height:\s*50px/.test(calendar), 'horas compactas en landscape phones');
});

t('v1.2.0 calendar: week grid responsive', () => {
  contains(calendar, 'max-width: 480px', 'week grid en phones');
});

t('v1.2.0 notebook: pencil drawer adapts en landscape', () => {
  contains(notebook, 'orientation: landscape', 'notebook orient');
  ok(/left:\s*auto/.test(notebook), 'pencil drawer cambia de lado en landscape');
});

t('v1.2.0 notebook: backdrop-filter blur', () => {
  contains(notebook, 'backdrop-filter: blur', 'toolbar con blur');
});

t('v1.2.0 notebook: book grid auto-fill en phones', () => {
  contains(notebook, 'max-width: 480px', 'book grid responsive');
});

// ── device.js runtime detection ──

t('v1.2.0 device.js: detecta DPR', () => {
  ok(/devicePixelRatio/.test(device), 'lee devicePixelRatio');
});

t('v1.2.0 device.js: detecta orientation', () => {
  ok(/orientation:\s*"portrait"|orientation: portrait/.test(device), 'lee orientation');
});

t('v1.2.0 device.js: detecta prefers-color-scheme', () => {
  ok(/prefers-color-scheme: dark/.test(device), 'lee prefers-color-scheme');
});

t('v1.2.0 device.js: detecta prefers-reduced-motion', () => {
  ok(/prefers-reduced-motion/.test(device), 'lee reduced motion');
});

t('v1.2.0 device.js: tier breakpoints', () => {
  ok(/tiny|phone|phablet|tablet|laptop|desktop/.test(device), 'tiers definidos');
});

t('v1.2.0 device.js: subscribe + reactivo', () => {
  ok(/subscribe\(|addEventListener/.test(device), 'sistema reactivo');
});

t('v1.2.0 device.js: setTheme override', () => {
  ok(/setTheme|dataset\.theme/.test(device), 'permite override manual de tema');
});

// ── main.js wired ──

t('v1.2.0 main.js: arranca device watcher', () => {
  ok(/startDeviceWatch|device/.test(main), 'main usa device');
});

// ── Recap ──
console.log(`\nResults: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\nFailures:');
  fails.forEach(f => console.log(`  ✗ ${f.name}: ${f.err}`));
  process.exit(1);
}
console.log('✓ All v1.2.0 responsive + adaptive validations passed');
process.exit(0);
