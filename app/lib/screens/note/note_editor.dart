// NoteEditor: editor markdown con split view + preview.
// Editor de nota: monospace, shortcuts de formato, auto-save.

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/shortcuts.dart';
import '../../core/theme.dart';
import '../../services/vault_service.dart';
import 'note_view.dart';

class NoteEditor extends StatefulWidget {
  final String notePath;
  const NoteEditor({super.key, required this.notePath});

  @override
  State<NoteEditor> createState() => _NoteEditorState();
}

class _NoteEditorState extends State<NoteEditor> {
  final _titleController = TextEditingController();
  final _bodyController = TextEditingController();
  final _bodyFocus = FocusNode();
  final _scrollController = ScrollController();

  VaultService? _vault;
  Note? _original;
  bool _saving = false;
  bool _isDirty = false;
  bool _showPreview = false;
  Timer? _autoSave;
  String _autosaveKey = '';

  @override
  void initState() {
    super.initState();
    _autosaveKey = 'mnexus.editor.${widget.notePath}';
    _load();
    _titleController.addListener(_onChange);
    _bodyController.addListener(_onChange);
  }

  Future<void> _load() async {
    final vaultPath = p.dirname(widget.notePath).split('/').sublist(
      0, p.dirname(widget.notePath).split('/').length - 1).join('/');
    _vault = VaultService(vaultPath);
    _original = await _vault!.readNote(widget.notePath);
    if (_original == null) return;
    final parsed = VaultService.parseFrontmatter(_original!.content);
    final bodyOnly = parsed.body;
    final titleFromFm = parsed.frontmatter['title'];
    setState(() {
      _titleController.text = titleFromFm ?? _original!.name;
      _bodyController.text = bodyOnly;
      _isDirty = false;
    });
  }

  void _onChange() {
    if (!_isDirty) setState(() { _isDirty = true; });
    _autoSave?.cancel();
    _autoSave = Timer(const Duration(seconds: 2), _autoSavePersist);
  }

  Future<void> _autoSavePersist() async {
    if (!_isDirty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('$_autosaveKey.body', _bodyController.text);
    await prefs.setString('$_autosaveKey.title', _titleController.text);
  }

  Future<void> _save() async {
    if (_vault == null) return;
    setState(() { _saving = true; });
    final title = _titleController.text.trim().isEmpty
        ? _original?.name ?? 'Sin título'
        : _titleController.text.trim();
    final body = _bodyController.text;
    final content = '''---
title: $title
date: ${DateTime.now().toIso8601String().substring(0, 10)}
modified: ${DateTime.now().toIso8601String()}
---

$body''';
    await _vault!.writeNote(widget.notePath, content);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('$_autosaveKey.body');
    await prefs.remove('$_autosaveKey.title');
    if (!mounted) return;
    setState(() { _saving = false; _isDirty = false; });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Guardado')),
    );
  }

  void _insertFormat(String before, String after) {
    final sel = _bodyController.selection;
    final text = _bodyController.text;
    if (sel.start < 0) return;
    final selected = sel.textInside(text);
    final newText = text.replaceRange(sel.start, sel.end, '$before$selected$after');
    _bodyController.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(
        offset: sel.start + before.length + selected.length,
      ),
    );
  }

  @override
  void dispose() {
    _autoSave?.cancel();
    _titleController.dispose();
    _bodyController.dispose();
    _bodyFocus.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isMobile = AppTheme.isMobile(context);
    return Shortcuts(
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.keyS, control: true): _SaveIntent(),
        SingleActivator(LogicalKeyboardKey.keyE, control: true): _TogglePreviewIntent(),
        SingleActivator(LogicalKeyboardKey.keyB, control: true): _BoldIntent(),
        SingleActivator(LogicalKeyboardKey.keyI, control: true): _ItalicIntent(),
        SingleActivator(LogicalKeyboardKey.escape): _EscapeIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          _SaveIntent: CallbackAction<_SaveIntent>(
            onInvoke: (i) { _save(); return null; },
          ),
          _TogglePreviewIntent: CallbackAction<_TogglePreviewIntent>(
            onInvoke: (i) { setState(() { _showPreview = !_showPreview; }); return null; },
          ),
          _BoldIntent: CallbackAction<_BoldIntent>(
            onInvoke: (i) { _insertFormat('**', '**'); return null; },
          ),
          _ItalicIntent: CallbackAction<_ItalicIntent>(
            onInvoke: (i) { _insertFormat('*', '*'); return null; },
          ),
          _EscapeIntent: CallbackAction<_EscapeIntent>(
            onInvoke: (i) {
              if (_showPreview) setState(() { _showPreview = false; });
              return null;
            },
          ),
        },
        child: Focus(
          autofocus: true,
          child: Scaffold(
            appBar: _buildAppBar(),
            body: isMobile ? _buildMobile() : _buildDesktop(),
          ),
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      title: Text(_titleController.text.isEmpty ? 'Sin título' : _titleController.text,
        overflow: TextOverflow.ellipsis),
      actions: [
        if (_isDirty)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 8),
            child: Center(
              child: Text('● sin guardar',
                style: TextStyle(fontSize: 11, color: Colors.orange)),
            ),
          ),
        if (!AppTheme.isMobile(context))
          IconButton(
            icon: Icon(_showPreview ? Icons.edit : Icons.visibility),
            onPressed: () => setState(() { _showPreview = !_showPreview; }),
            tooltip: 'Toggle preview (Ctrl+E)',
          ),
        IconButton(
          icon: _saving
              ? const SizedBox(width: 18, height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.save),
          onPressed: _saving ? null : _save,
          tooltip: 'Guardar (Ctrl+S)',
        ),
        const SizedBox(width: 8),
      ],
    );
  }

  Widget _buildMobile() {
    if (_showPreview) {
      return _buildPreview();
    }
    return _buildEditor();
  }

  Widget _buildDesktop() {
    return Row(
      children: [
        Expanded(flex: 1, child: _buildEditor()),
        const VerticalDivider(width: 1),
        Expanded(flex: 1, child: _buildPreview()),
      ],
    );
  }

  Widget _buildEditor() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Title
          TextField(
            controller: _titleController,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
            decoration: const InputDecoration(
              hintText: 'Título',
              border: InputBorder.none,
              filled: false,
              contentPadding: EdgeInsets.zero,
            ),
          ),
          const SizedBox(height: 12),
          // Format toolbar
          Wrap(
            spacing: 4,
            children: [
              _FormatBtn(icon: Icons.format_bold, tooltip: 'Bold (Ctrl+B)',
                onPressed: () => _insertFormat('**', '**')),
              _FormatBtn(icon: Icons.format_italic, tooltip: 'Italic (Ctrl+I)',
                onPressed: () => _insertFormat('*', '*')),
              _FormatBtn(icon: Icons.code, tooltip: 'Code',
                onPressed: () => _insertFormat('`', '`')),
              _FormatBtn(icon: Icons.title, tooltip: 'Heading',
                onPressed: () => _insertFormat('\n## ', '\n')),
              _FormatBtn(icon: Icons.format_list_bulleted, tooltip: 'Lista',
                onPressed: () => _insertFormat('\n- ', '\n')),
              _FormatBtn(icon: Icons.format_quote, tooltip: 'Cita',
                onPressed: () => _insertFormat('\n> ', '\n')),
              _FormatBtn(icon: Icons.link, tooltip: 'Link',
                onPressed: () => _insertFormat('[', '](url)')),
            ],
          ),
          const Divider(height: 24),
          // Body
          TextField(
            controller: _bodyController,
            focusNode: _bodyFocus,
            maxLines: null,
            minLines: 20,
            style: const TextStyle(
              fontSize: 14, fontFamily: 'monospace', height: 1.5,
            ),
            decoration: const InputDecoration(
              hintText: 'Empezá a escribir…\n\n'
                  '# Heading\n**bold** *italic*\n- lista\n'
                  '[[link a otra nota]]\n![imagen](ruta.png)',
              border: InputBorder.none,
              filled: false,
              contentPadding: EdgeInsets.zero,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPreview() {
    return Container(
      color: Theme.of(context).colorScheme.surfaceContainerLowest,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: MarkdownBody(
          data: _bodyController.text.isEmpty ? '_(vacío)_' : _bodyController.text,
          selectable: true,
          onTapLink: (text, href, title) {
            if (href == null) return;
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Link: $href')),
            );
          },
        ),
      ),
    );
  }
}

class _FormatBtn extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;
  const _FormatBtn({
    required this.icon, required this.tooltip, required this.onPressed,
  });
  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(icon, size: 18),
      tooltip: tooltip,
      onPressed: onPressed,
      visualDensity: VisualDensity.compact,
    );
  }
}

class _SaveIntent extends Intent { const _SaveIntent(); }
class _TogglePreviewIntent extends Intent { const _TogglePreviewIntent(); }
class _BoldIntent extends Intent { const _BoldIntent(); }
class _ItalicIntent extends Intent { const _ItalicIntent(); }
class _EscapeIntent extends Intent { const _EscapeIntent(); }
