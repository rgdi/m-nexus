// block_editor.dart: editor de bloques estilo AFFiNE/Notion.
//
// v0.49.8: editor estructurado por bloques en lugar de markdown plano.
// Cada bloque es una unidad (paragraph, heading, todo, bullet, quote, code,
// divider, image, table, math) que se renderiza y se puede manipular
// individualmente. Slash menu (/ al inicio del bloque) para insertar
// nuevos bloques.
//
// Formato en disco: el archivo sigue siendo markdown (compatibilidad con
// el resto de la app). El editor transforma el markdown en bloques al
// cargar y al guardar.
//
// Limitaciones v0.49.8:
//   - Tablas: row-by-row en una lista (no grid real, eso en v0.50)
//   - Math: KaTeX no disponible en Flutter, mostramos formula en monospace
//   - Code: highlight basico (no syntax highlight completo)
//   - Whiteboards / mind maps: en v0.50 (requieren canvas custom)

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../../core/design_tokens.dart';
import '../../services/vault_service.dart';
import '../../services/logger.dart';
import '../../state/app_state.dart';

enum BlockType {
  paragraph,
  heading1,
  heading2,
  heading3,
  bulletList,
  numberedList,
  todo,
  quote,
  code,
  divider,
  callout,
  table,
  math,
  image,
}

extension BlockTypeMeta on BlockType {
  String get label {
    switch (this) {
      case BlockType.paragraph: return 'Texto';
      case BlockType.heading1: return 'Título 1';
      case BlockType.heading2: return 'Título 2';
      case BlockType.heading3: return 'Título 3';
      case BlockType.bulletList: return 'Lista con viñetas';
      case BlockType.numberedList: return 'Lista numerada';
      case BlockType.todo: return 'Tarea';
      case BlockType.quote: return 'Cita';
      case BlockType.code: return 'Código';
      case BlockType.divider: return 'Divisor';
      case BlockType.callout: return 'Callout';
      case BlockType.table: return 'Tabla';
      case BlockType.math: return 'Fórmula';
      case BlockType.image: return 'Imagen';
    }
  }

  IconData get icon {
    switch (this) {
      case BlockType.paragraph: return Icons.notes_rounded;
      case BlockType.heading1: return Icons.title_rounded;
      case BlockType.heading2: return Icons.title_outlined;
      case BlockType.heading3: return Icons.subtitle_outlined;
      case BlockType.bulletList: return Icons.format_list_bulleted_rounded;
      case BlockType.numberedList: return Icons.format_list_numbered_rounded;
      case BlockType.todo: return Icons.check_box_outlined;
      case BlockType.quote: return Icons.format_quote_rounded;
      case BlockType.code: return Icons.code_rounded;
      case BlockType.divider: return Icons.horizontal_rule_rounded;
      case BlockType.callout: return Icons.lightbulb_outline_rounded;
      case BlockType.table: return Icons.table_chart_outlined;
      case BlockType.math: return Icons.calculate_outlined;
      case BlockType.image: return Icons.image_outlined;
    }
  }

  String get hint {
    switch (this) {
      case BlockType.paragraph: return 'Texto';
      case BlockType.heading1: return 'Título';
      case BlockType.heading2: return 'Subtítulo';
      case BlockType.heading3: return 'Sección';
      case BlockType.bulletList: return 'Elemento';
      case BlockType.numberedList: return 'Elemento';
      case BlockType.todo: return 'Tarea';
      case BlockType.quote: return 'Cita';
      case BlockType.code: return 'Código';
      case BlockType.divider: return '';
      case BlockType.callout: return 'Callout';
      case BlockType.table: return 'Celda';
      case BlockType.math: return 'LaTeX: E=mc^2';
      case BlockType.image: return 'URL o adjuntar';
    }
  }
}

class Block {
  final String id;
  BlockType type;
  String text;
  bool checked; // para todo
  // para table: filas (cada fila es lista de celdas)
  List<List<String>>? tableRows;
  // para callout: emoji
  String? emoji;
  // para image: ruta local
  String? imagePath;

  Block({
    required this.id,
    required this.type,
    this.text = '',
    this.checked = false,
    this.tableRows,
    this.emoji,
    this.imagePath,
  });

  factory Block.paragraph() => Block(id: _newId(), type: BlockType.paragraph);
  static String _newId() => 'b-${DateTime.now().microsecondsSinceEpoch}-${_counter++}';
  static int _counter = 0;
}

class BlockEditor extends StatefulWidget {
  final String vaultPath;
  final String? notePath;
  final String? initialTitle;
  const BlockEditor({super.key, required this.vaultPath, this.notePath, this.initialTitle});

  @override
  State<BlockEditor> createState() => _BlockEditorState();
}

class _BlockEditorState extends State<BlockEditor> {
  final _titleController = TextEditingController();
  final _scrollController = ScrollController();
  final Map<String, TextEditingController> _controllers = {};
  final Map<String, FocusNode> _focusNodes = {};
  final List<Block> _blocks = [];
  String? _slashMenuFor; // id del bloque con menu abierto
  bool _saving = false;
  String? _loadedFrom;
  late final VaultService _vault;

  @override
  void initState() {
    super.initState();
    _vault = VaultService(widget.vaultPath);
    _init();
  }

  Future<void> _init() async {
    if (widget.notePath != null) {
      final note = await _vault.readNote(widget.notePath!);
      if (note != null) {
        _loadedFrom = widget.notePath;
        _titleController.text = note.title ?? widget.initialTitle ?? '';
        final parsed = _parseMarkdown(note.content);
        setState(() {
          _blocks.clear();
          _blocks.addAll(parsed);
          if (_blocks.isEmpty) _blocks.add(Block.paragraph());
        });
        return;
      }
    }
    _titleController.text = widget.initialTitle ?? '';
    setState(() {
      _blocks.clear();
      _blocks.add(Block.paragraph());
    });
  }

  @override
  void dispose() {
    _titleController.dispose();
    _scrollController.dispose();
    for (final c in _controllers.values) c.dispose();
    for (final n in _focusNodes.values) n.dispose();
    super.dispose();
  }

  TextEditingController _controllerFor(Block b) {
    return _controllers.putIfAbsent(b.id, () {
      final c = TextEditingController(text: b.text);
      c.addListener(() {
        b.text = c.text;
      });
      return c;
    });
  }

  FocusNode _focusFor(Block b) {
    return _focusNodes.putIfAbsent(b.id, FocusNode.new);
  }

  /// v0.49.8: parse markdown to blocks
  /// Heuristica simple: cada linea o grupo de lineas = 1 bloque.
  /// Distingue frontmatter (--- al inicio) de divider (en cualquier otro lugar).
  List<Block> _parseMarkdown(String md) {
    final out = <Block>[];
    final lines = md.split('\n');
    int i = 0;
    // Detectar frontmatter solo al inicio
    bool frontmatterSkipped = false;
    if (lines.isNotEmpty && lines[0].trim() == '---') {
      int j = 1;
      while (j < lines.length && lines[j].trim() != '---') j++;
      if (j < lines.length) {
        // Hay cierre --- al inicio -> frontmatter
        i = j + 1;
        frontmatterSkipped = true;
      }
    }
    while (i < lines.length) {
      final l = lines[i];
      if (l.isEmpty) { i++; continue; }
      if (l.startsWith('# ')) {
        out.add(Block(id: Block._newId(), type: BlockType.heading1, text: l.substring(2)));
      } else if (l.startsWith('## ')) {
        out.add(Block(id: Block._newId(), type: BlockType.heading2, text: l.substring(3)));
      } else if (l.startsWith('### ')) {
        out.add(Block(id: Block._newId(), type: BlockType.heading3, text: l.substring(4)));
      } else if (l.startsWith('- [ ] ')) {
        out.add(Block(id: Block._newId(), type: BlockType.todo, text: l.substring(6)));
      } else if (l.startsWith('- [x] ') || l.startsWith('- [X] ')) {
        out.add(Block(id: Block._newId(), type: BlockType.todo, text: l.substring(6), checked: true));
      } else if (l.startsWith('- ') || l.startsWith('* ')) {
        out.add(Block(id: Block._newId(), type: BlockType.bulletList, text: l.substring(2)));
      } else if (RegExp(r'^\d+\. ').hasMatch(l)) {
        out.add(Block(id: Block._newId(), type: BlockType.numberedList, text: l.replaceFirst(RegExp(r'^\d+\. '), '')));
      } else if (l.startsWith('> ')) {
        out.add(Block(id: Block._newId(), type: BlockType.quote, text: l.substring(2)));
      } else if (l.startsWith('```')) {
        final code = StringBuffer();
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          code.writeln(lines[i]);
          i++;
        }
        out.add(Block(id: Block._newId(), type: BlockType.code, text: code.toString().trimRight()));
      } else if (l.trim() == '---' || l.trim() == '***') {
        out.add(Block(id: Block._newId(), type: BlockType.divider));
      } else {
        out.add(Block(id: Block._newId(), type: BlockType.paragraph, text: l));
      }
      i++;
    }
    if (!frontmatterSkipped) {
      // Caso edge: --- dentro del body (no frontmatter) ya se maneja como divider
    }
    return out;
  }

  /// v0.49.8: serialize blocks back to markdown
  String _serializeToMarkdown() {
    final buf = StringBuffer();
    for (int i = 0; i < _blocks.length; i++) {
      final b = _blocks[i];
      switch (b.type) {
        case BlockType.heading1: buf.writeln('# ${b.text}'); break;
        case BlockType.heading2: buf.writeln('## ${b.text}'); break;
        case BlockType.heading3: buf.writeln('### ${b.text}'); break;
        case BlockType.bulletList: buf.writeln('- ${b.text}'); break;
        case BlockType.numberedList: buf.writeln('1. ${b.text}'); break;
        case BlockType.todo: buf.writeln(b.checked ? '- [x] ${b.text}' : '- [ ] ${b.text}'); break;
        case BlockType.quote: buf.writeln('> ${b.text}'); break;
        case BlockType.code: buf.writeln('```\n${b.text}\n```'); break;
        case BlockType.divider: buf.writeln('---'); break;
        case BlockType.callout: buf.writeln('> ${b.emoji ?? "💡"} ${b.text}'); break;
        case BlockType.table:
          if (b.tableRows != null) {
            for (final row in b.tableRows!) {
              buf.writeln('| ${row.join(' | ')} |');
            }
          }
          break;
        case BlockType.math: buf.writeln('\$\$${b.text}\$\$'); break;
        case BlockType.image: buf.writeln('![${b.text}](${b.imagePath ?? ""})'); break;
        case BlockType.paragraph: buf.writeln(b.text); break;
      }
      buf.writeln();
    }
    return buf.toString();
  }

  void _addBlockAfter(Block current, BlockType type) {
    final idx = _blocks.indexOf(current);
    final next = Block(id: Block._newId(), type: type);
    setState(() {
      _blocks.insert(idx + 1, next);
      _slashMenuFor = null;
      if (current.type == BlockType.paragraph) {
        final c = _controllers[current.id];
        if (c != null && c.text.startsWith('/')) c.text = '';
      }
    });
    // Autofocus the new block
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusFor(next).requestFocus();
    });
  }

  void _deleteBlock(Block b) {
    if (_blocks.length <= 1) {
      // No borrar el último, lo vaciamos
      setState(() {
        b.text = '';
        b.type = BlockType.paragraph;
        _controllers[b.id]?.text = '';
      });
      return;
    }
    final idx = _blocks.indexOf(b);
    setState(() => _blocks.removeAt(idx));
    // Foco al anterior
    if (idx > 0) {
      _focusFor(_blocks[idx - 1]).requestFocus();
    }
  }

  void _changeBlockType(Block b, BlockType type) {
    setState(() {
      b.type = type;
      _slashMenuFor = null;
    });
  }

  /// v0.49.8: si el usuario pulsa Enter, crea un nuevo bloque debajo
  void _onEnter(Block b) {
    if (b.type == BlockType.todo) {
      // Enter en un todo crea otro todo
      final next = Block(id: Block._newId(), type: BlockType.todo);
      setState(() {
        final idx = _blocks.indexOf(b);
        _blocks.insert(idx + 1, next);
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _focusFor(next).requestFocus();
      });
    } else if (b.type == BlockType.bulletList) {
      final next = Block(id: Block._newId(), type: BlockType.bulletList);
      setState(() {
        final idx = _blocks.indexOf(b);
        _blocks.insert(idx + 1, next);
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _focusFor(next).requestFocus();
      });
    } else {
      // En cualquier otro bloque, Enter crea un paragraph
      _addBlockAfter(b, BlockType.paragraph);
    }
  }

  /// v0.49.9: drag&drop reordering via ReorderableListView
  void _onReorder(int oldIndex, int newIndex) {
    setState(() {
      if (newIndex > oldIndex) newIndex--;
      final item = _blocks.removeAt(oldIndex);
      _blocks.insert(newIndex, item);
    });
  }

  void _onBackspaceEmpty(Block b) {
    if (b.text.isEmpty) {
      _deleteBlock(b);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final body = _serializeToMarkdown();
      String path = _loadedFrom ?? p.join(widget.vaultPath, 'Inbox', 'block-${DateTime.now().millisecondsSinceEpoch}.md');
      final title = _titleController.text.trim().isEmpty
        ? 'Sin título'
        : _titleController.text.trim();
      final fm = '---\ntitle: $title\ntype: block-note\ncreated: ${DateTime.now().toIso8601String()}\n---\n\n';
      final content = fm + body;
      if (_loadedFrom != null) {
        await _vault.writeNote(_loadedFrom!, content);
      } else {
        await _vault.createNote(folder: 'Inbox', title: title, content: content);
        _loadedFrom = p.join(widget.vaultPath, 'Inbox', '$title.md');
      }
      await AppState.instance.reload();
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(_titleController.text.isEmpty ? 'Editor de bloques' : _titleController.text),
        actions: [
          IconButton(
            icon: const Icon(Icons.dashboard_customize_outlined),
            tooltip: 'Templates',
            onPressed: _showTemplatesSheet,
          ),
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Añadir bloque',
            onPressed: () => _addBlockAfter(_blocks.last, BlockType.paragraph),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.save_rounded, size: 18),
              label: const Text('Guardar'),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Title (no draggable)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: TextField(
              controller: _titleController,
              style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
              decoration: const InputDecoration(
                border: InputBorder.none,
                hintText: 'Título',
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),
          // Reorderable list of blocks
          Expanded(
            child: ReorderableListView.builder(
              scrollController: _scrollController,
              padding: const EdgeInsets.fromLTRB(8, 8, 8, 100),
              buildDefaultDragHandles: false,
              onReorder: _onReorder,
              itemCount: _blocks.length,
              itemBuilder: (context, idx) {
                final block = _blocks[idx];
                return _buildDraggableBlock(block, idx, theme);
              },
            ),
          ),
        ],
      ),
    );
  }

  /// v0.49.9: cada bloque con su handle de drag a la izquierda
  Widget _buildDraggableBlock(Block block, int idx, ThemeData theme) {
    final controller = _controllerFor(block);
    final focus = _focusFor(block);
    final children = <Widget>[];

    if (_slashMenuFor == block.id) {
      children.add(_buildSlashMenu(theme, block));
    }

    children.add(
      KeyedSubtree(
        key: ValueKey('block-${block.id}'),
        child: _renderBlock(block, controller, focus, theme),
      ),
    );

    return Padding(
      key: ValueKey('block-wrap-${block.id}'),
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Drag handle
          ReorderableDragStartListener(
            index: idx,
            child: Padding(
              padding: const EdgeInsets.only(top: 8, right: 4),
              child: MouseRegion(
                cursor: SystemMouseCursors.grab,
                child: Icon(Icons.drag_indicator,
                  size: 16,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: children,
            ),
          ),
        ],
      ),
    );
  }

  /// v0.49.9: templates gallery (Notion-style)
  void _showTemplatesSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.7,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (ctx, scroll) => _buildTemplatesPanel(ctx, scroll),
      ),
    );
  }

  Widget _buildTemplatesPanel(BuildContext ctx, ScrollController scroll) {
    final theme = Theme.of(ctx);
    final templates = _getTemplates();
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: Column(
        children: [
          Container(
            margin: const EdgeInsets.only(top: 8),
            width: 40, height: 4,
            decoration: BoxDecoration(
              color: theme.colorScheme.outline,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(Icons.dashboard_customize, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('Templates', style: theme.textTheme.titleLarge),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              controller: scroll,
              itemCount: templates.length,
              itemBuilder: (ctx, i) {
                final t = templates[i];
                return ListTile(
                  leading: Container(
                    width: 48, height: 48,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primaryContainer,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(t.icon, color: theme.colorScheme.onPrimaryContainer),
                  ),
                  title: Text(t.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(t.description),
                  onTap: () {
                    Navigator.pop(ctx);
                    _applyTemplate(t);
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  /// v0.49.9: aplica un template (limpia bloques actuales y crea nuevos)
  void _applyTemplate(_Template t) {
    setState(() {
      _blocks.clear();
      _blocks.addAll(t.blocks.map((b) {
        final nb = Block(id: Block._newId(), type: b.type, text: b.text);
        nb.checked = b.checked;
        nb.tableRows = b.tableRows;
        nb.emoji = b.emoji;
        return nb;
      }));
    });
  }

  static List<_Template> _getTemplates() {
    return [
      _Template(
        name: 'Nota de estudio',
        description: 'Título, objetivo, secciones de temas, tareas, revisión',
        icon: Icons.school_rounded,
        blocks: [
          Block(id: 't1', type: BlockType.heading2, text: 'Objetivo'),
          Block(id: 't2', type: BlockType.paragraph, text: '¿Qué quiero aprender hoy?'),
          Block(id: 't3', type: BlockType.heading2, text: 'Temas'),
          Block(id: 't4', type: BlockType.bulletList, text: 'Tema 1'),
          Block(id: 't5', type: BlockType.bulletList, text: 'Tema 2'),
          Block(id: 't6', type: BlockType.divider),
          Block(id: 't7', type: BlockType.heading2, text: 'Tareas'),
          Block(id: 't8', type: BlockType.todo, text: 'Repasar flashcards'),
          Block(id: 't9', type: BlockType.todo, text: 'Hacer resumen'),
          Block(id: 't10', type: BlockType.divider),
          Block(id: 't11', type: BlockType.heading2, text: 'Repaso programado'),
          Block(id: 't12', type: BlockType.paragraph, text: 'Mañana 10 min, en 3 días, en 1 semana'),
        ],
      ),
      _Template(
        name: 'Tabla comparativa',
        description: 'Tabla de N filas para comparar conceptos',
        icon: Icons.table_chart_rounded,
        blocks: [
          Block(id: 't1', type: BlockType.heading2, text: 'Comparación'),
          Block(id: 't2', type: BlockType.table, tableRows: [
            ['Concepto', 'A', 'B', 'C'],
            ['', '', '', ''],
            ['', '', '', ''],
          ]),
        ],
      ),
      _Template(
        name: 'Daily meeting',
        description: 'Ayer, hoy, blockers (estilo scrum)',
        icon: Icons.event_note_rounded,
        blocks: [
          Block(id: 't1', type: BlockType.heading2, text: '✅ Ayer'),
          Block(id: 't2', type: BlockType.bulletList, text: 'Hecho 1'),
          Block(id: 't3', type: BlockType.bulletList, text: 'Hecho 2'),
          Block(id: 't4', type: BlockType.heading2, text: '🎯 Hoy'),
          Block(id: 't5', type: BlockType.bulletList, text: 'Tarea 1'),
          Block(id: 't6', type: BlockType.bulletList, text: 'Tarea 2'),
          Block(id: 't7', type: BlockType.heading2, text: '🚧 Blockers'),
          Block(id: 't8', type: BlockType.paragraph, text: 'Nada por ahora'),
        ],
      ),
      _Template(
        name: 'Lección',
        description: 'Estructura pedagógica: objetivos, conceptos, ejemplos, autoevaluación',
        icon: Icons.menu_book_rounded,
        blocks: [
          Block(id: 't1', type: BlockType.callout, emoji: '🎯', text: 'Objetivo: al final de esta lección serás capaz de...'),
          Block(id: 't2', type: BlockType.heading2, text: 'Conceptos clave'),
          Block(id: 't3', type: BlockType.bulletList, text: 'Concepto 1'),
          Block(id: 't4', type: BlockType.bulletList, text: 'Concepto 2'),
          Block(id: 't5', type: BlockType.divider),
          Block(id: 't6', type: BlockType.heading2, text: 'Ejemplos'),
          Block(id: 't7', type: BlockType.paragraph, text: 'Ejemplo 1: ...'),
          Block(id: 't8', type: BlockType.divider),
          Block(id: 't9', type: BlockType.heading2, text: 'Autoevaluación'),
          Block(id: 't10', type: BlockType.todo, text: '¿Entiendo X?'),
          Block(id: 't11', type: BlockType.todo, text: '¿Puedo explicar Y?'),
        ],
      ),
      _Template(
        name: 'Página en blanco',
        description: 'Empezar desde cero',
        icon: Icons.notes_rounded,
        blocks: [
          Block(id: 't1', type: BlockType.paragraph, text: ''),
        ],
      ),
    ];
  }

  Widget _buildBlock(Block block, int idx, ThemeData theme) {
    final controller = _controllerFor(block);
    final focus = _focusFor(block);
    final children = <Widget>[];

    if (_slashMenuFor == block.id) {
      children.add(_buildSlashMenu(theme, block));
    }

    children.add(
      KeyedSubtree(
        key: ValueKey('block-${block.id}'),
        child: _renderBlock(block, controller, focus, theme),
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: children,
    );
  }

  Widget _renderBlock(Block block, TextEditingController c, FocusNode focus, ThemeData theme) {
    Widget child;
    switch (block.type) {
      case BlockType.heading1:
        child = TextField(
          controller: c, focusNode: focus,
          style: theme.textTheme.headlineLarge?.copyWith(fontWeight: FontWeight.w800),
          decoration: InputDecoration(border: InputBorder.none, hintText: 'Título 1'),
          maxLines: null, onSubmitted: (_) => _onEnter(block),
        );
        break;
      case BlockType.heading2:
        child = TextField(
          controller: c, focusNode: focus,
          style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
          decoration: InputDecoration(border: InputBorder.none, hintText: 'Título 2'),
          maxLines: null, onSubmitted: (_) => _onEnter(block),
        );
        break;
      case BlockType.heading3:
        child = TextField(
          controller: c, focusNode: focus,
          style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
          decoration: InputDecoration(border: InputBorder.none, hintText: 'Título 3'),
          maxLines: null, onSubmitted: (_) => _onEnter(block),
        );
        break;
      case BlockType.bulletList:
        child = Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 6, right: 6),
              child: Text('•', style: TextStyle(fontSize: 20)),
            ),
            Expanded(
              child: TextField(
                controller: c, focusNode: focus,
                decoration: InputDecoration(border: InputBorder.none, hintText: 'Elemento'),
                maxLines: null,
                onSubmitted: (_) => _onEnter(block),
                onChanged: (v) {
                  if (v.endsWith('  ')) {
                    // Doble espacio termina el bullet (vuelve a paragraph)
                    setState(() {
                      c.text = v.trimRight();
                      block.type = BlockType.paragraph;
                      _addBlockAfter(block, BlockType.paragraph);
                    });
                  }
                },
              ),
            ),
          ],
        );
        break;
      case BlockType.numberedList:
        child = Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 4, right: 6),
              child: Text('${_numberedIndex(block)}.', style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
            Expanded(
              child: TextField(
                controller: c, focusNode: focus,
                decoration: InputDecoration(border: InputBorder.none, hintText: 'Elemento'),
                maxLines: null,
                onSubmitted: (_) => _onEnter(block),
              ),
            ),
          ],
        );
        break;
      case BlockType.todo:
        child = Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              value: block.checked,
              onChanged: (v) => setState(() => block.checked = v ?? false),
            ),
            Expanded(
              child: TextField(
                controller: c, focusNode: focus,
                style: TextStyle(
                  decoration: block.checked ? TextDecoration.lineThrough : null,
                  color: block.checked ? theme.colorScheme.onSurfaceVariant : null,
                ),
                decoration: InputDecoration(border: InputBorder.none, hintText: 'Tarea'),
                maxLines: null,
                onSubmitted: (_) => _onEnter(block),
              ),
            ),
          ],
        );
        break;
      case BlockType.quote:
        child = Container(
          padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(color: theme.colorScheme.primary, width: 4),
            ),
          ),
          child: TextField(
            controller: c, focusNode: focus,
            style: theme.textTheme.bodyLarge?.copyWith(
              fontStyle: FontStyle.italic,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            decoration: const InputDecoration(border: InputBorder.none, hintText: 'Cita'),
            maxLines: null, onSubmitted: (_) => _onEnter(block),
          ),
        );
        break;
      case BlockType.code:
        child = Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHigh,
            borderRadius: BorderRadius.circular(8),
          ),
          child: TextField(
            controller: c, focusNode: focus,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
            decoration: const InputDecoration(border: InputBorder.none, hintText: 'Código'),
            maxLines: null, onSubmitted: (_) => _onEnter(block),
          ),
        );
        break;
      case BlockType.callout:
        child = Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: theme.colorScheme.tertiaryContainer.withOpacity(0.5),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: theme.colorScheme.tertiary, width: 1),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(block.emoji ?? '💡', style: const TextStyle(fontSize: 20)),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: c, focusNode: focus,
                  decoration: const InputDecoration(border: InputBorder.none, hintText: 'Callout'),
                  maxLines: null, onSubmitted: (_) => _onEnter(block),
                ),
              ),
            ],
          ),
        );
        break;
      case BlockType.divider:
        child = const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Divider(),
        );
        break;
      case BlockType.math:
        child = Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: theme.colorScheme.outline),
          ),
          child: TextField(
            controller: c, focusNode: focus,
            style: const TextStyle(fontFamily: 'monospace', fontStyle: FontStyle.italic),
            decoration: const InputDecoration(
              border: InputBorder.none,
              hintText: 'LaTeX: E=mc^2',
            ),
            maxLines: null, onSubmitted: (_) => _onEnter(block),
          ),
        );
        break;
      case BlockType.table:
        child = _buildTableBlock(block, theme);
        break;
      case BlockType.image:
        child = _buildImageBlock(block, c, focus, theme);
        break;
      case BlockType.paragraph:
      default:
        child = TextField(
          controller: c, focusNode: focus,
          style: theme.textTheme.bodyLarge,
          decoration: InputDecoration(
            border: InputBorder.none,
            hintText: block.type.hint,
          ),
          maxLines: null,
          onSubmitted: (_) => _onEnter(block),
          onChanged: (v) {
            if (v == '/') {
              setState(() => _slashMenuFor = block.id);
            }
            if (_slashMenuFor == block.id && !v.startsWith('/')) {
              setState(() => _slashMenuFor = null);
            }
          },
        );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: child,
    );
  }

  Widget _buildTableBlock(Block block, ThemeData theme) {
    if (block.tableRows == null) {
      block.tableRows = [
        ['Columna 1', 'Columna 2', 'Columna 3'],
        ['', '', ''],
      ];
    }
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outline),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: List.generate(block.tableRows!.length, (i) {
          final row = block.tableRows![i];
          return Container(
            decoration: BoxDecoration(
              border: i == 0 ? null : Border(top: BorderSide(color: theme.colorScheme.outline)),
            ),
            child: Row(
              children: List.generate(row.length, (j) {
                return Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      border: j == 0 ? null : Border(left: BorderSide(color: theme.colorScheme.outline)),
                    ),
                    child: TextFormField(
                      initialValue: row[j],
                      decoration: const InputDecoration(border: InputBorder.none, isDense: true),
                      style: i == 0 ? const TextStyle(fontWeight: FontWeight.w600) : null,
                      onChanged: (v) => row[j] = v,
                    ),
                  ),
                );
              }),
            ),
          );
        }),
      ),
    );
  }

  Widget _buildImageBlock(Block block, TextEditingController c, FocusNode f, ThemeData theme) {
    return Column(
      children: [
        if (block.imagePath != null)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            child: Text('📷 ${block.imagePath}', style: theme.textTheme.bodySmall),
          ),
        TextField(
          controller: c, focusNode: f,
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            hintText: 'URL o path de imagen',
            suffixIcon: IconButton(
              icon: const Icon(Icons.upload),
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Pega la URL. Subida en v0.50')),
                );
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSlashMenu(ThemeData theme, Block block) {
    final items = BlockType.values.where((t) => t != BlockType.divider).toList();
    return Container(
      margin: const EdgeInsets.only(left: 24, bottom: 4),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(8),
        boxShadow: MxShadows.md,
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 280),
        child: GridView.count(
          shrinkWrap: true,
          crossAxisCount: 2,
          childAspectRatio: 4,
          children: items.map((t) {
            return InkWell(
              onTap: () {
                // Quitar el '/' del bloque y cambiar tipo
                final c = _controllers[block.id];
                if (c != null && c.text == '/') c.text = '';
                _changeBlockType(block, t);
              },
              borderRadius: BorderRadius.circular(6),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Row(
                  children: [
                    Icon(t.icon, size: 18, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(t.label,
                        style: theme.textTheme.bodyMedium,
                        maxLines: 1, overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  int _numberedIndex(Block block) {
    final idx = _blocks.indexOf(block);
    int count = 0;
    for (int i = idx; i >= 0; i--) {
      if (_blocks[i].type == BlockType.numberedList) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }
}

/// v0.49.9: template definition (para el gallery)
class _Template {
  final String name;
  final String description;
  final IconData icon;
  final List<Block> blocks;
  _Template({required this.name, required this.description, required this.icon, required this.blocks});
}
