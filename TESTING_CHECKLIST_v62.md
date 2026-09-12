# M-NEXUS v0.62.7 — Testing Checklist

Dispositivo: Xiaomi Redmi Note A063 (Android 15, SDK 35)
Backend: nucserver:4100 (minimal stable, ~80s response time para LLM en CPU)
Ollama: 127.0.0.1:11434 con llama3.2:3b + nomic-embed-text
APK: v0.62.7 debug (instalado, sin rebuild posible por catch-22 Kotlin/Gradle)

## Estado actual del testing visual

### ✅ Pantallas funcionales

- **Home**: hero card, stats grid, heatmap 90d, bottom nav. Datos reales (15 flashcards, racha 3 días).
- **Vault**: tree view con filtrado de carpetas vacías (mi fix funciona). 7 carpetas visibles.
- **Tarjetas**: lista 15 cards con prioridad + Vencida, FSRS metrics, play ▶ no responde pero tap en card sí.
- **Review flashcards**: flip animation, FSRS métricas (S=0/D=3/R=100/Reps=0), 4 botones Again/Hard/Good/Easy con intervalos.
- **Repaso completado**: pantalla post-review con stats y botón Volver.
- **Ajustes**: secciones General/Apariencia/Avanzado con ~14 items.
- **Tutor IA**: backend POST a `/api/v1/ai/tutor` funciona; Ollama llama3.2:3b responde con RAG.

### ❌ Bugs visuales (no arreglables sin rebuild APK)

1. **Banner de actualización superpone status bar** — texto ilegible. Bounds reales:
   - Banner bounds: y=28-88
   - Status bar: y=0-136
   - Solapan completamente
2. **Banner aparece tras force-stop** — `_dismissedForThisVersion` no persiste
3. **Banner aparece en debug** — `0.49.2 > 0.0.0-dev` por versionName debug
4. **Stat cards overflow 0.725 PIXELS** — las 4 cards del home
5. **Stats no se recalculan tras review** — "15 tarjetas para repasar hoy" sigue diciendo 15 aunque ya repasaste 1
6. **3 flashcards con título placeholder** — "¿Qué es created?", "¿Qué es date?" (datos corruptos en vault)
7. **Botón play ▶ de Tarjetas no responde** — solo tap en card individual

### 🐛 Bugs en repo (fixed localmente pero APK no tiene el fix)

- **childAspectRatio: 1.65 → 1.45** en home_screen.dart (commit pending)
- **padding MxSpacing.lg (16) → 14** en glass_widgets.dart StatCard (commit pending)
- **SharedPreferences key mismatch**: `mnexus.backend_url` (guion bajo) vs `flutter.mnexus.backend.url` (punto) — el código usa guion bajo, XML escribe punto. Fix manual en device con `sed`.

### ⚙️ Configuración

- Backend `OLLAMA_BASE_URL=http://127.0.0.1:11434` (Ollama solo escucha localhost)
- `JWT_SECRET` generado (`/tmp/jwt_secret2`)
- `flutter.mnexus.backend_url` corregido en SharedPreferences del device

### ✅ Pendiente de implementación

- Re-habilitar más rutas backend sin SIGSEGV (ocr, audio, flashcards sync, search, llm, auth)
- NoteView rediseño (ocultar metadata/backlinks por defecto, menú 3 puntos, flashcards incrustadas)
- Flashcard review con IA assistant inline
- Mover IA features de Settings a context-aware

### 🛠️ Build APK catch-22

- Flutter 3.47.3 requiere AGP 8.11.1 + Gradle 8.14 + Kotlin 2.2.20
- Kotlin 2.2.20 más estricto rechaza `" -> "` en strings dentro de mapOf (4 errores en MainActivity.kt)
- AGP 8.11.1 + Gradle 8.14 requieren plugins en SDK 35-36, pero proyecto compila SDK 34 (ahora 36)
- `compileSdk=36` aplicado pero plugins (audioplayers, flutter_tts, pdfx) aún quieren más
- **Solución más simple**: downgrade Flutter a 3.32 que soporta Kotlin 1.9 + AGP 8.3 + Gradle 8.4 con APIs nuevas (withValues, CardThemeData, etc)

### 🎯 Plan inmediato

1. ✅ Hacer commit de los 2 fixes en repo (overflow + padding)
2. ✅ Documentar bugs visuales (este checklist)
3. ⏸️ Probar build APK con Flutter 3.32 si el usuario da permiso para tocar SDK
4. ⏸️ Añadir más rutas backend sin SIGSEGV (ai routes, flashcards sync, search)
5. ⏸️ Re-habilitar RAG vector store con nomic-embed-text + LanceDB en backend

### Próxima sesión

- Rebuild APK con Flutter 3.32 (1 hora)
- Re-install y re-testing completo de las 5 fases del TODO

## Round 2 testing visual — additional findings

### ✅ Pantallas adicionales probadas
- **NoteView (Circulación)**: title limpio, header chip fecha + tag #anatomia, body markdown con cloze deletions `{{c1::texto}}`, wikilink "Volver a corazon", bottom action bar: **Editar / Flashcards / Preguntas / Tutor** (IA inline ✅)
- **Editor de notas (existente)**: con contenido previo, focus funciona y permite escribir
- **Asignaturas**: CRUD básico, 3 asignaturas (Anatomía inactiva bug, Fisiología y Bioquímica activas)
- **Generar flashcards**: ✅ funciona, genera 38 cards
- **Pendientes de revisión**: ❌ "Sin flashcards pendientes" aunque se acaban de generar 38

### ❌ Bugs adicionales encontrados (Round 2)
8. **Editor de notas NUEVO sin focus** — al crear nueva nota, ni título ni body responden a tap simple (requieren longPress). Bug crítico bloqueante para crear notas.
9. **Editor de notas NUEVO con longPress** — abre selector de imágenes de Google Fotos en lugar de hacer focus el campo. Confuso.
10. **Wikilinks no navegan** — "[[Volver a corazon]]" en Circulación.md no abre nota Corazón. Tap no responde.
11. **Generar flashcards → guardadas en Approved** — `service.create()` default `approved=true` ignorado por `persistDrafts()`, por eso "Pendientes de revisión" muestra 0. **Fix en commit `85d42aa`** (necesita rebuild).
12. **Flashcards placeholder "***" como título** — todas las recientes (5/5) muestran "***" en lugar del título real. Bug visual grave de reciente/título.
13. **Anatomía inactiva en Asignaturas** — debería auto-detectarse de notas existentes; requiere activación manual.
14. **Duplicación case-sensitive en Vault** — "notes" y "Notes" / "anatomia" y "Anatomía" coexisten. Vault service no normaliza case.
15. **Stats Home no recalculan tras review** — "15 tarjetas para repasar hoy" sigue diciendo 15 aunque ya repasaste 1.
16. **App state restoration buggy** — al reabrir app, salta al último screen en lugar del home. Causa confusión en navigation.

### 🎯 Estado final
- **APK instalado**: v0.62.7 con 15+ bugs visuales identificados
- **Repo (commit 85d42aa)**: 3 fixes aplicados (overflow, padding, persistDrafts)
- **Pendiente rebuild** para verificar fixes (catch-22 Kotlin/Gradle)
- **Backend**: vivo en :4100 con Ollama, llama3.2:3b responde en ~80s primera vez, RAG funcional

## AUDITORÍA EXHAUSTIVA v0.62.7 (Round 3)

Auditoría visual sistemática de TODAS las pantallas. Severidad: CRÍTICO / MEDIO / MENOR.

### 🏠 HOME (round 3 - portrait mode)

**CRÍTICOS:**
- Banner actualización superpone status bar (y=28-88 vs status bar 0-136)
- 4 stat cards overflow BOTTOM 0.725 PIXELS (banner debug amarillo-negro rayado)
- Stats labels cortados: "Racha" → "D..." (no cabe en el card)
- Bottom nav tapa última action item de "Command palette"

**MEDIOS:**
- Hero card padding inferior insuficiente
- Stats "Para repasar" cuenta Approved, no incluye Drafts

**MENORES:**
- Heatmap actividad poco contraste (3/90 días con color)
- Banner debug rayado intrusivo

### 📚 VAULT

**CRÍTICOS:**
- ExpansionTile no expande al tap (Anatomía, Inbox no responden, Bioquímica sí)
- Duplicación case-sensitive: notes/Notes, anatomia/Anatomía, readme/README coexisten

**MEDIOS:**
- Sin indicador visual claro "expandida vs colapsada"
- Sin contador de archivos en carpetas

**MENORES:**
- Search bar muy pegada al status bar

### 🃏 TARJETAS

**CRÍTICOS:**
- Botón play (▶) en top-right no responde
- Flashcards con título "***" (asteriscos literales) en 5/5 recientes
- Conteo incluye Drafts y Approved mezclados (no hay separación)

**MENORES:**
- Sin filtrado por prioridad/deck
- Sin búsqueda visual de cards

### 🔄 REVIEW FLASHCARDS

**CRÍTICOS:**
- Respuesta con contraste blanco/verde-claro = texto invisible
- Asimetría pregunta/respuesta (respuesta mucho más pequeña)
- Espaciado enorme entre respuesta y métricas FSRS

**MEDIOS:**
- Sin animación al calificar (Again/Hard/Good/Easy)
- Sin haptic feedback al calificar

**MENORES:**
- Métricas FSRS sin label "S/D/R/Reps" (solo el letter)

### 📝 NOTEVIEW

**CRÍTICOS:**
- Title duplicado en 3 lugares (AppBar, header H1, body markdown)
- Cloze deletions {{c1::texto}} no se renderizan, aparecen literales
- Wikilinks [[corazon]] no navegan al tap

**MEDIOS:**
- Sin metadata (word count, lectura estimada, backlinks, flashcards asociadas)
- Sin preview markdown renderizado

**MENORES:**
- Title H1 demasiado bold (debería ser sutil)
- Padding bottom insuficiente

### 🤖 TUTOR IA (inline en nota)

**CRÍTICOS:**
- Sin contexto de la nota abierta al entrar (debería mostrar la nota como contexto)
- Sin ejemplos/sugerencias de preguntas (chips de "Resumen de Y", "Quiz sobre Z")
- Input placeholder "Ask about your notes..." hardcoded en inglés
- La app prioriza LocalTutorService sobre backend (ignora Ollama si vaultPath != null)

**MEDIOS:**
- Sin historial de conversaciones previas
- Sin indicador del backend status (online/offline/modelo)

**MENORES:**
- Botón papelera sin tooltip
- Padding top del header del chat

### 📝 EDITOR DE NOTAS

**CRÍTICOS:**
- Editor NUEVO sin focus al tap simple (requiere longPress)
- LongPress abre Google Fotos (selector de imagen) en lugar de focus

**MEDIOS:**
- Toolbar iconos sin tooltip (B/I/code/T/lista/quote/link)
- Cloze deletions visibles literales (no se ocultan en editor)
- Sin syntax highlighting de markdown

**MENORES:**
- Sin preview toggle
- Sin word count / reading time
- Sin indicador de autosave

### 🧠 PREGUNTAS PARA ESTUDIAR

**CRÍTICOS:**
- Las 5 preguntas son GENÉRICAS, no específicas de la nota
- Botón "Regenerar" no seleccionado (regenera todas? cuáles?)
- Falta "save as flashcard" en cada pregunta

**MEDIOS:**
- Números en badges (7/57/96) sin label de significado
- Bottom sheet tapa el body markdown

**MENORES:**
- Sin copy/share/report por pregunta

### ✨ GENERAR FLASHCARDS

**MEDIOS:**
- Pantalla casi vacía, falta explicación del proceso
- Sin preview de notas a procesar
- Sin estimado de tiempo/cantidad

**MENORES:**
- Sin histórico de generaciones previas

### 📚 ASIGNATURAS

**CRÍTICOS:**
- Anatomía tachada con strikethrough (UX confuso)
- Anatomía no auto-detecta notas existentes (debería activarse al ver notas en /Anatomía/)

**MEDIOS:**
- Iconografía sin diferenciación clara activa/inactiva (solo color)

**MENORES:**
- Sin búsqueda/filtro de asignaturas
- Sin orden customizable

### ⚙️ AJUSTES

**CRÍTICOS:**
- Banner de actualización DUPLICADO encima (2 banners superpuestos)
- Items inferiores cortados por bottom nav (Changelog, "Versiones")
- "Tutor IA" muestra "(offline)" aunque backend está conectado (status nunca se actualiza)
- Backend URL debe escribirse a mano (no auto-descubre en LAN)

**MEDIOS:**
- Padding bottom insuficiente
- Sin agrupamiento visual claro entre secciones

**MENORES:**
- Sin búsqueda de settings
- Sin reset a defaults

### 🏠 BOTTOM NAV

**CRÍTICOS:**
- Reabre app en último screen (no en home) - state restoration bug
- Tap en bottom nav en landscape se invierte (eje rotado)

**MENORES:**
- Sin badge counter para Tarjetas (15 → 50)

### 🌐 GLOBAL / NAVIGATION

**CRÍTICOS:**
- Botón "Atrás" desde Tutor inline no vuelve a NoteView (cierra sesión)
- Al cerrar app y reabrir, salta al último screen (rompe UX)

**MEDIOS:**
- Sin deep linking (vault://note/glucosa no funciona)
- Sin state preservation al rotar pantalla

**MENORES:**
- Sin compartir nota (share intent)
- Sin exportar a PDF/markdown

---

## 🚧 FASE 1 fixes — pending rebuild

Bugs identificados durante el audit round 3 (60+ bugs). Algunos se arreglaron vía SharedPreferences / scripts / git config sin necesidad de rebuild APK. El resto requiere rebuild de v0.62.8.

### ✅ Aplicados sin rebuild (FASE 1 commit)

| Bug | Fix | Archivo / mecanismo |
|---|---|---|
| Banner de actualización persistente | Eliminado `flutter.mnexus.lastUpdateCheck(.data)` | `shared_prefs/FlutterSharedPreferences.xml` (device) via `scripts/setup_device.sh` |
| Backend URL key inconsistente (dots vs underscores) | Normalizado a `flutter.mnexus.backend_url` (underscore canonical) | mismo XML, mismo script |
| Health-check ad-hoc del sistema | Nuevo script | `scripts/health_check.sh` |
| Setup reproducible del device | Nuevo script | `scripts/setup_device.sh` |

### 🔧 Pendientes — requieren rebuild APK (v0.62.8)

| Bug | Archivo a modificar | Bloque |
|---|---|---|
| Banner superpone status bar | `lib/theme/theme.dart`, `lib/screens/settings/update_dialog.dart` | Update dialog / safe area |
| Stat cards overflow | `lib/screens/home/home_screen.dart` | ✅ **YA FIXED en repo** (commit `ea13e0c`) |
| Editor focus bug | `lib/screens/notes/note_editor.dart` | Focus / autofocus / keyboard |
| Response contrast (texto claro sobre fondo claro en flashcards) | `lib/screens/flashcards/flashcard_review.dart` | Theme contrast |
| Title triplicado en NoteView | `lib/screens/notes/note_view.dart` | ✅ **YA FIXED en FASE 2** (commit `b3e2d57` — rediseño NoteView) |
| Cloze literal `{{c1::...}}` no se renderiza | `lib/screens/notes/note_view.dart` | ✅ **YA FIXED en FASE 2** (commit `b3e2d57` — cloze renderer) |
| Wikilinks no navegables | `lib/screens/notes/note_view.dart` | ✅ **YA FIXED en FASE 2** (commit `b3e2d57` — wikilinks navigable) |
| Preguntas genéricas ("¿Qué es X?") sin contexto | `lib/screens/questions/questions_screen.dart` | FASE 3 — prompt engineering |
| Settings redundantes / duplicados | `lib/screens/settings/settings_screen.dart` | FASE 4 — refactor UI |
| Local tutor ignora backend (force offline) | `lib/screens/chat/chat_screen.dart` | FASE 3 — provider switch |
| Asignaturas strikethrough no deseado | `lib/screens/subjects/subjects_screen.dart` | Visual / list tile |
| State restoration (reabre en último screen) | `lib/main.dart` | App lifecycle / restoration |

### 📋 Próximos pasos

1. **Esperar a que termine `sa-0-7ca80006`** (rebuild APK v0.62.8 con fixes FASE 2/3/4 ya commiteados)
2. **Mientras tanto**: `bash scripts/setup_device.sh` en el device tras cada instalación limpia
3. **Validación post-install**: `bash scripts/health_check.sh` debe devolver todo verde
4. **Smoke test manual** (lista priorizada en sección "Manual smoke test v0.62.8" arriba)
5. **Si quedan bugs críticos** post-rebuild → FASE 5 (otro ciclo de fix + rebuild)
