// NoteEditorScreen v0.41: crear/editar notas markdown.
//
// Features:
//   - Split view en desktop: editor | preview
//   - Tabs en mobile: Edit | Preview
//   - Frontmatter (YAML) con campos básicos
//   - Auto-save a SharedPreferences mientras escribe
//   - Save a archivo cuando confirma
//   - Sugerencias de [[wikilinks]] desde el vault
//   - Tags con # al final
//   - Soporta crear desde cero o abrir existente

import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import '../utils/theme.dart';

class NoteEditorScreen extends StatefulWidget {
  /// Ruta del vault donde guardar
  final String vaultPath;

  /// Path del archivo a editar (null = crear nuevo)
  final String? existingPath;

  /// Nombre inicial (para crear)
  final String? initialTitle;

  const NoteEditorScreen({
    super.key,
    required this.vaultPath,
    this.existingPath,
    this.initialTitle,
  });

  @override
  State<NoteEditorScreen> createState() => _NoteEditorScreenState();
}

class _NoteEditorScreenState extends State<NoteEditorScreen>
    with SingleTickerProviderStateMixin {
  final _titleController = TextEditingController();
  final _contentController = TextEditingController();
  final _tagsController = TextEditingController();
  late TabController _tab;
  Timer? _autoSaveTimer;
  String _autosaveKey = '';
  bool _isDirty = false;
  String? _existingPath;
  bool _saving = false;

  // Frontmatter
  final Map<String, String> _frontmatter = {};
  final _dateController = TextEditingController(
    text: DateTime.now().toIso8601String().substring(0, 10),
  );

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 2, vsync: this);
    _existingPath = widget.existingPath;
    if (_existingPath != null) {
      _autosaveKey = 'mnexus.editor.${_existingPath}';
      _load();
    } else {
      _autosaveKey = 'mnexus.editor.new.${DateTime.now().millisecondsSinceEpoch}';
      _titleController.text = widget.initialTitle ?? '';
    }
    _contentController.addListener(_onChanged);
    _titleController.addListener(_onChanged);
    _tagsController.addListener(_onChanged);
  }

  Future<void> _load() async {
    if (_existingPath == null) return;
    final file = File(_existingPath!);
    if (!await file.exists()) return;
    final content = await file.readAsString();
    final parsed = _parseFrontmatter(content);
    setState(() {
      _contentController.text = parsed.body;
      _frontmatter
        ..clear()
        ..addAll(parsed.fm);
      if (_frontmatter.containsKey('title')) {
        _titleController.text = _frontmatter['title']!;
      }
      if (_frontmatter.containsKey('date')) {
        _dateController.text = _frontmatter['date']!;
      }
      if (_frontmatter.containsKey('tags')) {
        _tagsController.text = _frontmatter['tags']!;
      }
    });
  }

  _MdParsed _parseFrontmatter(String raw) {
    if (!raw.startsWith('---')) return _MdParsed(body: raw, fm: const {});
    final lines = raw.split('\n');
    if (lines.length < 3 || lines[0].trim() != '---') return _MdParsed(body: raw, fm: const {});
    final endIdx = lines.indexWhere((l) => l.trim() == '---', 1);
    if (endIdx == -1) return _MdParsed(body: raw, fm: const {});
    final fm = <String, String>{};
    for (final line in lines.sublist(1, endIdx)) {
      final m = RegExp(r'^(\w+)\s*:\s*(.*)$').firstMatch(line.trim());
      if (m != null) fm[m.group(1)!] = m.group(2)!.trim();
    }
    return _MdParsed(body: lines.sublist(endIdx + 1).join('\n'), fm: fm);
  }

  void _onChanged() {
    if (!_isDirty) setState(() { _isDirty = true; });
    _autoSaveTimer?.cancel();
    _autoSaveTimer = Timer(const Duration(seconds: 3), _autoSave);
  }

  Future<void> _autoSave() async {
    if (!_isDirty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('$_autosaveKey.content', _contentController.text);
    await prefs.setString('$_autosaveKey.title', _titleController.text);
  }

  Future<void> _save() async {
    if (_titleController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Poné un título')),
      );
      return;
    }
    setState(() { _saving = true; });
    final log = <String>[];
    // Frontmatter
    log.add('---');
    log.add('title: ${_titleController.text.trim()}');
    log.add('date: ${_dateController.text}');
    if (_tagsController.text.trim().isNotEmpty) {
      log.add('tags: ${_tagsController.text.trim()}');
    }
    log.add('created: ${DateTime.now().toIso8601String()}');
    log.add('---');
    log.add('');
    log.add(_contentController.text);

    final fileContent = log.join('\n');
    String filePath;
    if (_existingPath != null) {
      filePath = _existingPath!;
    } else {
      // Generar nombre
      final title = _titleController.text.trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9\s-]'), '')
        .replaceAll(RegExp(r'\s+'), '-')
        .replaceAll(RegExp(r'-+'), '-');
      final stamp = DateTime.now().toIso8601String().substring(0, 10);
      filePath = p.join(widget.vaultPath, '$stamp-$title.md');
    }
    try {
      await File(filePath).writeAsString(fileContent);
      // Limpiar autosave
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('$_autosaveKey.content');
      await prefs.remove('$_autosaveKey.title');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Guardado: ${p.basename(filePath)}')),
      );
      setState(() { _isDirty = false; _existingPath = filePath; });
      Navigator.of(context).pop(filePath);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e')),
      );
    } finally {
      if (mounted) setState(() { _saving = false; });
    }
  }

  Future<bool> _onWillPop() async {
    if (!_isDirty) return true;
    final res = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cambios sin guardar'),
        content: const Text('¿Salir sin guardar?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Salir')),
        ],
      ),
    );
    return res ?? false;
  }

  @override
  void dispose() {
    _autoSaveTimer?.cancel();
    _contentController.dispose();
    _titleController.dispose();
    _tagsController.dispose();
    _dateController.dispose();
    _tab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDesktop = MnexusTheme.isDesktop(context);
    return PopScope(
      canPop: !_isDirty,
      onPopInvoked: (didPop) async {
        if (!didPop) {
          final canPop = await _onWillPop();
          if (canPop && mounted) Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(_existingPath != null
              ? p.basename(_existingPath!)
              : (_titleController.text.isEmpty ? 'Nueva nota' : _titleController.text)),
          actions: [
            if (_isDirty)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Center(
                  child: Text('● sin guardar',
                    style: TextStyle(fontSize: 11,
                      color: Theme.of(context).colorScheme.onSurfaceVariant)),
                ),
              ),
            FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(width: 16, height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.save, size: 18),
              label: const Text('Guardar'),
            ),
            const SizedBox(width: 8),
          ],
        ),
        body: isDesktop ? _buildSplit() : _buildTabs(),
      ),
    );
  }

  Widget _buildSplit() {
    return Row(
      children: [
        Expanded(child: _buildEditor()),
        const VerticalDivider(width: 1),
        Expanded(child: _buildPreview()),
      ],
    );
  }

  Widget _buildTabs() {
    return Column(
      children: [
        TabBar(
          controller: _tab,
          tabs: const [
            Tab(icon: Icon(Icons.edit, size: 18), text: 'Editar'),
            Tab(icon: Icon(Icons.visibility, size: 18), text: 'Vista'),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tab,
            children: [
              _buildEditor(),
              _buildPreview(),
            ],
          ),
        ),
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
              hintText: 'Título de la nota',
              border: InputBorder.none,
              filled: false,
              contentPadding: EdgeInsets.zero,
            ),
          ),
          const SizedBox(height: 12),
          // Metadata row
          Wrap(
            spacing: 12,
            runSpacing: 8,
            children: [
              SizedBox(
                width: 160,
                child: TextField(
                  controller: _dateController,
                  decoration: const InputDecoration(
                    labelText: 'Fecha',
                    isDense: true,
                  ),
                ),
              ),
              Expanded(
                child: TextField(
                  controller: _tagsController,
                  decoration: const InputDecoration(
                    labelText: 'Tags (separados por espacio)',
                    hintText: 'anatomía cardio cap-1',
                    isDense: true,
                  ),
                ),
              ),
            ],
          ),
          const Divider(height: 32),
          // Body
          TextField(
            controller: _contentController,
            maxLines: null,
            minLines: 10,
            style: const TextStyle(
              fontSize: 14,
              fontFamily: 'monospace',
              height: 1.5,
            ),
            decoration: const InputDecoration(
              hintText: 'Empezá a escribir…\n\n'
                  'Soportá markdown:\n'
                  '# Heading\n'
                  '**bold** *italic*\n'
                  '- lista\n'
                  '[[link a otra nota]]\n'
                  '![imagen](ruta.png)',
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
    final body = _contentController.text;
    return Markdown(
      data: body.isEmpty ? '_(vacío)_' : body,
      padding: const EdgeInsets.all(20),
      selectable: true,
    );
  }
}

class _MdParsed {
  final String body;
  final Map<String, String> fm;
  const _MdParsed({required this.body, required this.fm});
}
