// backlinks_panel.dart: panel de backlinks para note_view (Fase 2.B.3).
//
// v0.47.28: integración real con VaultService.backlinks().
// Antes era un stub que retornaba lista vacía. Ahora:
//   1. Llama VaultService.backlinks(relPath) que escanea el vault
//   2. Filtra por nombre de archivo (sin extension) con NFD normalize
//   3. Genera snippet de contexto: la línea con el [[wikilink]]
//   4. Expone onNoteOpen callback para navegar a la nota

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../services/vault_service.dart';
import '../services/wikilink_parser.dart';

class BacklinksPanel extends StatefulWidget {
  /// Path absoluto de la nota actual.
  final String currentNotePath;

  /// Path absoluto del vault (necesario para construir VaultService).
  final String vaultPath;

  /// Callback al tocar un backlink. Recibe el path absoluto de la nota origen.
  final ValueChanged<String>? onNoteOpen;

  const BacklinksPanel({
    super.key,
    required this.currentNotePath,
    required this.vaultPath,
    this.onNoteOpen,
  });

  @override
  State<BacklinksPanel> createState() => _BacklinksPanelState();
}

class _BacklinksPanelState extends State<BacklinksPanel> {
  late Future<List<BacklinkResult>> _backlinksFuture;

  @override
  void initState() {
    super.initState();
    _backlinksFuture = _loadBacklinks();
  }

  @override
  void didUpdateWidget(BacklinksPanel old) {
    super.didUpdateWidget(old);
    if (old.currentNotePath != widget.currentNotePath ||
        old.vaultPath != widget.vaultPath) {
      _backlinksFuture = _loadBacklinks();
    }
  }

  /// Escanea el vault buscando notas que tengan un [[wikilink]] apuntando
  /// a la nota actual. Genera un snippet de contexto con la línea del link.
  ///
  /// Performance: O(n) sobre el vault. Para vaults grandes (>10k notas) considerar
  /// migrar a un índice inverso. Por ahora acepta la latencia.
  Future<List<BacklinkResult>> _loadBacklinks() async {
    final vault = VaultService(widget.vaultPath);
    final relPath = p.relative(widget.currentNotePath, from: widget.vaultPath);
    final candidates = await vault.backlinks(relPath);

    final results = <BacklinkResult>[];
    final targetBasename = p.basenameWithoutExtension(widget.currentNotePath);
    final targetBasenameNfd = _stripAccents(targetBasename.toLowerCase());
    final targetRelNoExt = p.withoutExtension(relPath).toLowerCase();
    final targetRelNoExtNfd = _stripAccents(targetRelNoExt);

    for (final note in candidates) {
      // VaultService.backlinks() usa search('[[target]]') que es aproximado.
      // Filtramos manualmente para asegurar match exacto (con NFD).
      final links = WikilinkParser.parse(note.content);
      final matchedLink = links.firstWhere(
        (l) {
          if (l.isEmbed) return false;
          final t = _stripAccents(l.target.toLowerCase());
          return t == targetBasenameNfd ||
              t == targetRelNoExt ||
              t == targetRelNoExtNfd;
        },
        orElse: () => const Wikilink(target: ''),
      );
      if (matchedLink.target.isEmpty) continue;

      // Generar snippet: la línea que contiene el wikilink
      final snippet = _extractSnippet(note.content, matchedLink);

      results.add(BacklinkResult(
        sourcePath: note.path,
        sourceTitle: note.name,
        contextSnippet: snippet,
      ));
    }

    // Ordenar por título para estabilidad
    results.sort((a, b) => a.sourceTitle.compareTo(b.sourceTitle));
    return results;
  }

  /// Extrae la línea que contiene el wikilink, sin markdown.
  String _extractSnippet(String content, Wikilink link) {
    final lines = content.split('\n');
    final pattern = RegExp(RegExp.escape('[[${link.target}'));
    for (final line in lines) {
      if (pattern.hasMatch(line)) {
        // Strip markdown emphasis
        var clean = line
            .replaceAll(RegExp(r'\*\*([^*]+)\*\*'), r'$1')  // bold
            .replaceAll(RegExp(r'\*([^*]+)\*'), r'$1')        // italic
            .replaceAll(RegExp(r'`([^`]+)`'), r'$1')          // code
            .trim();
        if (clean.length > 80) {
          clean = '${clean.substring(0, 77)}...';
        }
        return clean;
      }
    }
    return '';
  }

  /// Elimina diacríticos (NFD strip) para matching robusto.
  String _stripAccents(String s) {
    const accents = 'áéíóúñÁÉÍÓÚÑàèìòùÀÈÌÒÙäëïöüÄËÏÖÜ';
    const without = 'aeiounAEIOUNaeiouAEIOUaeiouAEIOU';
    var out = s;
    for (var i = 0; i < accents.length; i++) {
      out = out.replaceAll(accents[i], without[i]);
    }
    return out;
  }

  void _refresh() {
    setState(() {
      _backlinksFuture = _loadBacklinks();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.link, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 6),
                Text(
                  'Linked references',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.refresh, size: 18),
                  tooltip: 'Refresh',
                  onPressed: _refresh,
                ),
              ],
            ),
            const SizedBox(height: 4),
            FutureBuilder<List<BacklinkResult>>(
              future: _backlinksFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Padding(
                    padding: EdgeInsets.all(8),
                    child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                  );
                }
                if (snapshot.hasError) {
                  return Text(
                    'Error: ${snapshot.error}',
                    style: TextStyle(color: theme.colorScheme.error, fontSize: 12),
                  );
                }
                final results = snapshot.data ?? [];
                if (results.isEmpty) {
                  return Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(
                      'No notes link to this one yet.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontStyle: FontStyle.italic,
                        color: theme.disabledColor,
                      ),
                    ),
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: results.map((r) => _buildBacklinkTile(r, theme)).toList(),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBacklinkTile(BacklinkResult r, ThemeData theme) {
    return InkWell(
      onTap: () => widget.onNoteOpen?.call(r.sourcePath),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            const Icon(Icons.arrow_back, size: 14, color: Colors.grey),
            const SizedBox(width: 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    r.sourceTitle,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (r.contextSnippet.isNotEmpty)
                    Text(
                      r.contextSnippet,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.disabledColor,
                        fontStyle: FontStyle.italic,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class BacklinkResult {
  final String sourcePath;
  final String sourceTitle;
  final String contextSnippet;

  const BacklinkResult({
    required this.sourcePath,
    required this.sourceTitle,
    required this.contextSnippet,
  });
}
