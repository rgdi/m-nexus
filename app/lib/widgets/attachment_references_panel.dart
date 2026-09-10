// attachment_references_panel.dart: panel que muestra attachments
// (PDFs, imagenes, audios) referenciados en la nota actual.
//
// v0.49.11: detecta [[path.pdf]] y 'name.pdf' en el contenido, los resuelve
// contra el vault, y los muestra como cards clickeables.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../services/attachments_service.dart';

class AttachmentReferencesPanel extends StatefulWidget {
  final String vaultPath;
  final String noteContent;
  final void Function(Attachment) onAttachmentOpen;
  const AttachmentReferencesPanel({
    super.key,
    required this.vaultPath,
    required this.noteContent,
    required this.onAttachmentOpen,
  });

  @override
  State<AttachmentReferencesPanel> createState() => _AttachmentReferencesPanelState();
}

class _AttachmentReferencesPanelState extends State<AttachmentReferencesPanel> {
  late final AttachmentsService _service;
  List<Attachment> _references = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _service = AttachmentsService(widget.vaultPath);
    _load();
  }

  @override
  void didUpdateWidget(covariant AttachmentReferencesPanel old) {
    super.didUpdateWidget(old);
    if (old.noteContent != widget.noteContent) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final all = await _service.listAll();
    // Buscar referencias en el contenido
    final referencedNames = <String>{};
    for (final a in all) {
      // Patrones: [[path/to/file.pdf]], 'name.pdf', ![](name.pdf)
      if (widget.noteContent.contains(a.relPath) ||
          widget.noteContent.contains('[[${a.name}]]') ||
          widget.noteContent.contains('[[${a.relPath}]]') ||
          RegExp(RegExp.escape(a.name)).hasMatch(widget.noteContent)) {
        referencedNames.add(a.path);
      }
    }
    if (!mounted) return;
    setState(() {
      _references = all.where((a) => referencedNames.contains(a.path)).toList();
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const SizedBox(
        height: 80,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    if (_references.isEmpty) return const SizedBox.shrink();

    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(top: 24),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.attach_file, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              Text('Adjuntos referenciados (${_references.length})',
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _references.map((a) => _buildChip(a, theme)).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildChip(Attachment a, ThemeData theme) {
    final color = a.isPdf ? Colors.red
      : a.isPptx ? Colors.orange
      : a.isImage ? Colors.purple
      : theme.colorScheme.primary;
    final icon = a.isPdf ? Icons.picture_as_pdf
      : a.isPptx ? Icons.slideshow
      : a.isImage ? Icons.image
      : Icons.insert_drive_file;
    return InkWell(
      onTap: () => widget.onAttachmentOpen(a),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: color.withOpacity(0.12),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withOpacity(0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 6),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 200),
              child: Text(
                a.displayTitle,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: theme.colorScheme.onSurface,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (a.pageCount != null) ...[
              const SizedBox(width: 4),
              Text('${a.pageCount}p', style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant)),
            ] else if (a.slideCount != null) ...[
              const SizedBox(width: 4),
              Text('${a.slideCount}s', style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant)),
            ],
          ],
        ),
      ),
    );
  }
}
