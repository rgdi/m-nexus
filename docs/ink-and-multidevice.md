# Escritura a mano, tinta y varios dispositivos

> *v2.38.11 – v2.38.14*

Este documento explica cómo funciona la tinta, por qué es vectorial, qué
pasa cuando dos dispositivos escriben a la vez y qué está verificado y
qué no.

---

## 1. Por qué vector y no imagen

La idea es de [rnote](https://rnote.flxzt.net/), **reimplementada aquí**.
No es una idea trivial.

Si el handwriting se guarda como PNG:

- no puedes mover un trazo sin redibujarlo,
- no puedes cambiar el grosor de lo ya escrito,
- dos dispositivos a distinta resolución muestran cosas distintas,
- y no hay forma de fusionar dos trazos sin inventar puntos que nadie
  escribió.

En vector, el trazo se mueve, se colorea, se borra por segmentos, y se
ve **igual en un móvil de 390 que en uno de 1440**. Eso es lo que hace
que "escribe en la tablet, míralo en el portátil" sea lo mismo y no dos
versiones parecidas.

### Sobre la licencia

rnote es **GPL-3.0** y está escrito en **Rust + GTK4**. No se ha copiado
su código: hacerlo habría puesto M-NEXUS en GPL, y un binario GTK no se
embebe en un frontend JavaScript. Lo que es libre de reutilizar es la
arquitectura, y eso es lo que está implementado.

---

## 2. El modelo

```ts
{ id, by, seq, deleted, tool, color, width, alpha,
  points: [{ x, y, p, t }], page, aspect, bbox }
```

| Campo | Qué es |
|---|---|
| `x`, `y` | Fracción de página, 0..1. **No píxeles.** |
| `p` | Presión 0..1, o `-1` si el dispositivo no la da. |
| `t` | ms desde el inicio del trazo. |
| `seq` | Reloj lógico del autor. El mayor gana. |
| `deleted` | Reloj del borrado, o 0. Un tombstone. |
| `page` | A qué página se ancla, no a qué posición del scroll. |

La presión viene de Pointer Events (`pressure`), que es lo único que la
da de verdad. **Un dedo llega con `pointerType: "touch"` y `p = -1`; un
lápiz llega con `"pen"` y `p` entre 0 y 1.** No se pregunta: se mira.

Cuando no hay presión, **la velocidad hace de sustituto**: rápido es
fino, despacio es gordo. Es lo mejor que se puede sacar del dedo.

### Por qué las coordenadas de página

Es lo que hace que la misma anotación caiga en el mismo sitio en
cualquier pantalla. Con píxeles, al pasar de la tablet de 820 al
portátil de 1440 cada trazo se desplazaría.

---

## 3. Dibujo

`frontend/src/widgets/ink_pad.js` — Pointer Events, cuatro herramientas
(lápiz, marcador, resaltador, borrador), deshacer y rehacer de verdad.

**El borrador parte el trazo, no deshace el último.** Es lo que espera
cualquiera que haya dibujado en un papel: lo que pilla el borrador, se
va, y el resto del trazo se queda.

**Lo que no hace, y conviene saber:** no reconoce formas, no alisa los
trazos, no rectifica. Eso es lo que hacen las apps de dibujo de verdad y
es un trabajo de meses. Lo que hay aquí escribe fino.

---

## 4. Conflictos

Tres casos distintos, con tres reglas distintas.

### Dos trazos que se cruzan — **no son un conflicto**

Son dos trazos, y se ven los dos. Intentar fusionarlos en uno sería
inventar puntos que nadie escribió. No se intenta.

### El mismo trazo en dos sitios — gana el `seq` mayor

Como en el resto del sistema, aplicado a un trazo entero en vez de a un
carácter.

### Un borrado — **nadie lo resucita**

El tombstone tiene reloj propio. Si `max(deleted) >= max(seq de
contenido)`, el trazo se va.

Antes no era así: una modificación posterior con `seq` más alto
resucitaba el trazo. En la tablet se borraba algo y en el portátil —con
la versión vieja en caché— volvía a aparecer. **Es perder trabajo sin
avisar**, y era el fallo más grave de todo este bloque.

---

## 5. Texto

El texto ya tenía CRDT de secuencia con tombstones: insertar "ab" y
"bc" en el mismo sitio da "abc", no una de las dos. **Deletes win**: un
borrado no se deshace con una edición posterior.

El borrado por carácter y el borrado de trazo son el mismo principio a
distinto nivel. Esa coherencia es intencionada.

---

## 6. Varios dispositivos

### La identidad era el dispositivo — y se cambió

Antes cada registro era un subject distinto con su propio
`data/users/<subject>/`. Sin cuenta, sin correo, sin forma de vincular
dos máquinas. *"La tablet y el portátil a la vez sobre la misma nota"*
no era un bug de sincronización: **era el modelo de identidad**.

Ahora:

```
sin cuenta    data/users/<subject>/
con cuenta    data/accounts/<cuenta>/
```

Un solo punto de decisión, así que no hay migración: quien no tenga
cuenta sigue con sus datos donde estaban.

**Al crear la cuenta se migra lo que ya tenía el dispositivo, y al
entrar también.** La primera versión solo migraba al entrar, y el
resultado era dos directorios para la misma cuenta: el móvil no veía lo
que escribía el portátil.

### La caché estaba indexada por dispositivo

Las colecciones se cacheaban por subject, que es lo mismo que el
directorio mientras cada uno tenía sus datos. Al compartir, el móvil leía
su copia cacheada y no veía lo recién escrito, **en el mismo proceso y
con el disco al día**.

La clave ahora es el directorio. Los dispositivos de una cuenta
comparten caché —que es lo correcto, comparten datos— y los de cuentas
distintas siguen aislados.

### DosTruths prevention: la revisión

Un contador que sube con cada escritura del store, colgado de
`writeCollection`, que es el **único** sitio por donde pasan todas las
escrituras.

No hace falta comparar contenido entero: basta con *«¿mi número es el de
ahora?»*.

### El canal

`GET /api/v1/stream` — Server-Sent Events, no WebSocket: es un canal de
**una sola dirección**, que es lo único que hace falta. El dispositivo
avisa de lo suyo con `push`; este canal solo le dice *"hay algo nuevo"*.

**El token va por query** porque `EventSource` no puede mandar
cabeceras. Sin eso el canal abría sin identidad, caía en el subject por
defecto y **no llegaba nada nunca** — y parecía funcionar, porque el
saludo sí llegaba.

---

## 7. Qué está verificado y qué no

**Verificado, con tests en `scripts/`:**

| | |
|---|---|
| `test_ink.cjs` — 21/21 | geometría, fusión, borrado, aislamiento |
| `test_account.cjs` — 20/20 | dos dispositivos, una cuenta, aislamiento |
| `test_multidevice.cjs` — 12 | login, revisión, canal en vivo |
| `test_ink_ui.cjs` — 9/10 | lápiz, presión, sincronización, deshacer |
| `test_live_push.cjs` — 7/7 | el push, de punta a punta |

**NO verificado:**

- ~~El bucle de tiempo real~~ — **cerrado el 2026-10-01**. El problema
  era CORS: el canal se escribía con `raw.writeHead`, que se salta las
  cabeceras que el hook de CORS había puesto, y el navegador lo
  rechazaba con `ERR_FAILED` mientras el cliente se reconectaba en
  bucle. Con las cabeceras de origen puestas a mano y la misma política
  —no `*`, que el canal lleva el token en la URL— el push llega:
  otro dispositivo escribe y la página se entera sin recargar.
- **La entrega de lo perdido al reconectar.** El endpoint acepta
  `?since=`; leer de un SSE que no termina cuelga el test.
- **Un lápiz real.** La presión se simula despachando PointerEvents
  con `pointerType: "pen"`. Un Apple Pencil de verdad tiene una curva
  de presión que un dedo no tiene, y eso no se puede simular.
- **Safari en iPad.** Todo lo visual está verificado en Chromium, y el
  producto se usa en iPad.

---

## 8. Conectar la interfaz

El servidor, el canal y el modelo de conflictos están hechos. Falta
enchufar la superficie en las pantallas donde tiene sentido:

- el editor de notas, para escribir a mano encima del texto,
- el visor de PDF, para anotar página a página.

`mountPdfAnnotate()` ya está hecho y monta una capa de tinta por
página, anclada a la página y no al scroll —que es lo único que hace
que al hacer scroll la anotación siga tapando lo que tapaba.
