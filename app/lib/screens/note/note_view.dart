// NoteView: pantalla de lectura.
// Vista de nota: frontmatter, contenido, backlinks al final.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:path/path.dart' as p;
import '../../core/shortcuts.dart';
import '../../core/theme.dart';
import '../../services/logger.dart';
import '../../services/vault_service.dart';
import '../../services/attachments_service.dart';
import '../../utils/safe_call.dart';
import '../../widgets/backlinks_panel.dart';
import '../../widgets/attachment_references_panel.dart';
import '../../widgets/empty_state.dart';
import '../attachments/attachments_screen.dart';
import 'note_editor.dart';
import 'note_sketch_screen.dart';
import 'block_editor.dart';

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
            icon: const Icon(Icons.dashboard_customize_outlined),
            onPressed: () async {
              // v0.49.9: editar con block editor
              await Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => BlockEditor(
                  vaultPath: widget.vaultPath,
                  notePath: note.path,
                  initialTitle: note.title,
                )),
              );
              if (!mounted) return;
              _load();
            },
            tooltip: 'Editar con bloques',
          ),
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
          // v0.48: botón para abrir el canvas de handwriting sobre la nota.
          IconButton(
            icon: const Icon(Icons.brush),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => NoteSketchScreen(
                  notePath: widget.notePath,
                  vaultPath: widget.vaultPath,
                )),
              );
            },
            tooltip: 'Dibujar / Anotar',
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
            data: _preprocessWikilinks(note.content.isEmpty ? '_(vacío)_' : note.content),
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
          // v0.49.11: adjuntos referenciados (PDFs, imagenes, audios)
          AttachmentReferencesPanel(
            vaultPath: widget.vaultPath,
            noteContent: note.content,
            onAttachmentOpen: (att) {
              if (att.isImage) {
                Navigator.push(context, MaterialPageRoute(
                  builder: (_) => _ImageFullScreen(path: att.path),
                ));
              } else {
                Navigator.push(context, MaterialPageRoute(
                  builder: (_) => AttachmentsScreen(vaultPath: widget.vaultPath),
                ));
              }
            },
          ),
          const SizedBox(height: 16),
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
      // v0.49.11: si el target termina en .pdf/.pptx/.png/etc, abrir como attachment
      final ext = p.extension(href).toLowerCase();
      const attachmentExts = {'.pdf', '.pptx', '.ppt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp3', '.wav', '.m4a'};
      if (attachmentExts.contains(ext)) {
        _openAttachment(href);
        return;
      }
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

  /// v0.49.11: abre un attachment (PDF, imagen, audio, etc) desde un link
  void _openAttachment(String relOrName) async {
    // Construir path absoluto
    String absPath;
    if (p.isAbsolute(relOrName)) {
      absPath = relOrName;
    } else {
      // Buscar en vault por relPath o nombre
      final svc = AttachmentsService(widget.vaultPath);
      final all = await svc.listAll();
      final match = all.firstWhere(
        (a) => a.relPath == relOrName || a.name == relOrName,
        orElse: () => Attachment(
          path: p.join(widget.vaultPath, relOrName),
          relPath: relOrName,
          name: p.basename(relOrName),
          extension: p.extension(relOrName),
          sizeBytes: 0,
          modified: DateTime.now(),
        ),
      );
      absPath = match.path;
    }
    if (!await File(absPath).exists()) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Archivo no encontrado: $relOrName')),
      );
      return;
    }
    if (!mounted) return;
    final ext = p.extension(absPath).toLowerCase();
    final att = Attachment(
      path: absPath,
      relPath: relOrName,
      name: p.basename(absPath),
      extension: ext,
      sizeBytes: await File(absPath).length(),
      modified: (await File(absPath).stat()).modified,
    );
    if (ext == '.pdf' || ext == '.pptx') {
      Navigator.push(context, MaterialPageRoute(
        builder: (_) => AttachmentsScreen(
          vaultPath: widget.vaultPath,
        ),
      ));
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].contains(ext)) {
      Navigator.push(context, MaterialPageRoute(
        builder: (_) => _ImageFullScreen(path: absPath),
      ));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Abierto: $relOrName')),
      );
    }
  }

  /// v0.48.5: pre-procesa el contenido markdown para que [[wikilinks]] se
  /// conviertan en links markdown estándar [title](target.md). Sin esto,
  /// flutter_markdown los muestra como texto plano.
  ///
  /// Formatos soportados:
  ///   [[note]]              → [note](note.md)
  ///   [[note|alias]]        → [alias](note.md)  (alias replaces displayed text)
  ///   [[folder/note#sec]]   → [folder/note#sec](folder/note.md)  (anchor preservado)
  String _preprocessWikilinks(String content) {
    return WikilinkPreprocessor.process(content);
  }
}

/// v0.48.5: utility class para pre-procesar wikilinks. Expuesto estáticamente
/// para poder testear sin instanciar NoteView.
class WikilinkPreprocessor {
  WikilinkPreprocessor._();

  /// Pre-procesa el contenido markdown convirtiendo [[wikilinks]] en links.
  static String process(String content) {
    return content.replaceAllMapped(
      RegExp(r'\[\[([^\]\n]+)\]\]'),
      (match) {
        final raw = match.group(1)!.trim();
        if (raw.isEmpty) return match.group(0)!;
        // Split en alias: target|display
        final pipeIdx = raw.indexOf('|');
        final String target;
        final String display;
        if (pipeIdx > 0) {
          target = raw.substring(0, pipeIdx).trim();
          display = raw.substring(pipeIdx + 1).trim();
        } else {
          target = raw;
          display = raw;
        }
        // Si tiene fragmento (#section), lo separamos
        String file = target;
        String fragment = '';
        final hashIdx = target.indexOf('#');
        if (hashIdx >= 0) {
          file = target.substring(0, hashIdx);
          fragment = target.substring(hashIdx); // incluye el '#'
        }
        // Añadir .md si no lo tiene
        if (!file.endsWith('.md')) {
          file = '$file.md';
        }
        final href = fragment.isEmpty ? file : '$file$fragment';
        return '[$display]($href)';
      },
    );
  }
}

/// v0.49.11: fullscreen image viewer (InteractiveViewer para zoom)
class _ImageFullScreen extends StatelessWidget {
  final String path;
  const _ImageFullScreen({required this.path});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(p.basename(path), overflow: TextOverflow.ellipsis),
      ),
      body: Center(
        child: InteractiveViewer(
          maxScale: 6,
          child: Image.file(
            File(path),
            errorBuilder: (ctx, err, st) => Padding(
              padding: const EdgeInsets.all(24),
              child: Text('No se pudo cargar: $err',
                style: const TextStyle(color: Colors.white)),
            ),
          ),
        ),
      ),
    );
  }
}
