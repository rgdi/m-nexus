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
- [ ] **B1. Índice general de recursos.** El de `coverage` existe pero
  solo cruza transcripciones. No hay un índice único de "qué hay en mis
  notas, PDFs, grabaciones y tarjetas, y cómo se relacionan".
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
- [ ] **B7. Estudio exclusivo de un tema**, desde el chat o desde un menú
  especial semiescondido: solo ese PDF, solo esa carpeta, solo esa nota.
- [ ] **B8. Tutor socrático como actividad.** Comparar la respuesta del
  usuario con la estandarizada, sobre recursos de referencia. No existe
  ningún servicio de esto.
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

## C. Verificación que falta

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
3. **B1** — un índice único, que es la base de B4, B6 y B7.
4. **B9** — el RAG ya recibe los trozos; solo falta citar y saltar.
5. **B5 + B6** — flashcards IA con su nota y su puerta de aprobación.
6. **B7** — estudio exclusivo, que ya tiene la mecánica de scope.
7. **B8** — tutor socrático.
8. **B4** — recursos antiguos, con lo que B1 deje disponible.
9. **B10 + B11** — interfaz. Al final a propósito: reorganizar antes de
   tener las cosas dentro sería dos veces el trabajo.
10. **A2** — el PDF, cuando haya algo real que mostrar en él.
