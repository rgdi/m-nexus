# Modelos 3D: de dónde salen y con qué licencia

Los seis modelos que trae la aplicación son **primitivas generadas**.
No hay ningún archivo de anatomía de otra persona en este repositorio,
y eso es a propósito: casi todos los modelos anatómicos que hay tienen
licencia, y meterlos aquí es trabajo de alguien que hay que nombrar.

Para tener anatomía de verdad, el bloque de la nota tiene un botón
**«📂 Abrir .glb»**: eliges un archivo de tu dispositivo y se abre en el
sitio, con etiquetas y oclusión. El archivo **no se sube a ningún
servidor**: se queda en tu sesión.

## Fuentes con licencia abierta

### BodyParts3D — CC BY 4.0

- Fuente: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html>
- Mantenimiento: Database Center for Life Science (DBCLS), Japón.
- 1.838 estructuras sobre un cuerpo masculino adulto.
- **Atribución obligatoria**, exactamente esta:
  > BodyParts3D, © The Database Center for Life Science licensed
  > under CC Attribution 4.0 International
- La versión 4.0 cambió de CC BY-SA 2.1 Japan a **CC BY 4.0** el
  2025-02-27. Eso importa: CC BY deja hacer derivados y uso comercial;
  CC BY-SA obligaba a compartir igual. **Usa la 4.0, no el clon de la
  versión 3** que hay en GitHub, que sigue marcado como BY-SA.

Lo que se puede hacer: descargar los `.obj`/`.stl`, convertirlos a
`.glb` (Blender, `gltf-transform`, o `obj2gltf`), y usarlos.
Lo que no: redistribuirlos aquí como si fueran míos.

### Smithsonian 3D — CC0, pero no es anatomía

- <https://3d.si.edu/> · <https://www.si.edu/openaccess/faq>
CC0: dominio público, sin atribución obligatoria, uso comercial.
- Miles de piezas de museo, y también la colección de medicina y
  ciencia: instrumental, maquetas anatómicas, mummies.
- **No hay un corazón, un pulmón ni un cerebro como modelo limpio y
  manipulable.** Para estudiar anatomía no sirve; para una clase de
  historia de la medicina, sí.

### Sketchfab — hay que mirar modelo a modelo

- Colecciones de dominio público y CC0, y también CC BY.
- **La licencia cambia en cada archivo.** Un modelo que pone «CC BY» en
  la ficha pide atribución; uno que pone «CC BY-NC» no vale para uso
  comercial. Descarga la ficha de licencia junto al `.glb` y ponla en
  la nota.

### Z-Anatomy, BioDigital — de pago, con licencia propia

Modelos anatómicos de calidad de atlas. No son libres: hay que
comprarlos y cada uno tiene su propia licencia de uso. **No se pueden
meter en este repositorio**, ni redistribuir ni servir. Se pueden
usar en local si has comprado la licencia y lo cargas con el botón
`.glb`.

## La atribución, dentro de la app

El bloque 3D guarda un campo `credit` que sale debajo del modelo, y el
`.glb` que cargas por tu cuenta lo rellena con el nombre del archivo.
No es un adorno: es el sitio donde la licencia de un modelo ajeno tiene
que poder mostrarse. **Si usas un modelo de otra persona, pon su
crédito ahí.**

## Lo que este repositorio NO hace

- No redistribuye modelos anatómicos de terceros.
- No incluye un `.glb` en el árbol.
- No finge que las primitivas generadas son un atlas: son esquemáticas,
  sirven para girar, etiquetar y tapar, y no sustituyen a un modelo
  anatómico real.
