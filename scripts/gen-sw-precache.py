#!/usr/bin/env python3
"""gen-sw-precache.py — regenerate frontend/sw-precache.js.

The service worker needs the full module list at install time, otherwise an
offline cold start gets only the shell HTML and then dies on the first
missing ES-module import. This script walks frontend/src and writes a plain
`const MODULES = [...]` array that sw.js importScripts()s.

Usage:
    python3 scripts/gen-sw-precache.py

Run it whenever you add or remove a module under frontend/src. A test in
frontend/tests/v236.test.js fails if the file is stale.
"""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
OUT = os.path.join(FRONTEND, "sw-precache.js")

HEADER = """/* ============================================================
 * sw-precache.js — GENERATED. Do not edit by hand.
 *
 * Lists every frontend/src module so the service worker can precache
 * the whole app. Without this, an offline cold start only gets the
 * shell HTML and then dies on the first missing import.
 *
 * Regenerate with: python3 scripts/gen-sw-precache.py
 * ============================================================ */
"""

FOOTER = """
// Exposed on self so sw.js can read it: a bare `const` in the worker
// global scope is NOT reachable as self.MODULES.
self.MODULES = MODULES;

self.addEventListener("message", (e) => {
  if ((e.data || {}).type === "mnexus-get-precache") {
    e.source?.postMessage({ type: "mnexus-precache", modules: MODULES });
  }
});
"""


def collect() -> list[str]:
    files: list[str] = []
    src = os.path.join(FRONTEND, "src")
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for fn in filenames:
            if fn.endswith((".js", ".css")):
                rel = os.path.relpath(os.path.join(dirpath, fn), FRONTEND)
                files.append("./" + rel.replace(os.sep, "/"))
    return sorted(files)


def render(files: list[str]) -> str:
    lines = [HEADER, "", "const MODULES = ["]
    lines += [f'  "{f}",' for f in files]
    lines.append("];")
    lines.append(FOOTER)
    return "\n".join(lines)


def main() -> int:
    files = collect()
    if not files:
        print("error: no modules found under frontend/src", file=sys.stderr)
        return 1
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(render(files))
    print(f"{len(files)} modules → {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
