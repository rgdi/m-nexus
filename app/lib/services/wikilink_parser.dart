// wikilink_parser.dart: parser de [[wikilinks]] estilo Obsidian (Fase 2.B.1).
//
// Soporta:
//   - [[Note Name]]
//   - [[Note Name|display text]]
//   - [[Note#section]]
//   - [[Note#^block-id]]
//   - ![[Note]] (embed)

class Wikilink {
  final String target;       // Note Name (sin |)
  final String? displayText;  // Texto a mostrar (después de |)
  final String? section;      // #section
  final String? blockId;      // ^block-id
  final bool isEmbed;         // ![[...]]

  const Wikilink({
    required this.target,
    this.displayText,
    this.section,
    this.blockId,
    this.isEmbed = false,
  });

  /// True si el link apunta a un bloque especifico.
  bool get isBlockRef => blockId != null;

  /// Path del archivo Markdown (agrega .md si no tiene extension).
  String get targetPath {
    final base = target.trim();
    if (base.contains('.')) return base;
    return '$base.md';
  }

  @override
  String toString() {
    final s = StringBuffer();
    if (isEmbed) s.write('!');
    s.write('[[$target');
    if (section != null) s.write('#$section');
    if (blockId != null) s.write('^$blockId');
    if (displayText != null) s.write('|$displayText');
    s.write(']]');
    return s.toString();
  }
}

class WikilinkParser {
  static final _wikilinkRegex = RegExp(r'(!?)\[\[([^\]]+)\]\]');

  /// Extrae todos los wikilinks de un texto.
  static List<Wikilink> parse(String content) {
    final result = <Wikilink>[];
    for (final match in _wikilinkRegex.allMatches(content)) {
      final isEmbed = match.group(1) == '!';
      final inner = match.group(2)!.trim();
      result.add(_parseInner(inner, isEmbed));
    }
    return result;
  }

  static Wikilink _parseInner(String inner, bool isEmbed) {
    // Split por # para section
    var parts = inner.split('#');
    final targetPart = parts[0].trim();
    String? section;
    String? blockId;
    if (parts.length > 1) {
      final sec = parts.sublist(1).join('#');
      if (sec.startsWith('^')) {
        blockId = sec.substring(1).trim();
      } else {
        section = sec.trim();
      }
    }
    // Split por | para display text
    final displayParts = targetPart.split('|');
    final target = displayParts[0].trim();
    final displayText = displayParts.length > 1 ? displayParts[1].trim() : null;

    return Wikilink(
      target: target,
      displayText: displayText,
      section: section,
      blockId: blockId,
      isEmbed: isEmbed,
    );
  }

  /// Resuelve un wikilink a su path completo.
  /// Si el target es "Note Name" → "Note Name.md".
  /// Si ya tiene extension (.md, .png) → no la duplica.
  static String resolveToPath(String target) {
    final t = target.trim();
    if (t.contains('.')) return t;
    return '$t.md';
  }
}
