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
