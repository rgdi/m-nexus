// note_block_renderer.dart
//
// v0.62 (FASE 2): renderer "inteligente" que decide por bloque:
//   - Headings, listas, blockquotes, code fences, tablas, hr → flutter_markdown
//   - Párrafos → NoteInlineRich (cloze + wikilinks clicables + markdown inline)
//
// Estrategia simple: dividir el contenido en bloques separados por líneas
// en blanco, clasificarlos por la primera línea, y renderizarlos por
// separado en un Column. Conserva espacios y formato.
//
// Usado por NoteView como reemplazo del MarkdownBody único en el body.

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'note_inline_rich.dart';

class NoteBlockRenderer extends StatelessWidget {
  final String content;
  final TextStyle? baseStyle;
  final void Function(String target)? onOpenNote;
  final void Function(String text, String? href, String? title)? onTapLink;

  const NoteBlockRenderer({
    super.key,
    required this.content,
    this.baseStyle,
    this.onOpenNote,
    this.onTapLink,
  });

  @override
  Widget build(BuildContext context) {
    final blocks = _splitBlocks(content);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: blocks.map((b) => _buildBlock(context, b)).toList(),
    );
  }

  Widget _buildBlock(BuildContext context, _Block b) {
    final base = baseStyle ?? Theme.of(context).textTheme.bodyLarge ?? const TextStyle();
    if (b.kind == _BlockKind.paragraph) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: NoteInlineRich(
          text: b.text,
          baseStyle: base,
          onOpenNote: onOpenNote,
        ),
      );
    }
    // El resto delega en MarkdownBody. Le pasamos el bloque puro
    // (sin envolver en paragraph) para que flutter_markdown aplique el
    // styling correcto (heading, list, code).
    return MarkdownBody(
      data: b.text,
      selectable: true,
      onTapLink: (text, href, title) {
        if (href != null && onTapLink != null) {
          onTapLink!(text, href, title);
        }
      },
      styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
        p: base,
        h1: Theme.of(context).textTheme.headlineSmall,
        h2: Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 22),
        h3: Theme.of(context).textTheme.titleLarge,
        code: TextStyle(
          fontFamily: 'monospace',
          backgroundColor:
              Theme.of(context).colorScheme.surfaceContainerHighest,
        ),
        codeblockDecoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(6),
        ),
        codeblockPadding: const EdgeInsets.all(12),
      ),
    );
  }

  // --- Block splitting -----------------------------------------------

  List<_Block> _splitBlocks(String source) {
    final lines = source.split('\n');
    final blocks = <_Block>[];
    final buffer = StringBuffer();
    _BlockKind currentKind = _BlockKind.paragraph;

    void flush() {
      final text = buffer.toString().trimRight();
      if (text.trim().isEmpty) {
        buffer.clear();
        return;
      }
      blocks.add(_Block(kind: currentKind, text: text));
      buffer.clear();
    }

    for (final line in lines) {
      final kind = _classifyLine(line);
      if (kind != currentKind && buffer.isNotEmpty) {
        flush();
        currentKind = kind;
      } else if (kind != currentKind) {
        currentKind = kind;
      }
      if (buffer.isNotEmpty) buffer.write('\n');
      buffer.write(line);
    }
    if (buffer.isNotEmpty) flush();
    return blocks;
  }

  _BlockKind _classifyLine(String line) {
    final t = line.trimLeft();
    if (t.isEmpty) return _BlockKind.paragraph; // separador — el caller decidirá
    if (t.startsWith('#')) return _BlockKind.markdown;
    if (t.startsWith('```')) return _BlockKind.markdown;
    if (t.startsWith('>')) return _BlockKind.markdown;
    if (t.startsWith('- ') ||
        t.startsWith('* ') ||
        t.startsWith('+ ') ||
        RegExp(r'^\d+\.\s').hasMatch(t)) {
      return _BlockKind.markdown;
    }
    if (t.startsWith('|') || t.startsWith('---')) return _BlockKind.markdown;
    if (t.startsWith('!') && t.contains('[')) return _BlockKind.markdown;
    if (t.startsWith('<!--')) return _BlockKind.markdown;
    return _BlockKind.paragraph;
  }
}

enum _BlockKind { paragraph, markdown }

class _Block {
  final _BlockKind kind;
  final String text;
  const _Block({required this.kind, required this.text});
}
