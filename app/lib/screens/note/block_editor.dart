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
import 'package:flutter_math_fork/flutter_math.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/github.dart';
import '../../core/design_tokens.dart';
import '../../services/vault_service.dart';
import '../../services/logger.dart';
import '../../services/ai_copilot.dart';
import '../../services/version_history_service.dart';
import '../../services/embed_service.dart';
import '../../widgets/outline_sidebar.dart';
import '../../widgets/threaded_comments_panel.dart';
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
  columns,
  embed,
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
      case BlockType.columns: return 'Columnas';
      case BlockType.embed: return 'Embed';
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
      case BlockType.columns: return Icons.view_column_outlined;
      case BlockType.embed: return Icons.embed_rounded;
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
      case BlockType.columns: return '2 columnas';
      case BlockType.embed: return 'YouTube, gist, ...';
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
  // v0.50: para code: language (dart, python, js, etc)
  String? language;
  // v0.50: para comments: lista de comentarios por bloque
  List<BlockComment> comments;
  // v0.50: para columns: lista de columnas, cada una es una lista de bloques
  List<List<Block>>? columnChildren;
  // v0.50: para columns: ratio (eg [0.5, 0.5] o [0.7, 0.3])
  List<double>? columnRatios;
  // v0.51: para embed: URL del recurso
  String? embedUrl;
  // v0.51: para embed: tipo detectado (youtube, twitter, gist, ...)
  String? embedType;

  Block({
    required this.id,
    required this.type,
    this.text = '',
    this.checked = false,
    this.tableRows,
    this.emoji,
    this.imagePath,
    this.language,
    List<BlockComment>? comments,
    this.columnChildren,
    this.columnRatios,
    this.embedUrl,
    this.embedType,
  }) : comments = comments ?? <BlockComment>[];

  factory Block.paragraph() => Block(id: _newId(), type: BlockType.paragraph);
  static String _newId() => 'b-${DateTime.now().microsecondsSinceEpoch}-${_counter++}';
  static int _counter = 0;
}

/// v0.50: comentario ancla do a un bloque
class BlockComment {
  final String id;
  final String text;
  final String author;
  final DateTime createdAt;
  final String? replyTo;
  BlockComment({
    required this.id,
    required this.text,
    required this.author,
    required this.createdAt,
    this.replyTo,
  });
  Map<String, dynamic> toJson() => {
    'id': id,
    'text': text,
    'author': author,
    'createdAt': createdAt.toIso8601String(),
    'replyTo': replyTo,
  };
  factory BlockComment.fromJson(Map j) => BlockComment(
    id: j['id'] as String,
    text: j['text'] as String,
    author: j['author'] as String,
    createdAt: DateTime.parse(j['createdAt'] as String),
    replyTo: j['replyTo'] as String?,
  );
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
  final GlobalKey _scrollKey = GlobalKey();
  final Map<String, TextEditingController> _controllers = {};
  final Map<String, FocusNode> _focusNodes = {};
  final List<Block> _blocks = [];
  String? _slashMenuFor; // id del bloque con menu abierto
  bool _saving = false;
  bool _showOutline = false;
  bool _showComments = false;
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
      } else if (l.trim() == ':::columns' || l.trim() == ':::columns-2') {
        // v0.50: multi-column block. Lee las lineas siguientes hasta ':::'
        final cols = <List<Block>>[];
        cols.add(<Block>[]);
        i++;
        while (i < lines.length && lines[i].trim() != ':::') {
          final cl = lines[i];
          if (cl.trim() == ':::col') {
            cols.add(<Block>[]);
          } else if (cl.trim() == ':::col-3') {
            // soporte 3 columnas si se anade mas
            while (cols.length < 3) cols.add(<Block>[]);
            cols.last.add(Block(id: Block._newId(), type: BlockType.paragraph, text: cl));
          } else {
            // Parse recursivo simple: si es heading/paragraph/etc
            if (cl.startsWith('# ')) {
              cols.last.add(Block(id: Block._newId(), type: BlockType.heading1, text: cl.substring(2)));
            } else if (cl.startsWith('## ')) {
              cols.last.add(Block(id: Block._newId(), type: BlockType.heading2, text: cl.substring(3)));
            } else if (cl.isEmpty) {
              // skip
            } else {
              cols.last.add(Block(id: Block._newId(), type: BlockType.paragraph, text: cl));
            }
          }
          i++;
        }
        // Filtra columnas vacias
        final nonEmpty = cols.where((c) => c.isNotEmpty).toList();
        if (nonEmpty.isNotEmpty) {
          out.add(Block(
            id: Block._newId(),
            type: BlockType.columns,
            columnChildren: nonEmpty,
            columnRatios: List.generate(nonEmpty.length, (_) => 1.0 / nonEmpty.length),
          ));
        } else {
          out.add(Block(id: Block._newId(), type: BlockType.columns,
            columnChildren: [[Block.paragraph()], [Block.paragraph()]],
            columnRatios: [0.5, 0.5],
          ));
        }
      } else if (l.trim().startsWith(':::embed ')) {
        // v0.51: embed block
        final url = l.trim().substring(9).trim();
        final info = EmbedService.detect(url);
        out.add(Block(
          id: Block._newId(),
          type: BlockType.embed,
          text: url,
          embedUrl: url,
          embedType: info?.type ?? 'iframe',
        ));
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
        case BlockType.embed: buf.writeln(':::embed ${b.embedUrl ?? b.text}'); break;
        case BlockType.columns:
          buf.writeln(':::columns');
          if (b.columnChildren != null) {
            for (final col in b.columnChildren!) {
              buf.writeln(':::col');
              for (final c in col) {
                switch (c.type) {
                  case BlockType.heading1: buf.writeln('# ${c.text}'); break;
                  case BlockType.heading2: buf.writeln('## ${c.text}'); break;
                  case BlockType.paragraph: buf.writeln(c.text); break;
                  default: buf.writeln(c.text); break;
                }
              }
            }
          }
          buf.writeln(':::');
          break;
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

      // v0.50.1: snapshot ANTES de sobreescribir (si ya existia)
      if (_loadedFrom != null) {
        try {
          final history = VersionHistoryService(widget.vaultPath);
          await history.snapshot(_loadedFrom!);
        } catch (_) {}
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
    final hasNotePath = _loadedFrom != null;
    return Scaffold(
      appBar: AppBar(
        title: Text(_titleController.text.isEmpty ? 'Editor de bloques' : _titleController.text),
        actions: [
          IconButton(
            icon: const Icon(Icons.toc),
            tooltip: 'Outline',
            onPressed: _toggleOutline,
          ),
          if (hasNotePath)
            IconButton(
              icon: const Icon(Icons.forum_outlined),
              tooltip: 'Comentarios',
              onPressed: _toggleComments,
            ),
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
          // Reorderable list of blocks + sidebar opcional
          Expanded(
            child: Row(
              children: [
                Expanded(
                  child: KeyedSubtree(
                    key: _scrollKey,
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
                ),
                if (_showOutline)
                  SizedBox(
                    width: 280,
                    child: OutlineSidebar(
                      entries: _computeOutline(),
                      currentIndex: 0,
                      onJump: _jumpToBlock,
                      onClose: _toggleOutline,
                    ),
                  ),
                if (_showComments && _loadedFrom != null)
                  SizedBox(
                    width: 320,
                    child: ThreadedCommentsPanel(
                      notePath: _loadedFrom!,
                      blockContexts: _blockContexts(),
                      onClose: _toggleComments,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// v0.50.1: outline entries de los blocks actuales
  List<OutlineEntry> _computeOutline() {
    final out = <OutlineEntry>[];
    for (int i = 0; i < _blocks.length; i++) {
      final b = _blocks[i];
      if (b.type == BlockType.heading1) out.add(OutlineEntry(level: 1, text: b.text, blockIndex: i));
      if (b.type == BlockType.heading2) out.add(OutlineEntry(level: 2, text: b.text, blockIndex: i));
      if (b.type == BlockType.heading3) out.add(OutlineEntry(level: 3, text: b.text, blockIndex: i));
    }
    return out;
  }

  /// v0.50.1: blockId -> preview text para comments panel
  Map<String, String> _blockContexts() {
    final out = <String, String>{};
    for (final b in _blocks) {
      if (b.text.isNotEmpty) {
        out[b.id] = b.text;
      } else {
        out[b.id] = '[${b.type.label}]';
      }
    }
    return out;
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
  /// v0.50.1: toggle outline sidebar
  void _toggleOutline() {
    setState(() {
      _showOutline = !_showOutline;
      if (_showOutline) _showComments = false;
    });
  }

  /// v0.50.1: toggle comments panel
  void _toggleComments() {
    setState(() {
      _showComments = !_showComments;
      if (_showComments) _showOutline = false;
    });
  }

  /// v0.50.1: scroll al bloque con el heading
  void _jumpToBlock(int blockIndex) {
    if (blockIndex < 0 || blockIndex >= _blocks.length) return;
    final id = _blocks[blockIndex].id;
    final ctx = _scrollKey.currentContext;
    if (ctx != null) {
      Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 300));
    }
    // Opcional: focus
    _focusFor(_blocks[blockIndex]).requestFocus();
  }

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
        child = _buildCodeBlock(block, c, focus, theme);
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
        child = _buildMathBlock(block, c, focus, theme);
        break;
      case BlockType.table:
        child = _buildTableBlock(block, theme);
        break;
      case BlockType.columns:
        child = _buildColumnsBlock(block, theme);
        break;
      case BlockType.embed:
        child = _buildEmbedBlock(block, c, focus, theme);
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

  /// v0.50: multi-column layout (similar a AFFiNE/Notion)
  Widget _buildColumnsBlock(Block block, ThemeData theme) {
    if (block.columnChildren == null) {
      block.columnChildren = [[Block.paragraph()], [Block.paragraph()]];
      block.columnRatios = [0.5, 0.5];
    }
    final cols = block.columnChildren!;
    final ratios = block.columnRatios ?? List.generate(cols.length, (_) => 1.0 / cols.length);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: List.generate(cols.length, (i) {
          return Expanded(
            flex: (ratios[i] * 100).round(),
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                border: i == 0 ? null : Border(left: BorderSide(color: theme.colorScheme.outlineVariant)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: cols[i].map((c) {
                  final cc = _controllerFor(c);
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: TextField(
                      controller: cc,
                      style: theme.textTheme.bodyMedium,
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                        isDense: true,
                        hintText: 'Texto columna ${i + 1}',
                      ),
                      onChanged: (v) => c.text = v,
                    ),
                  );
                }).toList(),
              ),
            ),
          );
        }),
      ),
    );
  }

  /// v0.51: embed block con preview offline (YouTube, Twitter, etc)
  /// Muestra thumbnail + titulo + link, no requiere WebView.
  Widget _buildEmbedBlock(Block block, TextEditingController c, FocusNode focus, ThemeData theme) {
    final url = block.embedUrl ?? block.text;
    final info = EmbedService.detect(url);

    if (url.isEmpty) {
      // Modo edicion
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.colorScheme.outline),
        ),
        child: TextField(
          controller: c, focusNode: focus,
          decoration: const InputDecoration(
            border: InputBorder.none,
            hintText: 'Pega URL: YouTube, Twitter, Gist, ...',
          ),
          onChanged: (v) {
            block.text = v;
            final detected = EmbedService.detect(v);
            block.embedUrl = v;
            block.embedType = detected?.type;
          },
        ),
      );
    }

    // Modo vista: preview card
    final type = info?.type ?? 'iframe';
    final iconData = switch (type) {
      'youtube' => Icons.play_circle_filled_rounded,
      'twitter' => Icons.alternate_email_rounded,
      'gist' => Icons.code_rounded,
      'codepen' => Icons.code_rounded,
      'spotify' => Icons.music_note_rounded,
      'vimeo' => Icons.video_library_rounded,
      'loom' => Icons.videocam_rounded,
      'image' => Icons.image_rounded,
      _ => Icons.link_rounded,
    };
    final color = switch (type) {
      'youtube' => Colors.red,
      'twitter' => Colors.lightBlue,
      'gist' => Colors.purple,
      'codepen' => Colors.black,
      'spotify' => Colors.green,
      'vimeo' => Colors.teal,
      'loom' => Colors.deepPurple,
      'image' => Colors.orange,
      _ => theme.colorScheme.primary,
    };

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
            ),
            child: Row(
              children: [
                Icon(iconData, size: 16, color: color),
                const SizedBox(width: 6),
                Text(type.toUpperCase(),
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: color)),
                const Spacer(),
                if (info != null)
                  Text('${info.width}x${info.height}',
                    style: TextStyle(fontSize: 10, color: theme.colorScheme.onSurfaceVariant)),
                IconButton(
                  icon: const Icon(Icons.edit, size: 14),
                  onPressed: () => focus.requestFocus(),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 14),
                  onPressed: () {
                    setState(() {
                      _blocks.remove(block);
                    });
                  },
                ),
              ],
            ),
          ),
          // Body
          InkWell(
            onTap: () {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Embed: $url')),
              );
            },
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Container(
                    width: 80, height: 60,
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Icon(iconData, color: color, size: 32),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _embedTitle(url, type),
                          style: TextStyle(fontWeight: FontWeight.w600, color: theme.colorScheme.onSurface),
                          maxLines: 1, overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          url,
                          style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant, fontFamily: 'monospace'),
                          maxLines: 2, overflow: TextOverflow.ellipsis,
                        ),
                        if (info != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Embed URL: ${info.embedUrl}',
                            style: TextStyle(fontSize: 10, color: theme.colorScheme.onSurfaceVariant, fontStyle: FontStyle.italic),
                            maxLines: 1, overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// v0.51: extrae un titulo legible de una URL embed
  String _embedTitle(String url, String type) {
    switch (type) {
      case 'youtube':
        final m = RegExp(r'youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})').firstMatch(url);
        return m != null ? 'YouTube: ${m.group(1)}' : 'YouTube';
      case 'twitter':
        return 'Tweet';
      case 'gist':
        return 'GitHub Gist';
      case 'codepen':
        return 'CodePen';
      case 'spotify':
        return 'Spotify';
      case 'vimeo':
        return 'Vimeo';
      case 'loom':
        return 'Loom';
      case 'image':
        return 'Imagen (Imgur)';
      default:
        return 'Link';
    }
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
    final items = <_SlashItem>[
      // Tipos de bloque
      ...BlockType.values.where((t) => t != BlockType.divider).map((t) =>
        _SlashItem(
          icon: t.icon,
          label: t.label,
          onTap: () {
            final c = _controllers[block.id];
            if (c != null && c.text == '/') c.text = '';
            _changeBlockType(block, t);
          },
        ),
      ),
      // v0.49.18: AI commands
      _SlashItem(
        icon: Icons.psychology,
        label: 'AI: Resumir',
        isAi: true,
        onTap: () => _runAiCommand(block, 'summarize'),
      ),
      _SlashItem(
        icon: Icons.psychology,
        label: 'AI: Preguntas',
        isAi: true,
        onTap: () => _runAiCommand(block, 'questions'),
      ),
      _SlashItem(
        icon: Icons.psychology,
        label: 'AI: Outline',
        isAi: true,
        onTap: () => _runAiCommand(block, 'outline'),
      ),
      _SlashItem(
        icon: Icons.psychology,
        label: 'AI: Traducir EN',
        isAi: true,
        onTap: () => _runAiCommand(block, 'translate', targetLang: 'ingles'),
      ),
    ];
    return Container(
      margin: const EdgeInsets.only(left: 24, bottom: 4),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(8),
        boxShadow: MxShadows.md,
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 320),
        child: GridView.count(
          shrinkWrap: true,
          crossAxisCount: 2,
          childAspectRatio: 4,
          children: items.map((it) {
            return InkWell(
              onTap: it.onTap,
              borderRadius: BorderRadius.circular(6),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Row(
                  children: [
                    Icon(it.icon,
                      size: 18,
                      color: it.isAi ? theme.colorScheme.tertiary : theme.colorScheme.primary,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(it.label,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: it.isAi ? theme.colorScheme.tertiary : null,
                          fontWeight: it.isAi ? FontWeight.w600 : null,
                        ),
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

  /// v0.49.18: ejecuta un comando AI y reemplaza el bloque con el resultado
  Future<void> _runAiCommand(Block block, String command, {String? targetLang}) async {
    final c = _controllers[block.id];
    if (c != null && c.text == '/') c.text = '';
    setState(() {
      block.text = '⏳ Generando con IA...';
    });
    try {
      final copilot = AICopilot(
        backendUrl: widget.vaultPath.isNotEmpty ? null : null, // usar SharedPreferences si se quiere
        vaultContext: await _loadVaultContext(),
      );
      final result = await copilot.run('/ai $command', targetLang: targetLang);
      if (!mounted) return;
      setState(() {
        block.text = result;
        block.type = BlockType.paragraph;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        block.text = 'Error: $e';
      });
    }
  }

  /// v0.49.18: carga los primeros N chars del vault para contexto
  Future<String> _loadVaultContext() async {
    try {
      final dir = Directory(widget.vaultPath);
      if (!await dir.exists()) return '';
      final buf = StringBuffer();
      await for (final entity in dir.list(recursive: false)) {
        if (entity is File && entity.path.endsWith('.md')) {
          final content = await entity.readAsString();
          buf.writeln('## ${p.basename(entity.path)}');
          buf.writeln(content.substring(0, content.length.clamp(0, 500)));
          buf.writeln();
        }
        if (buf.length > 3000) break;
      }
      return buf.toString();
    } catch (_) {
      return '';
    }
  }

  /// v0.50: code block con syntax highlight usando flutter_highlight
  Widget _buildCodeBlock(Block block, TextEditingController c, FocusNode focus, ThemeData theme) {
    final isEditing = focus.hasFocus;
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E1E),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.colorScheme.outline.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header con selector de lenguaje
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.3),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
            ),
            child: Row(
              children: [
                const Icon(Icons.code, size: 12, color: Colors.white70),
                const SizedBox(width: 6),
                _CodeLanguagePicker(
                  current: block.language ?? 'plaintext',
                  onChanged: (lang) => setState(() => block.language = lang),
                ),
                const Spacer(),
                if (block.text.isNotEmpty)
                  IconButton(
                    icon: const Icon(Icons.copy, size: 14, color: Colors.white70),
                    onPressed: () {
                      // v0.50: copy to clipboard
                      // Clipboard.setData(ClipboardData(text: block.text));
                    },
                  ),
              ],
            ),
          ),
          // Body
          if (isEditing)
            Padding(
              padding: const EdgeInsets.all(8),
              child: TextField(
                controller: c, focusNode: focus,
                style: const TextStyle(
                  fontFamily: 'monospace', fontSize: 13, color: Colors.white,
                ),
                decoration: const InputDecoration(
                  border: InputBorder.none,
                  hintText: '// código',
                  hintStyle: TextStyle(color: Colors.white38),
                ),
                maxLines: null,
                minLines: 3,
                onSubmitted: (_) => _onEnter(block),
              ),
            )
          else
            InkWell(
              onTap: () => focus.requestFocus(),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                child: block.text.isEmpty
                  ? const Text('// pulsa para escribir código',
                      style: TextStyle(color: Colors.white38, fontFamily: 'monospace', fontSize: 13))
                  : HighlightView(
                      // v0.50: syntax highlight real
                      text: block.text,
                      language: block.language ?? 'plaintext',
                      theme: githubTheme,
                      padding: EdgeInsets.zero,
                    ),
              ),
            ),
        ],
      ),
    );
  }

  /// v0.50: math block con preview live usando flutter_math_fork
  Widget _buildMathBlock(Block block, TextEditingController c, FocusNode focus, ThemeData theme) {
    final isEditing = focus.hasFocus;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.colorScheme.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.calculate, size: 14, color: theme.colorScheme.tertiary),
              const SizedBox(width: 6),
              Text('LaTeX', style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant, fontWeight: FontWeight.w600)),
              const Spacer(),
              if (block.text.isNotEmpty && !isEditing)
                IconButton(
                  icon: const Icon(Icons.edit, size: 14),
                  onPressed: () => focus.requestFocus(),
                ),
            ],
          ),
          const SizedBox(height: 8),
          if (isEditing)
            TextField(
              controller: c, focusNode: focus,
              style: const TextStyle(fontFamily: 'monospace', fontStyle: FontStyle.italic),
              decoration: const InputDecoration(
                border: InputBorder.none,
                hintText: 'E=mc^2',
              ),
              maxLines: null,
              onSubmitted: (_) => _onEnter(block),
            )
          else if (block.text.isEmpty)
            InkWell(
              onTap: () => focus.requestFocus(),
              child: Text(
                'Pulsa para añadir LaTeX',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
              ),
            )
          else
            InkWell(
              onTap: () => focus.requestFocus(),
              child: Math.tex(
                block.text,
                textStyle: TextStyle(fontSize: 18, color: theme.colorScheme.onSurface),
                mathStyle: MathStyle.text,
                onErrorFallback: (err) => Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text('Error LaTeX: $err',
                    style: TextStyle(color: theme.colorScheme.onErrorContainer, fontSize: 12)),
                ),
              ),
            ),
        ],
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

/// v0.49.18: item del slash menu
class _SlashItem {
  final IconData icon;
  final String label;
  final bool isAi;
  final VoidCallback onTap;
  _SlashItem({required this.icon, required this.label, required this.onTap, this.isAi = false});
}

/// v0.50: language picker para code blocks
class _CodeLanguagePicker extends StatelessWidget {
  final String current;
  final ValueChanged<String> onChanged;
  const _CodeLanguagePicker({required this.current, required this.onChanged});

  static const _languages = [
    'plaintext', 'dart', 'python', 'javascript', 'typescript', 'java',
    'kotlin', 'swift', 'c', 'cpp', 'csharp', 'go', 'rust', 'sql',
    'json', 'yaml', 'xml', 'html', 'css', 'bash', 'shell', 'markdown',
  ];

  @override
  Widget build(BuildContext context) {
    return DropdownButton<String>(
      value: current,
      dropdownColor: const Color(0xFF2D2D2D),
      isDense: true,
      underline: const SizedBox.shrink(),
      style: const TextStyle(color: Colors.white, fontSize: 12),
      iconEnabledColor: Colors.white70,
      items: _languages.map((l) => DropdownMenuItem(
        value: l,
        child: Text(l),
      )).toList(),
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }
}
