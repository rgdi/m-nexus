// Device detector (v0.37).
//
// Detecta si el plugin está corriendo en:
//   - "mobile"  (phone, pantalla < 600px, touch-first)
//   - "tablet"  (tablet, pantalla 600-1024px, touch)
//   - "desktop" (PC, pantalla >= 1024px, mouse-first)
//
// Combina 3 señales para tomar la decisión:
//   1) Platform de Obsidian: isAndroidApp / isIosApp → al menos mobile
//   2) Ancho de ventana: window.innerWidth
//   3) Características del input: hover capability, pointer type
//
// La detección se actualiza en tiempo real si el usuario
// cambia el tamaño de la ventana o rota la pantalla.
//
// Esto permite que el plugin:
//   - En mobile: use layouts de 1 columna, botones grandes, menús compactos
//   - En tablet: use 2 columnas con espacio entre ellas
//   - En desktop: use 3+ columnas, sidebars, modales grandes
//
// El resultado se cachea en `device.type` (CSS class en <body>) y
// `device.profile` (objeto con flags individuales).

import { Platform } from "obsidian";

export type DeviceType = "mobile" | "tablet" | "desktop";

export interface DeviceProfile {
  type: DeviceType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouch: boolean;
  isHover: boolean;
  width: number;
  height: number;
  pixelRatio: number;
  isLandscape: boolean;
}

const MOBILE_MAX = 600;
const TABLET_MAX = 1024;

class DeviceDetector {
  private listeners: Set<(p: DeviceProfile) => void> = new Set();
  private _profile: DeviceProfile;

  constructor() {
    this._profile = this.detect();
    this.attach();
  }

  /** Devuelve el perfil actual (cacheado o recalculado). */
  profile(): DeviceProfile {
    return this._profile;
  }

  /** Tipo principal: "mobile" | "tablet" | "desktop". */
  type(): DeviceType {
    return this._profile.type;
  }

  /** Suscripción a cambios (resize, rotate). */
  subscribe(cb: (p: DeviceProfile) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Recalcula el perfil y notifica a los listeners. */
  refresh(): DeviceProfile {
    this._profile = this.detect();
    this.applyToDom(this._profile);
    this.listeners.forEach((cb) => {
      try { cb(this._profile); } catch (e) { /* ignore */ }
    });
    return this._profile;
  }

  private detect(): DeviceProfile {
    const w = typeof window !== "undefined" ? window.innerWidth : 1024;
    const h = typeof window !== "undefined" ? window.innerHeight : 768;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const isLandscape = w > h;

    // Señal 1: plataforma
    let platformMobile = false;
    let platformTablet = false;
    try {
      if (Platform.isAndroidApp || Platform.isIosApp) {
        platformMobile = true;
      }
    } catch { /* en tests */ }

    // Señal 2: características del input
    let isTouch = false;
    let isHover = true;
    if (typeof window !== "undefined") {
      try {
        // matchMedia('(hover: hover)') y '(pointer: coarse)' no siempre
        // están disponibles en el webview de Obsidian, pero intentamos.
        isHover = window.matchMedia?.("(hover: hover)").matches ?? true;
        isTouch = window.matchMedia?.("(pointer: coarse)").matches
          ?? (navigator.maxTouchPoints > 0);
      } catch {
        isTouch = navigator?.maxTouchPoints > 0;
        isHover = !isTouch;
      }
    }

    // Decisión
    let type: DeviceType;
    if (platformMobile) {
      // En Android/iOS, confiamos en la plataforma y usamos el ancho
      // para refinar mobile vs tablet.
      type = w >= TABLET_MAX ? "tablet" : (w >= MOBILE_MAX ? "tablet" : "mobile");
    } else {
      // En desktop, decidimos por ancho y características
      if (w < MOBILE_MAX) {
        // Pantalla muy chica: probablemente una ventana redimensionada
        type = "mobile";
      } else if (w < TABLET_MAX) {
        // Pantalla mediana
        type = isTouch && !isHover ? "tablet" : "desktop";
      } else {
        type = "desktop";
      }
    }

    return {
      type,
      isMobile: type === "mobile",
      isTablet: type === "tablet",
      isDesktop: type === "desktop",
      isTouch,
      isHover,
      width: w,
      height: h,
      pixelRatio: dpr,
      isLandscape,
    };
  }

  private attach(): void {
    if (typeof window === "undefined") return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (t) clearTimeout(t);
      // Debounce: evita refrescos excesivos durante drag
      t = setTimeout(() => this.refresh(), 150);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    // MatchMedia listener para cambios de hover/pointer
    try {
      const hoverMql = window.matchMedia?.("(hover: hover)");
      hoverMql?.addEventListener?.("change", onResize);
      const pointerMql = window.matchMedia?.("(pointer: coarse)");
      pointerMql?.addEventListener?.("change", onResize);
    } catch { /* ignore */ }
  }

  private applyToDom(p: DeviceProfile): void {
    if (typeof document === "undefined") return;
    // Aplicamos una clase al <body> para que el CSS pueda reaccionar
    const body = document.body;
    if (!body) return;
    body.classList.remove("mnexus-mobile", "mnexus-tablet", "mnexus-desktop");
    body.classList.add(`mnexus-${p.type}`);
    body.classList.toggle("mnexus-touch", p.isTouch);
    body.classList.toggle("mnexus-hover", p.isHover);
    body.classList.toggle("mnexus-landscape", p.isLandscape);
  }
}

// Singleton
export const device = new DeviceDetector();
