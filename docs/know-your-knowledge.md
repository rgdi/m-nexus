# Know Your Knowledge

> *"No sabes lo que sabes hasta que te lo preguntan de la manera
> equivocada."*

Este documento explica qué hace el sistema de planificación, qué
promete y qué no. Está aquí para poder discutirlo, no para venderlo.

---

## 1. El problema

Un usuario que abre una app de estudio no parte de cero ni parte de
todo. Parte de un agujero con forma rara, y esa forma es distinta en
cada persona.

Casi todos los sistemas de repaso parten de la misma simplificación:
un intento. Si aciertas, sabes. Si fallas, no. Y eso mezcla **tres
cosas diferentes**:

| Lo que pasó | Lo que el sistema cree | Lo que pasó de verdad |
|---|---|---|
| Acierta al primer intento | lo sabe | probablemente sí |
| Falla al primer intento | no lo sabe | ¿olvidado? ¿nunca entró? ¿no lo entendió? |
| Acierta después de pensarlo | no lo sabe | lo sabe, le cuesta sacarlo solo |

La tercera fila es la que más cuesta. Un sistema que solo mide un
intento mete en el mismo saco a quien aprendió algo hace dos semanas y
a quien lo está leyendo por primera vez. Y después mete en el de
"dominado" a quien contesta de memoria algo que no entiende.

**Know Your Knowledge** (KYK) mide el hueco, no el rendimiento.

---

## 2. Qué hace

### 2.1 La excavación

Un fallo no cierra nada. Abre un nivel.

```
L0   pregunta directa, respuesta libre
L1   se estrecha: pasa a opciones, con una pista
L2   se compara con material cercano del mismo tema
L3   tres preguntas de control, para discriminar
```

Cada nivel **repregunta de otra manera a propósito**. Repetir la misma
pregunta mide si te sabías la formulación, no el concepto.

El L2 es el que importa. En vez de repetir, compara: *"¿en qué se
diferencia esto de aquello de al lado?"*. Y ahí aparece un veredicto
que ningún test de un intento puede ver:

> **`mismatched` — lo tienes al revés.** Aciertas el ejemplo y fallas
> la regla. No es despiste: es la regla del revés, sostenida con
> confianza. Un mapa mental lo deshace; seguir repitiendo la misma
> pregunta no.

### 2.2 Los cinco veredictos

| Veredicto | Significa | Qué hace con FSRS |
|---|---|---|
| `known` | lo tenía | `good`, el scheduler decide |
| `unstable` | lo sabe pero no le sale solo | `hard`, vuelve mañana |
| `forgotten` | estaba, se le había ido | `lapse` + drilling |
| `mismatched` | la regla del revés | `lapse` + mapa mental |
| `absent` | nunca entró | `lapse` fuerte, fecha corta |

La asimetría es deliberada: **fallar mueve −0.12, acertar mueve +0.08**.
Un acierto puede ser suerte; un fallo es evidencia. Por eso la media de
respuestas al azar se queda en 0.48, no en 0.50. Si se normalizara a
0.5, el sistema trataría un "no lo sé" igual que un "vale".

### 2.3 Lo que aprende va a tres sitios

1. **FSRS.** Un acierto en L3 vale más que en L0. Un fallo es un
   `lapse`, no un "visto".
2. **Tarjetas de drilling** del tema, que vuelven a la cola.
3. **La probabilidad del concepto** (`p`, 0..1), que decide cuánto
   indagar la próxima vez.

### 2.4 Corre solo

`buildPlan` decide la cola con los exámenes por delante, sin preguntar
nada:

| Días hasta el examen | Cuánto se indaga |
|---|---|
| ≤ 3 | L3, a fondo |
| ≤ 7 | L2 |
| ≤ 21 (horizonte) | L1 |
| más lejos | L0, una comprobación barata |

Y el tope de **6 conceptos al día**, porque medir es útil pero no vale
la pena sangrar la sesión de estudio por ello.

### 2.5 La curva de reparto

Aquí hubo un bug real que la prueba de carga encontró.

La distribución de sesiones por día usaba pesos `1.4^d`, de modo que
con un examen a 60 días el reparto era **5 minutos el primer día y 60 el
último**. Justo al revés de lo que sirve: con tiempo de sobra se
reparte desde el principio y se afloja al final.

Ahora los pesos son una campana suave. Con 30 días, el trabajo pasó de
**10 días sueltos a 27 repartidos**. Con un examen a ≤3 días no cambia:
ahí sí conviene juntar el esfuerzo.

Además, el **tope horario es del día entero**, no de cada sesión. Con
dos exámenes el mismo día —el caso normal en ineturnos— el tope se
aplicaba dentro del bucle de cada examen y el usuario acababa con
66 minutos programados de un tope de 60.

Y cuando **no cabe**, se dice. El motivo de la sesión lleva *"Se
recortó 20 min: no cabía todo el día"*. Un plan que no cabe y no lo
dice es peor que uno que se ajusta.

---

## 3. Qué NO hace

Esto es tan importante como lo que sí.

- **No mide comprensión.** KYK mide si puedes recuperar. Que sepas
  recuperar y no understands es un problema real, y aquí no se detecta.
- **No sustituye al diagnóstico clásico.** `/#/diagnostic` sigue
  existiendo y sigue siendo lo que genera un perfil FSRS a partir de un
  temario completo. `/#/probe` es la excavación.
- **No adivina conceptos.** Los conceptos salen de lo que hay escrito.
  Si un tema no está en ninguna nota, no existe para KYK.
- **No cruza conceptos y exámenes por similitud.** El cruce es por
  **cadena exacta**: si el examen dice "Genética" y el concepto se
  llama "Nota 12 de Genética", no se cruzan. Es una limitación
  conocida y comprobable, no un matiz.
- **No es FSRS puro.** FSRS-7 califica la recuperación; KYK califica la
  profundidad del hueco y luego pasa el veredicto a FSRS. Son capas
  distintas y el orden importa.

---

## 4. Qué se ha comprobado y qué no

`scripts/stress_kyk.cjs` — **19/19 con 300 notas, 900 tarjetas, 120
oclusiones (998 zonas), 12 carpetas y 4 exámenes**.

Comprobado con datos ficticios:

- El plan se genera en ~1-2 ms con el peso encima.
- Ninguna duración negativa; el tope diario se respeta (60 de 60).
- Con respuestas al azar la estimación no se infla (p = 0.48).
- Fallar baja la estabilidad en las 545 tarjetas graduadas; acertar
  nunca la baja en las 900.
- La excavación termina siempre en L3 o antes.
- Con un examen mañana, lo de ese tema va primero y a nivel 3.

**No comprobado:**

- Todo lo anterior es con el motor determinista y datos sintéticos. El
  cruce con un LLM real no está probado, porque no hay modelo
  configurado en este entorno.
- El comportamiento con el usuario real, en sesiones reales, después
  de semanas. Un sistema que funciona en 300 notas ficticias puede
  fallar con 30 reales, porque las reales están todas correlacionadas
  y las ficticias no.
- Safari en iPad. Todo el trabajo visual está verificado en Chromium.

---

## 5. Cómo ejecutarlo

```bash
node scripts/stress_kyk.cjs              # 300 notas
node scripts/stress_kyk.cjs --scale=2000 # a ver dónde se rompe
node scripts/test_planner.cjs            # 26 comprobaciones de lógica
```

Con `--scale=2000` el generador produce 2000 notas, 6000 tarjetas y
800 oclusiones. No hay ningún límite puesto: el objetivo es encontrar
dónde se rompe, no certificar que no se rompe.

---

## 6. Intención

El objetivo no es que el usuario estudie más. Es que estudie **lo que
no sabe**, y que lo que ya sabe no le ocupe sitio.

Un plan que manda 900 tarjetas porque hay 900 tarjetas en la carpeta
está haciendo exactamente lo contrario de esto.
