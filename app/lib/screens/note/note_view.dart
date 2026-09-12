// NoteView: pantalla de lectura.
// Vista de nota: frontmatter, contenido (markdown con cloze + wikilinks
// interactivos), adjuntos referenciados y backlinks al final.
//
// v0.62 (FASE 2) — rediseño:
//   - Sin título duplicado: el heading H1 inicial del cuerpo se elimina,
//     dejando solo el AppBar como fuente de verdad para el título.
//   - Cloze deletions {{c1::texto}} ahora se renderizan como widgets
//     cloze reales (Anki-style): "______" por defecto, click para revelar.
//   - Wikilinks [[nota]] siguen siendo navegables (resolución a través
//     de VaultService.resolveNote → push NoteView para la nota destino).
//   - Menú 3 puntos (PopupMenuButton) con: Toggle preview/source,
//     Share, Export markdown, Word count, History, Export PDF, Export HTML.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:path/path.dart' as p;
import '../../core/theme.dart';
import '../../services/logger.dart';
import '../../services/vault_service.dart';
import '../../services/attachments_service.dart';
import '../../widgets/backlinks_panel.dart';
import '../../widgets/attachment_references_panel.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/note_inline_rich.dart';
import '../../widgets/note_block_renderer.dart';
import '../../services/export_service.dart';
import '../attachments/attachments_screen.dart';
import '../notes/version_history_screen.dart';
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

  /// v0.62 (FASE 2): source = muestra el markdown crudo sin procesar
  /// cloze/wikilinks; preview = render enriquezido (default).
  bool _showSource = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final log = AdvancedLogger.instance;
    log.debug('note_view', '_load start',
        context: {'path': widget.notePath, 'vault': widget.vaultPath});
    try {
      final service = VaultService(widget.vaultPath);
      _note = await service.readNote(widget.notePath);
    } catch (e, s) {
      log.error('note_view', '[EC-NOTE-001] Load note failed',
          context: {'path': widget.notePath, 'vault': widget.vaultPath},
          error: e,
          stack: s);
      if (!mounted) return;
      _error = e.toString();
    }
    if (!mounted) return;
    setState(() {
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState();
    if (_error != null) return ErrorStateView(error: _error!, onRetry: _load);
    if (_note == null) {
      return const EmptyState(
          icon: Icons.error_outline, title: 'Nota no encontrada');
    }

    final note = _note!;
    final body =
        AppTheme.isMobile(context) ? _buildBody(note) : _buildDesktop(note);

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
                MaterialPageRoute(
                    builder: (_) => BlockEditor(
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
                MaterialPageRoute(
                    builder: (_) => NoteEditor(
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
            icon: const Icon(Icons.brush),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => NoteSketchScreen(
                          notePath: widget.notePath,
                          vaultPath: widget.vaultPath,
                        )),
              );
            },
            tooltip: 'Dibujar / Anotar',
          ),
          // v0.62 (FASE 2): menú 3 puntos unificado con todas las acciones
          // extra (preview/source, share, export markdown, word count)
          // manteniendo las históricas (history, export PDF/HTML).
          _NoteOverflowMenu(
            note: note,
            showSource: _showSource,
            onShowSourceChanged: (v) => setState(() => _showSource = v),
            onShare: () => _shareNote(note),
            onExportMarkdown: () => _exportMarkdown(note),
            onWordCount: () => _showWordCount(note),
            onHistory: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) =>
                      VersionHistoryScreen(notePath: widget.notePath),
                ),
              );
            },
            onExportPdf: () => _export('pdf'),
            onExportHtml: () => _export('html'),
          ),
        ],
      ),
      body: body,
    );
  }

  // ---- Body -------------------------------------------------------

  Widget _buildBody(Note note) {
    final raw = note.content.isEmpty ? '_(vacío)_' : note.content;
    // v0.62 (FASE 2): si el archivo trae un H1 inicial, lo quitamos del
    // body para evitar duplicación con el AppBar title.
    final stripped = stripLeadingH1(raw);
    final body = stripped.body;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 80),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildFrontmatter(note.frontmatter),
          if (note.frontmatter.isNotEmpty) const SizedBox(height: 16),
          if (_showSource)
            _buildSourceView(body)
          else
            _buildRenderedBody(note, body),
          // v0.47.28: panel de backlinks (siempre se muestra, vacío si no hay)
          const SizedBox(height: 32),
          const Divider(),
          const SizedBox(height: 8),
          // v0.49.11: adjuntos referenciados (PDFs, imágenes, audios)
          AttachmentReferencesPanel(
            vaultPath: widget.vaultPath,
            noteContent: note.content,
            onAttachmentOpen: (att) {
              if (att.isImage) {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (_) => _ImageFullScreen(path: att.path)),
                );
              } else {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) =>
                        AttachmentsScreen(vaultPath: widget.vaultPath),
                  ),
                );
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
                MaterialPageRoute(
                    builder: (_) => NoteView(
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

  Widget _buildRenderedBody(Note note, String body) {
    return NoteBlockRenderer(
      content: body,
      onOpenNote: (target) {
        // v0.62 (FASE 2): los wikilinks [[nota]] dentro de párrafos
        // invocan directamente _handleWikilink sin pasar por markdown.
        _handleWikilink(target);
      },
      onTapLink: (text, href, title) {
        // Links en headings/listas/code blocks llegan por aquí.
        if (href == null) return;
        if (WikilinkInline.pattern.allMatches(href).isNotEmpty) {
          // No esperamos hrefs de wikilink (estos se inyectan vía
          // onOpenNote, no via flutter_markdown). Por seguridad, ignorar.
          return;
        }
        _handleLink(href);
      },
    );
  }

  Widget _buildSourceView(String body) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
          color: Theme.of(context).dividerColor.withValues(alpha: 0.5),
        ),
      ),
      child: SelectableText(
        body,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 13, height: 1.5),
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
        border:
            Border.all(color: const Color(0xFFFFB74D).withValues(alpha: 0.4)),
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
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 12)),
                  ),
                  Expanded(
                    child: Text(e.value,
                        style: const TextStyle(
                            fontSize: 12, fontFamily: 'monospace')),
                  ),
                ],
              ),
            )).toList(),
      ),
    );
  }

  // ---- Acciones (3-dot menú) -------------------------------------

  Future<void> _shareNote(Note note) async {
    final messenger = ScaffoldMessenger.of(context);
    // v0.62: share_plus está comentado en pubspec (FASE pre-deploy),
    // usamos Clipboard como fallback seguro y consistente con
    // logs_screen.dart / attachments_screen.dart. En el siguiente
    // despliegue con share_plus habilitado se conectará el intent
    // nativo aquí.
    await Clipboard.setData(ClipboardData(text: note.content));
    messenger.showSnackBar(
      const SnackBar(content: Text('Contenido copiado al portapapeles (Share)')),
    );
  }

  /// Exporta solo esta nota como .md plano (sin combinar el vault).
  /// Se guarda junto al archivo original como "<basename>.export.md".
  Future<void> _exportMarkdown(Note note) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final dir = p.dirname(note.path);
      final base = p.basenameWithoutExtension(note.path);
      final outPath = p.join(dir, '$base.export.md');
      await File(outPath).writeAsString(note.content);
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text('Markdown exportado: ${p.basename(outPath)}'),
        duration: const Duration(seconds: 5),
        action: SnackBarAction(label: 'OK', onPressed: () {}),
      ));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _showWordCount(Note note) async {
    final source = note.content;
    final words = _countWords(source);
    final chars = source.length;
    final lines = source.split('\n').length;
    final clozes = ClozeInline.findAll(source).length;
    final wiki = WikilinkInline.findAll(source).length;
    if (!mounted) return;
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Estadísticas de la nota'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _stat('Palabras', '$words'),
            _stat('Caracteres', '$chars'),
            _stat('Líneas', '$lines'),
            _stat('Cloze deletions', '$clozes'),
            _stat('Wikilinks', '$wiki'),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cerrar')),
        ],
      ),
    );
  }

  Widget _stat(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
          Text(value, style: const TextStyle(fontFamily: 'monospace')),
        ],
      ),
    );
  }

  int _countWords(String text) {
    if (text.trim().isEmpty) return 0;
    // Quitar cloze y dejar solo el contenido revelado antes de contar.
    final cleaned =
        text.replaceAll(ClozeInline.clozePattern, r'$1');
    return cleaned
        .split(RegExp(r'\s+'))
        .where((w) => w.trim().isNotEmpty)
        .length;
  }

  // ---- Resoluciones de link (compatibilidad hacia atrás) ---------

  void _handleLink(String href) async {
    await _handleLinkOrWikilink(href, isWikilink: false);
  }

  void _handleWikilink(String wikilink) async {
    // Convertir [[nota]] a href equivalente para reutilizar la lógica.
    final href = wikilink.endsWith('.md') ? wikilink : '$wikilink.md';
    await _handleLinkOrWikilink(href, isWikilink: true);
  }

  /// v0.48: resolver wikilink usando VaultService.resolveNote
  /// (case-insensitive, tolera tildes, busca en carpeta local y
  /// exhaustivamente en vault). Reutilizado por `_handleLink` y
  /// `_handleWikilink`.
  Future<void> _handleLinkOrWikilink(String href,
      {required bool isWikilink}) async {
    if (href.contains('://')) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Link externo: $href')),
      );
      return;
    }
    if (href.startsWith('mailto:')) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Email: $href')),
      );
      return;
    }
    final ext = p.extension(href).toLowerCase();
    const attachmentExts = {
      '.pdf', '.pptx', '.ppt', '.png', '.jpg', '.jpeg',
      '.gif', '.webp', '.svg', '.mp3', '.wav', '.m4a',
    };
    if (attachmentExts.contains(ext)) {
      _openAttachment(href);
      return;
    }
    // Para wikilinks [[nota]] sin extensión: añadir .md antes de buscar.
    final searchTarget = isWikilink && !href.endsWith('.md')
        ? '$href.md'
        : href;
    final resolved = await VaultService.sharedInstance.resolveNote(
      searchTarget,
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
  }

  /// v0.50.1: exporta la nota a PDF o HTML
  Future<void> _export(String format) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      messenger.showSnackBar(
          SnackBar(content: Text('Exportando a $format...')));
      final service = ExportService(widget.vaultPath);
      final outPath = format == 'pdf'
          ? await service.exportPdf(widget.notePath)
          : await service.exportHtml(widget.notePath);
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text('Exportado: ${p.basename(outPath)}'),
        duration: const Duration(seconds: 5),
        action: SnackBarAction(label: 'OK', onPressed: () {}),
      ));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  /// v0.49.11: abre un attachment (PDF, imagen, audio, etc) desde un link
  void _openAttachment(String relOrName) async {
    String absPath;
    if (p.isAbsolute(relOrName)) {
      absPath = relOrName;
    } else {
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
        builder: (_) => AttachmentsScreen(vaultPath: widget.vaultPath),
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
}

/// v0.62 (FASE 2): PopupMenuButton extraído para mantener `build` limpio.
/// Todos los callbacks inyectados por el padre; este widget es tonto y
/// solo dispone las entradas del menú 3 puntos.
class _NoteOverflowMenu extends StatelessWidget {
  final Note note;
  final bool showSource;
  final ValueChanged<bool> onShowSourceChanged;
  final VoidCallback onShare;
  final VoidCallback onExportMarkdown;
  final VoidCallback onWordCount;
  final VoidCallback onHistory;
  final VoidCallback onExportPdf;
  final VoidCallback onExportHtml;

  const _NoteOverflowMenu({
    required this.note,
    required this.showSource,
    required this.onShowSourceChanged,
    required this.onShare,
    required this.onExportMarkdown,
    required this.onWordCount,
    required this.onHistory,
    required this.onExportPdf,
    required this.onExportHtml,
  });

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_vert),
      tooltip: 'Más opciones',
      onSelected: (value) {
        switch (value) {
          case 'toggle_source':
            onShowSourceChanged(!showSource);
            break;
          case 'share':
            onShare();
            break;
          case 'export_md':
            onExportMarkdown();
            break;
          case 'word_count':
            onWordCount();
            break;
          case 'history':
            onHistory();
            break;
          case 'export_pdf':
            onExportPdf();
            break;
          case 'export_html':
            onExportHtml();
            break;
        }
      },
      itemBuilder: (_) => [
        PopupMenuItem(
          value: 'toggle_source',
          child: Row(
            children: [
              Icon(showSource
                  ? Icons.visibility_outlined
                  : Icons.code_outlined),
              const SizedBox(width: 12),
              Text(showSource
                  ? 'Ver preview'
                  : 'Ver source (markdown crudo)'),
            ],
          ),
        ),
        const PopupMenuDivider(),
        const PopupMenuItem(
          value: 'share',
          child: Row(children: [
            Icon(Icons.share_outlined),
            SizedBox(width: 12),
            Text('Compartir'),
          ]),
        ),
        const PopupMenuItem(
          value: 'export_md',
          child: Row(children: [
            Icon(Icons.description_outlined),
            SizedBox(width: 12),
            Text('Exportar markdown'),
          ]),
        ),
        const PopupMenuItem(
          value: 'word_count',
          child: Row(children: [
            Icon(Icons.text_fields_outlined),
            SizedBox(width: 12),
            Text('Estadísticas'),
          ]),
        ),
        const PopupMenuDivider(),
        const PopupMenuItem(
          value: 'history',
          child: Row(children: [
            Icon(Icons.history),
            SizedBox(width: 12),
            Text('Historial de versiones'),
          ]),
        ),
        const PopupMenuItem(
          value: 'export_pdf',
          child: Row(children: [
            Icon(Icons.picture_as_pdf_outlined),
            SizedBox(width: 12),
            Text('Exportar PDF'),
          ]),
        ),
        const PopupMenuItem(
          value: 'export_html',
          child: Row(children: [
            Icon(Icons.html_outlined),
            SizedBox(width: 12),
            Text('Exportar HTML'),
          ]),
        ),
      ],
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

// ---------------------------------------------------------------------------
// WikilinkPreprocessor se conserva por compatibilidad. Se sigue usando
// cuando una nota debe renderizarse en contextos donde NoteBlockRenderer
// no aplica (p.ej. el block_editor o el preview del note_editor).
// ---------------------------------------------------------------------------

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
        String file = target;
        String fragment = '';
        final hashIdx = target.indexOf('#');
        if (hashIdx >= 0) {
          file = target.substring(0, hashIdx);
          fragment = target.substring(hashIdx);
        }
        if (!file.endsWith('.md')) {
          file = '$file.md';
        }
        final href = fragment.isEmpty ? file : '$file$fragment';
        return '[$display]($href)';
      },
    );
  }
}
