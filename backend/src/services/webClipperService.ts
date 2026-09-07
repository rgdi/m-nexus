// webClipperService.ts: conversor HTML → Markdown (Fase 6).
//
// v0.46: extrae el contenido principal de una página web y lo convierte
// a Markdown listo para guardar como nota. Sin dependencias externas
// (no usamos Turndown para mantener 0 deps en el backend).
//
// Heurística: extrae <article>, <main>, o el div con más <p>.
// Elimina ads, navegación, scripts, estilos.

export interface ClipResult {
  /** URL original */
  url: string;
  /** Título extraído */
  title: string;
  /** Contenido en markdown */
  content: string;
  /** Excerpt / descripción */
  excerpt: string;
  /** Autor si se encontró */
  author?: string;
  /** Tags sugeridos */
  suggestedTags: string[];
  /** Imagen principal (og:image o primera <img>) */
  imageUrl?: string;
  /** Sitio (hostname) */
  site: string;
  /** Tiempo de clip (ms) */
  clippedAt: number;
}

export class WebClipperService {
  /**
   * Convierte HTML a Markdown.
   */
  static htmlToMarkdown(html: string, url?: string): ClipResult {
    // Extraer título
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const title = ogTitleMatch?.[1] ?? titleMatch?.[1] ?? "Sin título";

    // Extraer autor
    const authorMatch =
      html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i);
    const author = authorMatch?.[1];

    // Extraer descripción
    const descMatch =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const excerpt = descMatch?.[1] ?? "";

    // Extraer imagen principal
    const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const imageUrl = ogImageMatch?.[1];

    // Extraer contenido principal
    const mainHtml = WebClipperService.extractMainContent(html);
    const content = WebClipperService.htmlToMd(mainHtml);

    // Tags sugeridos
    const suggestedTags = WebClipperService.extractTags(html);

    // Site
    let site = "";
    if (url) {
      try {
        site = new URL(url).hostname;
      } catch {
        // ignore
      }
    }

    return {
      url: url ?? "",
      title: WebClipperService.decodeEntities(title),
      content,
      excerpt: WebClipperService.decodeEntities(excerpt),
      author: author ? WebClipperService.decodeEntities(author) : undefined,
      suggestedTags,
      imageUrl,
      site,
      clippedAt: Date.now(),
    };
  }

  /**
   * Extrae el contenido principal del HTML.
   * Estrategia: busca <article>, <main>, o el bloque con más <p>.
   */
  private static extractMainContent(html: string): string {
    // 1) Intentar <article>
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) return articleMatch[1];

    // 2) Intentar <main>
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) return mainMatch[1];

    // 3) Buscar el div con más <p>
    const divs = html.match(/<div[^>]*>[\s\S]*?<\/div>/gi) ?? [];
    let bestDiv = "";
    let maxP = 0;
    for (const d of divs) {
      const pCount = (d.match(/<p[\s>]/g) ?? []).length;
      if (pCount > maxP) {
        maxP = pCount;
        bestDiv = d;
      }
    }
    if (maxP >= 3) return bestDiv;

    // 4) Fallback: todo el body
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch?.[1] ?? html;
  }

  /**
   * Convierte HTML simple a Markdown.
   */
  private static htmlToMd(html: string): string {
    let md = html;

    // Eliminar scripts, estilos, comentarios
    md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
    md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
    md = md.replace(/<!--[\s\S]*?-->/g, "");

    // Eliminar atributos (excepto src, href, alt)
    md = md.replace(/<(\w+)([^>]*)>/g, (match, tag, attrs) => {
      const important = attrs.match(/(?:src|href|alt|title)=["'][^"']*["']/g) ?? [];
      if (important.length === 0) return `<${tag}>`;
      return `<${tag} ${important.join(" ")}>`;
    });

    // Headings
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n\n");
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n\n");
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n\n");
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n\n");
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n\n");
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n\n");

    // Bold / italic / code
    md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
    md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
    md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
    md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
    md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

    // Links
    md = md.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

    // Imágenes
    md = md.replace(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, "![$2]($1)");
    md = md.replace(/<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi, "![]($1)");

    // Párrafos y saltos
    md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n\n");
    md = md.replace(/<br\s*\/?>/gi, "\n");
    md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

    // Listas
    md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
    md = md.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");

    // Blockquote
    md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n\n");

    // Eliminar tags restantes
    md = md.replace(/<[^>]+>/g, "");

    // Decodificar entities
    md = WebClipperService.decodeEntities(md);

    // Limpiar whitespace
    md = md.replace(/\n{3,}/g, "\n\n").trim();

    return md;
  }

  /**
   * Decodifica HTML entities básicas.
   */
  static decodeEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&hellip;/g, "…")
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–")
      .replace(/&copy;/g, "©")
      .replace(/&reg;/g, "®")
      .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(n, 16)));
  }

  /**
   * Extrae tags sugeridas del HTML.
   * Toma de keywords meta, og:tags, y class names relevantes.
   */
  private static extractTags(html: string): string[] {
    const tags = new Set<string>();
    const kwMatch = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);
    if (kwMatch) {
      kwMatch[1].split(",").forEach((k) => {
        const clean = k.trim().toLowerCase().replace(/[^a-z0-9áéíóúñü-]/g, "");
        if (clean.length > 2) tags.add(clean);
      });
    }
    // De category og
    const catMatch = html.match(/<meta[^>]+property=["']article:section["'][^>]+content=["']([^"']+)["']/i);
    if (catMatch) tags.add(catMatch[1].toLowerCase().replace(/\s+/g, "-"));
    return Array.from(tags).slice(0, 10);
  }

  /**
   * Genera el frontmatter YAML para guardar el clip como nota.
   */
  static toFrontmatter(result: ClipResult): string {
    const lines = ["---"];
    lines.push(`title: "${result.title.replace(/"/g, '\\"')}"`);
    lines.push(`source: "${result.url}"`);
    if (result.author) lines.push(`author: "${result.author}"`);
    if (result.excerpt) lines.push(`excerpt: "${result.excerpt.replace(/"/g, '\\"')}"`);
    if (result.imageUrl) lines.push(`cover: "${result.imageUrl}"`);
    if (result.site) lines.push(`site: "${result.site}"`);
    lines.push(`clipped_at: ${new Date(result.clippedAt).toISOString()}`);
    if (result.suggestedTags.length > 0) {
      lines.push(`tags: [${result.suggestedTags.map((t) => `"${t}"`).join(", ")}]`);
    }
    lines.push("---");
    return lines.join("\n");
  }
}
