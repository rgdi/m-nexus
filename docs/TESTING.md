# TESTING.md — cómo se ejecutan y qué está excluido

> v2.38.0

## Suite completa

```bash
cd backend  && npx vitest run
cd frontend && npx vitest run
```

Estado actual, un solo run:

| Suite | Ficheros | Tests |
|---|---|---|
| Backend | 97 | 1338 (1 skipped) |
| Frontend | 50 | 673 |
| **Total** | **147** | **2011** |

TypeScript:

```bash
cd backend && npx tsc --noEmit    # 0 errores
```

## Qué está excluido del run por defecto, y por qué

```ts
exclude: [
  "tests/legacy/**",        // APIs obsoletas, deuda técnica asumida
  "**/integration.test.ts",
  "**/*E2E.test.ts",        // ← v2.38.0
  "**/*V224.test.ts",        // ← v2.38.0
]
```

Los dos últimos se añadieron en v2.38.0. `syncE2E.test.ts` y
`flashcardsV224.test.ts` **necesitan un servidor vivo en `:4100`**, y como
no se registraban en el patrón `integration.test.ts` fallaban en cada run
completo con `ECONNREFUSED` — haciendo que "ejecuta todo" pareciera roto
por una razón que no tenía que ver con el código bajo prueba.

Son tests de integración con nombre de test unitario. No se debilitaron:
se ejecutan aparte.

```bash
npm run dev &                       # servidor en :4100
cd backend && npm run test:e2e
```

## Por qué estos tests existen

Un test que solo comprueba que un valor es positivo no sirve de nada:

```ts
// v2.30.0, el test que no detectó nada
expect(r.newStability).toBeGreaterThan(0);
```

`Math.max(0.01, newS)` dentro del código convertía **toda** estabilidad
negativa en `0.01`, que es mayor que cero. El bug vivió siete releases
porque el test que debía cubrirlo solo miraba que el número fuera
positivo.

La regla que se aplicó desde entonces: **un assert sobre una magnitud
tiene que compararla con lo que el modelo dice que debería ser**, no con
cero.

Concretamente, `tests/v237.test.ts` cubre los cuatro bugs de FSRS con
comparaciones contra la fórmula de referencia, y `tests/v238rag.test.ts`
comprueba que la fusión RRF da `1/61 + 1/62` exactamente.

## Capturas

```bash
node scripts/capture_routes.cjs              # todas las rutas, teléfono
node scripts/capture_routes.cjs --desktop    # 1280×860
node scripts/capture_v237.cjs                # estudio → heatmap, end-to-end
node scripts/capture_v238.cjs                # captura rápida
```

Salida:

```
screenshots/routes/<route>.png    una por ruta
screenshots/routes/_report.json   estado + errores de consola por ruta
```

`capture_routes.cjs` lee `ROUTES` de `main.js`, así que la lista no puede
desincronizarse. Sale con código 1 si alguna ruta falla, lo que lo hace
usable en CI.

Un detalle que costó una iteración: una ruta que renderiza un cuerpo
**idéntico** a otra casi siempre es la pantalla de fallback, no esa ruta.
El script lo detecta y lo marca.

## Orden habitual antes de un release

```bash
# 1. regenerar el precache (obligatorio tras añadir módulos)
python3 scripts/gen-sw-precache.py

# 2. suites
cd backend  && npx tsc --noEmit && npx vitest run
cd frontend && npx vitest run

# 3. barrido de rutas
node scripts/capture_routes.cjs

# 4. sync
python3 scripts/gen-sw-precache.py && git add -A
```

El paso 1 va primero a propósito: hay un test que falla si
`sw-precache.js` está desactualizado respecto a `frontend/src`, y ver ese
fallo en la suite es más barato que descubrirlo en un dispositivo sin
conexión.

---

## v2.38.1 — ficheros de test nuevos

| Fichero | Tests | Qué fija |
|---------|-------|----------|
| `backend/tests/v238store.test.ts` | 23 | Aislamiento del almacén, sanitización del sujeto (nada de traversal), migración del fichero global exactamente una vez, y que la caché es por sujeto. |
| `backend/tests/v238storehttp.test.ts` | 10 | Lo mismo pero sobre el stack HTTP real, con dos tokens: lista, lectura por id, edición, borrado, tarjetas, tareas, carpetas y seis peticiones intercaladas en vuelo a la vez. |
| `backend/tests/v238res.test.ts` | 28 | Generador de recursos, incluido el caso en que un resumen real se titulaba con un mensaje de "no encontré nada". |
| `frontend/tests/v238crdt.test.js` | 19 | CRDT: inserciones, borrados, fusión, tombstones y reconciliación. |
| `frontend/tests/v238dragoc.test.js` | 19 | Arrastre sobre imagen, **incluido un montaje real contra jsdom** y un guard que comprueba que toda variable de módulo asignada está declarada. |
| `frontend/tests/v238feat.test.js` | 20 | `#/generate`, `#/mood` y la voz: sin métricas inventadas, endpoints reales, aviso de nube, el caret se guarda antes del resultado. |

### Nota sobre los tests y el almacén

A partir de v2.38.1 los datos se particionan por usuario, así que un test
que siembra `data/notes.json` a mano siembra algo que ya nadie lee. Las
fixtures van por `writeCollection()`.

Y al revés: un test no debe poder **migrar** el `data/` real del repositorio.
Por eso la adopción del fichero global está desactivada bajo vitest y hay
que pedirla explícitamente con `allowAdoption(true)`.

### Nota sobre identidad

El sujeto del JWT es el dispositivo registrado. Un helper de test que
registraba un dispositivo nuevo en cada llamada convertía cada petición en
un usuario distinto, así que una nota creada en una llamada no se veía en la
siguiente. `tests/v2331.test.ts` ahora cachea un token por fichero, que es
lo que parece una sesión real.