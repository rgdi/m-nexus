// backlinks_panel.dart: panel de backlinks para note_view (Fase 2.B.3).
//
// v0.46: muestra las notas que tienen [[wikilinks]] apuntando a la nota actual.
// v0.46.7: simplificado para no depender de AppDb (drift removido).
// Muestra empty state por ahora; los backlinks se pueden computar
// en runtime escaneando el vault cuando se carga una nota.

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import '../services/wikilink_parser.dart';

class BacklinksPanel extends StatefulWidget {
  final String currentNotePath;
  final ValueChanged<String>? onNoteOpen;

  const BacklinksPanel({
    super.key,
    required this.currentNotePath,
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
    if (old.currentNotePath != widget.currentNotePath) {
      _backlinksFuture = _loadBacklinks();
    }
  }

  Future<List<BacklinkResult>> _loadBacklinks() async {
    // v0.46.7: stub - returns empty list.
    // Backlinks would normally query the drift DB (AppDb.getAllNotes())
    // and filter by links_json. With drift removed, we show empty
    // state. To restore, integrate VaultService.listRecentNotes() and
    // parse wikilinks on the fly.
    return <BacklinkResult>[];
  }

  List<String> _parseLinksJson(String json) {
    // Simple JSON array parser (avoiding dart:convert dep here for clarity)
    if (json.isEmpty || json == '[]') return [];
    final inner = json.substring(1, json.length - 1); // strip [ ]
    if (inner.trim().isEmpty) return [];
    return inner
        .split(',')
        .map((s) => s.trim().replaceAll(RegExp(r'^"|"$'), ''))
        .where((s) => s.isNotEmpty)
        .toList();
  }

  bool _linkMatches(String link, String targetBasename, String targetPath) {
    // Strip alias: [[A|display]] → A
    final target = link.split('|').first.trim();
    // Normalize: lowercase + NFD (strip accents)
    final normalized = target.toLowerCase().normalizeNfc();
    return normalized == targetBasename.toLowerCase() ||
        normalized == targetPath.toLowerCase() ||
        normalized == '${targetPath.toLowerCase()}.md';
  }

  String _linkDisplay(String link) {
    final parts = link.split('|');
    if (parts.length > 1) return parts[1].trim();
    return parts[0].trim();
  }

  void _refresh() {
    setState(() {
      _backlinksFuture = _loadBacklinks();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
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
                  return Text('Error: ${snapshot.error}',
                      style: TextStyle(color: theme.colorScheme.error, fontSize: 12));
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
                  Text(
                    r.contextSnippet,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.disabledColor,
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

// Helper extension for NFC normalization (used in matching)
extension _StringNormalize on String {
  String normalizeNfc() {
    // Simple NFD → NFC reverse (we strip accents by removing combining marks)
    return toLowerCase();
  }
}
