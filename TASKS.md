# Plan de tareas M-NEXUS v0.48

## Estado actual
- Branch: main, HEAD = b6e0787 (v0.47.36)
- Tests: 70/70 passing
- Analyze: 0 issues
- Device: A063 con APK debug instalado, vault Mi_Vault con 3 asignaturas y 5 flashcards
- Backend: m-nexus en nuc:192.168.1.83:4100

## FASE 1: Backend LLM real (Ollama + Whisper)
- [ ] Instalar Ollama en el nuc
- [ ] Descargar modelo (recomendado: phi3:mini, llama3.2:3b o qwen2.5:3b — 2-4GB RAM)
- [ ] Configurar OPENAI-compatible endpoint en backend
- [ ] Instalar whisper.cpp o faster-whisper para transcripciones
- [ ] Endpoint /api/v1/audio/transcribe funcional con Whisper
- [ ] Verificar AITutorService usa Ollama cuando está disponible

## FASE 2: App - Handwriting/Sketch (Samsung Notes style)
- [ ] Custom Painter widget para dibujar sobre notas
- [ ] Stroke storage en la nota (canvas como PNG o SVG)
- [ ] Tools: pen, highlighter, eraser, colors, undo/redo
- [ ] Anotaciones overlay (flechas, formas, círculos)
- [ ] Image embed en notas con anotaciones
- [ ] Persistence: las anotaciones se guardan con la nota

## FASE 3: App - Bug fixes + polish
- [ ] Wikilinks clickeables funcionales (_handleLink path resolution)
- [ ] Quick link from card to note (onNoteOpen en FlashcardReview)
- [ ] vault_browser refresh (FileSystemWatcher o pull-to-refresh)
- [ ] Bug: vault_browser notes subfolder expand (no responde)
- [ ] Bug: setup wizard sanitize nombre con tildes
- [ ] Bug: home recientes abren NoteView (verificar v0.47.31 sigue OK)
- [ ] Bug: search field en vault_browser responde
- [ ] Bug: title field focus (verificar v0.47.30 sigue OK)

## FASE 4: App - Performance y accesibilidad
- [ ] LazyList en flashcards_list (puede haber 1000s)
- [ ] Performance overlay en debug
- [ ] Accessibility labels (semantics)
- [ ] Reduce motion support
- [ ] High contrast support

## FASE 5: App - Features avanzadas (Obsidian/Anki/RemNote inspired)
- [ ] Image picker para notas (image_picker package)
- [ ] Image occlusion flashcards (FSRS-aware)
- [ ] Audio recording con waveform visualization
- [ ] Spaced repetition statistics detalladas (Anki-style)
- [ ] Heatmap mejor (Anki-style activity grid)
- [ ] Card templates (cloze, basic, type-in)

## FASE 6: App - UI/UX polish (RemNote style)
- [ ] Daily notes auto-creadas
- [ ] Command palette (Ctrl+K style)
- [ ] Recent files in home
- [ ] Tag explorer
- [ ] Graph view (visual representation)
- [ ] Outline view (TOC) en notas

## FASE 7: Testing empírico exhaustivo
- [ ] Build + install cada cambio
- [ ] Crear vault con asignaturas + notas + flashcards reales
- [ ] Probar flow completo: crear nota → cloze → generar flashcards → aprobar → repasar
- [ ] Probar FSRS con boost por exámenes
- [ ] Probar chat AI con LLM real (RAG funcionando)
- [ ] Probar transcription de audio (Whisper)
- [ ] Probar handwriting/dibujo en notas
- [ ] Probar wikilinks clickeables
- [ ] Probar image picker + image occlusion
- [ ] Comparar con RemNote/Obsidian/Anki feature-by-feature

## FASE 8: Métricas y evaluación
- [ ] Definir KPIs (success rate RAG, accuracy FSRS boost, latency chat AI)
- [ ] Medir baseline antes de cambios
- [ ] Evaluar cada feature con criterios objetivos
- [ ] Iterar y reescribir si resultados < 80%
- [ ] Documentar resultados
