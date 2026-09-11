// outline_sidebar.dart: TOC (tabla de contenidos) lateral con headings.
//
// v0.50.1: detecta # ## ### y permite click para scroll al bloque.
// Soporta bloque-editor + note-view (lee markdown).

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;

class OutlineEntry {
  final int level; // 1, 2, 3
  final String text;
  final int blockIndex; // indice en la lista de bloques
  OutlineEntry({required this.level, required this.text, required this.blockIndex});
}

class OutlineSidebar extends StatelessWidget {
  final List<OutlineEntry> entries;
  final int currentIndex;
  final void Function(int blockIndex) onJump;
  final VoidCallback? onClose;

  const OutlineSidebar({
    super.key,
    required this.entries,
    required this.currentIndex,
    required this.onJump,
    this.onClose,
  });

  static List<OutlineEntry> parseFromMarkdown(String md) {
    final out = <OutlineEntry>[];
    int idx = 0;
    int blockIndex = 0;
    for (final line in md.split('\n')) {
      if (line.startsWith('# ')) {
        out.add(OutlineEntry(level: 1, text: line.substring(2), blockIndex: blockIndex));
        idx++;
      } else if (line.startsWith('## ')) {
        out.add(OutlineEntry(level: 2, text: line.substring(3), blockIndex: blockIndex));
        idx++;
      } else if (line.startsWith('### ')) {
        out.add(OutlineEntry(level: 3, text: line.substring(4), blockIndex: blockIndex));
        idx++;
      }
      blockIndex++;
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        border: Border(left: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: theme.colorScheme.outlineVariant)),
            ),
            child: Row(
              children: [
                Icon(Icons.toc, color: theme.colorScheme.primary, size: 18),
                const SizedBox(width: 8),
                Text('Outline (${entries.length})',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const Spacer(),
                if (onClose != null)
                  IconButton(icon: const Icon(Icons.close, size: 18), onPressed: onClose),
              ],
            ),
          ),
          Expanded(
            child: entries.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'Sin headings.\nUsa # para crear.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: entries.length,
                  itemBuilder: (ctx, i) {
                    final e = entries[i];
                    final isCurrent = i == currentIndex;
                    return InkWell(
                      onTap: () => onJump(e.blockIndex),
                      child: Container(
                        padding: EdgeInsets.fromLTRB(
                          12.0 + (e.level - 1) * 16.0,
                          6, 12, 6,
                        ),
                        decoration: BoxDecoration(
                          color: isCurrent ? theme.colorScheme.primaryContainer : null,
                          border: isCurrent
                            ? Border(left: BorderSide(color: theme.colorScheme.primary, width: 3))
                            : null,
                        ),
                        child: Row(
                          children: [
                            Text(_dotFor(e.level), style: TextStyle(
                              color: isCurrent
                                ? theme.colorScheme.onPrimaryContainer
                                : theme.colorScheme.onSurfaceVariant,
                            )),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                e.text,
                                style: TextStyle(
                                  fontSize: 12.0 + (4 - e.level) * 1.5,
                                  fontWeight: e.level == 1 ? FontWeight.w700 : FontWeight.w500,
                                  color: isCurrent
                                    ? theme.colorScheme.onPrimaryContainer
                                    : theme.colorScheme.onSurface,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
          ),
        ],
      ),
    );
  }

  String _dotFor(int level) {
    switch (level) {
      case 1: return '●';
      case 2: return '○';
      case 3: return '▪';
      default: return '·';
    }
  }
}
