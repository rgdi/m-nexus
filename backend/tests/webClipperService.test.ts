// Tests para WebClipperService (Fase 6).

import { describe, it, expect } from "vitest";
import { WebClipperService } from "../src/services/webClipperService";

describe("WebClipperService.decodeEntities", () => {
  it("decodes basic entities", () => {
    expect(WebClipperService.decodeEntities("&amp;")).toBe("&");
    expect(WebClipperService.decodeEntities("&lt;")).toBe("<");
    expect(WebClipperService.decodeEntities("&gt;")).toBe(">");
    expect(WebClipperService.decodeEntities("&quot;")).toBe('"');
  });

  it("decodes named entities", () => {
    expect(WebClipperService.decodeEntities("&nbsp;")).toBe(" ");
    expect(WebClipperService.decodeEntities("&hellip;")).toBe("…");
    expect(WebClipperService.decodeEntities("&mdash;")).toBe("—");
  });

  it("decodes numeric entities", () => {
    expect(WebClipperService.decodeEntities("&#241;")).toBe("ñ");
    expect(WebClipperService.decodeEntities("&#xA9;")).toBe("©");
  });

  it("leaves normal text alone", () => {
    expect(WebClipperService.decodeEntities("Hello World")).toBe("Hello World");
  });
});

describe("WebClipperService.htmlToMarkdown", () => {
  it("extracts title from <title>", () => {
    const html = "<html><head><title>Test Article</title></head><body></body></html>";
    const result = WebClipperService.htmlToMarkdown(html, "https://example.com/test");
    expect(result.title).toBe("Test Article");
  });

  it("prefers og:title over <title>", () => {
    const html = `<html>
<head>
<title>Page</title>
<meta property="og:title" content="OG Title">
</head>
<body></body>
</html>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.title).toBe("OG Title");
  });

  it("extracts description", () => {
    const html = `<html><head>
<meta name="description" content="This is a description">
</head><body></body></html>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.excerpt).toBe("This is a description");
  });

  it("extracts author", () => {
    const html = `<html><head>
<meta name="author" content="Dr. House">
</head><body></body></html>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.author).toBe("Dr. House");
  });

  it("extracts og:image", () => {
    const html = `<html><head>
<meta property="og:image" content="https://example.com/img.jpg">
</head><body></body></html>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.imageUrl).toBe("https://example.com/img.jpg");
  });

  it("extracts hostname from URL", () => {
    const html = "<html><head><title>T</title></head><body></body></html>";
    const result = WebClipperService.htmlToMarkdown(html, "https://www.medscape.com/article");
    expect(result.site).toBe("www.medscape.com");
  });

  it("handles invalid URL", () => {
    const html = "<html><head><title>T</title></head><body></body></html>";
    const result = WebClipperService.htmlToMarkdown(html, "not a url");
    expect(result.site).toBe("");
  });

  it("converts headings to markdown", () => {
    const html = `<article>
<h1>Title</h1>
<h2>Subtitle</h2>
<p>Body</p>
</article>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.content).toContain("# Title");
    expect(result.content).toContain("## Subtitle");
  });

  it("converts bold/italic/code", () => {
    const html = `<article>
<p>This is <strong>bold</strong> and <em>italic</em> and <code>code</code>.</p>
</article>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.content).toContain("**bold**");
    expect(result.content).toContain("*italic*");
    expect(result.content).toContain("`code`");
  });

  it("converts links to markdown", () => {
    const html = `<article>
<p>Visit <a href="https://example.com">our site</a></p>
</article>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.content).toContain("[our site](https://example.com)");
  });

  it("converts images to markdown", () => {
    const html = `<article>
<img src="https://example.com/img.jpg" alt="An image">
</article>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.content).toContain("![An image](https://example.com/img.jpg)");
  });

  it("removes scripts and styles", () => {
    const html = `<article>
<script>alert('x')</script>
<style>.x { color: red; }</style>
<p>Visible content</p>
</article>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.content).not.toContain("alert");
    expect(result.content).not.toContain("color: red");
    expect(result.content).toContain("Visible content");
  });

  it("converts lists to markdown", () => {
    const html = `<article>
<ul>
<li>Item 1</li>
<li>Item 2</li>
</ul>
</article>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.content).toContain("- Item 1");
    expect(result.content).toContain("- Item 2");
  });

  it("converts blockquote", () => {
    const html = `<article>
<blockquote>Quote here</blockquote>
</article>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.content).toContain("> Quote here");
  });

  it("extracts tags from keywords meta", () => {
    const html = `<html><head>
<meta name="keywords" content="anatomia, cardiología, fisiología">
</head><body></body></html>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.suggestedTags).toContain("anatomia");
    expect(result.suggestedTags).toContain("cardiología");
  });

  it("uses <article> as main content", () => {
    const html = `<html>
<body>
<header>Header content</header>
<article><p>Article content</p></article>
<footer>Footer content</footer>
</body>
</html>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.content).toContain("Article content");
    // El header y footer podrían no incluirse si están en tags separados
  });

  it("uses <main> when no <article>", () => {
    const html = `<html>
<body>
<nav>Nav content</nav>
<main><p>Main content</p></main>
<aside>Aside content</aside>
</body>
</html>`;
    const result = WebClipperService.htmlToMarkdown(html);
    expect(result.content).toContain("Main content");
  });

  it("clippedAt is current timestamp", () => {
    const before = Date.now();
    const html = "<html></html>";
    const result = WebClipperService.htmlToMarkdown(html);
    const after = Date.now();
    expect(result.clippedAt).toBeGreaterThanOrEqual(before);
    expect(result.clippedAt).toBeLessThanOrEqual(after);
  });
});

describe("WebClipperService.toFrontmatter", () => {
  it("generates valid frontmatter", () => {
    const result = WebClipperService.htmlToMarkdown(
      `<html><head>
<title>Test</title>
<meta name="author" content="A">
<meta property="og:image" content="https://img.jpg">
</head><body></body></html>`,
      "https://example.com"
    );
    const fm = WebClipperService.toFrontmatter(result);
    expect(fm).toContain("title:");
    expect(fm).toContain('source: "https://example.com"');
    expect(fm).toContain('author: "A"');
    expect(fm).toContain('cover: "https://img.jpg"');
    expect(fm).toContain('site: "example.com"');
  });
});
