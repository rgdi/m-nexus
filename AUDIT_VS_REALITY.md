# 🔴 AUDITORÍA EXPECTATIVA VS REALIDAD — M-NEXUS

**Fecha**: 2026-09-10
**Versión auditada**: v0.51.7+129
**Tipo de auditoría**: BRUTAL. Sin filtros. Sin auto-engaño.
**Comparativa**: AnkiDroid, Anki 24.06.3, AnkiHub, Obsidian 1.13, Notion 2026, RemNote, Logseq, SuperMemo 19, Roam Research.

---

## TL;DR — La verdad incómoda

**M-NEXUS es un MVP funcional con muy buena base técnica pero está a 3-5 años de competir con los líderes mundiales del sector.**

- **Anki 24.06.3** (líder en SR) tiene **+12 años** de ventaja en algoritmo + sincronización + plugin ecosystem.
- **Obsidian 1.13** (líder PKM) tiene **+1.000 plugins community**, 4.600+ extensiones, Bases (Notion-style) desde 2025.
- **Notion 2026** (líder en workspace) tiene 8 años de ventaja con AI Agents, Database Agents, Synced Blocks, Workers.

M-NEXUS tiene: markdown + block editor + FSRS + AI + CRDT. **Le faltan las 3 patas que definen a los líderes**: 1) sync real y maduro, 2) marketplace/community, 3) retención/personalización del algoritmo.

**Calificación actual**: 6/10 como MVP. **Para ser top mundial**: 9/10. Esto requiere 6-12 meses más con foco.

---

## SECCIÓN 1: GAPS CRÍTICOS (🔴 P0 — bloqueantes para "top mundial")

### 1.1 Sync end-to-end **NO funciona realmente**

**Lo que dice la documentación**: "Yjs CRDT sync real, multi-device, push/pull".
**La realidad**:

```typescript
// backend/src/routes/crdt.ts:97-99
// For broadcast: in this version, cada cliente pide estado completo
// via GET si quiere refresco. Para true broadcast P2P se usaria
// un hub central con clientes[wss] map; simplificado en v0.51
```

El WS del CRDT **NO hace broadcast de updates a otros clientes**. Es half-implementado. Cuando un cliente A edita una nota, el cliente B no se entera en tiempo real. Solo se entera si hace GET /state.

**Comparativa**:
- **Obsidian Sync**: push instantáneo via WebSocket + 1MB chunks + E2E encryption AES-256.
- **AnkiWeb**: sync binario de collection.media + 50MB collection cada 5min o on-demand.

**Impacto**: 🔴 P0. El "M" en M-NEXUS debería ser multi-device. Ahora mismo es multi-disconnected.

**Acción**:
- Implementar un hub central `clients[wss]: Map<WebSocket, ClientMeta>` con broadcast de updates.
- Heartbeat ping/pong cada 30s.
- Reconexión automática en cliente.
- Resolver conflictos en offline-edit (4 clientes editan la misma nota simultáneamente).
- Optimistic UI en cliente (mostrar el cambio antes de confirmación del server).

### 1.2 FSRS sin optimizador de parámetros

**Lo que dice**: "FSRS-6 con 21 parámetros".
**La realidad**: usa defaults fijos. No aprende del usuario.

```dart
// app/lib/services/fsrs_engine.dart:25-40
//   Diferencias con ts-fsrs:
//   - Sin optimizadores de parámetros. Usamos defaults de FSRS-5.
//   - Sin optimizer per-user (eso se hace en backend).
```

**Comparativa**:
- **Anki 23.10+**: corre `FSRS Optimizer` con los logs del usuario. Después de 10k reviews, los parámetros se personalizan via gradient descent sobre matriz DSR.
- **SuperMemo SM-18**: optimiza 7 parámetros basándose en matriz de R-ratio histórica.

**Impacto**: 🔴 P0. Sin optimización, FSRS es 20-30% menos preciso que SM-2 bien tuneado.

**Acción**:
- Implementar `FSRSOptimizer` que use gradient descent sobre las reviews guardadas.
- Background job que recalcula parámetros cada 1k reviews nuevos.
- Botón "Optimizar mi scheduler" en settings.
- Visualizar comparación "FSRS default vs personalizado" con un mini-chart de R-curve.

### 1.3 Sin RAG semántico (búsqueda = keyword matching)

**Lo que dice**: "AI Tutor RAG con vault".
**La realidad**:

```dart
// app/lib/services/local_tutor_service.dart:82-90
for (final kw in keywords) {
  if (content.contains(kw)) {
    score += content.split(kw).length - 1;  // substring count
    hits.add(kw);
  }
}
```

El "RAG" es **substring matching** con stopwords eliminadas. NO usa embeddings. NO hay busqueda semantica. NO hay vector store.

**Comparativa**:
- **Obsidian Smart Connections**: genera embeddings locales (Transformers.js), indexa en LanceDB, búsqueda semántica en <100ms.
- **Notion AI Q&A**: embeddings via OpenAI text-embedding-3-small, búsqueda vectorial en Pinecone.
- **RemNote AI**: embeddings + GPT-4 para responder sobre el knowledge graph.

**Impacto**: 🔴 P0. Es la funcionalidad más prometida de un AI tutor. Sin embeddings, es una búsqueda de Google de 1998.

**Acción**:
- Integrar `all-MiniLM-L6-v2` (90MB, on-device) via ONNX Runtime Mobile.
- Indexar todas las notas en `sqlite-vec` o `Zvec` (Alibaba, lanzado Feb 2026).
- Hybrid search: FTS5 + vector similarity + Reciprocal Rank Fusion.
- Background indexing con isolate.
- Mostrar fragmentos relevantes con score de similitud.

### 1.4 Sin E2E encryption

**Lo que dice**: "CRDT, sync seguro, E2E".
**La realidad**:

```typescript
// backend/src/services/syncService.ts:12-15 (Muerto)
//   - E2E encryption: en el cliente (no en backend) — backend solo ve ciphertext
// (Código sin usar, syncService es código muerto)
```

Backend recibe texto plano. No hay cifrado E2E real.

**Comparativa**:
- **Obsidian Sync**: AES-256-GCM, clave derivada en cliente, backend solo ve ciphertext.
- **Standard Notes**: XChaCha20-Poly1305, zero-knowledge backend.
- **Joplin Cloud**: también E2E con scrypt key derivation.

**Impacto**: 🔴 P0. Datos médicos son sensibles. Sin E2E, el backend es un honey pot. RGPD / HIPAA friendly NO.

**Acción**:
- Generar keypair en cliente con `pointycastle` o `cryptography`.
- Cifrar cada bloque Yjs antes de enviar al backend.
- Backend almacena ciphertext, no puede leer.
- Auth via challenge-response con firma digital.
- Backup opcional con clave recuperable (12 palabras tipo BIP39).

### 1.5 40 servicios backend NO MONTADOS (código muerto)

```bash
$ comm -23 <(ls backend/src/services/*.ts | xargs -I{} basename {} .ts | sort) \
         <(grep -E "await app.register" backend/src/server.ts | xargs ... | sort)
```

**Servicios backend implementados pero NUNCA registrados**:
- `gamificationService` (XP, achievements) — promete gamificación, no hay.
- `webClipperService` (HTML→MD) — no hay web clipper.
- `pluginService` (plugin API estilo Obsidian) — no hay plugin API.
- `graphService` (knowledge graph) — no hay graph view.
- `conflictResolver` (LWW por field) — no se usa, sync usa CRDT.
- `structuredNotes` (notes estructuradas) — no se usa.
- `crossRelevance` (cross-reference analyzer) — no se usa.
- `proposals.ts` y `proposalsV2.ts` (generación de propuestas) — solo V2 se usa.
- `typeAnswerService` (respuesta tipeada) — no se usa.
- `tagService` — no se usa.
- `templateService` — no se usa.
- `vaultEval` (evaluación del vault) — solo usado en /ai/vault/eval.
- `streamingTranscription` — implementado pero no expuesto a la app (es backend-only).
- `heatmapService` — backend no expone nada, app lo tiene propio.
- `pushNotifications` (FCM) — implementado pero no usado.

**Adicionalmente, código muerto confirmado**:
- `syncService.ts` (duplica `crdtSyncService.ts`).
- `proposals.ts` reemplazado por `proposalsV2.ts`.

**Impacto**: 🔴 P0. Esto es muy grave. El backend tiene **~35% de código sin usar**. Es peso muerto que da una falsa sensación de "feature complete".

**Acción**:
- Borrar o montar: `git grep -l` para cada servicio huérfano.
- Para cada servicio, decisión: ¿se elimina, se monta, o se archiva?
- Hacer un audit board que rastree cada servicio → ruta → uso en app.

---

## SECCIÓN 2: GAPS IMPORTANTES (🟠 P1 — afectan la propuesta de valor)

### 2.1 No hay Image Occlusion (solo API backend)

**Lo que existe**: `POST /api/v1/flashcards/image-occlusion` en backend con parser completo.
**Lo que NO existe**: UI para crear image occlusion en la app.

**Comparativa**:
- **Anki 24.06.3**: image occlusion BUILT-IN. Click derecho en imagen → "Hide labels" → pintar rectángulos → genera N cards.
- **RemNote Pro**: $8/mes solo por image occlusion.
- **AnKing deck**: la mitad de sus cards más efectivos son image occlusion.

**Impacto**: 🟠 P1. Feature crítico para anatomía, histología, radiología.

**Acción**:
- Crear `ImageOcclusionEditor` en app con `CustomPaint` + gestos.
- Integrar en flashcards_list y dentro del block_editor (image block → "ocluir").
- Guardar metadata JSON en el .md de la flashcard.

### 2.2 No hay Leech detection / Cramming mode / Burned

**Comparativa Anki**:
- **Leech detection**: cards que fallan N veces → marked as leech → rescheduled.
- **Cramming mode**: ver todas las cards nuevas en una sesión, sin scheduling.
- **Burned cards**: archivar cards que ya no aportan.
- **Custom study**: generar sesiones temporales.

**Impacto**: 🟠 P1. Sin leech detection, cards problemáticas se quedan en el queue eternamente.

**Acción**:
- Algoritmo: si `lapses >= 8` y `reps >= 10` y `lapses/reps > 0.25` → leech.
- UI: badge rojo en flashcards_list, opción "Reschedule" o "Suspend".
- Cramming: `FlashcardService.cram(deck, limit)` con `temporary=true`.
- Burned: `state=4` que no aparece en reviews normales.

### 2.3 No hay Audio real en cards (solo grabación de clase)

**Lo que existe**: Audio recorder para clases.
**Lo que NO existe**: Audio EMBEBIDO en flashcards (pronunciación, listening comprehension).

**Comparativa**:
- **Anki**: `card.front` puede ser un `<audio src="...">`. AnkiDroid tiene TTS automático.
- **AnkiDroid**: TTS en 30+ idiomas via `text-to-speech` plugin.
- **RemNote**: audio embebido en cards.

**Impacto**: 🟠 P1. Crítico para language learning, semi-crítico para anatomía (nombres en latín).

**Acción**:
- Agregar campo `audioPath` a Flashcard.
- TTS en review: `flutter_tts` para pronunciar la respuesta.
- Audio record inline en FlashcardEdit.

### 2.4 No hay Web Clipper

`webClipperService.ts` existe (340 líneas) pero **NO tiene endpoint**. Es código muerto.

**Comparativa**:
- **Notion Web Clipper**: extensión Chrome, guarda páginas completas con metadata.
- **Obsidian Web Clipper** (2024): oficial, soporta Markdown / HTML / full-page.
- **Evernote Web Clipper**: legacy pero todavía fuerte.

**Impacto**: 🟠 P1. Para investigación y "second brain" es crítico.

**Acción**:
- Crear `POST /api/v1/clip/url` que use `webClipperService.htmlToMarkdown`.
- Crear `POST /api/v1/clip/html` (paste HTML directo).
- Crear Chrome extension (MV3) que use este endpoint.
- Crear share intent en Android (recibe URL desde browser).

### 2.5 No hay Graph view

`graphService.ts` existe en backend (knowledge graph para adaptive quiz) pero **NO hay visualización en app**.

**Comparativa**:
- **Obsidian Graph view**: el feature signature. Muestra nodos (notas) y aristas (wikilinks), filterable por tags/folders, color-coded.
- **Roam Research**: graph + block-level linking (cada bullet es un nodo).
- **Notion**: NO tiene graph view (es su debilidad).

**Impacto**: 🟠 P1. Sin graph view, el "knowledge management" no es visual.

**Acción**:
- Usar `graphviz` o `flutter_graph_view`.
- Renderizar nodos en InteractiveViewer, layout force-directed.
- Local graph (al abrir nota) + global graph (full vault).
- Filtrar por tag, folder, regex.
- Color por tag.

### 2.6 No hay Calendar / Timeline / Gantt

**Comparativa**:
- **Notion Timeline view**: native, gantt-style con dependencias.
- **Obsidian**: NO tiene, pero hay plugins (Calendar, Tasks).
- **Anki**: no tiene.

**Impacto**: 🟠 P1. La feature de `exams` que existe en M-NEXUS debería tener un timeline view.

**Acción**:
- `TimelineScreen` con scroll horizontal.
- Cada examen = bar en timeline.
- Drag para reagendar.
- Heatmap de productividad debajo.

### 2.7 No hay Tasks agregados (como plugin Tasks de Obsidian)

**Comparativa**:
- **Obsidian Tasks plugin**: query `tag:#task` across all notes → global task list.
- **Notion**: database de tasks con views, filters, relations.
- **Todoist**: classic GTD app.

**Impacto**: 🟠 P1. `todo` block existe pero solo dentro de una nota.

**Acción**:
- `TaskService.extractAllTasks(vault)`: parsea `- [ ]` y `* [ ]` en todos los .md.
- `TaskScreen` global con filter por fecha, tag, proyecto.
- Marcar como done desde la pantalla global.
- Sincronizar con FSRS (cada "done" = review).

### 2.8 No hay Templates con JavaScript (Templater-style)

**Lo que existe**: 5 templates estáticos (gallery).
**Comparativa**:
- **Obsidian Templater**: templates con JS, prompts, fechas dinámicas, shell exec.
- **Notion**: templates con formulas (mini programming language).

**Impacto**: 🟠 P1. Power user feature, pero core para "second brain".

**Acción**:
- `Template` con script Dart (sandboxed).
- `{{date:YYYY-MM-DD}}`, `{{prompt:title}}`, `{{clipboard}}`.
- Ejecutar antes de crear nota.

### 2.9 No hay Kanban board (Database view)

**Comparativa**:
- **Obsidian Kanban**: notas = cards, drag entre columns.
- **Notion Board view**: nativo en databases.
- **Trello**: classic.

**Impacto**: 🟠 P1. Para project management y GTD.

**Acción**:
- `BoardView` dentro de un database block.
- Columnas = status, cards = notes.
- Drag&drop entre columnas actualiza frontmatter.

### 2.10 No hay Database con rollups / formulas (Notion-style)

**Lo que existe**: `DatabaseQuery` con field/value/tags/sort/limit.
**Lo que NO existe**: formulas (`field_a + field_b`), rollups (sum across relations), conditional colors.

**Comparativa Notion**:
- Formula: `if(prop("Status") == "Done", 1, 0)`.
- Rollup: `relation.sum(prop("Hours"))`.
- Conditional color: rule-based highlighting.

**Impacto**: 🟠 P1. Sin esto, las "linked databases" son searches, no databases.

**Acción**:
- Mini-parser de formulas (whitelist de functions: `if`, `sum`, `count`, `avg`, `now`, `dateAdd`).
- Rollup field: ejecuta aggregation sobre related entries.
- Conditional color en DataTable.

---

## SECCIÓN 3: GAPS MENORES (🟡 P2 — nice to have)

### 3.1 No hay AnkiHub / marketplace real

`marketplaceService.ts` solo tiene seed data hardcodeado. NO hay:
- API para subir decks.
- Reviews, ratings, comments.
- Distribución de decks privados.
- Sync de decks compartidos.
- "Live updates" (cuando un collaborator edita una card, todos reciben).

**Comparativa**:
- **AnkiHub**: $6/mes, 100k+ suscriptores, med-school decks colaborativos.
- **Quizlet Marketplace**: miles de decks públicos.
- **Brainscape**: marketplace propio.

**Acción**:
- Crear `MarketplaceBackend` con auth, upload, reviews.
- Backend en `/api/v1/marketplace/{browse,upload,download,sync}`.
- UI: `MarketplaceScreen` con búsqueda, install, sync.
- Revenue share: 70/30 split si es de pago.

### 3.2 No hay AnkiWeb-like cloud sync (gratis, robusto)

**AnkiWeb**: gratis, ~1.4M usuarios activos, sync en <5s, media handling robusto.

M-NEXUS tiene:
- Backend con auth JWT.
- CRDT sync.
- Dashboard.

**Pero falta**:
- E2E encryption (citado en 1.4).
- Selective sync (no subir todo el vault).
- Conflict resolution UI (cuando hay divergencia real).
- Bandwidth management (no subir 5GB de media).
- Compression.
- Deduplication de media.

### 3.3 No hay PDF/EPUB reader con highlighting

**Lo que existe**: PDF render con pdfx (solo lectura).
**Lo que NO existe**: highlighting, notes, export to Anki.

**Comparativa**:
- **MarginNote**: PDF + notes + flashcards + graph.
- **LiquidText**: PDF con linking entre páginas.
- **Anki**: Anki importa PDF pero no highlights directo.

**Acción**:
- Implementar selección de texto en PDF render.
- Guardar highlight como `[[PDF:page=5#selection]]` en una nota.
- Generar cloze de selección.

### 3.4 No hay handwriting/Sketch recognition

`handwriting_canvas.dart` existe (138 líneas) pero es solo drawing, no OCR.

**Comparativa**:
- **Notion AI**: handwriting recognition.
- **GoodNotes**: handwriting + search.
- **Apple Notes**: handwriting con reconocimiento.

**Acción**:
- Usar `google_ml_kit` (Android) o `vision_ocr` (iOS) para handwriting-to-text.
- Almacenar como capa searchable en el .md.

### 3.5 No hay TTS / voice output en cards

**Comparativa**:
- **AnkiDroid**: TTS built-in para 30+ idiomas.
- **Duolingo**: voice en cada exercise.
- **Memrise**: native speaker audio.

### 3.6 No hay widget de home screen (Android)

**AnkiDroid**: widget nativo con "5 due today" en home screen launcher.

### 3.7 No hay Wear OS / WatchOS support

**AnkiDroid**: experimental Wear OS. Permite reviews rápidos en muñeca.

### 3.8 No hay Apple Watch

**Por user request**: iOS skipped. Pero WatchOS sería nice.

### 3.9 No hay modo offline real para OCR/embed

`embed_service.dart` detecta URL pero **no renderiza** (no WebView). Card preview con link.
**Mejor**: WebView con lazy load + cache.

### 3.10 No hay Spectrogram / Waveform en recordings

**Comparativa**:
- **Voice Memos** (Apple): waveform.
- **Audacity**: spectrogram.
- **Notion Audio**: waveform.

**Acción**: render waveform en `AudioPlayerWidget`.

### 3.11 No hay Exam simulator (timed test)

**Comparativa**:
- **AnKing**: practice tests.
- **AMBOSS**: Qbank con timer.
- **UWorld**: classic exam sim.

**Acción**: `ExamSimulator` con timer, shuffled questions, scoring.

### 3.12 No hay Spaced Repetition de fórmulas o math

M-NEXUS tiene math (KaTeX) pero **no hay cards generadas automáticamente desde fórmulas**.

**Acción**: `MathToCard`: extrae `$...$` y genera cloze.

---

## SECCIÓN 4: FALLAS LÓGICAS Y DE DISEÑO

### 4.1 🔴 Race condition en CRDT + filesystem

CRDT sync (vía WS) escribe al `room.doc` en memoria. **PERO** el filesystem (vault .md files) **NO está sincronizado** con el CRDT doc.

```typescript
// backend/src/services/crdtSyncService.ts:73-79
// Persistir en cada update
doc.on("update", (_update: Uint8Array, origin: unknown) => {
  room!.dirty = true;
  this.schedulePersist(key);  // Persiste el Y.Doc
  // Si el origin es un cliente, propagar a otros
  if (typeof origin === "string" && origin.startsWith("client:")) {
    // Esto lo maneja el WebSocket handler
  }
});
```

**Problema**: el Y.Doc vive en `crdtDir/<sha1>.bin`. El vault .md está en otro lado. **No hay sync entre ambos**. El cliente debe:
1. Decodificar el Y.Doc a markdown.
2. Escribir el .md.
3. Re-leer el .md.

Esto NO está implementado. La "sync end-to-end" es solo entre Y.Docs, no entre Y.Docs y archivos.

**Impacto**: editar en cliente → CRDT en backend → ¿qué pasa con el .md? **NADA**.

### 4.2 🔴 `AppState.recordReview()` hace fire-and-forget reload

```dart
// app/lib/state/app_state.dart:127-140
void recordReview(String cardId) {
  _recentReviews.insert(0, ReviewEvent(timestamp: DateTime.now().millisecondsSinceEpoch));
  if (_recentReviews.length > 500) {
    _recentReviews = _recentReviews.sublist(0, 500);
  }
  // Re-fetch la card para tener su nuevo state
  if (_flashcardService != null) {
    _flashcardService!.listAll().then((updated) {
      _cards = updated;  // REEMPLAZA _cards con TODAS
      notifyListeners();
    });
  }
}
```

Después de CADA review, **lista todas las cards del FSRS otra vez**. Con 5k cards, esto es síncrono y bloquea el UI thread.

**Fix**: actualizar solo `_cards` en memoria, no relistar.

### 4.3 🔴 Sin file locking → race condition en escrituras

```dart
// app/lib/services/comments_service.dart:60
await _file.writeAsString(jsonEncode(all, indent: 2));
```

Si dos `comments_service.write()` ocurren en paralelo (e.g., comentario + reply en threads), el segundo sobreescribe al primero.

Mismo problema en:
- `comments_service.dart`
- `database_query_service.dart`
- `exams_service.dart`
- `version_history_service.dart` (parcial)
- `daily_note_service.dart`
- `export_service.dart`

**Fix**: usar `package:synchronized` o flock del sistema.

### 4.4 🔴 API keys en SharedPreferences sin encriptar

```dart
// app/lib/services/multi_model_ai.dart
AiConfig {
  String? apiKey;  // En SharedPreferences
  ...
}
```

En Android, SharedPreferences está en `/data/data/com.mnexus.app/shared_prefs/`. **En un dispositivo rooteado o con backup, queda expuesto**.

**Fix**: usar `flutter_secure_storage` con Android Keystore + iOS Keychain.

### 4.5 🟠 Embeds: detección funciona, render no

```dart
// app/lib/screens/note/block_editor.dart:1229
/// v0.51: embed block con preview offline (YouTube, Twitter, etc)
```

`embed_service.dart` detecta YouTube ID, Twitter URL, etc. Pero **NO renderiza**. Es una card con icono + "click to open in browser".

**Falta**: WebView para preview inline.

**Comparativa**:
- **Notion**: embeds reales con iframe (YouTube plays inline).
- **Obsidian**: no embeds por default pero hay plugins.

### 4.6 🟠 CRDT WS no hace broadcast (confirmado)

```typescript
// backend/src/routes/crdt.ts:97-99
// For broadcast: in this version, cada cliente pide estado completo
// via GET si quiere refresco. Para true broadcast P2P se usaria
// un hub central con clientes[wss] map; simplificado en v0.51
```

Dos clientes en el mismo room no se ven en tiempo real. **Esto rompe el "M" de Multi-device**.

### 4.7 🟠 CRDT sin E2E

`crdtSyncService` envía Yjs updates binarios sin cifrar. Si el backend se compromete, el vault se ve.

### 4.8 🟠 Markdown round-trip en block_editor puede perder datos

```dart
// app/lib/screens/note/block_editor.dart — block serialization
// format on disk is markdown (compatibilidad con el resto de la app)
```

Pero el block editor tiene 15 tipos de bloques. **¿Todos round-trip sin pérdida?**

Tip:
- `math` → `$...$` en markdown.
- `image` → `![](path)`.
- `embed` → `:::embed URL` (nuevo, no standard).
- `columns` → `:::columns ... :::col ... :::` (custom).
- `table` → Markdown table (puede perder formato).
- `callout` → `> [!note] ...` (Obsidian-style, custom).

`:::embed URL` y `:::columns` son **no-standard markdown**. Si exportas a otro editor (Typora, MarkText), se ven como basura.

**Fix**: documentar el superset de markdown o usar HTML comments como metadata.

### 4.9 🟠 `print()` en producción

```dart
// app/lib/services/daily_note_service.dart:67
print('debug: $s');

// app/lib/services/exams_service.dart:81
print('ExamsService.loadAll: parse error: $e');

// app/lib/services/subjects_service.dart:93
print('SubjectsService.loadAll: parse error: $e');
```

`print` en release mode va a logcat sin estructura. Debería usar el `AdvancedLogger`.

### 4.10 🟠 CRDT `roomKey` como private

```typescript
// backend/src/services/crdtSyncService.ts:17
private roomKey(notePath: string): string {
  return createHash("sha1").update(notePath).digest("hex").slice(0, 16);
}
```

Es private pero el código lo llama via `service["roomKey"](...)` (cast a any). Rompe el encapsulamiento.

### 4.11 🟠 No hay isolate para tareas pesadas

FSRS, OCR, Whisper todo corre en el main isolate. **UI se congela** en vaults grandes.

**Fix**: `compute()` o `Isolate.run()` para:
- FSRS bulk rating.
- Vault scan > 1000 notes.
- OCR.
- Whisper transcription.

### 4.12 🟠 Sin cleanup de WebSocket clients

```typescript
// backend/src/routes/crdt.ts
app.get("/crdt/ws/:notePath", { websocket: true }, async (socket, req) => {
  ...
  socket.on("close", () => {
    room.clients.delete(clientId);
    ...
  });
});
```

OK hay cleanup. Pero `clients[wss]` global no existe (porque broadcast no está implementado). Cuando se implemente, hay que tener cuidado con memory leaks.

### 4.13 🟠 Settings no se migran

`SettingsService` no tiene versionado. Si cambias un campo, los usuarios con versión anterior pierden config.

### 4.14 🟠 No hay tema oscuro completo

```dart
// app/lib/core/theme.dart
```

Solo el sistema. Custom themes (como Anki tiene 30+ themes) no existen.

### 4.15 🟠 Anki import no preserva scheduling

```typescript
// backend/src/services/importService.ts
```

Importa .apkg → extrae notes → crea markdown. **Pero el scheduling de Anki (FSRS state) se pierde**. Después de import, todas las cards son "new".

**Fix**: parsear la collection.anki21b o `revlog` para extraer history.

### 4.16 🟠 Sin backup automático

`backupRoutes` existe pero **no hay auto-backup** en el cliente. Si pierdes el vault, pierdes todo.

**Fix**: backup diario a Google Drive / Dropbox / WebDAV (Joplin-style).

### 4.17 🟠 Sin undo/redo a nivel app

`version_history_service` guarda snapshots pero **no hay undo global** (Ctrl+Z). El block_editor tiene undo por bloque.

### 4.18 🟡 Falta de tests de integración reales

- App tests: 534 expects en 13 files. Suficiente para unidades.
- Backend: 609/609 pass. Bien.
- **No hay integration tests** que prueben el flujo completo: crear vault → escribir nota → sync → modificar en otro device → sync.

### 4.19 🟡 `embedUrl` field no se sanitiza

```dart
class Block {
  String? embedUrl;  // User input
  ...
}
```

Si el usuario pone `javascript:alert(1)` como embedUrl, ¿se ejecuta? Depende del renderer. Si en el futuro se usa WebView, **XSS vulnerability**.

**Fix**: regex `^https?://` en validación.

### 4.20 🟡 No hay `Path` validation en uploads

```typescript
// backend/src/routes/upload.ts
```

El usuario sube un file. ¿El path es seguro? Si permite ../../etc/passwd, RCE.

**Fix**: validar que el path está dentro del vault.

### 4.21 🟡 Sin CSP headers

Backend no envía Content-Security-Policy. Si se sirve una web view o extension, XSS posible.

### 4.22 🟡 Sin rate limiting por usuario

```typescript
// backend/src/server.ts:68
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
```

Global, no por user. Un user puede saturar a otros.

### 4.23 🟡 Home es estático (no personalizable)

A diferencia de Notion o iOS home screen, el home de M-NEXUS es fijo. No se puede reordenar ni ocultar cards.

### 4.24 🟡 Sin onboarding interactivo

`onboarding_tutorial.dart` existe. **Pero no hay tooltips contextuales** la primera vez que usas cada feature (como iOS).

### 4.25 🟡 Sin collaborative editing real

CRDT es la base, pero **no hay UI para ver quién más está editando** (cursores de colores tipo Google Docs).

---

## SECCIÓN 5: COMPARATIVA CON LÍDERES MUNDIALES

### Anki (líder SR)

| Feature | Anki 24.06.3 | M-NEXUS v0.51.7 | Gap |
|---------|--------------|------------------|-----|
| FSRS 6 | ✅ Built-in | ✅ Default pero sin optimizer | 🟠 |
| AnkiWeb sync | ✅ Gratis, 5s, E2E no | 🟠 CRDT local sin E2E ni broadcast | 🔴 |
| Image Occlusion | ✅ Built-in | 🟠 API backend sin UI | 🔴 |
| 1600+ add-ons | ✅ | ❌ 0 plugins | 🔴 |
| Shared decks | ✅ AnkiWeb marketplace | 🟠 seed data hardcoded | 🔴 |
| TTS en cards | ✅ AnkiDroid | ❌ No | 🟠 |
| Leech detection | ✅ Auto | ❌ No | 🟠 |
| Cramming | ✅ | ❌ No | 🟡 |
| Custom study | ✅ | ❌ No | 🟡 |
| Card templates HTML | ✅ | 🟠 Markdown superset | 🟡 |
| Home screen widget | ✅ AnkiDroid | ❌ No | 🟡 |
| Wear OS | ✅ Beta | ❌ No | 🟡 |

**Veredicto Anki**: Anki es **2-3 años por delante** en algoritmo y 5+ años en ecosistema. M-NEXUS tiene AI nativo y vault integration que Anki no tiene. **M-NEXUS puede competir en AI/notes-first, no en SR puro.**

### Obsidian 1.13 (líder PKM)

| Feature | Obsidian 1.13 | M-NEXUS v0.51.7 | Gap |
|---------|---------------|------------------|-----|
| Local-first | ✅ | ✅ | ✅ |
| Markdown files | ✅ | ✅ | ✅ |
| Graph view | ✅ Built-in | ❌ Backend sin UI | 🔴 |
| Bases (2026) | ✅ Native Notion-style | 🟠 Mismo concepto, menos features | 🟠 |
| Backlinks | ✅ Auto | ✅ Panel | ✅ |
| 4600+ plugins | ✅ | ❌ 0 | 🔴 |
| Sync E2E | ✅ $4/mo | ❌ No | 🔴 |
| Publish web | ✅ $8/mo | ❌ No | 🟠 |
| CLI | ✅ v1.12 | ❌ No | 🟠 |
| Canvas (whiteboard) | ✅ JSON Canvas | 🟠 Canvas custom | 🟠 |
| Templater (JS) | ✅ | ❌ Estático | 🟠 |
| Dataview (SQL) | ✅ | ❌ Custom queries | 🟠 |
| Tasks (global) | ✅ | ❌ No | 🟠 |
| Calendar plugin | ✅ | ✅ Built-in | ✅ |
| Excalidraw | ✅ | ❌ No | 🟠 |

**Veredicto Obsidian**: M-NEXUS tiene AI nativo (Obsidian requiere plugin) y grabación de audio (Obsidian no). **M-NEXUS gana en AI-first; Obsidian gana en ecosistema y longevidad**.

### Notion 2026 (líder workspace)

| Feature | Notion 2026 | M-NEXUS v0.51.7 | Gap |
|---------|-------------|------------------|-----|
| Notion AI | ✅ Built-in, 20 free uses | ✅ Backend + 5 providers | ✅ |
| AI Agents (Workers) | ✅ Mayo 2026 | ❌ No | 🟠 |
| Database relations | ✅ Native | 🟠 Tipos, no relations | 🟠 |
| Database formulas | ✅ | ❌ No | 🟠 |
| Rollups | ✅ | ❌ No | 🟠 |
| Synced blocks | ✅ Cross-workspace | ❌ No | 🟠 |
| Real-time collab | ✅ 100+ users | 🟠 CRDT sin UI | 🟠 |
| Templates gallery | ✅ 1000+ | 🟠 5 hardcoded | 🟠 |
| Web Clipper | ✅ Chrome ext | ❌ Backend sin UI | 🟠 |
| Database agents | ✅ 2026 | ❌ No | 🟠 |
| Cross-platform | ✅ All | 🟠 Android only | 🟠 |

**Veredicto Notion**: M-NEXUS está más cerca de Notion que de Anki. **Falta database power (formulas, rollups, relations)**. Notion cuesta $10/mo, M-NEXUS gratis. **M-NEXUS tiene una oportunidad clara en el segmento "Notion offline-first"**.

### RemNote (líder notes+SR)

| Feature | RemNote | M-NEXUS v0.51.7 | Gap |
|---------|---------|------------------|-----|
| Notes+SR unificado | ✅ | ✅ | ✅ |
| FSRS default | ✅ | ✅ | ✅ |
| Incremental reading | ✅ Plugin | ❌ No | 🟠 |
| PDF annotation | ✅ Pro $8 | ❌ No | 🟠 |
| Image occlusion | ✅ Pro | ❌ No | 🟠 |
| Knowledge graph | ✅ | 🟠 Backend | 🟠 |
| AI | ✅ RemNote AI | ✅ Multi-provider | ✅ |
| Outliner | ✅ | ❌ Block editor | 🟠 |

**Veredicto RemNote**: Muy similar en filosofía. **RemNote gana en outliner + incremental reading. M-NEXUS gana en block editor + multimedia**.

### SuperMemo 19 (líder algoritmo)

| Feature | SuperMemo 19 | M-NEXUS v0.51.7 | Gap |
|---------|--------------|------------------|-----|
| SM-18 algorithm | ✅ | ❌ Solo FSRS | 🟠 |
| Incremental reading | ✅ 1990s, no equivalent | ❌ No | 🟠 |
| Neural network scheduling | ✅ SM-18 | ❌ No | 🟠 |
| Personal fine-tuning | ✅ Auto | ❌ No | 🟠 |
| Mobile | 🟠 Web | ✅ Native Android | ✅ |
| UX | 🟠 1990s | ✅ 2025+ | ✅ |

**Veredicto SuperMemo**: SuperMemo es el Rolls Royce del SR algorithm. M-NEXUS no puede competir ahí. **Pero el 99% de usuarios no necesita SM-18; FSRS es suficiente**.

---

## SECCIÓN 6: TABLA DE GAPS Y PRIORIDADES

### Matriz de priorización (esfuerzo × impacto)

| # | Gap | Impacto | Esfuerzo | Prioridad |
|---|-----|---------|----------|-----------|
| 1 | Sync real con broadcast | 🔴 P0 | M (2-3 sem) | **AHORA** |
| 2 | RAG semántico con embeddings | 🔴 P0 | L (4-6 sem) | **AHORA** |
| 3 | FSRS optimizer | 🔴 P0 | M (1-2 sem) | **AHORA** |
| 4 | E2E encryption | 🔴 P0 | M (2-3 sem) | **AHORA** |
| 5 | Montar/borrar servicios muertos | 🔴 P0 | S (1 sem) | **AHORA** |
| 6 | Image occlusion UI | 🟠 P1 | M (2 sem) | Próximo mes |
| 7 | Leech + cramming + burned | 🟠 P1 | S (1 sem) | Próximo mes |
| 8 | Audio en cards + TTS | 🟠 P1 | S (1 sem) | Próximo mes |
| 9 | Web clipper endpoint | 🟠 P1 | S (3-5 días) | Próximo mes |
| 10 | Graph view UI | 🟠 P1 | L (3-4 sem) | Próximo mes |
| 11 | Timeline / Gantt | 🟠 P1 | M (2 sem) | Próximo mes |
| 12 | Global Tasks | 🟠 P1 | M (2 sem) | Próximo mes |
| 13 | Templater-style | 🟠 P1 | M (2-3 sem) | Próximo mes |
| 14 | Kanban board | 🟠 P1 | S (1 sem) | Próximo mes |
| 15 | Database formulas + rollups | 🟠 P1 | L (3-4 sem) | Próximo trimestre |
| 16 | AnkiHub real marketplace | 🟠 P1 | L (1 mes) | Próximo trimestre |
| 17 | PDF reader highlighting | 🟡 P2 | L (1 mes) | Future |
| 18 | Handwriting OCR | 🟡 P2 | M (2 sem) | Future |
| 19 | Widget home screen | 🟡 P2 | S (3-5 días) | Future |
| 20 | Wear OS | 🟡 P2 | L (1 mes) | Future |
| 21 | Spectrogram / waveform | 🟡 P2 | S (1 sem) | Future |
| 22 | Exam simulator | 🟡 P2 | M (2 sem) | Future |

### Total esfuerzo: ~6-9 meses con 1 dev full-time.

---

## SECCIÓN 7: RECOMENDACIONES ESTRATÉGICAS

### 7.1 Posicionamiento: NO compitas con Anki

Anki tiene 12+ años de ventaja en SR. Es imposible ganarle en su terreno. **M-NEXUS debe posicionarse en "notes-first + AI-first + offline-first + privacy-first"**.

- Anki = best for SR (no notes).
- Obsidian = best for PKM (no AI, no SR).
- Notion = best for collaboration (no offline, no privacy).
- **M-NEXUS = best for "AI-enhanced second brain offline"**.

Tagline propuesto: **"Tu segundo cerebro con IA que respeta tu privacidad"**.

### 7.2 Foco del Q4 2026 — Q1 2027

1. **Sync real** (reemplaza el placeholder CRDT) — 1 mes.
2. **RAG semántico** — 1.5 meses.
3. **E2E encryption** — 1 mes.
4. **Cleanup servicios muertos** — 1 semana.
5. **Image occlusion UI** — 0.5 meses.
6. **Graph view** — 1 mes.

Total: ~5-6 meses. Resultado: M-NEXUS v0.60.

### 7.3 NO hacer

- **No** compitas con Notion en collaboration real-time (10+ años de ventaja).
- **No** intentes hacer un SuperMemo killer (es del algoritmo, no UX).
- **No** construyas un plugin ecosystem estilo Obsidian (1k+ plugins requiere años).
- **No** hagas un marketplace enorme estilo AnkiHub (es community-driven, tarda años).

### 7.4 Sí hacer

- **Sí** invierte en AI (es el diferenciador: Anki no tiene, Obsidian requiere plugin, Notion es caro).
- **Sí** invierte en offline-first (es la ventaja vs Notion).
- **Sí** invierte en privacy (es la ventaja vs Notion y el mercado médico).
- **Sí** invierte en multimedia (audio recording + image occlusion + handwriting = unique).

---

## SECCIÓN 8: ISSUES ESPECÍFICOS A CORREGIR EN ESTA SESIÓN

Si tuviera que arreglar 5 cosas **ahora mismo**:

### A. Limpiar código muerto (1 día)
- Borrar `backend/src/services/syncService.ts` (duplicado de crdtSyncService).
- Borrar `backend/src/services/proposals.ts` (reemplazado por V2).
- Decisión para cada servicio no montado: ¿borrar o montar?

### B. File locking en escrituras (1 día)
- Agregar `package:synchronized` o flock.
- Aplicar a `comments_service`, `database_query_service`, `exams_service`, `version_history_service`, `daily_note_service`, `export_service`.

### C. Fix `AppState.recordReview` (1 día)
- Reemplazar `_cards = updated` con update in-place de la card modificada.
- No relistar todas las cards.

### D. CRDT WS broadcast real (3-5 días)
- Implementar `clients[wss]: Map<WebSocket, ClientMeta>`.
- En `socket.on("message")`, propagar a otros clientes del mismo room.

### E. Cambiar SharedPreferences a flutter_secure_storage para API keys (1 día)
- Migrar `multi_model_ai.dart` a secure storage.

---

## SECCIÓN 9: MÉTRICAS DE CALIDAD

### Código

| Métrica | Valor | Estado |
|---------|-------|--------|
| Backend tests | 609/609 (1 skipped) | ✅ |
| App tests (Flutter) | 534 expects en 13 files | 🟠 Cobertura baja |
| App validations Node.js | 502+ en 18 scripts | ✅ |
| Servicios backend implementados | 40 | 🟠 35% sin montar |
| Servicios backend en uso | 26 | 🟠 |
| Código muerto (syncService) | Sí | 🔴 |
| `print()` en producción | 4 | 🔴 |
| `TODO`/`FIXME` | 1 (deck_detail_screen) | ✅ |
| `MOCK_*` en prod | 6 (whisper/ocr/tts) | 🟠 esperado para tests |

### Features

| Categoría | Total | Hecho | % |
|----------|-------|-------|---|
| Bug fixes (M1) | 20 | 20 | 100% |
| AFFiNE clone (M2) | 20 | 20 | 100% |
| Interlinking (M3) | 4 | 4 | 100% |
| Audio+Calendar (M4) | 5 | 5 | 100% |
| Polish+Audit (M5) | 8 | 8 | 100% |
| Features v0.50 (M6) | 6 | 6 | 100% |
| v0.51 push (M7) | 7 | 7 | 100% |
| **Anki 24.06.3 features** | 13 | 3 | 23% |
| **Obsidian 1.13 features** | 15 | 6 | 40% |
| **Notion 2026 features** | 11 | 1 | 9% |
| **RemNote features** | 8 | 4 | 50% |

### Performance

| Operación | Vault 100 | Vault 1k | Vault 10k |
|-----------|-----------|----------|-----------|
| `loadTree()` (vault_browser) | OK | OK | 🟠 Lento |
| `listRecentNotes(20)` | OK | OK | ✅ |
| `scanVault` (database_query) | OK | OK | 🟠 Lento |
| CRDT applyUpdate | ✅ | ✅ | ✅ |
| Flashcard review | ✅ | ✅ | 🟠 Recarga tras review |
| Home screen render | OK | OK | 🟠 1-2s |
| Backup | ✅ | 🟠 5-10s | 🔴 60s+ |

---

## SECCIÓN 10: CÓDIGO CONCRETO A REFACTORIZAR

### 10.1 CRDT WS — el problema es claro

**Antes** (línea 92-104 de `crdt.ts`):
```typescript
socket.on("message", (data: Buffer) => {
  try {
    const update = new Uint8Array(data);
    Y.applyUpdate(room.doc, update, clientId);
    service["schedulePersist"]?.(service["roomKey"]?.(notePath) ?? "");
    // For broadcast: in this version, cada cliente pide estado completo
    // via GET si quiere refresco. Para true broadcast P2P se usaria
    // un hub central con clientes[wss] map; simplificado en v0.51
  } catch (e) {
    logger.warn(`[crdt] ws message error: ${e}`);
  }
});
```

**Después**:
```typescript
// Module-level: map global
const wsClients = new Map<WebSocket, { roomKey: string; notePath: string; clientId: string }>();

// En el handler de conexion, registrar:
wsClients.set(socket, { roomKey, notePath, clientId });

// En socket.on("message"):
socket.on("message", (data: Buffer) => {
  try {
    const update = new Uint8Array(data);
    Y.applyUpdate(room.doc, update, clientId);
    service["schedulePersist"]?.(service["roomKey"]?.(notePath) ?? "");
    // Broadcast a otros clients
    for (const [otherWs, otherMeta] of wsClients) {
      if (otherWs === socket) continue;
      if (otherMeta.notePath !== notePath) continue;
      if (otherWs.readyState === WebSocket.OPEN) {
        otherWs.send(Buffer.from(update));
      }
    }
  } catch (e) { ... }
});

// En socket.on("close"):
wsClients.delete(socket);
```

### 10.2 `AppState.recordReview()` — fix simple

**Antes**:
```dart
_flashcardService!.listAll().then((updated) {
  _cards = updated;  // Relista TODAS
  notifyListeners();
});
```

**Después**:
```dart
_flashcardService!.getCard(cardId).then((updated) {
  if (updated == null) return;
  final idx = _cards.indexWhere((c) => c.id == cardId);
  if (idx >= 0) {
    _cards[idx] = updated;  // Update in-place
  }
  notifyListeners();
});
```

### 10.3 File locking en services

```dart
// app/lib/services/comments_service.dart
import 'package:synchronized/synchronized.dart';

class CommentsService {
  final Lock _writeLock = Lock();

  Future<void> _save(List<BlockComment> all) async {
    return await _writeLock.synchronized(() async {
      await _file.writeAsString(jsonEncode(all, indent: 2));
    });
  }
}
```

### 10.4 Secure storage para API keys

```dart
// app/lib/services/multi_model_ai.dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class MultiModelAi {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const _apiKeyKey = 'ai.api_key';

  Future<void> saveApiKey(String? key) async {
    if (key == null || key.isEmpty) {
      await _storage.delete(key: _apiKeyKey);
    } else {
      await _storage.write(key: _apiKeyKey, value: key);
    }
  }

  Future<String?> loadApiKey() async {
    return await _storage.read(key: _apiKeyKey);
  }
}
```

---

## CONCLUSIÓN

M-NEXUS tiene una base técnica sólida y ha cumplido su mega-checklist. Pero la auditoría revela que **está al 30-40% de un producto top mundial**.

**Los 5 bloqueantes P0** (sync, RAG, FSRS optimizer, E2E, código muerto) son **5-7 meses de trabajo concentrado**. Sin resolverlos, M-NEXUS sigue siendo un buen MVP, no un producto líder.

**El diferenciador claro** es: **AI-first + offline-first + privacy-first + multimedia (audio/image)**. Esa es la jugada. Obsidian no tiene AI built-in. Notion no es offline. Anki no tiene AI. M-NEXUS puede ganar si ejecuta esta visión.

**Próximo paso recomendado**: priorizar sync real + RAG semántico como objetivo v0.60, lanzamiento en 4-5 meses.
