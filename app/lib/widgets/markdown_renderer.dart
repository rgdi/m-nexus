// markdown_renderer.dart
//
// FASE 5: renderer markdown con:
//   - Callouts de Obsidian: `> [!note]`, `> [!warning]`, `> [!tip]`,
//     `> [!info]`, `> [!danger]`, `> [!example]`, `> [!quote]`,
//     `> [!question]`, `> [!success]`, `> [!bug]`.
//   - Code blocks con syntax highlighting básico por keyword (dart, python,
//     js, ts, bash, json, yaml, etc.).
//   - Typography mejorada: headings escalonados, listas con bullet custom,
//     blockquotes con borde izquierdo, código inline con background sutil.
//
// Estrategia: pre-procesa el texto para:
//   1. Convertir callouts `> [!type] ...` a un bloque con sintaxis
//      reemplazable (placeholder HTML/Markdown custom) que renderizamos
//      como un Container entre los MarkdownBody de párrafo.
//   2. Detectar code blocks ```lang y aplicar highlighting simple
//      (palabras clave en negrita/colour).
//
// Como flutter_markdown no permite inyectar widgets custom en medio del
// stream markdown sin extensión de builder, optamos por:
//   - Split del contenido en "bloques" separados por líneas en blanco.
//   - Cada bloque se clasifica (paragraph, heading, list, code, callout,
//     hr, table) y se renderiza con el widget apropiado.
//   - Para bloques que NO son callout ni code, usamos MarkdownBody.
//
// Uso:
//   MarkdownRenderer(
//     data: note.content,
//     onTapLink: (text, href, title) { ... },
//     onOpenNote: (path) { ... },
//   )

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

class MarkdownRenderer extends StatelessWidget {
  final String data;
  final bool selectable;
  final void Function(String text, String? href, String? title)? onTapLink;
  final void Function(String target)? onOpenNote;

  const MarkdownRenderer({
    super.key,
    required this.data,
    this.selectable = true,
    this.onTapLink,
    this.onOpenNote,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final blocks = _splitBlocks(data);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: blocks.map((b) => _renderBlock(context, theme, b)).toList(),
    );
  }

  // ── Render de bloque ─────────────────────────────────────────────

  Widget _renderBlock(BuildContext context, ThemeData theme, _Block b) {
    switch (b.kind) {
      case _BlockKind.callout:
        return _renderCallout(context, theme, b);
      case _BlockKind.code:
        return _renderCodeBlock(context, theme, b);
      case _BlockKind.heading:
      case _BlockKind.paragraph:
      case _BlockKind.list:
      case _BlockKind.blockquote:
      case _BlockKind.table:
      case _BlockKind.hr:
        return _renderMarkdown(context, theme, b.text);
    }
  }

  Widget _renderMarkdown(BuildContext context, ThemeData theme, String text) {
    final base = theme.textTheme.bodyLarge ?? const TextStyle();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: MarkdownBody(
        data: text,
        selectable: selectable,
        onTapLink: (text, href, title) {
          if (onTapLink != null) onTapLink!(text, href, title);
        },
        styleSheet: _buildStyleSheet(theme),
      ),
    );
  }

  // ── Callouts de Obsidian ────────────────────────────────────────

  Widget _renderCallout(BuildContext context, ThemeData theme, _Block b) {
    // b.text ya viene con el prefijo "> [!type] ..." limpio.
    final firstLine = b.text.split('\n').first.trim();
    // Detecta tipo: "> [!note] título" o "> [!note]" en la primera línea.
    final typeMatch = RegExp(r'^\[!(\w+)\]\s*(.*)$').firstMatch(firstLine);
    final type = (typeMatch?.group(1) ?? 'note').toLowerCase();
    final title = (typeMatch?.group(2) ?? '').trim();
    final bodyLines = b.text.split('\n').skip(1).toList();
    final bodyText = bodyLines.join('\n').trim();

    final spec = _calloutSpec(type, theme);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: spec.bg,
        borderRadius: BorderRadius.circular(8),
        border: Border(
          left: BorderSide(color: spec.accent, width: 4),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
              child: Row(
                children: [
                  Icon(spec.icon, size: 16, color: spec.accent),
                  const SizedBox(width: 6),
                  Text(
                    title,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: spec.accent,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
            child: MarkdownBody(
              data: bodyText.isEmpty ? '_Sin contenido_' : bodyText,
              selectable: selectable,
              onTapLink: (text, href, title) {
                if (onTapLink != null) onTapLink!(text, href, title);
              },
              styleSheet: _buildStyleSheet(theme).copyWith(
                p: theme.textTheme.bodyMedium,
              ),
            ),
          ),
        ],
      ),
    );
  }

  _CalloutSpec _calloutSpec(String type, ThemeData theme) {
    final isDark = theme.brightness == Brightness.dark;
    Color tint(Color c) => isDark
        ? Color.lerp(c, Colors.black, 0.7) ?? c
        : Color.lerp(c, Colors.white, 0.85) ?? c;
    switch (type) {
      case 'warning':
      case 'caution':
        return _CalloutSpec(
          icon: Icons.warning_amber_rounded,
          accent: Colors.orange.shade700,
          bg: tint(Colors.orange.shade200),
        );
      case 'danger':
      case 'error':
        return _CalloutSpec(
          icon: Icons.error_outline,
          accent: Colors.red.shade700,
          bg: tint(Colors.red.shade200),
        );
      case 'tip':
      case 'hint':
        return _CalloutSpec(
          icon: Icons.lightbulb_outline,
          accent: Colors.amber.shade800,
          bg: tint(Colors.amber.shade100),
        );
      case 'info':
        return _CalloutSpec(
          icon: Icons.info_outline,
          accent: Colors.blue.shade700,
          bg: tint(Colors.blue.shade200),
        );
      case 'example':
        return _CalloutSpec(
          icon: Icons.code,
          accent: Colors.purple.shade700,
          bg: tint(Colors.purple.shade200),
        );
      case 'quote':
        return _CalloutSpec(
          icon: Icons.format_quote,
          accent: Colors.grey.shade700,
          bg: tint(Colors.grey.shade300),
        );
      case 'question':
      case 'faq':
      case 'help':
        return _CalloutSpec(
          icon: Icons.help_outline,
          accent: Colors.teal.shade700,
          bg: tint(Colors.teal.shade200),
        );
      case 'success':
      case 'check':
      case 'done':
        return _CalloutSpec(
          icon: Icons.check_circle_outline,
          accent: Colors.green.shade700,
          bg: tint(Colors.green.shade200),
        );
      case 'bug':
        return _CalloutSpec(
          icon: Icons.bug_report_outlined,
          accent: Colors.brown.shade700,
          bg: tint(Colors.brown.shade200),
        );
      case 'note':
      default:
        return _CalloutSpec(
          icon: Icons.sticky_note_2_outlined,
          accent: Colors.blueGrey.shade700,
          bg: tint(Colors.blueGrey.shade100),
        );
    }
  }

  // ── Code blocks con syntax highlight básico ─────────────────────

  Widget _renderCodeBlock(BuildContext context, ThemeData theme, _Block b) {
    final lines = b.text.split('\n');
    // Primera línea: ```lang (si existe).
    String lang = '';
    String code = b.text;
    if (lines.isNotEmpty && lines.first.trim().startsWith('```')) {
      final fence = lines.first.trim();
      lang = fence.replaceAll('```', '').trim();
      code = lines.sublist(1, lines.length - (lines.last.trim() == '```' ? 1 : 0))
          .join('\n');
    }
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.dividerColor.withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (lang.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
              ),
              child: Text(
                lang.toUpperCase(),
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  color: theme.colorScheme.primary,
                  letterSpacing: 0.5,
                ),
              ),
            ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: SelectableText.rich(
                _highlight(code, lang, theme),
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 13,
                  height: 1.4,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Syntax highlighting simple basado en keywords por lenguaje.
  /// No es un parser completo (es best-effort) pero distingue:
  ///   - strings entre comillas
  ///   - comentarios de línea (//, #)
  ///   - keywords del lenguaje (bold + color primary)
  ///   - números
  TextSpan _highlight(String code, String lang, ThemeData theme) {
    final keywords = _keywordsFor(lang);
    final spans = <InlineSpan>[];
    final pattern = StringBuffer();
    if (keywords.isNotEmpty) {
      pattern.write(r'(?<=^|\W)(');
      pattern.write(keywords.map(RegExp.escape).join('|'));
      pattern.write(r')(?=$|\W)');
    }
    // Strings (""/''/`), comments, numbers, keywords.
    final re = RegExp(
      keywords.isEmpty
          ? r'''("[^"]*"|'[^']*'|`[^`]*`|//.*$|#.*$|\b\d+(?:\.\d+)?\b)'''
          : r'''("[^"]*"|'[^']*'|`[^`]*`|//.*$|#.*$|\b\d+(?:\.\d+)?\b|'''
            + pattern.toString()
            + ')',
      multiLine: true,
    );
    int lastEnd = 0;
    for (final m in re.allMatches(code)) {
      if (m.start > lastEnd) {
        spans.add(TextSpan(text: code.substring(lastEnd, m.start)));
      }
      final token = m.group(0)!;
      final isString = token.startsWith('"') ||
          token.startsWith("'") ||
          token.startsWith('`');
      final isComment = token.startsWith('//') || token.startsWith('#');
      final isNumber = RegExp(r'^\d').hasMatch(token);
      final isKeyword = keywords.contains(token);
      Color? color;
      FontWeight? fw;
      if (isString) {
        color = Colors.green.shade700;
      } else if (isComment) {
        color = Colors.grey.shade600;
        fw = FontWeight.normal;
      } else if (isNumber) {
        color = Colors.purple.shade700;
      } else if (isKeyword) {
        color = theme.colorScheme.primary;
        fw = FontWeight.bold;
      }
      spans.add(TextSpan(
        text: token,
        style: color != null
            ? TextStyle(color: color, fontWeight: fw)
            : null,
      ));
      lastEnd = m.end;
    }
    if (lastEnd < code.length) {
      spans.add(TextSpan(text: code.substring(lastEnd)));
    }
    return TextSpan(style: const TextStyle(), children: spans);
  }

  Set<String> _keywordsFor(String lang) {
    switch (lang.toLowerCase()) {
      case 'dart':
        return const {
          'abstract', 'as', 'assert', 'async', 'await', 'break', 'case',
          'catch', 'class', 'const', 'continue', 'covariant', 'default',
          'deferred', 'do', 'dynamic', 'else', 'enum', 'export', 'extends',
          'extension', 'external', 'factory', 'false', 'final', 'finally',
          'for', 'Function', 'get', 'hide', 'if', 'implements', 'import',
          'in', 'interface', 'is', 'late', 'library', 'mixin', 'new', 'null',
          'on', 'operator', 'part', 'rethrow', 'return', 'set', 'show',
          'static', 'super', 'switch', 'sync', 'this', 'throw', 'true',
          'try', 'typedef', 'var', 'void', 'when', 'while', 'with', 'yield',
        };
      case 'py':
      case 'python':
        return const {
          'and', 'as', 'assert', 'async', 'await', 'break', 'class',
          'continue', 'def', 'del', 'elif', 'else', 'except', 'False',
          'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
          'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise',
          'return', 'True', 'try', 'while', 'with', 'yield', 'self',
        };
      case 'js':
      case 'javascript':
      case 'ts':
      case 'typescript':
        return const {
          'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
          'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
          'false', 'finally', 'for', 'function', 'if', 'import', 'in',
          'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this',
          'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
          'yield', 'async', 'let', 'interface', 'type', 'enum',
        };
      case 'bash':
      case 'sh':
      case 'shell':
        return const {
          'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done',
          'case', 'esac', 'function', 'return', 'echo', 'export', 'local',
          'in', 'break', 'continue',
        };
      case 'json':
      case 'yaml':
      case 'yml':
      case 'toml':
      case 'ini':
        return const {};
      default:
        return const {};
    }
  }

  // ── Stylesheet mejorado ─────────────────────────────────────────

  MarkdownStyleSheet _buildStyleSheet(ThemeData theme) {
    final base = theme.textTheme.bodyLarge ?? const TextStyle();
    final codeInline = TextStyle(
      fontFamily: 'monospace',
      fontSize: 13,
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
      color: theme.colorScheme.tertiary,
    );
    return MarkdownStyleSheet.fromTheme(theme).copyWith(
      p: base,
      h1: theme.textTheme.headlineMedium?.copyWith(
            fontWeight: FontWeight.bold,
            height: 1.2,
          ) ??
          base,
      h2: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.bold,
            height: 1.25,
          ) ??
          base,
      h3: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600) ?? base,
      h4: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600) ?? base,
      h5: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600) ?? base,
      h6: base.copyWith(fontWeight: FontWeight.w600, fontStyle: FontStyle.italic),
      // Blockquotes: borde izquierdo visible.
      blockquote: base.copyWith(
        color: theme.colorScheme.onSurfaceVariant,
        fontStyle: FontStyle.italic,
      ),
      blockquoteDecoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(4),
        border: Border(
          left: BorderSide(color: theme.colorScheme.primary, width: 3),
        ),
      ),
      blockquotePadding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      // Code inline.
      code: codeInline,
      // Code blocks.
      codeblockDecoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(8),
      ),
      codeblockPadding: const EdgeInsets.all(12),
      // Lists con bullet custom (usamos default Unicode pero el padding
      // mejora la separación visual).
      listBullet: base.copyWith(fontWeight: FontWeight.bold),
      listIndent: 20,
      // Tables.
      tableHead: base.copyWith(fontWeight: FontWeight.bold),
      tableBorder: TableBorder.all(
        color: theme.dividerColor,
        width: 1,
      ),
      // Horizontal rule.
      horizontalRuleDecoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: theme.dividerColor, width: 1),
        ),
      ),
    );
  }

  // ── Block splitting ─────────────────────────────────────────────

  List<_Block> _splitBlocks(String source) {
    final lines = source.split('\n');
    final blocks = <_Block>[];
    final buffer = StringBuffer();
    _BlockKind currentKind = _BlockKind.paragraph;
    int calloutStartLine = -1;

    void flush() {
      final text = buffer.toString().trimRight();
      if (text.trim().isEmpty) {
        buffer.clear();
        return;
      }
      blocks.add(_Block(kind: currentKind, text: text));
      buffer.clear();
    }

    void setKind(_BlockKind k) {
      if (currentKind != k) {
        flush();
        currentKind = k;
      }
    }

    var inFence = false;
    var fenceLang = '';
    for (var i = 0; i < lines.length; i++) {
      final line = lines[i];
      final trimmed = line.trim();
      // Code fence toggle.
      if (trimmed.startsWith('```')) {
        if (!inFence) {
          // Abre un code block.
          flush();
          inFence = true;
          fenceLang = trimmed.substring(3).trim();
          currentKind = _BlockKind.code;
          buffer.writeln(line);
        } else {
          // Cierra.
          buffer.writeln(line);
          inFence = false;
          flush();
          currentKind = _BlockKind.paragraph;
        }
        continue;
      }
      if (inFence) {
        buffer.writeln(line);
        continue;
      }
      // Callout: la primera línea del bloque es `> [!type] ...`.
      if (trimmed.startsWith('>') &&
          RegExp(r'^>\s*\[!\w+\]').hasMatch(trimmed) &&
          calloutStartLine == -1) {
        // Comienza un callout.
        flush();
        calloutStartLine = i;
        currentKind = _BlockKind.callout;
        buffer.writeln(line);
        continue;
      }
      if (calloutStartLine != -1) {
        // Mientras siga siendo `> ...` o línea vacía seguimos en callout.
        if (trimmed.startsWith('>')) {
          buffer.writeln(line);
          continue;
        } else if (trimmed.isEmpty) {
          // Línea en blanco: sigue siendo parte del callout (multipárrafo).
          buffer.writeln(line);
          continue;
        } else {
          // Terminó el callout.
          calloutStartLine = -1;
          flush();
          currentKind = _BlockKind.paragraph;
          // Procesa esta línea normalmente (sigue en el loop).
        }
      }
      // Detección de tipo por primera línea.
      if (buffer.isEmpty) {
        if (trimmed.startsWith('#')) {
          currentKind = _BlockKind.heading;
        } else if (RegExp(r'^\s*([-*+]|\d+\.)\s').hasMatch(line)) {
          currentKind = _BlockKind.list;
        } else if (trimmed.startsWith('>')) {
          currentKind = _BlockKind.blockquote;
        } else if (trimmed.startsWith('|') &&
            i + 1 < lines.length &&
            lines[i + 1].trim().startsWith('|')) {
          currentKind = _BlockKind.table;
        } else if (RegExp(r'^\s*([-*_])\s*\1\s*\1').hasMatch(line) ||
            trimmed == '---' ||
            trimmed == '***') {
          currentKind = _BlockKind.hr;
        }
      }
      // Línea en blanco: flush, siguiente bloque nuevo.
      if (trimmed.isEmpty && buffer.isNotEmpty) {
        flush();
        currentKind = _BlockKind.paragraph;
      } else {
        buffer.writeln(line);
      }
    }
    flush();
    return blocks;
  }
}

class _CalloutSpec {
  final IconData icon;
  final Color accent;
  final Color bg;
  const _CalloutSpec({required this.icon, required this.accent, required this.bg});
}

enum _BlockKind {
  paragraph,
  heading,
  list,
  blockquote,
  callout,
  code,
  table,
  hr,
}

class _Block {
  final _BlockKind kind;
  final String text;
  const _Block({required this.kind, required this.text});
}