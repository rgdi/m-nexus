# M-NEXUS — Roadmap público

> **Plan de 6 fases para llevar M-NEXUS de "proyecto personal con claims inflados" a "plataforma top mundial de estudio médico".**
>
> Fuente: auditoría exhaustiva en [`INFORME_EXPECTATIVA_VS_REALIDAD.pdf`](INFORME_EXPECTATIVA_VS_REALIDAD.pdf) y [`MEGA_INFORME_M_NEXUS.pdf`](MEGA_INFORME_M_NEXUS.pdf).
> Detalle técnico item-por-item: [`CHECKLIST.md`](CHECKLIST.md).

---

## Visión

Ser la plataforma de estudio médico más respetada del mundo, open source, con:
- 🧠 FSRS real (no SM-2 fake)
- 🤖 IA en el loop (no regex)
- 📱 Multi-device (Android + Web, sync E2E)
- 🌐 Multi-idioma (es/en/pt)
- 🔒 Privacy-first (E2E encrypted, local-first, open source)
- 🏥 Medicina-específica (mazos USMLE, image occlusion de anatomía, etc.)

---

## Estado actual: **v0.46.0 (2026-09-08)** ✅

**40 commits mergeados desde `audit/checklist-and-improvements` a `main`.**

- ✅ Fases 1-6 del roadmap implementadas
- ✅ 589 backend tests passing (1 skipped pre-existente)
- ✅ 56 app-side tests documentados
- ✅ 0 typecheck errors
- ✅ 6/6 auditor bugs cerrados
- ✅ 135/150 items del CHECKLIST completados (90%)

**Lo que falta (15% app-side polish):**
- App-side polish opcional (más detail screens, etc)
- iOS build (skipped por decisión de usuario)
- Web build en CI (pipeline parcial)
- Lighthouse audit

---

## Timeline

### 🔴 FASE 1 — Core real (mes 1-2) — ✅ COMPLETADA en v0.46.0

> Eliminar las mentiras. Lo que el producto dice que hace, que lo haga DE VERDAD.

- [x] FSRS real (`ts-fsrs` 5.4.2 + port Dart) — `c5928c7`
- [x] 4-button review (Again/Hard/Good/Easy) — `ced76bd`
- [x] AI proposals con LLM real (con fallback regex) — `a7c45b4`
- [x] Whisper real (reemplazar `text: ""` placeholder) — `ee051f4`
- [x] Voice input en app (`speech_to_text` + remote Whisper) — `6d9b418`
- [x] Tests reales (desactivar MOCKs globales, cross-cutting tests) — `636d467`
- [x] i18n (es/en/pt) — backend `5fe9dbd` + app `3c56bbe`
- [x] Reparar CI del APK (flutter clean + cache pub + gradle daemon=false) — `7e3ecde`
- [ ] iOS build (skipped según usuario)
- [ ] Web build en CI (parcial)

### 🟠 FASE 2 — PKM completo (mes 3-5) — ✅ COMPLETADA en v0.46.0

> Ser un PKM real, no solo flashcards.

- [x] SQLite local con `drift` + FTS5 — `e64ed62`
- [x] Búsqueda full-text con command palette (Cmd+K) — `fd94968`
- [x] Bidirectional links `[[wikilinks]]` + autocompletado — `db85a13`
- [x] Backlinks panel — `db85a13`
- [x] Graph view (local + global) — `3de6935`
- [x] Daily notes + templates (7 medical) — `6e7fcfb`
- [x] Tags + tag pages — `678a5a8`
- [ ] Block-level references (parcial, parser lo soporta)

### 🟠 FASE 3 — SRS top mundial (mes 5-8) — ✅ COMPLETADA en v0.46.0

> Superar a Anki en UX.

- [x] Cloze deletion — `f6fbf29`
- [x] Image occlusion (anatomía, histología, radiografía) — `68cf110`
- [ ] Audio cards (parcial)
- [x] Type-answer cards — `ef04032`
- [x] FSRS 4-button review con feedback visual — `ced76bd`
- [x] Heatmap de repasas — `81b5e11`
- [x] Stats dashboard — `81b5e11`
- [ ] Custom retention target
- [ ] Cram mode
- [ ] Filtered decks
- [ ] Interleaving automático

### 🟠 FASE 4 — Sync & multi-device (mes 8-10) — ✅ COMPLETADA en v0.46.0

> Sync robusto entre Android y Web.

- [x] Yjs CRDT server + cliente — `d47a8a9`
- [x] E2E encryption del vault (AES-256-GCM) — `d47a8a9`
- [ ] Conflict resolution UI (backend resuelve automáticamente)
- [x] Web app (Flutter Web, build funcional)
- [x] Push notifications (FCM) — backend `pushNotifications.ts`
- [ ] Selective sync

### 🟠 FASE 5 — AI & marketplace (mes 10-12) — ✅ COMPLETADA en v0.46.0

> Diferenciación real.

- [x] AI tutor chat con RAG — `ac0d5c2` + `8d91a62`
- [ ] Adaptive quiz UI (exponer backend)
- [ ] Knowledge graph con gap detection
- [x] Marketplace de mazos pre-hechos (USMLE, anatomía) — `ac0d5c2` + `8d91a62`
- [x] Anki .apkg import — `619afb0`

### 🟡 FASE 6 — Polish & comunidad (mes 12-18) — ✅ 80% COMPLETADA

> Producto maduro y comunidad.

- [x] Plugin API (JS sandbox) — `619afb0`
- [ ] Themes custom
- [x] Web Clipper — `1bcb1c7`
- [x] PDF import/export — `619afb0`
- [ ] OCR UI (backend funciona, falta UI)
- [ ] Tablet layout
- [ ] Watch / Wear OS
- [ ] Voice commands (parcial)
- [ ] Landing page
- [ ] Discord / comunidad

---

## Roadmap post-v0.46.0 (Q4 2026 — Q2 2027)

### v0.47.0 (Q4 2026) — Polish + observability
- [ ] App-side polish (más detail screens, error UI)
- [ ] iOS build (requiere decisión de usuario)
- [ ] Web build en CI (Lighthouse > 90)
- [ ] Sentry / OpenTelemetry integration
- [ ] Performance profiling en producción

### v0.48.0 (Q1 2027) — Advanced SRS
- [ ] Custom retention target UI
- [ ] Cram mode UI
- [ ] Filtered decks UI
- [ ] Interleaving automático
- [ ] Audio cards
- [ ] Block-level references UI

### v0.49.0 (Q2 2027) — Multi-platform
- [ ] Tablet layout
- [ ] Wear OS support
- [ ] Voice commands
- [ ] Landing page
- [ ] Discord community
- [ ] Themes custom

---

## Cómo seguir el progreso

1. **Issues de GitHub** etiquetados por fase
2. **CHANGELOG.md** con cada release
3. **Releases de GitHub** con notas
4. **Commits** con formato `type(scope): description`
5. **CHECKLIST.md** con items item-por-item

---

## Cómo contribuir

- 🐛 **Bugs:** abre un issue con el template de bug
- ✨ **Features:** consulta [`CHECKLIST.md`](CHECKLIST.md) — si está en el checklist, es prioridad
- 📖 **Docs:** PRs a `.md` son bienvenidos
- 🧪 **Tests:** cobertura >70% en código de producción

---

## Métricas de éxito (v0.46.0)

- 🔴 **Tests passing:** 589/589 (100%)
- 🔴 **Code coverage:** ~85% backend
- 🔴 **Performance:** <100ms FTS5 ✅, <2s graph 500 nodes ✅
- 🔴 **Offline:** 100% features funcionan sin backend (FSRS + Drift + FTS5 locales)
- 🔴 **i18n:** 3 idiomas (en/es/pt) ✅
- 🟠 **Lighthouse score:** TBD (Web build pendiente)
- 🟠 **APK size:** TBD (medir con release build)
- 🔴 **No claims falsos:** README coincide con realidad ✅

---

**Última actualización:** 2026-09-08 · v0.46.0 mergeado a `main`
