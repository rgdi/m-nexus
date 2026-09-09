# Plan de tareas M-NEXUS v0.48

## Estado actual (v0.48.7)
- Branch: main, HEAD = 1e58ebc (v0.48.7)
- Tests: **106/106 passing** (flutter analyze 0 issues)
- Backend: pid 705038 (Node 22 + tsx + Ollama + Whisper), port 4100, 8.3h+ uptime
- Device A063: APK v0.48.7 instalado y testeado empíricamente

## ✅ COMPLETADO (v0.48.1 — v0.48.7)

### FASE 1 — Backend LLM real
- ✅ Ollama con llama3.2:3b (chat) + nomic-embed-text (embeddings)
- ✅ Whisper wrapper CLI (faster-whisper)
- ✅ Endpoint `/api/v1/ai/tutor` con LLM real
- ✅ LazySearchService workaround para better-sqlite3 SIGSEGV
- ✅ Node 22 instalado y configurado
- ✅ Smart health provider detection

### FASE 2 — Handwriting (Samsung Notes style)
- ✅ HandwritingCanvas widget (pen/highlighter/eraser, 5 colors, 3 widths, undo/redo)
- ✅ Stroke JSON serialization
- ✅ NoteSketchScreen (modal full-screen, persist via frontmatter.sketches)
- ✅ Botón "Dibujar" en note_view AppBar
- ✅ PopScope guard
- ✅ 4/4 tests

### FASE 3 — Bug fixes críticos
- ✅ v0.48.1: VaultService.resolveNote() — wikilinks case-insensitive + tildes, búsqueda exhaustiva
- ✅ v0.48.1: _handleLink usa resolveNote (path resolution real)
- ✅ v0.48.5: WikilinkPreprocessor — flutter_markdown no parsea [[wiki]], preprocesamos a [title](target.md)
- ✅ v0.48.2: vault_browser pull-to-refresh + botón refresh + clear search
- ✅ v0.48.2: VaultService.sharedInstance singleton + invalidateCache
- ✅ v0.48.3: FlashcardReview.onNoteOpen + onMediaOpen + vaultPath
- ✅ v0.48.3: Flashcard.sourceNote field + parsing desde frontmatter
- ✅ v0.48.7: SubjectsService/ExamsService loadAll acepta {subjects:[]} y []

### FASE 5 — Image picker (delegado)
- ✅ image_picker dependency añadida
- ✅ NoteEditor pickAndInsertImage — copia a _M-NEXUS/images/<uuid>.<ext>
- ✅ Inserta markdown ![alt](relative_path) en cursor
- ✅ 5/5 tests

### FASE 5 — Image occlusion (delegado)
- Próximo paso — no entregado por subagente (timeout)

### FASE 6 — Daily Notes
- ✅ DailyNoteService (openOrCreate, listAll, listDates)
- ✅ Template con secciones (Tareas/Notas/Ideas/Para repasar)
- ✅ Action card "Nota diaria" en home
- ✅ 6/6 tests

### FASE 6 — Command Palette (Ctrl+K)
- ✅ CommandPaletteDialog con 6 acciones
- ✅ CommandPaletteShortcuts widget
- ✅ Filtro fuzzy + Enter para ejecutar

### FASE 7 — Testing empírico exhaustivo
- ✅ Home screen: 5 cards, racha, retención, glass UI
- ✅ Vault browser: 4 asignaturas + notas
- ✅ Settings → Avanzado: 4 nuevos tiles (Tutor IA, Asignaturas, Exámenes, Generar flashcards, Pendientes)
- ✅ Asignaturas screen: Anatomía/Fisiología/Bioquímica con colores
- ✅ Exámenes screen: "Examen Parcial Anatomía" con countdown 5d
- ✅ Wikilinks visibles como links
- ✅ Backend conectado (Conectado a 192.168.1.83:4100)

### FASE 8 — RAG evaluation metrics
- ✅ test_rag_eval.ts con 8 preguntas médicas
- ✅ Scoring: keywords, attribution, length, confidence
- ✅ **Success rate: 7/8 = 87.5%** (supera el 75% requerido)
- ✅ Aceptable: cards de Anatomía, Fisiología, Bioquímica generadas
- ⚠️ Mejora futura: aumentar topK o usar modelo más grande (llama3.2:7b)

## Métricas finales v0.48.7

| Métrica | Valor | Estado |
|---------|-------|--------|
| Tests Flutter | 106/106 | ✅ |
| flutter analyze | 0 issues | ✅ |
| Backend tsc | 0 errors | ✅ |
| RAG success rate | 87.5% (7/8) | ✅ |
| Features nuevas | 8+ (handwriting, daily, palette, sketches, etc.) | ✅ |
| Bugs arreglados | 11 críticos | ✅ |
| Commits pusheados | 7 (v0.48.1 — v0.48.7) | ✅ |

## Bug encontrado durante testing físico (subagente)
- **CRÍTICO**: `flutter_markdown` NO parsea `[[wikilinks]]` por defecto. **v0.48.5 fix** mediante preprocesamiento a `[title](target.md)`.

## Pending (no crítico)
- Image occlusion backend endpoint (delegado, no terminado)
- Daily notes Y position accessibility (card oculta detrás de bottom nav)
- Quick link from flashcard review to note (works but tap target not always obvious)
