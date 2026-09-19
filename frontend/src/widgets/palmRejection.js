// palmRejection.js — Distinguish stylus/finger from palm (v2.13.0).
//
// Heuristic for PointerEvent:
//   - Pen (pointerType="pen"): always allow
//   - Touch (pointerType="touch"): if contact area > 1500px², likely palm
//     (iPads/Pixel/Samsung report area in width × height)
//   - Mouse (pointerType="mouse"): always allow
//   - Hover-only touches (coalescedEvents, used for palm hover) blocked
//
// Returns true if the event should be IGNORED as palm contact.

const PALM_AREA_THRESHOLD = 1500; // px²
const PALM_RADIUS_THRESHOLD = 22;  // px (contact radius, when reported)

export function isPalmContact(e) {
  if (!e || !e.pointerType) return false;
  if (e.pointerType === "pen") return false;
  if (e.pointerType === "mouse") return false;
  if (e.pointerType !== "touch") return false;

  // PointerEvent.width/height give contact rectangle on touch devices.
  // Some browsers (Safari iPadOS) report radius. Touch radius < 22 = finger tip.
  const w = e.width || 0;
  const h = e.height || 0;
  const area = w * h;
  const radius = e.radiusX || e.radiusY || 0;

  // Palm heuristic: large area OR very wide touch (touchscreen palm is wide)
  if (area > PALM_AREA_THRESHOLD) return true;
  if (radius > PALM_RADIUS_THRESHOLD) return true;
  // Touch too wide but small area (rare on real devices)
  if (w > 30 && h < 10) return true;

  return false;
}

/**
 * Wraps a canvas element to filter palm contacts. The handler is called
 * with the original event ONLY if it's not a palm contact.
 */
export function wrapWithPalmRejection(canvas, handler) {
  const types = ["pointerdown", "pointermove", "pointerup", "pointercancel"];
  for (const t of types) {
    canvas.addEventListener(t, (e) => {
      if (isPalmContact(e)) {
        // Prevent palm from triggering strokes
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      handler(e);
    }, { capture: true }); // capture phase so we intercept before main handlers
  }
}
