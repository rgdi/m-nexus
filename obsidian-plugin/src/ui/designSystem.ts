// v0.28: Design System unificado para M-NEXUS.
//
// Principios:
//   1. Eye-friendly: contraste suficiente, sin colores chillones
//   2. Intuitivo: jerarquía clara, copy consistente, sin emojis redundantes
//   3. Cero curva de aprendizaje: tooltips, onboarding contextual
//   4. Ahorra tiempo: shortcuts, acciones en 1 click, defaults sensatos
//   5. Responsive: mobile-first, adaptable
//
// Tokens:
//   - Espaciado: múltiplos de 4 (0, 4, 8, 12, 16, 24, 32, 48)
//   - Tipografía: 11 (caption), 13 (body-sm), 14 (body), 16 (h3), 20 (h2), 28 (h1)
//   - Radios: 4 (sm), 6 (md), 8 (lg), 12 (xl)
//   - Sombras: 3 niveles (sm, md, lg)
//   - Colores: paleta semántica (success, warning, error, info, neutral)

// ── Espaciado ────────────────────────────────────────────
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

// ── Tipografía ───────────────────────────────────────────
export const FONT_SIZE = {
  caption: 11,
  bodySm: 13,
  body: 14,
  h3: 16,
  h2: 20,
  h1: 28,
  display: 36,
} as const;

export const FONT_WEIGHT = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const LINE_HEIGHT = {
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.7,
} as const;

// ── Radios ───────────────────────────────────────────────
export const RADIUS = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  pill: 999,
} as const;

// ── Sombras (eye-friendly, no agresivas) ─────────────────
export const SHADOW = {
  sm: "0 1px 2px rgba(0,0,0,0.06)",
  md: "0 2px 6px rgba(0,0,0,0.08)",
  lg: "0 4px 16px rgba(0,0,0,0.12)",
} as const;

// ── Colores semánticos (basados en CSS vars de Obsidian) ─
export const COLOR = {
  // Estados
  success: "var(--text-success)",
  successBg: "var(--background-modifier-success)",
  warning: "var(--text-warning)",
  warningBg: "var(--background-modifier-warning)",
  error: "var(--text-error)",
  errorBg: "var(--background-modifier-error)",
  info: "var(--text-accent)",
  infoBg: "var(--background-modifier-accent)",

  // UI base
  text: "var(--text-normal)",
  textMuted: "var(--text-muted)",
  textFaint: "var(--text-faint)",
  textOnAccent: "var(--text-on-accent)",
  bg: "var(--background-primary)",
  bgSecondary: "var(--background-secondary)",
  border: "var(--background-modifier-border)",
  borderHover: "var(--background-modifier-border-hover)",
  accent: "var(--interactive-accent)",
  accentHover: "var(--interactive-accent-hover)",
} as const;

// ── Transiciones (suaves, no mareantes) ──────────────────
export const TRANSITION = {
  fast: "120ms ease-out",
  normal: "200ms ease-out",
  slow: "320ms ease-out",
} as const;

// ── Z-index ──────────────────────────────────────────────
export const Z_INDEX = {
  base: 0,
  dropdown: 10,
  sticky: 100,
  modal: 1000,
  tooltip: 2000,
  toast: 3000,
} as const;

// ── Tamaños de elementos clickeables (mobile-friendly) ───
export const TAP_TARGET = {
  min: 36, // WCAG mínimo
  comfortable: 44, // iOS HIG
  spacious: 48,
} as const;

// ── Iconos semánticos (sustituyen a emojis redundantes) ──
// Solo usamos emojis cuando añaden valor semántico
export const ICON = {
  // Acciones
  approve: "✓",
  reject: "✕",
  apply: "▶",
  run: "▶",
  edit: "✎",
  delete: "🗑",
  close: "✕",
  back: "←",
  next: "→",
  more: "⋯",
  expand: "▾",
  collapse: "▴",

  // Estados
  success: "✓",
  error: "!",
  warning: "⚠",
  info: "i",
  pending: "○",
  loading: "◐",

  // Categorías (cuando aportan valor)
  flashcard: "▤",
  note: "▢",
  exam: "◉",
  class: "◎",
  audio: "♪",
  image: "▣",

  // Knowledge graph
  definition: "📖",
  symptom: "🩺",
  treatment: "💊",
  diagnosis: "🔬",
} as const;

// ── Helpers: aplicar tokens de manera consistente ────────

/** Aplica estilos de botón primario. */
export function primaryButton(el: HTMLElement): HTMLElement {
  Object.assign(el.style, {
    padding: `${SPACING.sm}px ${SPACING.lg}px`,
    minHeight: `${TAP_TARGET.min}px`,
    background: COLOR.accent,
    color: COLOR.textOnAccent,
    border: "none",
    borderRadius: `${RADIUS.md}px`,
    fontSize: `${FONT_SIZE.body}px`,
    fontWeight: FONT_WEIGHT.medium,
    cursor: "pointer",
    transition: TRANSITION.fast,
  } as unknown as Partial<CSSStyleDeclaration>);
  return el;
}

/** Aplica estilos de botón secundario. */
export function secondaryButton(el: HTMLElement): HTMLElement {
  Object.assign(el.style, {
    padding: `${SPACING.xs}px ${SPACING.md}px`,
    minHeight: `${TAP_TARGET.min}px`,
    background: COLOR.bg,
    color: COLOR.text,
    border: `1px solid ${COLOR.border}`,
    borderRadius: `${RADIUS.md}px`,
    fontSize: `${FONT_SIZE.bodySm}px`,
    fontWeight: FONT_WEIGHT.normal,
    cursor: "pointer",
    transition: TRANSITION.fast,
  } as unknown as Partial<CSSStyleDeclaration>);
  return el;
}

/** Aplica estilos de botón ghost (solo icono, minimal). */
export function ghostButton(el: HTMLElement): HTMLElement {
  Object.assign(el.style, {
    padding: `${SPACING.xs}px`,
    minWidth: `${TAP_TARGET.min}px`,
    minHeight: `${TAP_TARGET.min}px`,
    background: "transparent",
    color: COLOR.textMuted,
    border: "none",
    borderRadius: `${RADIUS.sm}px`,
    cursor: "pointer",
    transition: TRANSITION.fast,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  } as unknown as Partial<CSSStyleDeclaration>);
  return el;
}

/** Aplica estilos de tarjeta (card). */
export function card(el: HTMLElement, interactive: boolean = false): HTMLElement {
  Object.assign(el.style, {
    padding: `${SPACING.lg}px`,
    background: COLOR.bg,
    border: `1px solid ${COLOR.border}`,
    borderRadius: `${RADIUS.lg}px`,
    boxShadow: SHADOW.sm,
    transition: interactive ? TRANSITION.fast : "none",
    cursor: interactive ? "pointer" : "default",
  } as unknown as Partial<CSSStyleDeclaration>);
  if (interactive) {
    el.addEventListener("mouseenter", () => {
      el.style.borderColor = COLOR.borderHover;
      el.style.boxShadow = SHADOW.md;
    });
    el.addEventListener("mouseleave", () => {
      el.style.borderColor = COLOR.border;
      el.style.boxShadow = SHADOW.sm;
    });
  }
  return el;
}

/** Aplica estilos de badge (estado). */
export function badge(el: HTMLElement, variant: "success" | "warning" | "error" | "info" | "neutral" = "neutral"): HTMLElement {
  const colors = {
    success: { bg: COLOR.successBg, fg: COLOR.success },
    warning: { bg: COLOR.warningBg, fg: COLOR.warning },
    error: { bg: COLOR.errorBg, fg: COLOR.error },
    info: { bg: COLOR.infoBg, fg: COLOR.info },
    neutral: { bg: COLOR.bgSecondary, fg: COLOR.textMuted },
  }[variant];
  Object.assign(el.style, {
    padding: `2px ${SPACING.sm}px`,
    background: colors.bg,
    color: colors.fg,
    borderRadius: `${RADIUS.pill}px`,
    fontSize: `${FONT_SIZE.caption}px`,
    fontWeight: FONT_WEIGHT.medium,
    display: "inline-block",
    lineHeight: "1.4",
  } as unknown as Partial<CSSStyleDeclaration>);
  return el;
}

/** Aplica estilos de input. */
export function input(el: HTMLElement): HTMLElement {
  Object.assign(el.style, {
    padding: `${SPACING.sm}px ${SPACING.md}px`,
    minHeight: `${TAP_TARGET.min}px`,
    background: COLOR.bg,
    color: COLOR.text,
    border: `1px solid ${COLOR.border}`,
    borderRadius: `${RADIUS.md}px`,
    fontSize: `${FONT_SIZE.body}px`,
    outline: "none",
    transition: TRANSITION.fast,
  } as unknown as Partial<CSSStyleDeclaration>);
  el.addEventListener("focus", () => {
    el.style.borderColor = COLOR.accent;
  });
  el.addEventListener("blur", () => {
    el.style.borderColor = COLOR.border;
  });
  return el;
}

/** Aplica estilos de título. */
export function title(el: HTMLElement, level: 1 | 2 | 3 = 2): HTMLElement {
  const sizes = { 1: FONT_SIZE.h1, 2: FONT_SIZE.h2, 3: FONT_SIZE.h3 };
  Object.assign(el.style, {
    margin: "0",
    fontSize: `${sizes[level]}px`,
    fontWeight: FONT_WEIGHT.semibold,
    lineHeight: `${LINE_HEIGHT.tight}`,
    color: COLOR.text,
  } as unknown as Partial<CSSStyleDeclaration>);
  return el;
}

/** Crea un separador visual sutil. */
export function separator(parent: HTMLElement): HTMLElement {
  const sep = parent.createDiv({ cls: "mnexus-separator" });
  sep.style.cssText = `height:1px;background:${COLOR.border};margin:${SPACING.md}px 0;`;
  return sep;
}

/** Crea un tooltip que aparece al hacer hover/focus. */
export function attachTooltip(el: HTMLElement, text: string, shortcut?: string): void {
  const fullText = shortcut ? `${text} (${shortcut})` : text;
  el.setAttribute("aria-label", fullText);
  el.setAttribute("title", fullText);
}

/** Stack vertical con espaciado consistente. */
export function stack(parent: HTMLElement, gap: keyof typeof SPACING = "md"): HTMLElement {
  const s = parent.createDiv({ cls: "mnexus-stack" });
  s.style.cssText = `display:flex;flex-direction:column;gap:${SPACING[gap]}px;`;
  return s;
}

/** Cluster horizontal con espaciado consistente. */
export function cluster(parent: HTMLElement, gap: keyof typeof SPACING = "sm", wrap: boolean = true): HTMLElement {
  const c = parent.createDiv({ cls: "mnexus-cluster" });
  c.style.cssText = `display:flex;flex-direction:row;gap:${SPACING[gap]}px;align-items:center;${wrap ? "flex-wrap:wrap;" : ""}`;
  return c;
}

/** Mensaje vacío (sin contenido). */
export function emptyState(parent: HTMLElement, message: string, hint?: string): HTMLElement {
  const empty = parent.createDiv({ cls: "mnexus-empty-state" });
  empty.style.cssText = `text-align:center;padding:${SPACING.xxxl}px ${SPACING.lg}px;color:${COLOR.textMuted};`;
  const msg = empty.createDiv();
  msg.style.cssText = `font-size:${FONT_SIZE.body}px;margin-bottom:${SPACING.xs}px;`;
  msg.textContent = message;
  if (hint) {
    const h = empty.createDiv();
    h.style.cssText = `font-size:${FONT_SIZE.caption}px;color:${COLOR.textFaint};`;
    h.textContent = hint;
  }
  return empty;
}

/** Spinner de carga. */
export function spinner(parent: HTMLElement, size: number = 16): HTMLElement {
  const s = parent.createDiv({ cls: "mnexus-spinner" });
  s.style.cssText = `
    width:${size}px;
    height:${size}px;
    border:2px solid ${COLOR.border};
    border-top-color:${COLOR.accent};
    border-radius:50%;
    animation:mnexus-spin 0.8s linear infinite;
    display:inline-block;
  `;
  return s;
}

/** Toast (notice) con estilos consistentes. */
export function toast(message: string, variant: "success" | "error" | "info" = "info"): void {
  // Delegamos al Notice de Obsidian, pero podríamos crear uno custom
  // Por ahora usamos prefix semántico
  const prefix = variant === "success" ? "✓" : variant === "error" ? "!" : "i";
  // eslint-disable-next-line no-console
  console.log(`[mnexus ${prefix}] ${message}`);
}
