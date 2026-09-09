# Plan de tareas M-NEXUS v0.48

## Estado actual (v0.48.4)
- Branch: main, HEAD = 83d2e98 (v0.48.4)
- Tests: 81/81 passing (4 handwriting + 6 daily + 7 resolveNote + 64 existentes)
- Analyze: 0 issues
- Backend: en nuc:192.168.1.83:4100 con Node 22 + tsx + Ollama + Whisper
- Device A063: APK v0.48.4 instalado, vault Mi_Vault con 3 asignaturas, 5 flashcards, daily notes funcionando

## ✅ COMPLETADO (v0.48.1 — v0.48.4)

### FASE 1 — Backend LLM real (Ollama + Whisper)
- ✅ Ollama instalado en nuc (puerto 11434)
- ✅ Modelo llama3.2:3b descargado (~2GB)
- ✅ Modelo nomic-embed-text (RAG embeddings)
- ✅ Whisper wrapper CLI (Python faster-whisper) en backend/scripts/whisper
- ✅ Endpoint /api/v1/ai/tutor funcional con LLM real
- ✅ /api/v1/health reporta providers disponibles
- ✅ Better-sqlite3 fix (LazySearchService) + Node 22 install

### FASE 3 — Bug fixes
- ✅ v0.48.1: VaultService.resolveNote() — wikilinks case-insensitive + tildes
- ✅ v0.48.1: _handleLink usa resolveNote (path resolution real)
- ✅ v0.48.2: VaultService.sharedInstance singleton + invalidateCache
- ✅ v0.48.2: vault_browser pull-to-refresh + botón refresh + clear search
- ✅ v0.48.3: FlashcardReview.onNoteOpen + onMediaOpen + vaultPath
- ✅ v0.48.3: Flashcard.sourceNote field + parseo en _parseCard
- ✅ v0.48.3: Sketch frontmatter persistence (writeNote reescribe)

### FASE 2 — Handwriting (Samsung Notes style)
- ✅ v0.48.4: HandwritingCanvas widget (pen/highlighter/eraser, 5 colors, 3 widths, undo/redo)
- ✅ v0.48.4: Stroke JSON serialization (tool, color, width, points)
- ✅ v0.48.4: NoteSketchScreen (modal full-screen, persist via frontmatter.sketches)
- ✅ v0.48.4: Botón "Dibujar" en note_view AppBar
- ✅ v0.48.4: PopScope guard (aviso si hay cambios sin guardar)

### FASE 6 — Daily Notes
- ✅ v0.48.4: DailyNoteService (openOrCreate, listAll, listDates)
- ✅ v0.48.4: Template con secciones (Tareas/Notas/Ideas/Para repasar)
- ✅ v0.48.4: Action card "Nota diaria" en home con día de la semana
- ✅ v0.48.4: Tests 6/6 passing

### FASE 6 — Command Palette (Ctrl+K)
- ✅ v0.48.4: CommandPaletteDialog (6 acciones)
- ✅ v0.48.4: CommandPaletteShortcuts widget (Ctrl+K binding)
- ✅ v0.48.4: Filtro fuzzy sobre title/subtitle
- ✅ v0.48.4: Búsqueda + Enter para ejecutar

## ⏳ EN PROGRESO (v0.48.5+)

### FASE 5 — Image picker (delegado a subagente)
- [ ] image_picker integration en note_editor
- [ ] Copia a _M-NEXUS/images/<uuid>.<ext>
- [ ] Inserta markdown ![alt](path) en cursor

### FASE 5 — Image occlusion (delegado a subagente)
- [ ] POST /api/v1/flashcards/image-occlusion endpoint
- [ ] Crear flashcard con mediaPath + mediaType='image'

### FASE 8 — RAG evaluation metrics (delegado a subagente)
- [ ] test_rag_eval.ts con 8 preguntas médicas
- [ ] Scoring: keywords, attribution, length
- [ ] Markdown table output con success rate

## 📋 PENDIENTE (testing físico)

### FASE 7 — Testing empírico exhaustivo (delegado a subagente)
- [ ] Repasar hoy → 4 botones FSRS funcionan
- [ ] Vault browser muestra Anatomía/Fisiología/Bioquímica con notas
- [ ] Wikilink [[circulacion]] navega correctamente
- [ ] Handwriting canvas abre + dibuja + guarda
- [ ] Daily note abre con secciones Tareas/Notas
- [ ] Tarjetas tab muestra 5 flashcards
- [ ] Ajustes → Avanzado tiene 4 nuevos tiles
