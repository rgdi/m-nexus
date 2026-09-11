// NoteEditor: editor markdown con split view + preview.
// v0.47.1: arreglado para soportar creación de notas nuevas (notePath nullable).
// Antes: requeria notePath obligatorio, lo que causaba crash al crear desde home.

import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import '../../l10n/app_localizations.dart';
import '../../core/shortcuts.dart';
import '../../core/theme.dart';
import '../../services/vault_service.dart';
import '../../services/logger.dart';
import '../../state/app_state.dart';
import '../../utils/safe_call.dart';
import 'note_view.dart';

class NoteEditor extends StatefulWidget {
  final String vaultPath;

  /// Si es null, se crea una nota nueva. Si tiene valor, se edita.
  final String? notePath;

  /// Título inicial (solo para notas nuevas).
  final String? initialTitle;

  /// Contenido inicial (solo para notas nuevas).
  final String? initialContent;

  const NoteEditor({
    super.key,
    required this.vaultPath,
    this.notePath,
    this.initialTitle,
    this.initialContent,
  });

  @override
  State<NoteEditor> createState() => _NoteEditorState();
}

class _NoteEditorState extends State<NoteEditor> {
  final _titleController = TextEditingController();
  final _bodyController = TextEditingController();
  // v0.47.30: focus nodes explícitos + listener que desenfoca el otro campo
  // cuando uno gana foco. Antes el title TextField no tenía focusNode, así
  // que cuando el body capturaba el foco, el title no podía recuperarlo al
  // re-tapear — Flutter lo descartaba porque el GestureDetector del
  // Expanded del body interceptaba el tap antes de llegar al title.
  final _titleFocus = FocusNode(debugLabel: 'note-editor-title');
  final _bodyFocus = FocusNode(debugLabel: 'note-editor-body');
  final _scrollController = ScrollController();
  final _log = AdvancedLogger.instance;
  final ImagePicker _imagePicker = ImagePicker();

  VaultService? _vault;
  Note? _original;
  bool _saving = false;
  bool _isDirty = false;
  bool _showPreview = false;
  Timer? _autoSave;
  String _autosaveKey = '';
  bool _isNewNote = true;

  @override
  void initState() {
    super.initState();
    _isNewNote = widget.notePath == null;
    _autosaveKey = 'mnexus.editor.${widget.notePath ?? "new-${DateTime.now().millisecondsSinceEpoch}"}';
    if (_isNewNote) {
      _titleController.text = widget.initialTitle ?? '';
      _bodyController.text = widget.initialContent ?? '';
    } else {
      _load();
    }
    _titleController.addListener(_onChange);
    _bodyController.addListener(_onChange);
    _bodyFocus.addListener(() => setState(() {}));
    // v0.47.30: mutually-exclusive focus entre title y body. Cuando el
    // title gana foco, el body pierde foco y se cierra el teclado del
    // body (si estaba visible). Viceversa para el body.
    _titleFocus.addListener(() {
      if (_titleFocus.hasFocus && _bodyFocus.hasFocus) {
        _bodyFocus.unfocus();
      }
      setState(() {});
    });
    _bodyFocus.addListener(() {
      if (_bodyFocus.hasFocus && _titleFocus.hasFocus) {
        _titleFocus.unfocus();
      }
      setState(() {});
    });
  }

  @override
  void dispose() {
    _autoSave?.cancel();
    _titleController.dispose();
    _bodyController.dispose();
    _titleFocus.dispose();
    _bodyFocus.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (widget.notePath == null) return;
    setState(() {
      _vault = VaultService(widget.vaultPath);
    });
    final note = await _vault!.readNote(widget.notePath!);
    if (!mounted) return;
    if (note == null) {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _original = note;
      _titleController.text = note.title ?? '';
      _bodyController.text = note.content;
      _isDirty = false;
    });
  }

  void _onChange() {
    if (!_isDirty) {
      setState(() => _isDirty = true);
    }
    _autoSave?.cancel();
    _autoSave = Timer(const Duration(seconds: 2), _autoSavePersist);
  }

  Future<void> _autoSavePersist() async {
    // Autosave only saves to SharedPreferences for crash recovery
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('$_autosaveKey.title', _titleController.text);
    await prefs.setString('$_autosaveKey.body', _bodyController.text);
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    final body = _bodyController.text;
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('El título es obligatorio')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      _vault ??= VaultService(widget.vaultPath);
      Note saved;
      if (_isNewNote) {
        // Crea nota nueva (en root o subcarpeta notes)
        final path = await _vault!.createNote(
          folder: 'notes',
          title: title,
          content: body.isEmpty ? '# $title\n' : body,
        );
        // v0.47.21: mounted check tras await antes de setState.
        if (!mounted) return;
        setState(() {
          _isNewNote = false;
          _original = Note(
            path: path,
            relPath: path.replaceFirst(widget.vaultPath, ''),
            name: p.basename(path),
            content: body,
            frontmatter: {},
            modified: DateTime.now(),
            sizeBytes: body.length,
            tags: const [],
            links: const [],
            title: title,
          );
        });
      } else {
        // Edita nota existente
        await _vault!.writeNote(widget.notePath!, body);
        // v0.47.33: safe null check en readNote. readNote retorna Note?
        // y el ! lanzaba Null check operator cuando el archivo no existía
        // por race conditions (e.g., el archivo se borró antes del read).
        // Ahora logueamos el warning y continuamos con el _original previo.
        final readResult = await _vault!.readNote(widget.notePath!);
        if (readResult == null) {
          _log.warn('note_editor', 'readNote returned null after writeNote',
              context: {'path': widget.notePath});
        } else {
          saved = readResult;
          _original = saved;
        }
      }
      // Recarga AppState
      await AppState.instance.reload();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Guardado'), duration: Duration(seconds: 2)),
      );
      setState(() {
        _isDirty = false;
        _saving = false;
      });
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  void _insertFormat(String open, String close) {
    final sel = _bodyController.selection;
    final text = _bodyController.text;
    if (sel.start < 0) return;
    final before = text.substring(0, sel.start);
    final mid = text.substring(sel.start, sel.end);
    final after = text.substring(sel.end);
    final newText = '$before$open$mid$close$after';
    _bodyController.value = TextEditingValue(
      text: newText,
      selection: TextSelection(
        baseOffset: sel.start + open.length,
        extentOffset: sel.start + open.length + mid.length,
      ),
    );
    _bodyFocus.requestFocus();
  }

  /// Opens the image picker, copies the chosen file into
  /// `<vaultPath>/_M-NEXUS/images/<uuid>.<ext>`, and inserts a markdown
  /// image reference `![alt](relative_path)` at the current cursor
  /// position.
  ///
  /// Exposed as a top-level helper (see [pickAndInsertImage]) so the
  /// behaviour can be exercised by unit tests with a mocked
  /// [ImagePicker].
  Future<void> _pickAndInsertImage() async {
    await pickAndInsertImage(
      picker: _imagePicker,
      vaultPath: widget.vaultPath,
      bodyController: _bodyController,
      bodyFocus: _bodyFocus,
      log: _log,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(_isNewNote ? 'Nueva nota' : (_titleController.text.isEmpty ? 'Editar' : _titleController.text)),
        actions: [
          IconButton(
            icon: const Icon(Icons.image_outlined),
            onPressed: _pickAndInsertImage,
            tooltip: 'Insertar imagen',
          ),
          IconButton(
            icon: Icon(_showPreview ? Icons.edit : Icons.preview),
            onPressed: () => setState(() => _showPreview = !_showPreview),
            tooltip: _showPreview ? 'Editar' : 'Vista previa',
          ),
          if (_isDirty && !_saving)
            const Padding(
              padding: EdgeInsets.only(right: 8),
              child: Center(
                child: SizedBox(
                  width: 8, height: 8,
                  child: CircularProgressIndicator(strokeWidth: 1.5),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.save, size: 16),
              label: const Text('Guardar'),
              style: FilledButton.styleFrom(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Title
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            // v0.47.30: tapTargetSize + explicit focusNode. Antes el title
            // TextField no tenía focusNode y la zona de tap era estrecha;
            // combinado con el GestureDetector del body Expanded (que
            // intercepta taps en su área), el title field no recibía taps
            // cuando el body ya tenía foco. Con focusNode explícito +
            // mutually-exclusive focus listener (en initState), Flutter
            // sabe a quién desviar el foco.
            child: TextField(
              controller: _titleController,
              focusNode: _titleFocus,
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              decoration: const InputDecoration(
                hintText: 'Título de la nota',
                border: InputBorder.none,
                contentPadding: EdgeInsets.symmetric(vertical: 8),
              ),
            ),
          ),
          // Toolbar
          if (!_showPreview)
            _buildToolbar(theme),
          // Body
          Expanded(
            child: _showPreview
                ? _buildPreview(theme)
                : _buildEditor(theme),
          ),
        ],
      ),
    );
  }

  Widget _buildToolbar(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: theme.colorScheme.outlineVariant.withOpacity(0.3))),
      ),
      child: Row(
        children: [
          _ToolbarBtn(icon: Icons.format_bold, onTap: () => _insertFormat('**', '**')),
          _ToolbarBtn(icon: Icons.format_italic, onTap: () => _insertFormat('*', '*')),
          _ToolbarBtn(icon: Icons.code, onTap: () => _insertFormat('`', '`')),
          _ToolbarBtn(icon: Icons.title, onTap: () => _insertFormat('\n## ', '')),
          _ToolbarBtn(icon: Icons.format_list_bulleted, onTap: () => _insertFormat('\n- ', '')),
          _ToolbarBtn(icon: Icons.format_quote, onTap: () => _insertFormat('\n> ', '')),
          _ToolbarBtn(icon: Icons.link, onTap: () => _insertFormat('[[', ']]')),
          const Spacer(),
        ],
      ),
    );
  }

  Widget _buildEditor(ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: TextField(
        controller: _bodyController,
        focusNode: _bodyFocus,
        maxLines: null,
        expands: true,
        textAlignVertical: TextAlignVertical.top,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 14, height: 1.6),
        decoration: const InputDecoration(
          hintText: 'Empieza a escribir...',
          border: InputBorder.none,
        ),
      ),
    );
  }

  Widget _buildPreview(ThemeData theme) {
    final body = _bodyController.text;
    return Container(
      padding: const EdgeInsets.all(16),
      child: MarkdownBody(
        data: body.isEmpty ? '*Sin contenido*' : body,
        styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
          p: theme.textTheme.bodyLarge,
          h1: theme.textTheme.headlineLarge,
          h2: theme.textTheme.headlineMedium,
          code: TextStyle(
            fontFamily: 'monospace',
            backgroundColor: theme.colorScheme.surfaceContainerHigh,
          ),
        ),
      ),
    );
  }
}

class _ToolbarBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  const _ToolbarBtn({required this.icon, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(icon, size: 18),
      onPressed: onTap,
      visualDensity: VisualDensity.compact,
      tooltip: '',
    );
  }
}

/// Image subfolder inside the vault's `_M-NEXUS/` directory.
const String _kImagesDir = '_M-NEXUS/images';

const Uuid _uuidGen = Uuid();

/// Opens the image picker, copies the chosen file into
/// `<vaultPath>/_M-NEXUS/images/<uuid>.<ext>`, and inserts a markdown
/// image reference `![alt](relative_path)` at the current cursor
/// position inside [bodyController].
///
/// This is a pure function (no `BuildContext`, no implicit
/// dependencies) so unit tests can drive it with a mocked [picker].
Future<void> pickAndInsertImage({
  required ImagePicker picker,
  required String vaultPath,
  required TextEditingController bodyController,
  required FocusNode bodyFocus,
  AdvancedLogger? log,
}) async {
  final XFile? picked;
  try {
    picked = await picker.pickImage(source: ImageSource.gallery);
  } catch (e, st) {
    log?.error('note_editor', 'image_picker.pickImage threw',
        error: e, stack: st);
    return;
  }
  if (picked == null) {
    // User dismissed the picker — silent no-op.
    return;
  }

  final ext = p.extension(picked.path).toLowerCase();
  final safeExt = ext.isEmpty ? '.png' : ext;
  final id = _uuidGen.v4();
  final filename = '$id$safeExt';
  final imagesDir = Directory(p.join(vaultPath, _kImagesDir));
  try {
    if (!await imagesDir.exists()) {
      await imagesDir.create(recursive: true);
    }
  } catch (e, st) {
    log?.error('note_editor', 'imagesDir.create failed',
        error: e, stack: st,
        context: {'path': imagesDir.path});
    return;
  }

  final dest = File(p.join(imagesDir.path, filename));
  try {
    await File(picked.path).copy(dest.path);
  } catch (e, st) {
    log?.error('note_editor', 'image copy failed',
        error: e, stack: st,
        context: {'src': picked.path, 'dst': dest.path});
    return;
  }

  final relativePath = '$_kImagesDir/$filename';
  final alt = 'image';
  final markdown = '![$alt]($relativePath)';
  _insertAtCursor(bodyController, bodyFocus, markdown);
}

/// Inserts [text] into [controller] at the current selection, leaving
/// the cursor immediately after the inserted text.
void _insertAtCursor(
  TextEditingController controller,
  FocusNode focus,
  String text,
) {
  final sel = controller.selection;
  final base = controller.text;
  final start = sel.start < 0 ? base.length : sel.start;
  final end = sel.start < 0 ? base.length : sel.end;
  final before = base.substring(0, start);
  final after = base.substring(end);
  final newText = '$before$text$after';
  final caret = start + text.length;
  controller.value = TextEditingValue(
    text: newText,
    selection: TextSelection.collapsed(offset: caret),
  );
  focus.requestFocus();
}
