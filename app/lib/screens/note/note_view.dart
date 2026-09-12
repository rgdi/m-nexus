// NoteView v0.62.15: vista de lectura minimalista reconstruida.
//
// Reemplaza el NoteView anterior de 1110 líneas (con sidebars de outline/
// comments que nadie pidió + 3-dot menu gigante + frontmatter debug + tabs
// laterales). Ahora: frontmatter discreto + contenido markdown + 2 acciones
// (editar, compartir).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:path/path.dart' as p;
import '../../core/design_tokens.dart';
import '../../services/vault_service.dart';
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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final svc = VaultService(widget.vaultPath);
      final n = await svc.readNote(widget.notePath);
      if (!mounted) return;
      setState(() {
        _note = n;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  String get _title {
    if (_note == null) return 'Nota';
    final fm = _note!.frontmatter['title'];
    if (fm != null && fm.isNotEmpty) return fm;
    final base = p.basenameWithoutExtension(widget.notePath);
    return base == 'Sin título' ? 'Sin título' : base;
  }

  String get _body {
    if (_note == null) return '';
    final content = _note!.content;
    // Quita el bloque frontmatter (lo mostramos aparte como metadatos).
    if (!content.startsWith('---')) return content;
    final end = content.indexOf('---', 3);
    if (end <= 0) return content;
    return content.substring(end + 3).trimLeft();
  }

  Future<void> _edit() async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => NoteEditor(
        vaultPath: widget.vaultPath,
        notePath: widget.notePath,
        initialTitle: _title,
      ),
    ));
    if (changed == true) await _load();
  }

  Future<void> _share() async {
    if (_note == null) return;
    // v0.62.15: share_plus está comentado en pubspec (FASE pre-deploy),
    // usamos Clipboard como fallback seguro. En el siguiente despliegue
    // con share_plus habilitado se conectará el intent nativo aquí.
    await Clipboard.setData(ClipboardData(text: '$_title\n\n$_body'));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Contenido copiado al portapapeles')),
    );
  }

  void _copy() {
    if (_note == null) return;
    Clipboard.setData(ClipboardData(text: _body));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Contenido copiado')),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_note == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(
          child: Text('No se pudo cargar la nota'),
        ),
      );
    }

    final body = _buildBody();

    if (widget.embedded) return body;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          _title,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            onPressed: _edit,
            tooltip: 'Editar',
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert_rounded),
            onSelected: (v) {
              if (v == 'copy') _copy();
              if (v == 'share') _share();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(
                value: 'copy',
                child: ListTile(
                  leading: Icon(Icons.copy_rounded),
                  title: Text('Copiar'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              PopupMenuItem(
                value: 'share',
                child: ListTile(
                  leading: Icon(Icons.share_rounded),
                  title: Text('Compartir'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ],
          ),
        ],
      ),
      body: body,
    );
  }

  Widget _buildBody() {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 96),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Metadatos discretos (solo si hay más que el título)
          if (_note!.frontmatter.isNotEmpty) ...[
            _FrontmatterChipBar(
              frontmatter: _note!.frontmatter,
              accent: scheme.onSurfaceVariant,
            ),
            const SizedBox(height: 12),
          ],
          // Título principal
          if (_title != 'Sin título') ...[
            Text(
              _title,
              style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.w800,
                letterSpacing: -0.5,
                height: 1.15,
              ),
            ),
            const SizedBox(height: 16),
          ],
          // Contenido markdown
          if (_body.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Text(
                  'Nota vacía. Toca ✏️ para escribir.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
            )
          else
            MarkdownBody(
              data: _body,
              selectable: true,
              styleSheet: MarkdownStyleSheet(
                p: theme.textTheme.bodyLarge?.copyWith(height: 1.55, fontSize: 15),
                h1: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                ),
                h2: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.3,
                ),
                h3: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
                code: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 13,
                  backgroundColor: scheme.surfaceContainerHigh,
                  color: scheme.primary,
                ),
                codeblockDecoration: BoxDecoration(
                  color: scheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(MxRadius.md),
                ),
                blockquoteDecoration: BoxDecoration(
                  border: Border(
                    left: BorderSide(color: scheme.primary, width: 3),
                  ),
                ),
                a: TextStyle(color: scheme.primary, decoration: TextDecoration.underline),
              ),
            ),
        ],
      ),
    );
  }
}

/// Chips de metadatos: muestra cada key/value que no sea 'title' (que ya
/// se muestra como header) en una barra horizontal compacta.
class _FrontmatterChipBar extends StatelessWidget {
  final Map<String, String> frontmatter;
  final Color accent;
  const _FrontmatterChipBar({required this.frontmatter, required this.accent});

  @override
  Widget build(BuildContext context) {
    final filtered = <String, String>{};
    for (final e in frontmatter.entries) {
      if (e.key == 'title') continue;
      filtered[e.key] = e.value;
    }
    if (filtered.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: 6,
      runSpacing: 4,
      children: filtered.entries.map((e) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(MxRadius.pill),
        ),
        child: Text(
          '${e.key}: ${e.value.length > 24 ? '${e.value.substring(0, 24)}…' : e.value}',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w500,
            color: accent,
            fontFamily: 'monospace',
          ),
        ),
      )).toList(),
    );
  }
}
