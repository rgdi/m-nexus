// themesService.ts: temas custom (CSS variables).
//
// v0.60 (P2.4): permite a usuarios crear/importar/exportar temas.
// Cada tema = nombre + JSON con {primary, secondary, bg, fg, accent, ...}.

import { randomUUID } from "node:crypto";

export interface ThemeColors {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  foreground: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  borderRadius: number; // px
  // v0.60: density (compact, normal, cozy)
  density: "compact" | "normal" | "cozy";
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  // v0.60: dark/light
  mode: "dark" | "light" | "auto";
  author: string;
  createdAt: number;
  builtin: boolean;
}

const BUILTIN_THEMES: Theme[] = [
  {
    id: "default-dark",
    name: "Default Dark",
    description: "Tema oscuro por defecto de M-NEXUS",
    mode: "dark",
    builtin: true,
    author: "M-NEXUS Team",
    createdAt: 0,
    colors: {
      primary: "#7C4DFF",
      secondary: "#03DAC6",
      background: "#121212",
      surface: "#1E1E1E",
      foreground: "#E1E1E1",
      accent: "#BB86FC",
      error: "#CF6679",
      warning: "#FFB74D",
      success: "#81C784",
      borderRadius: 8,
      density: "normal",
    },
  },
  {
    id: "default-light",
    name: "Default Light",
    description: "Tema claro por defecto",
    mode: "light",
    builtin: true,
    author: "M-NEXUS Team",
    createdAt: 0,
    colors: {
      primary: "#5E35B1",
      secondary: "#00897B",
      background: "#FAFAFA",
      surface: "#FFFFFF",
      foreground: "#212121",
      accent: "#7E57C2",
      error: "#D32F2F",
      warning: "#F57C00",
      success: "#388E3C",
      borderRadius: 8,
      density: "normal",
    },
  },
  {
    id: "solarized",
    name: "Solarized",
    description: "Paleta clasica de Solarized (Ethan Schoonover)",
    mode: "light",
    builtin: true,
    author: "M-NEXUS Team",
    createdAt: 0,
    colors: {
      primary: "#268BD2",
      secondary: "#2AA198",
      background: "#FDF6E3",
      surface: "#EEE8D5",
      foreground: "#586E75",
      accent: "#D33682",
      error: "#DC322F",
      warning: "#B58900",
      success: "#859900",
      borderRadius: 4,
      density: "cozy",
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    description: "Tema inspirado en Monokai (Sublime Text)",
    mode: "dark",
    builtin: true,
    author: "M-NEXUS Team",
    createdAt: 0,
    colors: {
      primary: "#F92672",
      secondary: "#A6E22E",
      background: "#272822",
      surface: "#3E3D32",
      foreground: "#F8F8F2",
      accent: "#FD971F",
      error: "#F92672",
      warning: "#E6DB74",
      success: "#A6E22E",
      borderRadius: 6,
      density: "normal",
    },
  },
];

class ThemesService {
  private themes: Theme[] = [...BUILTIN_THEMES];
  private activeId = "default-dark";

  list(includeBuiltin = true): Theme[] {
    return includeBuiltin ? [...this.themes] : this.themes.filter(t => !t.builtin);
  }

  get(id: string): Theme | undefined {
    return this.themes.find(t => t.id === id);
  }

  active(): Theme | undefined {
    return this.get(this.activeId);
  }

  setActive(id: string): boolean {
    if (!this.get(id)) return false;
    this.activeId = id;
    return true;
  }

  create(input: Omit<Theme, "id" | "createdAt" | "builtin">): Theme {
    const t: Theme = {
      ...input,
      id: `theme-${randomUUID()}`,
      builtin: false,
      createdAt: Date.now(),
    };
    this.themes.push(t);
    return t;
  }

  update(id: string, patch: Partial<Theme>): Theme | null {
    const t = this.get(id);
    if (!t || t.builtin) return null;
    Object.assign(t, patch);
    return t;
  }

  remove(id: string): boolean {
    const t = this.get(id);
    if (!t || t.builtin) return false;
    this.themes = this.themes.filter(x => x.id !== id);
    return true;
  }

  /// v0.60: genera CSS variables para usar en una webview.
  toCss(theme: Theme): string {
    const c = theme.colors;
    return `:root {
  --mnexus-primary: ${c.primary};
  --mnexus-secondary: ${c.secondary};
  --mnexus-bg: ${c.background};
  --mnexus-surface: ${c.surface};
  --mnexus-fg: ${c.foreground};
  --mnexus-accent: ${c.accent};
  --mnexus-error: ${c.error};
  --mnexus-warning: ${c.warning};
  --mnexus-success: ${c.success};
  --mnexus-radius: ${c.borderRadius}px;
  --mnexus-density: ${c.density === "compact" ? "0.85" : c.density === "cozy" ? "1.15" : "1.0"};
}`;
  }

  /// v0.60: exporta todos los temas user como JSON.
  exportUserThemes(): string {
    const user = this.themes.filter(t => !t.builtin);
    return JSON.stringify({ themes: user, version: 1 }, null, 2);
  }
}

let _instance: ThemesService | null = null;
export function getThemesService(): ThemesService {
  if (!_instance) _instance = new ThemesService();
  return _instance;
}
