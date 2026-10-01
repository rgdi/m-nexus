# Lo que falta — checklist viva

Actualizado: 2026-10-01. Marca `[x]` solo lo que está comprobado con un
test o una captura. Lo demás está sin hacer o sin verificar, y se dice.

---

## A. Roto ahora mismo — bugs conocidos

- [x] **A1. El subtítulo de Oclusión llegaba al borde derecho.** Corregido
  el 2026-10-01: ahora es línea propia con margen. Medido a 360/390/414:
  16px de margen y 2 líneas en los tres.
- [ ] **A2. El PDF no está comprobado renderizando nada.**
  El visor carga pdf.js desde CDN y nunca se ha visto una página pintada
  en el sandbox. Puede que funcione, puede que no. Sin red no se puede
  afirmar, y no se afirma.
- [ ] **A3. Una máscara del OCR queda 3px fuera de la imagen.**
  Redondeo de subpíxel en el borde inferior. Documentado, no arreglado.
  Sigue abierto: es cosmético pero está medido y no lo está resuelt.

## B. Lo que pediste y no existe

### Indexación y documentos
- [x] **B1. Índice general de recursos.** Hecho el 2026-10-01. Un grafo
  con notas, tarjetas, documentos, grabaciones, eventos y tareas, cada
  uno con su procedencia y aristas entre ellos. Reconstrucción
  incremental por sello: 300 notas en 6ms.
- [x] **B2. OCR dentro de PDFs.** Hecho el 2026-10-01. Un PDF sin capa de
  texto se rasteriza con poppler y se lee con tesseract, y el aviso dice
  que viene de OCR. Verificado con un PDF escaneado de verdad: 1 → 26
  palabras, 2.5s, y el cruce posterior funciona.
- [ ] **B3. Enlazar una nota desde el PDF con doble clic o clic largo**
  sobre un texto resaltado, y al revés: desde la nota, abrir el PDF en
  la página exacta.
- [ ] **B4. Recursos antiguos.** Nada sabe hoy de una tarjeta hecha hace
  ocho meses que sigue sin tocarse. El diagnóstico lo estima por
  concepto, no por recurso.

### Estudio
- [ ] **B5. Flashcards IA desde cualquier nota**, con la nota de origen
  asignada, y **puerta de aprobación individual**: hasta que no se
  aprueban, no entran en FSRS. Nada de esto existe.
- [ ] **B6. Asignación automática.** Al crear una nota que depende de un
  PDF o una grabación, que sus flashcards e imágenes的后 queden
  apuntando a ese origen.
- [~] **B7. Estudio exclusivo de un tema.** El backend está hecho
  (`POST /graph/scope`): dado un recurso devuelve su material, por tipo,
  y ordena lo más antiguo primero. Falta la interfaz para pedirlo sin
  escribir la ruta a mano.
- [x] **B8. Tutor socrático como actividad.** Hecho el 2026-10-01.
  Preguntas extraídas de la nota del propio usuario, comparación
  determinista de términos en tres capas y veredicto `inverted` para el
  modelo al revés. Sin modelo funciona igual y lo dice.
- [ ] **B9. El RAG cita la línea exacta** y permite abrir el recurso
  donde empieza el Passage. Cita el documento y un fragmento, pero no
  lleva a la línea.

### Interfaz
- [ ] **B10. Manojo de botones.** Settings tiene 20 botones, Generate 7,
  y hay más repartidos. Pasa a submenús con contexto, sin crecen la
  superficie.
- [ ] **B11. Notas en móvil con imágenes y 3D.** No hay ningún soporte de
  3D en la app. Las imágenes se pueden adjuntar, pero el editor móvil
  no está revisited para ello.

## D. Escritura a mano y dos dispositivos a la vez

- [x] **D1. Trazo vectorial, no pixeles.** Hecho el 2026-10-01:
  `services/ink.ts`, con presión, velocidad como sustituto cuando no la
  hay, simplificación, borrador que parte el trazo y merge con
  tombstones. 21/21. Falta la interfaz de dibujo.
- [~] **D0. Lo que ya no hace falta decidir.** Modelo de tinta con presión
  (Pointer Events: `pressure`, `tiltX/Y`, `pointerType`), almacenado
  como vectores. Es la idea de rnote y se reimplementa aquí: **rnote es
  GPL-3.0 y Rust+GTK4**, copiar su código pondría M-NEXUS en GPL y un
  binario GTK no se embebe en un frontend JS. La arquitectura es libre;
  el código no.
- [x] **D2. Anotar un PDF o una imagen.** Hecho el 2026-10-01:
  `mountPdfAnnotate()` monta una capa de tinta por página, anclada a la
  página y no al scroll. Falta enchufarlo en la ruta de #/pdf, que es
  una línea, y probarlo con un PDF de varias páginas de verdad.
- [x] **D3. Dos dispositivos en la misma nota a la vez.** Las notas y la
  tinta se comparten por cuenta. Verificado entre dos ventanas, con dos
  sesiones reales y aislamiento entre cuentas. Falta probarlo entre dos
  máquinas de verdad, que es la parte que no se puede simular aquí.
- [x] **D4. Transporte en tiempo real.** Hecho y verificado el
  2026-10-01: SSE en `GET /api/v1/stream`, cliente suscrito en
  `services/live.js`, reconexión progresiva y aviso por evento
  `mnexus:changed`. `test_live_push.cjs` 7/7: otro dispositivo
  escribe y la página se entera sin recargar, también con dos ventanas
  abiertas a la vez. El bug era CORS: el canal se escribía a pelo con
  `raw.writeHead` y se saltaba las cabeceras del hook.
- [x] **D8. Login convencional.** Correo y contraseña, alta y entrada.
  scrypt con sal propia; bcrypt se queda para lo que ya estaba guardado
  con él, para no dejar cuentas a medio migrar.
- [x] **D9. Una sola verdad entre dispositivos.** Un contador de
  revisión que sube con cada escritura del store, y ambos dispositivos
  leen el mismo. Antes el servidor iba bien y el cliente no se
  enteraba: dos verdades en pantalla y nadie sabía cuál.
- [x] **D4bis. CUENTA DE USUARIO.** Hecho el 2026-10-01.
  `data/accounts/<id>/` con un dispositivo enlazado por código de 8
  caracteres, 15 minutos de vida y un solo uso. Al crear la cuenta se
  migra lo que ya tenía el dispositivo; al entrar, también. 20/20.
  Aditivo: sin cuenta, todo sigue igual y con los mismos datos.
- [~] **D4bis-bis. La seguridad del código, pendiente.** El código de
  invitación es una contraseña y va por HTTP. Suficiente para pasar un
  dispositivo de una habitación a otra; insuficiente para nada más.
  Quien necesite más necesita HTTPS y límite de intentos.
- [ ] ~~**D4bis. CUENTA DE USUARIO — BLOQUEANTE.**~~ Este es el que
  impedía todo lo demás, y no estaba en la lista hasta ahora.
  La identidad de la app es **el dispositivo registrado**: cada
  registro es un subject distinto con su propio
  `data/users/<sub>/`. No hay cuenta, ni correo, ni forma de vincular
  dos dispositivos.
  Consecuencia directa: **dos dispositivos son dos usuarios**, así que
  hoy "la tablet y el portátil a la vez sobre la misma nota" es
  literalmente imposible, y no por un bug: por el modelo de identidad.
  Hasta que exista, D1 y D3 se pueden construir y probar pero no
  ended entre dos máquinas. Es la pieza más grande de todo el bloque
  D y hay que decidirla antes que las demás.
- [ ] **D5. Conflictos.** Dos dispositivos offline cambian lo mismo y se
  reconectan. Para el texto ya hay CRDT de secuencia con tombstones;
  para la tinta no, y un trazo a la vez no es un conflicto de
  caracteres. Hay que decidir y dejarlo escrito.
- [ ] **D6. Presencia.** Ver qué dispositivo está editando ahora, para
  no pelearse con uno mismo.

## E. Verificación que falta

- [ ] **C0. Nada de la escritura a mano está probado en un lápiz
  real.** Un stylus de verdad tiene una curva de presión que un dedo no
  tiene. El modelo está pensado para eso, pero simularlo no es lo
  mismo.
- [ ] **C1. Nada de esto se ha probado en Safari.** Todo el trabajo
  visual está verificado en Chromium, y el producto se usa en iPad.
- [ ] **C2. El cruce `coverage` no se ha probado con PDFs reales de
  profesor**, solo con un PPTX y un DOCX sintéticos que genera el propio
  test. Un PDF de una editorial real tiene una estructura distinta.
- [ ] **C3. El comportamiento con el usuario real durante semanas.**
  300 notas ficticias no son 30 reales: las reales están correlacionadas
  y las ficticias no.

---

## Orden de ejecución

1. **A1** — dos líneas de CSS, lo que queda está roto hoy.
2. **B3** — el índice ya guarda línea y página, y B2 ya está hecho.
3. ~~**B1**~~ — hecho. Queda **B9** sobre sus cimientos.
4. **B9** — el RAG ya recibe los trozos; solo falta citar y saltar.
5. **B5 + B6** — flashcards IA con su nota y su puerta de aprobación.
6. **B7** — estudio exclusivo, que ya tiene la mecánica de scope.
7. **B8** — tutor socrático.
8. **B4** — recursos antiguos, con lo que B1 deje disponible.
9. **B10 + B11** — interfaz. Al final a propósito: reorganizar antes de
   tener las cosas dentro sería dos veces el trabajo.
10. **A2** — el PDF, cuando haya algo real que mostrar en él.

El bloque D va aparte y es el más grande de todos: tinta, tiempo real y
conflictos. Los tres juntos, porque por separado no sirven de nada —un
trazos que no se sincroniza entre dispositivos es un doodle, y una
sincronización sin conflictos es una forma de perder trabajo—.
