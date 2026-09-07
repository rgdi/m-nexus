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

## Timeline

### 🔴 FASE 1 — Core real (mes 1-2) — en progreso

> Eliminar las mentiras. Lo que el producto dice que hace, que lo haga DE VERDAD.

- [ ] FSRS real (`ts-fsrs` + port Dart)
- [ ] 4-button review (Again/Hard/Good/Easy)
- [ ] AI proposals con LLM real
- [ ] Whisper real (reemplazar `text: ""` placeholder)
- [ ] Voice input en app (`speech_to_text`)
- [ ] Tests reales (desactivar MOCKs globales)
- [ ] i18n (es/en/pt)
- [ ] iOS build (skipped según usuario)
- [ ] Web build en CI
- [ ] Reparar CI del APK

### 🟠 FASE 2 — PKM completo (mes 3-5)

> Ser un PKM real, no solo flashcards.

- [ ] SQLite local con `drift` + FTS5
- [ ] Búsqueda full-text con command palette (Cmd+K)
- [ ] Bidirectional links `[[wikilinks]]` + autocompletado
- [ ] Backlinks panel
- [ ] Graph view (local + global)
- [ ] Daily notes + templates
- [ ] Tags + tag pages
- [ ] Block-level references

### 🟠 FASE 3 — SRS top mundial (mes 5-8)

> Superar a Anki en UX.

- [ ] Cloze deletion
- [ ] Image occlusion (anatomía, histología, radiografía)
- [ ] Audio cards
- [ ] Type-answer cards
- [ ] FSRS 4-button review con feedback visual
- [ ] Heatmap de repasas
- [ ] Stats dashboard
- [ ] Custom retention target
- [ ] Cram mode
- [ ] Filtered decks
- [ ] Interleaving automático

### 🟠 FASE 4 — Sync & multi-device (mes 8-10)

> Sync robusto entre Android y Web.

- [ ] Yjs CRDT server + cliente
- [ ] E2E encryption del vault
- [ ] Conflict resolution UI
- [ ] Web app full
- [ ] Push notifications (FCM)
- [ ] Selective sync

### 🟠 FASE 5 — AI & marketplace (mes 10-12)

> Diferenciación real.

- [ ] AI tutor chat con RAG
- [ ] Adaptive quiz UI (exponer backend)
- [ ] Knowledge graph con gap detection
- [ ] Marketplace de mazos pre-hechos (USMLE, anatomía)
- [ ] Anki .apkg import/export

### 🟡 FASE 6 — Polish & comunidad (mes 12-18)

> Producto maduro y comunidad.

- [ ] Plugin API
- [ ] Themes custom
- [ ] Web Clipper
- [ ] PDF import/export
- [ ] OCR UI
- [ ] Tablet layout
- [ ] Watch / Wear OS
- [ ] Voice commands
- [ ] Landing page
- [ ] Discord / comunidad

---

## Cómo seguir el progreso

1. **Issues de GitHub** etiquetados por fase
2. **CHANGELOG.md** con cada release
3. **Releases de GitHub** con notas
4. **Commits** con formato `type(scope): description`

---

## Cómo contribuir

- 🐛 **Bugs:** abre un issue con el template de bug
- ✨ **Features:** consulta [`CHECKLIST.md`](CHECKLIST.md) — si está en el checklist, es prioridad
- 📖 **Docs:** PRs a `.md` son bienvenidos
- 🧪 **Tests:** cobertura >70% en código de producción

---

## Métricas de éxito

- 🔴 **Tests passing:** 0 fallos
- 🔴 **Code coverage:** >70%
- 🔴 **Performance:** <100ms FTS5, <2s graph 500 nodes
- 🔴 **Offline:** 100% features funcionan sin backend
- 🔴 **i18n:** 3 idiomas
- 🔴 **Lighthouse score:** >90 web
- 🔴 **APK size:** <80MB
- 🔴 **No claims falsos:** README coincide con realidad

---

**Última actualización:** 2026-09-07 · v0.45.11b → v0.46.0 en desarrollo
