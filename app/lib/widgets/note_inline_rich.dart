// note_inline_rich.dart
//
// Reusable widgets para renderizar el contenido de una nota con:
//   - Cloze deletions {{c1::texto}} como widgets clickeables que alternan
//     entre "______" (oculto) y "texto" (revelado). Modelo Anki.
//   - Wikilinks [[nota]] / [[nota|alias]] como InkWell tapables que llaman
//     a un callback onOpenNote(String).
//   - Markdown ligero para negrita, cursiva y `código`.
//   - Otras marcas (enlaces [txt](url), ![alt](img)) preservadas como
//     selectable text.
//
// Usado por NoteView para renderizar bloques tipo párrafo con markup
// inline interactivo. Los bloques no-párrafo (headings, listas, code
// fences, tablas) siguen delegándose a flutter_markdown.
//
// v0.62: FASE 2 — rediseño NoteView.

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

/// Parsea un cloze {{c1::texto}} (Anki-style) y produce un nodo inline.
class ClozeInline {
  /// Contenido original dentro del cloze (sin las llaves).
  final String answer;

  /// Identificador leído del cloze (ej. "c1"), o null si no venía.
  final String? id;

  /// Posición en el texto original. Usado para reconstruir orden.
  final int start;
  final int end;

  const ClozeInline({
    required this.answer,
    required this.start,
    required this.end,
    this.id,
  });

  /// Matcher regex global para cloze deletions Anki-style:
  /// {{c1::texto}} o {{c2::texto con :: dos puntos}}.
  static final RegExp clozePattern =
      RegExp(r'\{\{c(\d+)::([^}]+)\}\}');

  /// Encuentra TODOS los cloze en [source].
  /// Devuelve lista ordenada por posición. Ranges no se solapan porque
  /// la regex consume el match completo.
  static List<ClozeInline> findAll(String source) {
    final out = <ClozeInline>[];
    for (final m in clozePattern.allMatches(source)) {
      final ans = m.group(2) ?? '';
      if (ans.isEmpty) continue;
      out.add(ClozeInline(
        answer: ans,
        id: 'c${m.group(1)}',
        start: m.start,
        end: m.end,
      ));
    }
    return out;
  }
}

/// Parsea wikilinks [[nota]] o [[nota|alias]] a partir de texto plano
/// (sin pre-procesado markdown). Devuelve spans con inicio/fin.
class WikilinkInline {
  final String target;
  final String display;
  final int start;
  final int end;

  const WikilinkInline({
    required this.target,
    required this.display,
    required this.start,
    required this.end,
  });

  /// Matcher: [[algo]] o [[algo|otro]]. No captura links anidados por
  /// diseño (la primera ]] cierra el link).
  static final RegExp pattern =
      RegExp(r'\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]');

  static List<WikilinkInline> findAll(String source) {
    final out = <WikilinkInline>[];
    for (final m in pattern.allMatches(source)) {
      final target = (m.group(1) ?? '').trim();
      if (target.isEmpty) continue;
      out.add(WikilinkInline(
        target: target,
        display: (m.group(2) ?? target).trim(),
        start: m.start,
        end: m.end,
      ));
    }
    return out;
  }
}

/// Widget clickeable que muestra "______" hasta que se toca, entonces
/// revela la respuesta del cloze. Mantiene estado local.
class ClozeTapWidget extends StatefulWidget {
  final String answer;
  final String? id;
  final TextStyle? baseStyle;
  final Color? revealedColor;
  final Color? concealedColor;
  final double underlineThickness;

  const ClozeTapWidget({
    super.key,
    required this.answer,
    this.id,
    this.baseStyle,
    this.revealedColor,
    this.concealedColor,
    this.underlineThickness = 2.0,
  });

  @override
  State<ClozeTapWidget> createState() => _ClozeTapWidgetState();
}

class _ClozeTapWidgetState extends State<ClozeTapWidget> {
  bool _revealed = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final revealedColor = widget.revealedColor ?? theme.colorScheme.primary;
    final concealedColor = widget.concealedColor ??
        theme.colorScheme.onSurface.withValues(alpha: 0.55);
    final base = widget.baseStyle ?? theme.textTheme.bodyLarge ?? const TextStyle();

    final text = _revealed ? widget.answer : '_' * widget.answer.length.clamp(3, 12);
    final color = _revealed ? revealedColor : concealedColor;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => setState(() => _revealed = !_revealed),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
        margin: const EdgeInsets.symmetric(horizontal: 1),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: color,
              width: widget.underlineThickness,
              style: _revealed ? BorderStyle.solid : BorderStyle.solid,
            ),
          ),
          color: _revealed
              ? revealedColor.withValues(alpha: 0.08)
              : concealedColor.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(3),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                text,
                style: base.copyWith(
                  color: color,
                  fontWeight: FontWeight.w600,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
            const SizedBox(width: 2),
            Icon(
              _revealed ? Icons.visibility_off_outlined : Icons.visibility_outlined,
              size: 12,
              color: color,
            ),
          ],
        ),
      ),
    );
  }
}

/// Renderiza un bloque de párrafo (o texto suelto, e.g. dentro de una lista)
/// soportando clozes clickeables y wikilinks clickeables. El resto de
/// markup markdown ligero (bold **x**, italic *x*, code `x`) se aplica
/// al texto plano restante mediante TextSpan anidados.
///
/// NO renderiza headings, code fences, blockquotes ni tablas — para esos
/// use flutter_markdown directamente.
class NoteInlineRich extends StatelessWidget {
  final String text;
  final TextStyle? baseStyle;
  final void Function(String target)? onOpenNote;

  const NoteInlineRich({
    super.key,
    required this.text,
    this.baseStyle,
    this.onOpenNote,
  });

  @override
  Widget build(BuildContext context) {
    if (text.trim().isEmpty) return const SizedBox.shrink();
    final spans = _buildSpans(context, text);
    return SelectableText.rich(
      TextSpan(style: baseStyle, children: spans),
    );
  }

  List<InlineSpan> _buildSpans(BuildContext context, String source) {
    final clozes = ClozeInline.findAll(source);
    final wiki = WikilinkInline.findAll(source);

    // Marca posiciones: cada "evento" (cloze o wikilink) tiene (start, end,
    // kind, payload). Ordenamos por start y procesamos linealmente
    // respetando solapamientos (los clozes pueden contener wikilinks y
    // viceversa — elegimos el evento más temprano y, ante empate, cloze
    // primero porque su sintaxis es más larga).
    final events = <_Event>[
      for (final c in clozes)
        _Event(
          start: c.start,
          end: c.end,
          kind: _EventKind.cloze,
          payload: c,
        ),
      for (final w in wiki)
        _Event(
          start: w.start,
          end: w.end,
          kind: _EventKind.wiki,
          payload: w,
        ),
    ]..sort((a, b) {
        final s = a.start.compareTo(b.start);
        if (s != 0) return s;
        // Mismo start: cloze gana (más priorizado porque el cloze es el
        // bloque conceptual principal en esta vista).
        return a.kind == _EventKind.cloze ? -1 : 1;
      });

    if (events.isEmpty) {
      return _applyMarkdownSpans(context, source);
    }

    final result = <InlineSpan>[];
    int cursor = 0;
    for (final ev in events) {
      if (ev.start < cursor) {
        // Solapamiento: el evento anterior ya cubrió este rango.
        continue;
      }
      if (ev.start > cursor) {
        final plain = source.substring(cursor, ev.start);
        result.addAll(_applyMarkdownSpans(context, plain));
      }
      switch (ev.kind) {
        case _EventKind.cloze:
          final c = ev.payload as ClozeInline;
          result.add(WidgetSpan(
            alignment: PlaceholderAlignment.baseline,
            baseline: TextBaseline.alphabetic,
            child: ClozeTapWidget(
              answer: c.answer,
              id: c.id,
              baseStyle: baseStyle,
            ),
          ));
          break;
        case _EventKind.wiki:
          final w = ev.payload as WikilinkInline;
          result.addAll(_buildWikiTapSpans(context, w));
          break;
      }
      cursor = ev.end;
    }
    if (cursor < source.length) {
      result.addAll(_applyMarkdownSpans(context, source.substring(cursor)));
    }
    return result;
  }

  /// Convierte markdown ligero inline (bold/italic/code) en spans.
  /// No procesa links ni imágenes — el caller ya filtra esos.
  List<InlineSpan> _applyMarkdownSpans(BuildContext context, String text) {
    if (text.isEmpty) return const [];
    // Estrategia: regex para encontrar **bold**, *italic*, `code`.
    // Bold antes que italic para no romper `***x***`.
    final pattern = RegExp(
      r'(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\*[^*\n]+\*)',
      multiLine: true,
    );
    final spans = <InlineSpan>[];
    int cursor = 0;
    for (final m in pattern.allMatches(text)) {
      if (m.start > cursor) {
        spans.add(TextSpan(text: text.substring(cursor, m.start)));
      }
      final raw = m.group(0)!;
      if (raw.startsWith('**')) {
        spans.add(TextSpan(
          text: raw.substring(2, raw.length - 2),
          style: const TextStyle(fontWeight: FontWeight.w700),
        ));
      } else if (raw.startsWith('`')) {
        spans.add(TextSpan(
          text: raw.substring(1, raw.length - 1),
          style: TextStyle(
            fontFamily: 'monospace',
            backgroundColor:
                Theme.of(context).colorScheme.surfaceContainerHighest,
          ),
        ));
      } else if (raw.startsWith('*')) {
        spans.add(TextSpan(
          text: raw.substring(1, raw.length - 1),
          style: const TextStyle(fontStyle: FontStyle.italic),
        ));
      }
      cursor = m.end;
    }
    if (cursor < text.length) {
      spans.add(TextSpan(text: text.substring(cursor)));
    }
    if (spans.isEmpty) {
      return [TextSpan(text: text)];
    }
    return spans;
  }

  List<InlineSpan> _buildWikiTapSpans(
      BuildContext context, WikilinkInline w) {
    final theme = Theme.of(context);
    final linkColor = theme.colorScheme.primary;

    void open() {
      if (onOpenNote != null) onOpenNote!(w.target);
    }

    return [
      TextSpan(
        text: w.display,
        style: TextStyle(
          color: linkColor,
          decoration: TextDecoration.underline,
          decorationColor: linkColor.withValues(alpha: 0.5),
          fontWeight: FontWeight.w500,
        ),
        recognizer: TapGestureRecognizer()..onTap = open,
        mouseCursor: SystemMouseCursors.click,
      ),
    ];
  }
}

enum _EventKind { cloze, wiki }

class _Event {
  final int start;
  final int end;
  final _EventKind kind;
  final Object payload;

  const _Event({
    required this.start,
    required this.end,
    required this.kind,
    required this.payload,
  });
}

/// v0.62 (FASE 2): strip leading H1 "# Title" duplicado cuando el
/// archivo markdown lo trae embebido. Devuelve (title, bodySinH1).
class TitleStripResult {
  final String? title;
  final String body;
  const TitleStripResult({this.title, required this.body});
}

/// Quita la primera línea si comienza con `# ` (H1). Solo afecta al primer
/// heading del documento. Conserva el resto intacto.
TitleStripResult stripLeadingH1(String content) {
  // Saltar líneas en blanco iniciales
  var i = 0;
  while (i < content.length && (content[i] == '\n' || content[i] == ' ')) {
    i++;
  }
  if (i >= content.length) return TitleStripResult(body: content);
  // Detectar H1 al inicio: "#", espacios opcionales, contenido hasta EOL
  final lineEnd = content.indexOf('\n', i);
  final firstLine = lineEnd < 0
      ? content.substring(i)
      : content.substring(i, lineEnd);
  final m = RegExp(r'^#{1,6}\s+(.+?)\s*#*\s*$').firstMatch(firstLine);
  if (m == null) return TitleStripResult(body: content);
  final title = m.group(1)!.trim();
  final rest = lineEnd < 0 ? '' : content.substring(lineEnd + 1);
  return TitleStripResult(title: title, body: rest);
}
