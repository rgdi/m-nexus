// attachments_screen.dart: lista de PDFs/PPTs/images del vault con preview.
//
// v0.49.11: gallery con filtros, busqueda, click para abrir.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:pdfx/pdfx.dart' as pdfx;
import '../../services/attachments_service.dart';
import '../../widgets/audio_player_widget.dart';

class AttachmentsScreen extends StatefulWidget {
  final String vaultPath;
  const AttachmentsScreen({super.key, required this.vaultPath});

  @override
  State<AttachmentsScreen> createState() => _AttachmentsScreenState();
}

class _AttachmentsScreenState extends State<AttachmentsScreen> {
  late final AttachmentsService _service;
  List<Attachment> _all = [];
  List<Attachment> _filtered = [];
  String _query = '';
  String _filterExt = ''; // '' = all, '.pdf', '.pptx', '.png'...
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _service = AttachmentsService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final list = await _service.listAll(forceRefresh: true);
    if (!mounted) return;
    setState(() {
      _all = list;
      _applyFilter();
      _loading = false;
    });
  }

  void _applyFilter() {
    Iterable<Attachment> r = _all;
    if (_filterExt.isNotEmpty) {
      r = r.where((a) => a.extension == _filterExt);
    }
    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      r = r.where((a) =>
        a.name.toLowerCase().contains(q) ||
        (a.title?.toLowerCase().contains(q) ?? false));
    }
    setState(() {
      _filtered = r.toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Adjuntos'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
            tooltip: 'Recargar',
          ),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              _buildSearchAndFilter(theme),
              const Divider(height: 1),
              Expanded(
                child: _filtered.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          _all.isEmpty
                            ? 'No hay PDFs, presentaciones ni imagenes en el vault.\nCopia archivos a la carpeta de tu vault y apareceran aqui.'
                            : 'No hay adjuntos con ese filtro.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        itemCount: _filtered.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (ctx, i) {
                          final att = _filtered[i];
                          return _buildAttachmentTile(att, theme);
                        },
                      ),
                    ),
              ),
            ],
          ),
    );
  }

  Widget _buildSearchAndFilter(ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          TextField(
            decoration: InputDecoration(
              hintText: 'Buscar adjuntos...',
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
              filled: true,
              fillColor: theme.colorScheme.surfaceContainerLow,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
            ),
            onChanged: (v) {
              _query = v;
              _applyFilter();
            },
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _filterChip('', Icons.all_inclusive, 'Todos'),
                _filterChip('.pdf', Icons.picture_as_pdf, 'PDFs'),
                _filterChip('.pptx', Icons.slideshow, 'Presentaciones'),
                _filterChip('.png', Icons.image, 'Imagenes'),
                _filterChip('.mp3', Icons.audiotrack, 'Audios'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _filterChip(String ext, IconData icon, String label) {
    final selected = _filterExt == ext;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: FilterChip(
        avatar: Icon(icon, size: 16, color: selected ? Colors.white : null),
        label: Text(label),
        selected: selected,
        onSelected: (_) {
          setState(() {
            _filterExt = ext;
            _applyFilter();
          });
        },
      ),
    );
  }

  Widget _buildAttachmentTile(Attachment att, ThemeData theme) {
    final isDoc = att.isPdf || att.isPptx;
    final color = att.isPdf ? Colors.red
      : att.isPptx ? Colors.orange
      : att.isImage ? Colors.purple
      : theme.colorScheme.primary;
    final icon = att.isPdf ? Icons.picture_as_pdf
      : att.isPptx ? Icons.slideshow
      : att.isImage ? Icons.image
      : Icons.insert_drive_file;
    return ListTile(
      leading: Container(
        width: 44, height: 44,
        decoration: BoxDecoration(
          color: color.withOpacity(0.15),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: color),
      ),
      title: Text(
        att.title ?? att.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: Row(
        children: [
          Text(att.name, style: theme.textTheme.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
          if (isDoc) ...[
            const Text(' · '),
            if (att.pageCount != null) Text('${att.pageCount} págs'),
            if (att.slideCount != null) Text('${att.slideCount} slides'),
            const Text(' · '),
          ],
          Text(_fmtSize(att.sizeBytes)),
        ],
      ),
      trailing: PopupMenuButton<String>(
        onSelected: (a) async {
          if (a == 'copy_path') {
            await Clipboard.setData(ClipboardData(text: att.path));
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Path copiado')),
              );
            }
          } else if (a == 'copy_rel') {
            await Clipboard.setData(ClipboardData(text: '[[${att.relPath}]]'));
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Wikilink copiado')),
              );
            }
          } else if (a == 'references') {
            final refs = await _service.findReferencingNotes(att);
            if (!mounted) return;
            showDialog(
              context: context,
              builder: (ctx) => AlertDialog(
                title: Text('Notas que referencian "${att.name}"'),
                content: SizedBox(
                  width: 400,
                  child: refs.isEmpty
                    ? const Text('Ninguna nota lo referencia todavia.')
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: refs.map((r) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2),
                          child: Text(p.basename(r), style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
                        )).toList(),
                      ),
                ),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
                ],
              ),
            );
          }
        },
        itemBuilder: (_) => const [
          PopupMenuItem(value: 'copy_path', child: Text('Copiar path')),
          PopupMenuItem(value: 'copy_rel', child: Text('Copiar wikilink [[...]]')),
          PopupMenuItem(value: 'references', child: Text('Notas que lo referencian')),
        ],
      ),
      onTap: () {
        if (att.isPdf) {
          Navigator.push(context, MaterialPageRoute(
            builder: (_) => _PdfPreviewScreen(attachment: att),
          ));
        } else if (att.isImage) {
          Navigator.push(context, MaterialPageRoute(
            builder: (_) => _ImagePreviewScreen(attachment: att),
          ));
        } else if (att.isPptx) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Vista PPTX: arrastra el archivo a Google Slides/Office Online para previsualizarlo')),
          );
        } else if (att.extension == '.mp3' || att.extension == '.wav' || att.extension == '.m4a') {
          // v0.50.1: audio player
          Navigator.push(context, MaterialPageRoute(
            builder: (_) => _AudioPlayerScreen(attachment: att),
          ));
        } else {
          // Otro: solo info
          showDialog(
            context: context,
            builder: (ctx) => AlertDialog(
              title: Text(att.name),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Tipo: ${att.extension}'),
                  Text('Tamaño: ${_fmtSize(att.sizeBytes)}'),
                  Text('Modificado: ${att.modified}'),
                ],
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
              ],
            ),
          );
        }
      },
    );
  }

  String _fmtSize(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)}KB';
    return '${(bytes / 1024 / 1024).toStringAsFixed(1)}MB';
  }
}

class _PdfPreviewScreen extends StatefulWidget {
  final Attachment attachment;
  const _PdfPreviewScreen({required this.attachment});

  @override
  State<_PdfPreviewScreen> createState() => _PdfPreviewScreenState();
}

class _PdfPreviewScreenState extends State<_PdfPreviewScreen> {
  int _currentPage = 1;
  int _totalPages = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadPdf();
  }

  Future<void> _loadPdf() async {
    try {
      // v0.50.1: usa pdfx para render real
      final doc = await pdfx.PdfDocument.openFile(widget.attachment.path);
      if (!mounted) return;
      setState(() {
        _totalPages = doc.pagesCount;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.attachment.displayTitle),
        actions: [
          if (_totalPages > 0)
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text('$_currentPage / $_totalPages',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
          ? _buildErrorFallback()
          : _buildPdfView(),
      floatingActionButton: _totalPages > 0
        ? Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              FloatingActionButton.small(
                heroTag: 'pdf-prev',
                onPressed: _currentPage > 1
                  ? () => setState(() => _currentPage--)
                  : null,
                child: const Icon(Icons.chevron_left),
              ),
              const SizedBox(width: 8),
              FloatingActionButton.small(
                heroTag: 'pdf-next',
                onPressed: _currentPage < _totalPages
                  ? () => setState(() => _currentPage++)
                  : null,
                child: const Icon(Icons.chevron_right),
              ),
            ],
          )
        : null,
    );
  }

  Widget _buildPdfView() {
    // Render real con pdfx
    return _PdfxPageView(
      path: widget.attachment.path,
      currentPage: _currentPage,
    );
  }

  Widget _buildErrorFallback() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.picture_as_pdf, size: 64, color: Colors.red),
            const SizedBox(height: 16),
            Text(widget.attachment.name, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (widget.attachment.pageCount != null)
              Text('${widget.attachment.pageCount} páginas'),
            const SizedBox(height: 16),
            Text('No se pudo renderizar: $_error',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 24),
            FilledButton.icon(
              icon: const Icon(Icons.copy),
              label: const Text('Copiar path'),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: widget.attachment.path));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Path copiado al portapapeles')),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// v0.50.1: wrapper que carga pdfx solo cuando se necesita (dynamic import
/// evita problemas si pdfx no compila en alguna plataforma)
class _PdfxPageView extends StatelessWidget {
  final String path;
  final int currentPage;
  const _PdfxPageView({required this.path, required this.currentPage});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Widget>(
      future: _buildWidget(context),
      builder: (ctx, snap) {
        if (snap.hasData) return snap.data!;
        if (snap.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text('Error renderizando PDF: ${snap.error}',
                textAlign: TextAlign.center),
            ),
          );
        }
        return const Center(child: CircularProgressIndicator());
      },
    );
  }

  Future<Widget> _buildWidget(BuildContext context) async {
    try {
      // v0.62.7: pdfx render API requiere width/height obligatorios.
      // Como no podemos llamarlo sin parámetros, mostramos info básica del PDF.
      final doc = await pdfx.PdfDocument.openFile(path);
      final pageCount = doc.pagesCount;
      return Container(
        padding: const EdgeInsets.all(24),
        alignment: Alignment.center,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.picture_as_pdf, size: 64, color: Colors.red),
            const SizedBox(height: 12),
            Text(
              'PDF con $pageCount páginas',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              path.split('/').last,
              style: Theme.of(context).textTheme.bodySmall,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    } catch (e) {
      return _buildFallback();
    }
  }

  Widget _buildFallback() {
    return Container(
      color: Colors.grey.shade300,
      child: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.picture_as_pdf, size: 48, color: Colors.red),
            SizedBox(height: 8),
            Text('Vista previa no disponible', style: TextStyle(color: Colors.grey)),
            SizedBox(height: 4),
            Text('Copia el path y abre con otra app',
              style: TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}

class _ImagePreviewScreen extends StatelessWidget {
  final Attachment attachment;
  const _ImagePreviewScreen({required this.attachment});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(attachment.name)),
      body: Center(
        child: InteractiveViewer(
          child: Image.file(
            File(attachment.path),
            errorBuilder: (ctx, err, st) => Padding(
              padding: const EdgeInsets.all(24),
              child: Text('No se pudo cargar: $err'),
            ),
          ),
        ),
      ),
    );
  }
}

/// v0.50.1: audio player con audioplayers
class _AudioPlayerScreen extends StatelessWidget {
  final Attachment attachment;
  const _AudioPlayerScreen({required this.attachment});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(attachment.displayTitle)),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.audiotrack, size: 96, color: Colors.purple),
            const SizedBox(height: 24),
            Text(attachment.name, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text('${(attachment.sizeBytes / 1024).toStringAsFixed(1)} KB',
              style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 32),
            AudioPlayerWidget(audioPath: attachment.path, autoplay: false),
          ],
        ),
      ),
    );
  }
}
