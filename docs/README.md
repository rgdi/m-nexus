# M-NEXUS — Documentación

> Última versión documentada: **v2.38.1** · 2026-09-29
> Este es el índice. Si algo aquí no coincide con el código, el código
> gana y esto es un bug: abrirlo.

---

## Empieza por aquí

| Si quieres… | Lee |
|---|---|
| Instalarlo en tu máquina | [README.md](../README.md) — un comando, cuatro modos |
| Entender cómo está montado | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Saber qué hace cada cosa | [FEATURES.md](../FEATURES.md) |
| Saber qué cambió en cada versión | [CHANGELOG.md](../CHANGELOG.md) |
| Montarlo en varios servidores | [SCALING.md](SCALING.md) |
| Entender los riesgos | [SECURITY.md](SECURITY.md) + [AUDIT_REPORT.md](../AUDIT_REPORT.md) |

---

## Documentación de operador

| Documento | Cubre |
|---|---|
| [SCALING.md](SCALING.md) | Topologías multi-servidor, descubrimiento de pares, elección de líder, sticky routes, manifiestos k8s. **El primero si vas a más de un nodo.** |
| [CLOUDFLARE_TUNNEL.md](CLOUDFLARE_TUNNEL.md) | Exponer la instancia sin abrir puertos. |
| [BACKUP.md](BACKUP.md) | Copias automáticas, restauración, backups cifrados. |
| [SECURITY.md](SECURITY.md) | Endurecimiento, fuerza del secreto JWT, rate limits, rutas públicas. |
| [AUTH.md](AUTH.md) | JWT, dispositivos, refresh tokens, bypass LAN, audit log. |
| [LOGGING.md](LOGGING.md) | Logs estructurados, niveles, redacción. |
| [ERROR_CODES.md](ERROR_CODES.md) | Catálogo de códigos `EC-XXX-NNN`. |
| [AI_PROVIDERS.md](AI_PROVIDERS.md) | Ollama, OpenRouter, OpenAI, mock. |
| [API.md](API.md) | Todos los endpoints REST + tipos de mensaje WebSocket. |

---

## Documentación de desarrollador

| Documento | Cubre |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Diagrama, separación frontend/backend/almacenamiento. |
| [TESTING.md](TESTING.md) | Cómo se ejecutan las pruebas, qué está excluido y por qué. |
| [SCREENSHOTS.md](SCREENSHOTS.md) | Cómo se regenera el barrido de capturas por ruta. |

---

## Notas de release

Cada una documenta lo que se rompió antes, no solo lo que se añadió.

| Versión | Tema |
|---|---|
| [v2.38.1.md](v2.38.1.md) | Store por usuario (aislamiento real + migración) · CRDT de notas · generar resumen/tarjetas/quiz/mapa mental · arrastre sobre imagen · voz · registro de ánimo |
| [v2.38.md](v2.38.md) | Captura rápida (texto libre → tareas/compras/hábitos/gastos) · RAG con scoping por carpeta · companion de IA en popup |
| [v2.37.md](v2.37.md) | Corrección de auditoría: 13 defectos, 4 P0. El FSRS-7 que no era FSRS-7, el heatmap que no guardaba nada, cuatro endpoints que filtraban datos. |
| [v2.36.md](v2.36.md) | PWA real (el service worker llevaba 20 versiones roto), grading por IA, drag-gap, logging estructurado. |

Las versiones anteriores están en el [CHANGELOG](../CHANGELOG.md).

---

## Referencias externas

Parte de este proyecto se inspiró en proyectos open source. Se copiaron
ideas y, en un caso, fórmulas:

| Proyecto | Qué se tomó |
|---|---|
| [lfnovo/open-notebook](https://github.com/lfnovo/open-notebook) | La arquitectura de 3 fases del RAG: **estrategia → fan-out → síntesis**. `graphs/ask.py`. |
| [khoj-ai/khoj](https://github.com/khoj-ai/khoj) | Los subqueries se generan **con el historial de conversación**, no solo con la última pregunta. `routers/helpers.py::generate_online_subqueries`. También el autolectura de páginas de resultados. |
| [MODSetter/SurfSense](https://github.com/MODSetter/SurfSense) | **Reciprocal Rank Fusion** para la búsqueda híbrida, y el tope de chunks por documento. `app/retriever/chunks_hybrid_search.py`. |

Cada adaptación lleva en el código un comentario con el archivo de origen.

---

## Lo que falta

Documentado para que no se pierda, no como excusa:

- Particionar el store por usuario — hoy `notes.json` y `flashcards.json`
  son un único JSON compartido. Ver la sección "Limitaciones conocidas" de
  [v2.37.md](v2.37.md).
- CRDT para notas — existe para PDF, no para el resto.
- Voz, mind tracker como pantalla propia, drag-to-gap sobre imágenes.
