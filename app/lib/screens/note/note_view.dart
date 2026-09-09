// NoteView: pantalla de lectura.
// Vista de nota: frontmatter, contenido, backlinks al final.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:path/path.dart' as p;
import '../../core/shortcuts.dart';
import '../../core/theme.dart';
import '../../services/logger.dart';
import '../../services/vault_service.dart';
import '../../utils/safe_call.dart';
import '../../widgets/backlinks_panel.dart';
import '../../widgets/empty_state.dart';
import 'note_editor.dart';

class NoteView extends StatefulWidget {
  final String notePath;
  final String vaultPath;
  final bool embedded;
  const NoteView({
    super.key,
    required this.notePath,
    required this.vaultPath,
    this.embedded = false,
  });

  @override
  State<NoteView> createState() => _NoteViewState();
}

class _NoteViewState extends State<NoteView> {
  Note? _note;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    final log = AdvancedLogger.instance;
    log.debug('note_view', '_load start', context: {'path': widget.notePath, 'vault': widget.vaultPath});
    try {
      final service = VaultService(widget.vaultPath);
      _note = await service.readNote(widget.notePath);
    } catch (e, s) {
      log.error('note_view', '[EC-NOTE-001] Load note failed',
        context: {'path': widget.notePath, 'vault': widget.vaultPath}, error: e, stack: s);
      if (!mounted) return;
      _error = e.toString();
    }
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState();
    if (_error != null) return ErrorStateView(error: _error!, onRetry: _load);
    if (_note == null) return const EmptyState(
      icon: Icons.error_outline, title: 'Nota no encontrada');

    final note = _note!;
    final body = AppTheme.isMobile(context) ? _buildBody(note) : _buildDesktop(note);

    if (widget.embedded) return body;
    return Scaffold(
      appBar: AppBar(
        title: Text(note.title ?? note.name, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit),
            onPressed: () async {
              await Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => NoteEditor(
                  notePath: note.path,
                  vaultPath: widget.vaultPath,
                )),
              );
              if (!mounted) return;
              _load();
            },
            tooltip: 'Editar (Ctrl+E)',
          ),
          IconButton(
            icon: const Icon(Icons.copy),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: note.content));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Markdown copiado')),
              );
            },
            tooltip: 'Copiar',
          ),
        ],
      ),
      body: body,
    );
  }

  Widget _buildBody(Note note) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 80),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildFrontmatter(note.frontmatter),
          if (note.frontmatter.isNotEmpty) const SizedBox(height: 16),
          MarkdownBody(
            data: note.content.isEmpty ? '_(vacío)_' : note.content,
            selectable: true,
            onTapLink: (text, href, title) {
              if (href == null) return;
              _handleLink(href);
            },
          ),
          // v0.47.28: panel de backlinks (siempre se muestra, vacío si no hay)
          const SizedBox(height: 32),
          const Divider(),
          const SizedBox(height: 8),
          BacklinksPanel(
            currentNotePath: widget.notePath,
            vaultPath: widget.vaultPath,
            onNoteOpen: (path) {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => NoteView(
                  notePath: path,
                  vaultPath: widget.vaultPath,
                )),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildDesktop(Note note) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 800),
        child: _buildBody(note),
      ),
    );
  }

  Widget _buildFrontmatter(Map<String, String> fm) {
    if (fm.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF3E0),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFFFB74D).withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: fm.entries.map((e) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 1),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 90,
                child: Text(e.key,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
              ),
              Expanded(
                child: Text(e.value,
                  style: const TextStyle(fontSize: 12, fontFamily: 'monospace')),
              ),
            ],
          ),
        )).toList(),
      ),
    );
  }

  void _handleLink(String href) async {
    // v0.48: resolver wikilink usando VaultService.resolveNote (case-insensitive,
    // tolera tildes, busca en carpeta local y exhaustivamente en vault).
    if (!href.contains('://') && !href.startsWith('mailto:')) {
      // Importante: sharedInstance para evitar duplicación de estado
      final resolved = await VaultService.sharedInstance.resolveNote(
        href,
        widget.vaultPath,
        fromPath: widget.notePath,
      );
      if (!mounted) return;
      if (resolved != null) {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => NoteView(
              notePath: resolved,
              vaultPath: widget.vaultPath,
            ),
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('No se encontró: $href')),
        );
      }
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Link: $href')),
      );
    }
  }
}
