# SCREENSHOTS.md — capturas por ruta

> v2.38.0

## El barrido

```bash
node scripts/capture_routes.cjs              # teléfono 414×896
node scripts/capture_routes.cjs --desktop    # escritorio 1280×860
```

Lee `ROUTES` directamente de `frontend/src/main.js`, registra un
dispositivo real para que las rutas autenticadas rendericen contenido en
lugar de rebotar al login, y visita cada una.

```
22 routes from main.js

  overview     ok     body=  3805
  calendar     ok     body=  2300
  ...
  progress     ok     body= 58362

22/22 rutas limpias
```

Sale con código 1 si algo falla, así que sirve en CI.

## Qué cuenta como defecto

| | |
|---|---|
| **404** | El cliente pidió un endpoint que no existe. Ruta no cableada, o cableada bajo otro path o prefijo. |
| **5xx** | El servidor explotó sirviendo una petición normal. |
| **error de red** | Conexión rechazada → cliente y servidor no coinciden sobre el puerto. |
| cuerpo idéntico a otra ruta | Casi siempre la pantalla de fallback. |

## Qué **no** cuenta

| | |
|---|---|
| **401 / 403** | Es una decisión de auth, no un defecto de cableado. Un no-admin abriendo Ajustes recibe 403 de `/admin/ai`, la pantalla lo maneja y la página se renderiza. Marcarlo escondería los 404 de verdad. |
| `info` / `debug` | La app escribe uno por arranque y uno por mensaje del service worker, por diseño. |
| `verbose:` | Sugerencias del inspector de DOM de Chrome. Una de ellas —"añade autocomplete"— es una decisión deliberada: `screens/login.js` pone `autocomplete="off"` para que los gestores de contraseñas no pre-rellenen una cuenta a medio recordar. |

## Lo que encontró

Cuatro cosas rotas que ninguna otra comprobación había visto. Están
documentadas en detalle en [v2.38.md](v2.38.md) §4.

## Capturas de flujo, no de pantalla

Un barrido de rutas no comprueba que hacer clic funcione. Estos scripts
ejercitan un flujo entero y fallan si la persistencia se rompe:

```bash
node scripts/capture_v237.cjs   # calificar una card → releer el heatmap
node scripts/capture_v238.cjs   # capturar texto libre → 4 tareas clasificadas
node scripts/capture_v236.cjs   # PWA: Service Worker activo + arranque offline
```

`capture_v237.cjs` verifica la persistencia contra el `reviewHistory` de
las cards concretas, no contra el contador del heatmap — ese contador es
global (todas las cards del servidor) y ya venía en 12 antes de empezar.

## Fichero de informe

`screenshots/routes/_report.json`:

```json
{
  "capturedAt": "2026-09-29T12:41:03.000Z",
  "viewport": "phone 414x896",
  "routes": [
    { "route": "overview", "status": "ok", "bodyLen": 3805,
      "redirected": null, "errors": [] }
  ]
}
```

Machine-readable, para comparar dos runs o diff en un PR.

## Limitación honesta

El barrido detecta rutas que **no renderizan o que piden endpoints
inexistentes**. No detecta una ruta que renderiza pero whose botones no
hacen nada — eso necesita los scripts de flujo, y solo hay tres.

## v2.38.1

| Captura | Qué demuestra |
|---------|---------------|
| `screenshots/mood-tracker.png` | `#/mood` con datos reales: 7 días de racha, media 3.6, 23 % de cobertura, gráfico con los 7 puntos y la leyenda legible (el FAB ya no la tapa). |
| `screenshots/generate-output.png` | `#/generate` genera desde una carpeta real y titula con el nombre de la carpeta, no con un mensaje de error. Sin modelo configurado dice `[mock AI] … Configure a real provider`, que es la verdad. |
| `screenshots/drag-occlusion.png` | Dos fichas arrastradas sobre la figura con eventos táctiles reales vía CDP. Las máscaras quedan `is-filled is-correct` y las fichas usadas se atenúan. Los tres botones caben a 414 px. |
| `screenshots/routes/*.png` | 24/24 rutas limpias, incluidas las dos nuevas. Reporte en `screenshots/routes/_report.json`. |

Cómo reproducir:

```bash
node scripts/capture_v238_drag.cjs   # arrastre sobre la imagen
node scripts/capture_routes.cjs      # barrido de las 24 rutas
```

El script de arrastre no se limita a hacer una captura: después de arrastrar
comprueba en el DOM que las máscaras quedaron marcadas, y avisa si no.
