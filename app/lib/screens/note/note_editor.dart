// NoteEditor v0.62.15: editor markdown minimalista reconstruido.
//
// Reemplaza el editor anterior de 491 líneas con split view + preview +
// toolbar rara + image picker. Ahora: solo título + body + botón flotante
// "Hecho" para guardar. Autosave cada cambio. Sin cliches.
//
// Uso típico:
// - Nueva nota: Navigator.push → NoteEditor(vaultPath: vp)
// - Editar: Navigator.push → NoteEditor(vaultPath: vp, notePath: np)

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/design_tokens.dart';
import '../../services/logger.dart';
import '../../services/template_service.dart';
import '../../services/vault_service.dart';
import '../../state/app_state.dart';
import '../../widgets/slash_menu.dart';

class NoteEditor extends StatefulWidget {
  final String vaultPath;

  /// Si es null, se crea una nota nueva. Si tiene valor, se edita.
  final String? notePath;

  /// Título inicial (solo para notas nuevas).
  final String? initialTitle;

  /// Contenido inicial (solo para notas nuevas).
  final String? initialContent;

  /// v0.62.16: template inicial (opcional) que pre-rellena el body.
  final DocTemplate? initialTemplate;

  const NoteEditor({
    super.key,
    required this.vaultPath,
    this.notePath,
    this.initialTitle,
    this.initialContent,
    this.initialTemplate,
  });

  @override
  State<NoteEditor> createState() => _NoteEditorState();
}

class _NoteEditorState extends State<NoteEditor> {
  late final TextEditingController _titleCtrl;
  late final TextEditingController _bodyCtrl;
  late final FocusNode _bodyFocus;

  VaultService? _vault;
  String? _currentPath;
  Timer? _debounce;
  bool _saving = false;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController(text: widget.initialTitle ?? '');
    _bodyCtrl = TextEditingController(
      text: widget.initialContent ?? widget.initialTemplate?.body ?? '',
    );
    _bodyFocus = FocusNode();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    // Flush pending save before disposing.
    _saveNow();
    _titleCtrl.dispose();
    _bodyCtrl.dispose();
    _bodyFocus.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final app = AppState.instance;
    if (widget.notePath != null) {
      _currentPath = widget.notePath;
      try {
        final svc = VaultService(widget.vaultPath);
        _vault = svc;
        final note = await svc.readNote(widget.notePath!);
        if (note != null && mounted) {
          final titleFromFrontmatter = note.frontmatter['title'];
          setState(() {
            _titleCtrl.text = titleFromFrontmatter?.isNotEmpty == true
                ? titleFromFrontmatter!
                : _titleFromFilename(widget.notePath!);
            _bodyCtrl.text = _stripFrontmatter(note.content);
            _loaded = true;
          });
        } else {
          _loaded = true;
        }
      } catch (e) {
        log.warn('note_editor', 'load failed', context: {'err': e.toString()});
        _loaded = true;
      }
    } else {
      _currentPath = null;
      _vault = VaultService(widget.vaultPath);
      _loaded = true;
    }
    // Autosave listener — escribe 1s después del último cambio.
    _titleCtrl.addListener(_scheduleAutosave);
    _bodyCtrl.addListener(_scheduleAutosave);
  }

  String _titleFromFilename(String path) {
    final base = path.split('/').last.replaceAll('.md', '');
    return base == 'Sin título' ? '' : base;
  }

  /// Quita el bloque frontmatter del contenido (lo gestionamos aparte).
  String _stripFrontmatter(String content) {
    if (!content.startsWith('---')) return content;
    final end = content.indexOf('---', 3);
    if (end <= 0) return content;
    return content.substring(end + 3).trimLeft();
  }

  void _scheduleAutosave() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 1000), _saveNow);
  }

  Future<void> _saveNow() async {
    if (!_loaded || _saving || _vault == null) return;
    final title = _titleCtrl.text.trim();
    final body = _bodyCtrl.text;
    _saving = true;
    try {
      if (_currentPath == null) {
        if (title.isEmpty && body.isEmpty) {
          _saving = false;
          return;
        }
        final folder = 'Inbox';
        final safeTitle = title.isEmpty ? 'Sin título' : title;
        final content = _composeContent(title, body);
        final path = await _vault!.createNote(
          folder: folder,
          title: safeTitle,
          content: content,
        );
        _currentPath = path;
      } else {
        final content = _composeContent(title, body);
        await _vault!.writeNote(_currentPath!, content);
      }
    } catch (e) {
      log.error('note_editor', 'save failed', context: {'err': e.toString()});
    } finally {
      _saving = false;
    }
  }

  String _composeContent(String title, String body) {
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final buf = StringBuffer();
    buf.writeln('---');
    if (title.isNotEmpty) buf.writeln('title: $title');
    buf.writeln('type: note');
    buf.writeln('date: $today');
    buf.writeln('---');
    buf.writeln();
    buf.write(body);
    return buf.toString();
  }

  void _close() async {
    _debounce?.cancel();
    await _saveNow();
    if (mounted) Navigator.of(context).pop(true);
  }

  /// v0.62.16: inserta un snippet markdown en la posición del cursor.
  void _insertMarkdown(String value) {
    final sel = _bodyCtrl.selection;
    if (!sel.isValid) return;
    final text = value;
    final newText = _bodyCtrl.text.replaceRange(sel.start, sel.end, text);
    _bodyCtrl.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(offset: sel.start + text.length),
    );
    _bodyFocus.requestFocus();
  }

  PopupMenuItem<String> _slashItem(String label, String snippet, String desc,
      IconData icon, String value) {
    return PopupMenuItem<String>(
      value: snippet,
      child: Row(
        children: [
          Icon(icon, size: 18, color: MxColors.indigoDeep),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                Text(desc, style: const TextStyle(fontSize: 11, color: Colors.grey)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // v0.62.17: en tablet/desktop, ancho del body limitado a 720dp centrado
    // (legibilidad óptima para markdown). En phone, ocupa todo el ancho.
    final isWide = MediaQuery.sizeOf(context).width >= 720;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: _close,
          tooltip: 'Cerrar (guarda)',
        ),
        title: Text(
          _saving ? 'Guardando…' : (_currentPath == null ? 'Nueva nota' : 'Editar'),
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
        ),
        actions: [
          // v0.62.16: Slash menu AFFiNE-style (comandos markdown rápidos).
          PopupMenuButton<String>(
            tooltip: 'Insertar',
            icon: const Icon(Icons.add_box_outlined),
            onSelected: (value) => _insertMarkdown(value),
            itemBuilder: (_) => [
              _slashItem('Encabezado 1', '# ', 'Título grande', Icons.title_rounded, 'h1'),
              _slashItem('Encabezado 2', '## ', 'Sección', Icons.title_rounded, 'h2'),
              _slashItem('Encabezado 3', '### ', 'Subsección', Icons.title_rounded, 'h3'),
              _slashItem('Lista', '- ', 'Lista con bullets', Icons.format_list_bulleted_rounded, 'list'),
              _slashItem('Numerada', '1. ', 'Lista numerada', Icons.format_list_numbered_rounded, 'ol'),
              _slashItem('Checklist', '- [ ] ', 'Tarea con checkbox', Icons.check_box_outlined, 'todo'),
              _slashItem('Cita', '> ', 'Bloque citado', Icons.format_quote_rounded, 'quote'),
              _slashItem('Código', '```\n\n```', 'Bloque de código', Icons.code_rounded, 'code'),
              _slashItem('Separador', '\n---\n', 'Línea horizontal', Icons.horizontal_rule_rounded, 'hr'),
              _slashItem('Cloze', '{{c1::texto}}', 'Tarjeta cloze', Icons.style_outlined, 'cloze'),
              _slashItem('Wikilink', '[[nota]]', 'Link a otra nota', Icons.link_rounded, 'wiki'),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.check_rounded),
            onPressed: _close,
            tooltip: 'Guardar y cerrar',
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: isWide ? 80 : 16,
            vertical: 12,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Título
              TextField(
                controller: _titleCtrl,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.3,
                ),
                decoration: const InputDecoration(
                  hintText: 'Título',
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                ),
                textInputAction: TextInputAction.next,
                onSubmitted: (_) => _bodyFocus.requestFocus(),
              ),
              Divider(color: Theme.of(context).dividerColor.withValues(alpha: 0.3)),
              const SizedBox(height: 8),
              // Body markdown
              Expanded(
                child: TextField(
                  controller: _bodyCtrl,
                  focusNode: _bodyFocus,
                  maxLines: null,
                  expands: true,
                  keyboardType: TextInputType.multiline,
                  textAlignVertical: TextAlignVertical.top,
                  style: const TextStyle(fontSize: 15, height: 1.5),
                  decoration: const InputDecoration(
                    hintText: '# Encabezado\n\nEscribe en **markdown**…\n\n- Listas\n- [Links](https://example.com)\n- ```código```',
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

