/**
 * model3d_block.js — un modelo 3D dentro de una nota.
 *
 * v2.38.16. Sustituye al "3D Graph" del resumen, que era el resumen con
 * las notas esparcidas como chinchetas sobre un hueso: bonito y sin
 * ninguna utilidad.
 *
 * Lo que si sirve es esto: un modelo en medio del texto, con
 * etiquetas puestas a mano sobre las estructuras y con oclusion encima
 * —tapar una parte y adivinar cual es— que es como se estudia
 * anatomia de verdad.
 *
 * Tres decisiones que no son las que parecian:
 *
 * 1. **three.js va en la app, no en unpkg.** Un modelo 3D que necesita
 *    internet no sirve en un examen sin datos. Esta en /vendor.
 *
 * 2. **La etiqueta no se escribe en un prompt().** `prompt()` es el
 *    dialogo del navegador: sin estilo, sin traduccion, y en iOS abre
 *    un teclado del sistema encima de la pantalla. Aqui se escribe
 *    inline, sobre el propio punto.
 *
 * 3. **La oclusion se ancla al modelo, no a la pantalla.** Cada caja
 *    guarda su punto en coordenadas del modelo. Si giras el corazon,
 *    la caja se queda encima de la auricula, no flotando en la
 *    esquina de la pantalla.
 */

/** Cada modulo lleva su propio escapeHtml: el del proyecto es una
 * copia pegada en quince ficheros, no un modulo compartido. */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** GLTFLoader, local. Cargar un .glb propio es lo que da acceso a
 *  modelos anatómicos de verdad, y sin meterse en redistribuir los de
 *  otros. */
let gltfPromise = null;
export function loadGltfLoader() {
  if (gltfPromise) return gltfPromise;
  gltfPromise = (async () => {
    for (const url of ["/vendor/GLTFLoader.js",
      "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/GLTFLoader.js"]) {
      try {
        const mod = await import(/* @vite-ignore */ url);
        if (mod && mod.GLTFLoader) return mod.GLTFLoader;
      } catch { /* el siguiente */ }
    }
    return null;
  })();
  return gltfPromise;
}

/* ── three.js local, con el CDN como red de seguridad ───────────── */
let threePromise = null;
export function loadThree() {
  if (threePromise) return threePromise;
  threePromise = (async () => {
    if (window.THREE) return window.THREE;
    // v2.38.16 — venia de unpkg con un <script>. En el sandbox y sin
    // red eso es un bloque 3D vacio.
    const LOCAL = "/vendor/three.min.js";
    const CDN = "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.158.0/three.min.js";
    for (const src of [LOCAL, CDN]) {
      try {
        await new Promise((ok, ko) => {
          const s = document.createElement("script");
          s.src = src;
          s.onload = ok;
          s.onerror = () => ko(new Error("no se pudo cargar " + src));
          document.head.appendChild(s);
        });
        if (window.THREE) return window.THREE;
      } catch { /* el siguiente */ }
    }
    throw new Error("three.js no disponible");
  })().catch((e) => { threePromise = null; throw e; });
  return threePromise;
}

/* ── modelos de anatomia, generados ──────────────────────────────
 *
 * No hay archivos .glb en el repo: vienen de fuentes libres con
 * licencias distintas y meterslos aqui seria publicar material que no
 * es mio. En vez de eso se generan primitivas con nombre, que para
 * oclusion y para etiquetas es exactamente lo que hace falta: girar,
 * mirar, tapar y adivinar. Un GLB de verdad se pega con `modelUrl` y
 * entra por el mismo camino.
 */
export const MODELOS = {
  corazon: {
    label: "Corazón",
    hint: "Aurículas, ventrículos y los grandes vasos",
    build(T) {
      const g = new T.Group();
      // v2.38.18 — los ventrículos son conos de punta, no bolas. Un
      // corazón son dos conos apuntando al ápex, con la aurícula encima;
      const MYO = new T.MeshStandardMaterial({ color: 0xa8323f, roughness: 0.62 });
      const MYO_INT = new T.MeshStandardMaterial({ color: 0x6e1f28, roughness: 0.85 });
      const GRASO = new T.MeshStandardMaterial({ color: 0xc4576a, roughness: 0.55 });
      const VASO = new T.MeshStandardMaterial({ color: 0x9b3b4a, roughness: 0.5 });
      const AZUL = new T.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 0.5 });
      const MORADO = new T.MeshStandardMaterial({ color: 0x8a4a9c, roughness: 0.5 });

      // v2.38.18 — el ventrículo es un perfil TORNEADO, no un cono.
      // Un cono tiene las paredes rectas y el vértice: parece un cubo
      // de Rubik. Lo que identifica la masa ventricular es la curva:
      // base ancha y plana arriba, y un ápex que se afila abajo. El
      // perfil se gira y sale con esa forma sola.
      const perfilVentriculo = (grosor) => [
        new T.Vector2(0.02, 1.32),
        new T.Vector2(0.62 * grosor, 1.26),
        new T.Vector2(1.02 * grosor, 1.02),
        new T.Vector2(1.18 * grosor, 0.5),
        new T.Vector2(1.12 * grosor, -0.1),
        new T.Vector2(0.86 * grosor, -0.72),
        new T.Vector2(0.46 * grosor, -1.28),
        new T.Vector2(0.02, -1.62),
      ];

      // El izquierdo: más grande y más bajo. Su pared es tres veces más
      // gruesa que la del derecho, y esa es la diferencia que importa
      // cuando estás mirando el corte.
      const izq = new T.Mesh(new T.LatheGeometry(perfilVentriculo(1.0), 40), MYO);
      izq.position.set(-0.42, -0.15, 0.18);
      izq.rotation.set(0.1, 0, 0.22);
      g.add(izq);
      const der = new T.Mesh(new T.LatheGeometry(perfilVentriculo(0.86), 36), MYO);
      der.position.set(0.72, -0.05, -0.08);
      der.rotation.set(-0.06, 0, -0.3);
      g.add(der);

      // El tabique interventricular: la pared gruesa entre los dos.
      // Sin ella, los dos ventrículos son un bulto y no hay corazón.
      const tabique = new T.Mesh(new T.LatheGeometry(perfilVentriculo(0.2), 24), GRASO);
      tabique.position.set(0.16, -0.1, 0.34);
      tabique.rotation.set(0.1, 0, 0.02);
      g.add(tabique);

      // Aurículas: cámaras anchas y de pared fina, sentadas encima de
      // los ventrículos. Domina el tercio superior.
      const auricula = (x, y, z, sx) => {
        const m = new T.Mesh(new T.SphereGeometry(0.8, 30, 22), GRASO);
        m.position.set(x, y, z);
        m.scale.set(sx, 0.72, 0.94);
        return m;
      };
      g.add(auricula(0.66, 1.34, -0.06, 1.16));    // derecha
      g.add(auricula(-0.62, 1.42, 0.2, 1.2));     // izquierda

      // Aorta: ascendente, arco y descendente, con las TRES ramas del
      // arco. Es lo que hace que se reconozca un corazón desde atrás.
      const asc = new T.Mesh(new T.CylinderGeometry(0.24, 0.26, 1.35, 22), VASO);
      asc.position.set(0.2, 2.05, -0.14);
      asc.rotation.z = 0.14;
      g.add(asc);
      const arco = new T.Mesh(new T.TorusGeometry(0.82, 0.23, 16, 44, Math.PI * 1.08), VASO);
      arco.position.set(-0.2, 2.66, -0.14);
      arco.rotation.set(Math.PI / 2, 0, Math.PI * 0.46);
      g.add(arco);
      const desc = new T.Mesh(new T.CylinderGeometry(0.2, 0.17, 1.4, 20), VASO);
      desc.position.set(-0.9, 2.16, -0.14);
      desc.rotation.z = -0.1;
      g.add(desc);
      for (const [x, y, h, tilt] of [[0.42, 3.36, 0.6, -0.2], [-0.06, 3.42, 0.7, 0.05], [-0.56, 3.28, 0.6, 0.22]]) {
        const r = new T.Mesh(new T.CylinderGeometry(0.1, 0.085, h, 14), VASO);
        r.position.set(x, y, -0.14);
        r.rotation.z = tilt;
        g.add(r);
      }

      // Tronco pulmonar: DELANTE y más bajo que la aorta. Detrás no se
      // ve, y si no se ve, la relación entre los dos grandes vasos —que
      // es justo lo que se pregunta— no se puede contestar.
      const tronco = new T.Mesh(new T.CylinderGeometry(0.27, 0.32, 1.3, 22), VASO);
      tronco.position.set(0.36, 1.82, 0.66);
      tronco.rotation.z = -0.3;
      g.add(tronco);
      for (const side of [-1, 1]) {
        const pa = new T.Mesh(new T.CylinderGeometry(0.16, 0.13, 0.92, 16), VASO);
        pa.position.set(0.36 + side * 0.44, 2.4, 0.64);
        pa.rotation.z = side * 0.74;
        g.add(pa);
      }

      // Venas cavares: entran en la aurícula derecha por arriba y por
      // abajo. Son la vía de retorno, y en azul se distinguen de un
      // vistazo de las arterias.
      const cavaSup = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 1.1, 18), AZUL);
      cavaSup.position.set(1.02, 2.42, -0.04);
      cavaSup.rotation.z = -0.24;
      g.add(cavaSup);
      const cavaInf = new T.Mesh(new T.CylinderGeometry(0.24, 0.24, 1.0, 18), AZUL);
      cavaInf.position.set(1.24, 0.62, -0.04);
      cavaInf.rotation.z = -0.16;
      g.add(cavaInf);
      // Venas pulmonares: cuatro, a la aurícula izquierda.
      for (const [x, y, z, rz] of [[-1.28, 1.72, 0.3, 0.52], [-1.28, 1.2, 0.06, 0.64]]) {
        const pv = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.78, 14), MORADO);
        pv.position.set(x, y, z);
        pv.rotation.z = rz;
        g.add(pv);
      }
      return g;
    },
  },

  craneo: {
    label: "Cráneo",
    hint: "Bóveda, orbits, mandíbula y foramen magnum",
    build(T) {
      const g = new T.Group();
      const HUESO = new T.MeshStandardMaterial({ color: 0xe6dcc2, roughness: 0.88 });
      const SUTURA = new T.MeshStandardMaterial({ color: 0xc9bb9c, roughness: 0.95 });
      // v2.38.18 — la bóveda es un perfil torneado, no una esfera: la
      // cabeza es más estrecha arriba que a los lados, y con una esfera
      // parecía una bola con una mandíbula pegada.
      const perfil = [
        new T.Vector2(0.02, -1.5), new T.Vector2(0.55, -1.35),
        new T.Vector2(0.95, -0.85), new T.Vector2(1.18, -0.1),
        new T.Vector2(1.22, 0.6), new T.Vector2(1.05, 1.1),
        new T.Vector2(0.62, 1.42), new T.Vector2(0.02, 1.5),
      ];
      const boveda = new T.Mesh(new T.LatheGeometry(perfil, 40), HUESO);
      boveda.scale.set(1, 1, 1.12);
      g.add(boveda);
      // La frente se adelanta un poco: sin esto parece un huevo.
      const frente = new T.Mesh(new T.SphereGeometry(0.72, 26, 20), HUESO);
      frente.position.set(0, 0.62, 0.78); frente.scale.set(1.05, 0.78, 0.7);
      g.add(frente);
      // Orbitas: dos huecos hundidos.
      for (const side of [-1, 1]) {
        const orb = new T.Mesh(new T.SphereGeometry(0.34, 22, 16),
          new T.MeshStandardMaterial({ color: 0x8d8367, roughness: 0.95 }));
        orb.position.set(side * 0.46, 0.16, 1.02);
        orb.scale.set(1, 0.86, 0.6);
        g.add(orb);
      }
      // Nasal.
      const nariz = new T.Mesh(new T.ConeGeometry(0.2, 0.5, 12), HUESO);
      nariz.position.set(0, -0.16, 1.08); nariz.rotation.x = Math.PI * 0.5;
      g.add(nariz);
      // Foramen magnum, en la base.
      const foramen = new T.Mesh(new T.TorusGeometry(0.34, 0.11, 12, 26), HUESO);
      foramen.position.set(0, -1.28, -0.24); foramen.rotation.x = Math.PI / 2;
      g.add(foramen);
      // Sutura sagital: la línea de arriba abajo. Lo primero que se ve
      // en un cráneo de frente.
      const sut = new T.Mesh(new T.BoxGeometry(0.05, 2.4, 0.06), SUTURA);
      sut.position.set(0, 0.4, 0.02);
      g.add(sut);
      // Mandíbula, con la curva del mentón.
      const mand = new T.Mesh(new T.TorusGeometry(0.82, 0.19, 12, 30, Math.PI * 0.9), HUESO);
      mand.position.set(0, -1.16, 0.5); mand.rotation.set(Math.PI / 2, 0, Math.PI * 1.06);
      g.add(mand);
      const menton = new T.Mesh(new T.BoxGeometry(0.5, 0.34, 0.4), HUESO);
      menton.position.set(0, -1.42, 0.78);
      g.add(menton);
      return g;
    },
  },

  pulmon: {
    label: "Pulmones",
    hint: "Lóbulos, tráquea y árbol bronquial",
    build(T) {
      const g = new T.Group();
      const PARENQ = new T.MeshStandardMaterial({ color: 0xcf7a86, roughness: 0.9 });
      const VIA = new T.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.75 });
      // v2.38.18 — el DERECHO tiene tres lóbulos y el IZQUIERDO dos:
      // el corazón se lo come el sitio. Esa diferencia es el nombre
      // de los lóbulos, así que un pulmón de dos mitades iguales no
      // sirve para estudiarlos.
      // v2.38.18 — cada pulmón es un perfil TORNEADO, no una pila de
      // esferas. Apilado se ve como un montoncito de pelotas; lo que
      // dice "pulmón" es el áxis estrecho arriba, el máximo hacia
      // un tercio de arriba y la base ancha. Los lóbulos se marcan con
      // las cisuras encima, que es como se ven de verdad.
      const perfilPulmon = (conMedio) => [
        new T.Vector2(0.05, 1.62),
        new T.Vector2(0.3, 1.5),
        new T.Vector2(0.62, 1.12),
        new T.Vector2(0.86, 0.62),
        new T.Vector2(0.94, 0.05),
        new T.Vector2(0.88, -0.58),
        new T.Vector2(0.72, -1.08),
        new T.Vector2(0.44, -1.42),
        new T.Vector2(0.05, -1.5),
      ];
      const hacerPulmon = (side) => {
        const m = new T.Mesh(new T.LatheGeometry(perfilPulmon(side > 0), 34), PARENQ);
        m.position.set(side * 0.98, 0, 0.12);
        m.scale.set(1, 1, 0.82);
        m.rotation.y = side * -0.16;
        g.add(m);
        // Cisuras: los surcos que separan los lóbulos. El izquierdo
        // tiene una; el derecho, dos.
        const surcos = side > 0 ? [[0.28, 0.5]] : [[0.42, 0.52], [-0.3, -0.52]];
        for (const [y, ang] of surcos) {
          const cis = new T.Mesh(new T.TorusGeometry(0.86, 0.035, 8, 32, Math.PI * 1.15),
            new T.MeshStandardMaterial({ color: 0xa8525f, roughness: 0.96 }));
          cis.position.set(side * 0.98, y, 0.12);
          cis.rotation.set(0, Math.PI / 2, ang);
          cis.scale.set(1, 1, 0.86);
          g.add(cis);
        }
      };
      hacerPulmon(1);
      hacerPulmon(-1);
      // Tráquea y bifurcación.
      // v2.38.18 — la vía aérea sube POR ENCIMA de la masa pulmonar.
      // Antes la tracrea estaba a y=1.42 con los pulmones hasta 1.6:
      // entera dentro, y no se veía ni la bifurcación ni los bronquios,
      // que es justo lo que se pregunta de un árbol bronquial.
      const traq = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 1.5, 20), VIA);
      traq.position.set(0, 2.06, 0.12);
      g.add(traq);
      const anillos = new T.Mesh(new T.TorusGeometry(0.2, 0.035, 8, 22), VIA);
      anillos.position.set(0, 2.5, 0.12);
      anillos.rotation.x = Math.PI / 2;
      g.add(anillos);
      // La carina: donde se bifurca.
      const carina = new T.Mesh(new T.SphereGeometry(0.2, 16, 12), VIA);
      carina.position.set(0, 1.42, 0.12);
      g.add(carina);
      for (const side of [-1, 1]) {
        const bron = new T.Mesh(new T.CylinderGeometry(0.14, 0.12, 1.1, 16), VIA);
        bron.position.set(side * 0.5, 1.16, 0.12);
        bron.rotation.z = side * 0.7;
        g.add(bron);
        // Dos bronquios más finos entrando en cada pulmón.
        for (const [dy, dz] of [[0.52, -0.34], [0.4, 0.4]]) {
          const b2 = new T.Mesh(new T.CylinderGeometry(0.08, 0.05, 0.8, 10), VIA);
          b2.position.set(side * 1.02, dy, 0.12 + dz);
          b2.rotation.z = side * 1.1;
          g.add(b2);
        }
      }
      // Diafragma: la cúpula de abajo, que separa los pulmones del
      // abdomen. Sin ella el pulmón flota y no se entiende la presión.
      // La CÚPULA, no el cuenco. thetaStart 0 es el hemisferio de
      // arriba; con la mitad de abajo salía una pala flotando
      // debajo de los pulmones, separada, y sin ninguna relación.
      const diafragma = new T.Mesh(new T.SphereGeometry(1.45, 34, 18, 0, Math.PI * 2, 0, Math.PI / 2),
        new T.MeshStandardMaterial({ color: 0xc98a72, roughness: 0.85 }));
      diafragma.position.set(0, -1.62, 0.12);
      diafragma.scale.set(1.08, 0.52, 0.78);
      g.add(diafragma);
      return g;
    },
  },

  cerebro: {
    label: "Cerebro",
    hint: "Lóbulos, cuerpo calloso y tronco encefálico",
    build(T) {
      const g = new T.Group();
      const SUST = new T.MeshStandardMaterial({ color: 0xdd9a9c, roughness: 0.94 });
      const BLANCO = new T.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.7 });
      // v2.38.18 — los surcos. Un cerebro liso es un melón. Los surcos
      // son lo que le da la forma de cerebro, y son justo lo que se
      // identifica en un corte o en una foto.
      const perfil = [
        new T.Vector2(0.02, -1.1), new T.Vector2(0.7, -0.95),
        new T.Vector2(1.15, -0.4), new T.Vector2(1.32, 0.25),
        new T.Vector2(1.16, 0.85), new T.Vector2(0.6, 1.16),
        new T.Vector2(0.02, 1.2),
      ];
      const cerebro = new T.Mesh(new T.LatheGeometry(perfil, 44), SUST);
      cerebro.scale.set(1, 1, 1.16);
      g.add(cerebro);
      // v2.38.18 — el cerebro va LISO.
      //
      // Se intentaron los surcos como aros de toro sobre la superficie:
      // se veían como los anillos de un planeta. Como grupos sobre la
      // superficie, medio enterrados: no se veían. Un cerebro liso con
      // el cuerpo calloso, el tálamo, el cerebelo y el tronco —que es
      // lo que se etiqueta y lo que se pregunta en un corte— es mejor
      // que un cerebro con aros. Los giros de verdad son una malla, y
      // eso no cabe en un `build()` de primitivas sin mentir.
      const radioEn = (y) => {
        const ys = [-1.1, -0.95, -0.4, 0.25, 0.85, 1.16, 1.2];
        const rs = [0.02, 0.7, 1.15, 1.32, 1.16, 0.6, 0.02];
        for (let i = 1; i < ys.length; i++) {
          if (y <= ys[i]) {
            const t = (y - ys[i - 1]) / (ys[i] - ys[i - 1]);
            return rs[i - 1] + t * (rs[i] - rs[i - 1]);
          }
        }
        return 1.3;
      };
      // El surco longitudinal, el que separa los hemisferios.
      const fisura = new T.Mesh(new T.BoxGeometry(0.07, 1.6, 1.3),
        new T.MeshStandardMaterial({ color: 0xb97578, roughness: 0.96 }));
      fisura.position.set(0, 0.05, 0.02);
      g.add(fisura);
      // Cuerpo calloso: el arco de materia blanca que une los dos
      // hemisferios. En un corte sagital es lo primero que se señala.
      const calloso = new T.Mesh(new T.TorusGeometry(0.78, 0.19, 14, 34, Math.PI * 1.1), BLANCO);
      calloso.position.set(0, 0.06, 0.16);
      calloso.rotation.set(0, Math.PI / 2, Math.PI * 0.42);
      calloso.scale.set(1, 1.2, 1);
      g.add(calloso);
      // Tálamo, debajo del cuerpo calloso.
      const talamo = new T.Mesh(new T.SphereGeometry(0.4, 20, 16),
        new T.MeshStandardMaterial({ color: 0xc9a3a4, roughness: 0.85 }));
      talamo.position.set(0, -0.22, 0.05);
      g.add(talamo);
      // Cerebelo, detrás y abajo.
      const cerebelo = new T.Mesh(new T.SphereGeometry(0.62, 24, 18), SUST);
      cerebelo.position.set(0, -1.05, -0.72);
      cerebelo.scale.set(1.28, 0.76, 0.9);
      g.add(cerebelo);
      // Tronco encefálico: mesencéfalo, puente y bulbo, en fila.
      const tallo = new T.Mesh(new T.CylinderGeometry(0.22, 0.3, 1.5, 18),
        new T.MeshStandardMaterial({ color: 0xd0a0a0, roughness: 0.8 }));
      tallo.position.set(0, -1.15, -0.18);
      g.add(tallo);
      return g;
    },
  },

  vertebra: {
    label: "Vértebra",
    hint: "Cuerpo, apófisis y canal medular",
    build(T) {
      const g = new T.Group();
      const HUESO = new T.MeshStandardMaterial({ color: 0xece2cc, roughness: 0.87 });
      const CART = new T.MeshStandardMaterial({ color: 0xb9c9a8, roughness: 0.6 });
      // v2.38.18 — el cuerpo vertebronal es un cilindro, y lo que
      // distingue una vértebra lumbar de una cervical es el TAMAÑO de
      // ese cilindro respecto al arco. Además, el disco está FUERA:
      // es de otra vértebra, no de esta.
      const cuerpo = new T.Mesh(new T.CylinderGeometry(0.92, 0.9, 0.72, 30), HUESO);
      cuerpo.rotation.x = Math.PI / 2;
      cuerpo.position.z = 0.5;
      g.add(cuerpo);
      // Caras articulares superior e inferior.
      for (const z of [0.86, 0.14]) {
        const cara = new T.Mesh(new T.CylinderGeometry(0.86, 0.86, 0.09, 30), CART);
        cara.rotation.x = Math.PI / 2;
        cara.position.z = z;
        g.add(cara);
      }
      // Pedículos: los dos cuellos que unen cuerpo y arco.
      for (const side of [-1, 1]) {
        const ped = new T.Mesh(new T.BoxGeometry(0.3, 0.42, 0.42), HUESO);
        ped.position.set(side * 0.66, 0, -0.08);
        g.add(ped);
      }
      // Láminas: cierran el arco por detrás.
      for (const side of [-1, 1]) {
        const lam = new T.Mesh(new T.BoxGeometry(0.36, 0.5, 0.4), HUESO);
        lam.position.set(side * 0.5, -0.16, -0.52);
        lam.rotation.y = side * 0.42;
        g.add(lam);
      }
      // Apófisis espinosa: la punta de atrás, en la línea media.
      const espina = new T.Mesh(new T.BoxGeometry(0.2, 0.9, 0.34), HUESO);
      espina.position.set(0, -0.4, -0.86);
      espina.rotation.x = -0.34;
      g.add(espina);
      // Apófisis transversas: las dos alas laterales.
      for (const side of [-1, 1]) {
        const tr = new T.Mesh(new T.BoxGeometry(0.66, 0.16, 0.26), HUESO);
        tr.position.set(side * 0.94, -0.06, -0.2);
        tr.rotation.z = side * -0.16;
        g.add(tr);
        const artic = new T.Mesh(new T.BoxGeometry(0.24, 0.28, 0.26), CART);
        artic.position.set(side * 1.24, -0.12, -0.16);
        g.add(artic);
      }
      // Médula: lo que pasa por el canal. Sin esto no se entiende para
      // qué está el hueco del centro.
      const medula = new T.Mesh(new T.CylinderGeometry(0.24, 0.24, 1.15, 20),
        new T.MeshStandardMaterial({ color: 0xf2e79a, roughness: 0.55 }));
      medula.rotation.x = Math.PI / 2;
      medula.position.z = -0.32;
      g.add(medula);
      // Las raíces, saliendo del canal.
      for (const side of [-1, 1]) {
        const raiz = new T.Mesh(new T.CylinderGeometry(0.07, 0.05, 0.7, 10),
          new T.MeshStandardMaterial({ color: 0xf0d98a, roughness: 0.5 }));
        raiz.position.set(side * 0.4, -0.2, -0.72);
        raiz.rotation.set(Math.PI / 2.4, 0, side * 0.7);
        g.add(raiz);
      }
      return g;
    },
  },

  hueso: {
    label: "Hueso largo",
    hint: "Epífisis, diáfisis, cortical y médula",
    build(T) {
      const g = new T.Group();
      const CORTICAL = new T.MeshStandardMaterial({ color: 0xf0e7d2, roughness: 0.88 });
      const ESPONJOSO = new T.MeshStandardMaterial({ color: 0xe3d5b4, roughness: 0.95 });
      const MEDULA = new T.MeshStandardMaterial({ color: 0xc26a6a, roughness: 0.75 });
      // v2.38.18 — el hueso largo tiene tres partes que se nombran por
      // separado: epífisis (los extremos), metafisis (la transición) y
      // diáfisis (el cuerpo). Aquí se ven las tres, y dentro, la
      // cortical por fuera y la médula por dentro.
      const diafisis = new T.Mesh(new T.CylinderGeometry(0.42, 0.38, 2.5, 28), CORTICAL);
      g.add(diafisis);
      for (const [y, r, sy] of [[1.62, 0.86, 0.62], [-1.62, 0.86, 0.62]]) {
        const epi = new T.Mesh(new T.SphereGeometry(r, 30, 24), ESPONJOSO);
        epi.position.y = y; epi.scale.set(1, sy, 0.94);
        g.add(epi);
        // La placa de crecimiento: la línea donde el hueso sigue
        // creciendo. En un niño es cartilago, en un adulto una línea.
        const placa = new T.Mesh(new T.CylinderGeometry(r * 0.62, r * 0.62, 0.1, 24),
          new T.MeshStandardMaterial({ color: 0xb9c9a8, roughness: 0.6 }));
        placa.position.y = y - sy * r * 0.62;
        g.add(placa);
        // Cóndilos.
        for (const side of [-1, 1]) {
          const con = new T.Mesh(new T.SphereGeometry(0.34, 20, 16), ESPONJOSO);
          con.position.set(side * 0.34, y + sy * r * 0.62, 0);
          con.scale.set(0.9, 0.62, 0.9);
          g.add(con);
        }
        // La apófisis, si es una tibia.
        const apo = new T.Mesh(new T.BoxGeometry(0.3, 0.3, 0.24), ESPONJOSO);
        apo.position.set(0, y + sy * r * 0.4, -0.38);
        g.add(apo);
      }
      // Médula: solo en la diáfisis, y solo por dentro.
      const medula = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 2.4, 20), MEDULA);
      g.add(medula);
      // Periostio: la película que envuelve el hueso. Sin ella el
      // hueso parece de plástico.
      const periostio = new T.Mesh(new T.CylinderGeometry(0.46, 0.42, 2.62, 28, 1, true),
        new T.MeshStandardMaterial({ color: 0xe8d3b4, roughness: 0.7, side: T.DoubleSide }));
      g.add(periostio);
      return g;
    },
  },
};


export const MODEL_IDS = Object.keys(MODELOS);

/* ── estilos ─────────────────────────────────────────────────── */
const CSS = `
.m3d { display:grid; gap:.5rem; }
.m3d-stage { position:relative; aspect-ratio:4/3; max-height:min(52vh,420px); border-radius:14px; overflow:hidden;
  background:radial-gradient(120% 90% at 50% 0%,#1d2130 0%,#0e1118 70%); touch-action:none; }
.m3d-stage canvas { max-height:min(52vh,420px); }
.m3d-stage canvas { display:block; width:100%; height:100%; }
.m3d-stage { overflow:hidden; }
.m3d-hint { position:absolute; left:10px; bottom:10px; font-size:.72rem; color:#9aa3b8;
  background:rgba(0,0,0,.5); padding:.22rem .5rem; border-radius:999px; pointer-events:none; }
.m3d-tools { position:absolute; right:8px; top:8px; display:flex; gap:.25rem; }
.m3d-tools button { width:36px; height:36px; border-radius:10px; border:1px solid rgba(255,255,255,.14);
  background:rgba(16,20,30,.78); color:#e7e9f0; display:grid; place-items:center; cursor:pointer; font-size:1rem; }
.m3d-tools button[aria-pressed="true"] { background:var(--accent,#7c5cff); border-color:transparent; }
.m3d-pin { position:absolute; transform:translate(-50%,-50%); display:flex; align-items:center; gap:.3rem;
  pointer-events:none; z-index:2; }
.m3d-dot { width:11px; height:11px; border-radius:50%; background:#ffd166; border:2px solid #0e1118;
  box-shadow:0 0 0 2px rgba(255,209,102,.35); flex:none; }
.m3d-name { font-size:.72rem; color:#f3f4f8; background:rgba(12,15,22,.82); padding:.14rem .44rem;
  border-radius:7px; white-space:nowrap; border:1px solid rgba(255,255,255,.12); }
.m3d-occ { position:absolute; border-radius:5px; border:2px solid var(--accent,#7c5cff);
  background:rgba(124,92,255,.34); cursor:pointer; z-index:3; }
.m3d-occ::after { content:"?"; position:absolute; inset:0; display:grid; place-items:center;
  color:#fff; font-weight:700; font-size:.85rem; }
.m3d-occ--tap { display:none; }
.m3d-occ--tapped { background:rgba(255,209,102,.45); border-color:#ffd166; }
.m3d-occ--tapped::after { content:"✓"; }
.m3d-bar { display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; }
.m3d-bar select { flex:1; min-width:8rem; }
.m3d-foot { font-size:.76rem; color:var(--fg-muted); }
.m3d-empty { display:grid; place-items:center; min-height:180px; text-align:center; padding:1rem;
  color:var(--fg-muted); gap:.4rem; }
.m3d-input { position:absolute; z-index:5; width:min(220px,60%); }
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const el = document.createElement("style");
  el.id = "model3d-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}

/**
 * Monta un bloque 3D.
 *
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string} [opts.modelId]  clave de MODELOS
 * @param {string} [opts.modelUrl]  un .glb propio
 * @param {Array}  [opts.labels]    [{ id, x, y, z, text }]
 * @param {Array}  [opts.occlusions] [{ id, x, y, z, w, h, answer }]
 * @param {Function} [opts.onChange] se llama al anadir o quitar algo
 */
export async function mountModel3D(host, opts = {}) {
  injectStyles();
  const state = {
    modelId: opts.modelId || "corazon",
    // Un .glb del usuario. No se guarda en la nota — pesa —; vive en
    // la sesión. Si quieres que persista, se sube a tus ficheros.
    modelUrl: opts.modelUrl || null,
    credit: opts.credit || "",
    labels: [...(opts.labels || [])],
    occlusions: [...(opts.occlusions || [])],
    onChange: opts.onChange || (() => {}),
  };

  host.classList.add("m3d");
  host.innerHTML = `
    <div class="m3d-bar">
      <select class="m3d-pick" aria-label="Modelo">
        ${MODEL_IDS.map((k) => `<option value="${k}"${k === state.modelId ? " selected" : ""}>${escapeHtml(MODELOS[k].label)}</option>`).join("")}
      </select>
      <button class="btn ghost m3d-label-btn" type="button" title="Poner una etiqueta sobre el modelo">🏷 Etiquetar</button>
      <button class="btn ghost m3d-occ-btn" type="button" title="Tapar una zona para jugar">▮ Ocluir</button>
      <button class="btn ghost m3d-open-btn" type="button"
        title="Abrir un modelo 3D tuyo (.glb)">📂 Abrir .glb</button>
      <input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden data-file>
    </div>
    <div class="m3d-stage">
      <div class="m3d-tools">
        <button type="button" data-act="reset" title="Centrar" aria-label="Centrar">⌂</button>
        <button type="button" data-act="spin" title="Girar solo" aria-label="Girar solo" aria-pressed="true">⟳</button>
      </div>
      <div class="m3d-hint">Arrastra para girar · toca una etiqueta para ver su texto</div>
    </div>
    <p class="m3d-foot"></p>
  `;

  const stage = host.querySelector(".m3d-stage");
  const foot = host.querySelector(".m3d-foot");
  const pick = host.querySelector(".m3d-pick");
  const labelBtn = host.querySelector(".m3d-label-btn");
  const occBtn = host.querySelector(".m3d-occ-btn");

  let THREE;
  try {
    THREE = await loadThree();
  } catch (e) {
    host.innerHTML = `<div class="m3d-empty">
      <div style="font-size:1.8rem">📦</div>
      <div>No se pudo cargar el visor 3D.</div>
      <div style="font-size:.75rem;opacity:.75">${escapeHtml(String(e.message || e))}</div>
    </div>`;
    return { destroy() {}, get state() { return state; } };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 100);
  camera.position.set(0, 0.4, 5.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(stage.clientWidth || 480, stage.clientHeight || 360, false);
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "Modelo 3D: arrastra para girar");

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fa2ff, 0.5);
  rim.position.set(-4, -2, -3);
  scene.add(rim);

  const holder = new THREE.Group();
  scene.add(holder);

  const ray = new THREE.Raycaster();
  const vec = new THREE.Vector3();
  let model = null;
  let rotY = 0.25, rotX = -0.12, autoSpin = true, alive = true;
  let mode = null;      // "label" | "occlusion" | null

  async function buildModel() {
    if (model) { holder.remove(model); model = null; }
    if (state.modelUrl) {
      foot.textContent = "Cargando el modelo…";
      const carga = await cargarGLB(state.modelUrl);
      if (carga) {
        model = carga;
        holder.add(model);
        rotY = 0.25; rotX = -0.12;
        encuadrar();
        paint();
        foot.textContent = state.credit
          ? `Modelo propio — ${state.credit}`
          : "Modelo propio. Si lo usas para estudiar y es de terceros, la licencia va con él.";
        return;
      }
    }
    const def = MODELOS[state.modelId];
    model = def ? def.build(THREE) : MODELOS.corazon.build(THREE);
    holder.add(model);
    rotY = 0.25; rotX = -0.12;
    // Si veníamos con un archivo y no se pudo abrir, se dice aquí y no
    // antes: antes el aviso se pisaba con el nombre del modelo de
    // ejemplo, y el fallo desaparecía de la pantalla.
    foot.textContent = fallo
      ? `⚠ No se pudo abrir tu archivo (${fallo}). Se muestra "${def.label}" de ejemplo.`
      : `${def.label} — ${def.hint}`;
    encuadrar();
    paint();
  }

  /**
   * Un .glb o .gltf, venga de un archivo local o de una URL.
   *
   * v2.38.19 — el fallo se guarda y se MUESTRA. Antes se tragaba el
   * error y caía de vuelta al modelo de ejemplo sin decir por qué, y
   * el pie decía "Corazón": tu archivo no se había abierto, y la
   * pantallaemblaba estar bien.
   */
  let fallo = null;
  async function cargarGLB(url) {
    const GLTFLoader = await loadGltfLoader();
    if (!GLTFLoader) { fallo = "no se pudo cargar el lector de .glb"; return null; }
    const loader = new GLTFLoader();
    try {
      const g = await new Promise((ok, ko) => loader.load(url, ok, undefined, ko));
      if (!g || !g.scene) { fallo = "el archivo no trae escena"; return null; }
      fallo = null;
      return g.scene;
    } catch (e) {
      fallo = String((e && e.message) || e).slice(0, 120);
      return null;
    }
  }

  /**
   * Encuadra el modelo, venga del tamaño que venga.
   *
   * v2.38.18 — la cámara estaba a una distancia fija, puesta a ojo. Al
   * agrandar los modelos, el corazón se salía por los cuatro lados:
   * se veía unChunks de ventrículo y nada más. Ahora se mide la
   * esfera envolvente y se calcula la distancia que hace que quepa
   * entera. El margen es de 0.94 a propósito: la esfera incluye los
   * extremos de los vasos, que no ocupan nada de pantalla en su
   * mayoría, y con un margen holgado el modelo salía diminuto
   * centrado en un cuadro vacío. Un pelo de recorte en las puntas
   * entra en el presupuesto; un modelo pequeño no se ve.
   */
  function encuadrar(margen = 0.94) {
    if (!model) return;
    const caja = new THREE.Box3().setFromObject(model);
    if (caja.isEmpty()) return;
    const esfera = caja.getBoundingSphere(new THREE.Sphere());
    // Mitad del ángulo vertical y mitad del HORIZONTAL. El horizontal
    // no es `aspect * fov`: sale de la tangente. Con la fórmula mala el
    // modelo salía a la mitad de la pantalla, porque la distancia se
    // calculaba como si la escena fuese mucho más ancha de lo que es.
    const fovV = (camera.fov * Math.PI) / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
    const distV = esfera.radius / Math.sin(fovV / 2);
    const distH = esfera.radius / Math.sin(fovH / 2);
    const d = Math.max(distV, distH) * margen;
    // El grupo se desplaza para que el centro del modelo quede en el
    // origen. A partir de ahí la cámara mira al ORIGEN, no al centro
    // antigo: si no, el recentrado y la cámara se contradicen y el
    // modelo queda descentrado.
    holder.position.set(-esfera.center.x, -esfera.center.y, -esfera.center.z);
    camera.position.set(0, esfera.radius * 0.06, d);
    camera.near = Math.max(0.05, d - esfera.radius * 3);
    camera.far = d + esfera.radius * 6;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  /** Un punto de la pantalla → coordenadas del modelo. */
  function toModel(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    ), camera);
    if (model) {
      const hits = ray.intersectObject(model, true);
      if (hits.length) return model.worldToLocal(hits[0].point.clone());
    }
    const plane = new THREE.Plane(camera.getWorldDirection(new THREE.Vector3()).negate(), 0);
    const out = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, out)) return model ? model.worldToLocal(out) : out;
    return null;
  }

  /** Proyecta un punto del modelo a la pantalla. */
  function toScreen(x, y, z) {
    vec.set(x, y, z);
    if (model) model.localToWorld(vec);
    vec.project(camera);
    return {
      x: (vec.x * 0.5 + 0.5) * 100,
      y: (-vec.y * 0.5 + 0.5) * 100,
      visible: vec.z < 1,
    };
  }

  /* ── etiquetas y oclusiones, en coordenadas del modelo ───────── */
  function paint() {
    stage.querySelectorAll(".m3d-pin, .m3d-occ").forEach((n) => n.remove());
    for (const l of state.labels) {
      const p = toScreen(l.x, l.y, l.z);
      if (!p.visible) continue;
      const el = document.createElement("div");
      el.className = "m3d-pin";
      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
      el.innerHTML = `<span class="m3d-dot"></span><span class="m3d-name">${escapeHtml(l.text)}</span>`;
      stage.appendChild(el);
    }
    for (const o of state.occlusions) {
      const p = toScreen(o.x, o.y, o.z);
      if (!p.visible) continue;
      const el = document.createElement("div");
      el.className = "m3d-occ" + (o.tapped ? " m3d-occ--tapped" : "");
      // El tamaño va en porcentaje de la escena: sigue siendo la misma
      // estructura tapada al cambiar el tamaño de la pantalla.
      el.style.left = `${p.x - (o.w || 0.14) * 50}%`;
      el.style.top = `${p.y - (o.h || 0.1) * 50}%`;
      el.style.width = `${(o.w || 0.14) * 100}%`;
      el.style.height = `${(o.h || 0.1) * 100}%`;
      el.title = o.answer || "Toca para ver la respuesta";
      el.addEventListener("pointerup", (ev) => {
        ev.stopPropagation();
        o.tapped = !o.tapped;
        el.classList.toggle("m3d-occ--tapped", !!o.tapped);
        state.onChange(state);
      });
      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        if (ev.shiftKey) {
          state.occlusions = state.occlusions.filter((x) => x.id !== o.id);
          paint();
          state.onChange(state);
        }
      });
      stage.appendChild(el);
    }
  }

  /* ── gesto: girar ────────────────────────────────────────────── */
  let dragging = null;
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    dragging = { x: ev.clientX, y: ev.clientY, moved: 0 };
    autoSpin = false;
    renderer.domElement.setPointerCapture?.(ev.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - dragging.x, dy = ev.clientY - dragging.y;
    dragging.moved += Math.abs(dx) + Math.abs(dy);
    rotY += dx * 0.008;
    rotX = Math.max(-1.2, Math.min(1.2, rotX + dy * 0.006));
    dragging.x = ev.clientX; dragging.y = ev.clientY;
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    const wasDrag = dragging && dragging.moved > 6;
    dragging = null;
    if (wasDrag || !mode) return;
    const local = toModel(ev.clientX, ev.clientY);
    if (!local) return;
    if (mode === "label") askLabel(local);
    else if (mode === "occlusion") {
      state.occlusions.push({
        id: "o-" + Math.random().toString(36).slice(2, 9),
        x: +local.x.toFixed(4), y: +local.y.toFixed(4), z: +local.z.toFixed(4),
        w: 0.16, h: 0.12, answer: "", tapped: false,
      });
      paint();
      state.onChange(state);
    }
  });

  /**
   * La etiqueta se escribe aqui mismo.
   *
   * v2.38.16 — esto era un `prompt()`. El dialogo del navegador no se
   * se puede estilizar, sale en ingles, y en iOS abre el teclado del
   * sistema tapando el modelo entero. Un input flotante, en el
   * punto que has tocado, resuelto en un momento.
   */
  function askLabel(local) {
    const p = toScreen(local.x, local.y, local.z);
    const box = document.createElement("input");
    box.className = "m3d-input";
    box.placeholder = "Nombre de la estructura";
    box.setAttribute("aria-label", "Nombre de la estructura");
    box.style.left = `min(max(${p.x}%, 4%), 60%)`;
    box.style.top = `${Math.min(p.y, 70)}%`;
    stage.appendChild(box);
    box.focus();
    const close = () => box.remove();
    box.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") commit();
      if (ev.key === "Escape") cerrar();
      ev.stopPropagation();
    });
    box.addEventListener("blur", commit, { once: true });
    // v2.38.16 — Enter dispara commit(), que hace blur, que dispara
    // commit() otra vez: dos remove() del mismo nodo y un NotFoundError
    // en consola. Una bandera y se cierra una vez.
    let cerrado = false;
    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      box.remove();
    }
    function commit() {
      if (cerrado) return;
      const text = box.value.trim();
      if (!text) { cerrar(); return; }
      state.labels.push({
        id: "l-" + Math.random().toString(36).slice(2, 9),
        x: +local.x.toFixed(4), y: +local.y.toFixed(4), z: +local.z.toFixed(4),
        text,
      });
      cerrar();
      paint();
      state.onChange(state);
    }
  }

  /* ── barra ───────────────────────────────────────────────────── */
  pick.addEventListener("change", () => {
    state.modelId = pick.value;
    // Volver a la lista de modelos deja el archivo propio.
    state.modelUrl = null;
    state.credit = "";
    buildModel();
    state.onChange(state);
  });
  labelBtn.addEventListener("click", () => {
    mode = mode === "label" ? null : "label";
    labelBtn.setAttribute("aria-pressed", String(mode === "label"));
    occBtn.setAttribute("aria-pressed", String(mode === "occlusion"));
  });
  occBtn.addEventListener("click", () => {
    mode = mode === "occlusion" ? null : "occlusion";
    occBtn.setAttribute("aria-pressed", String(mode === "occlusion"));
    labelBtn.setAttribute("aria-pressed", String(mode === "label"));
  });
  const openBtn = host.querySelector(".m3d-open-btn");
  const fileInput = host.querySelector("[data-file]");
  openBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    // El crédito no se inventa: se lee del nombre del archivo y se
    // puede cambiar. La licencia de un modelo ajeno es de quien lo
    // tenga, y el sitio de la app tiene que poder mostrarla.
    state.credit = f.name.replace(/\.glt?f$/i, "");
    state.modelUrl = url;
    await buildModel();
    state.onChange(state);
  });

  host.querySelector('[data-act="reset"]').addEventListener("click", () => {
    rotY = 0.25; rotX = -0.12; paint();
  });
  host.querySelector('[data-act="spin"]').addEventListener("click", (ev) => {
    autoSpin = !autoSpin;
    ev.currentTarget.setAttribute("aria-pressed", String(autoSpin));
  });

  function resize() {
    // clientHeight con el max-height puesto: sin esto el lienzo se
    // dibuja a la altura de aspect-ratio y se sale del bloque.
    const w = stage.clientWidth || 480;
    const h = stage.clientHeight || Math.round(w * 0.68);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    encuadrar();
    paint();
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(stage);

  function loop() {
    if (!alive) return;
    requestAnimationFrame(loop);
    if (autoSpin && !dragging) rotY += 0.0035;
    holder.rotation.y = rotY;
    holder.rotation.x = rotX;
    renderer.render(scene, camera);
    if (autoSpin) paint();      // las etiquetas giran con el modelo
  }

  resize();
  await buildModel();
  loop();

  return {
    get state() { return state; },
    destroy() {
      alive = false;
      ro?.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
