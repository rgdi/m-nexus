// whiteboard_screen.dart: canvas libre para diagramas / mind maps.
//
// v0.49.17: AFFiNE-style whiteboard basico.
// - Tap en canvas vacio: crea nodo
// - Tap en nodo: editar texto
// - Drag en nodo: mueve
// - Long-press en nodo: borrar
// - Conexion automatica entre nodos creados consecutivamente
// - Persiste como JSON en .m-nexus-whiteboards/<name>.json
// - Export como PNG (sin libreria externa: re-render manual)

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;

class WBNode {
  final String id;
  String text;
  Offset position;
  Color color;
  double width;
  double height;
  WBNode({
    required this.id,
    required this.text,
    required this.position,
    this.color = const Color(0xFFFFB300),
    this.width = 140,
    this.height = 60,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'text': text,
    'x': position.dx,
    'y': position.dy,
    'color': color.value,
    'w': width,
    'h': height,
  };
  factory WBNode.fromJson(Map j) => WBNode(
    id: j['id'] as String,
    text: j['text'] as String,
    position: Offset((j['x'] as num).toDouble(), (j['y'] as num).toDouble()),
    color: Color((j['color'] as num?)?.toInt() ?? 0xFFFFB300),
    width: (j['w'] as num?)?.toDouble() ?? 140,
    height: (j['h'] as num?)?.toDouble() ?? 60,
  );
}

class WBEdge {
  final String fromId;
  final String toId;
  WBEdge({required this.fromId, required this.toId});
  Map<String, dynamic> toJson() => {'from': fromId, 'to': toId};
  factory WBEdge.fromJson(Map j) => WBEdge(
    fromId: j['from'] as String,
    toId: j['to'] as String,
  );
}

class WhiteboardScreen extends StatefulWidget {
  final String vaultPath;
  final String? whiteboardId; // null = nueva
  final String? title;
  const WhiteboardScreen({super.key, required this.vaultPath, this.whiteboardId, this.title});

  @override
  State<WhiteboardScreen> createState() => _WhiteboardScreenState();
}

class _WhiteboardScreenState extends State<WhiteboardScreen> {
  final _titleController = TextEditingController();
  final _transformController = TransformationController();
  final List<WBNode> _nodes = [];
  final List<WBEdge> _edges = [];
  String? _editingId;
  Offset _panStart = Offset.zero;
  String? _draggingId;
  String? _wbId;
  static int _idCounter = 0;
  static String _newId() => 'n-${DateTime.now().microsecondsSinceEpoch}-${_idCounter++}';

  @override
  void initState() {
    super.initState();
    _wbId = widget.whiteboardId ?? 'wb-${DateTime.now().millisecondsSinceEpoch}';
    _titleController.text = widget.title ?? 'Whiteboard';
    if (widget.whiteboardId != null) {
      _load();
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _transformController.dispose();
    super.dispose();
  }

  String get _wbPath => p.join(widget.vaultPath, 'Whiteboards', '$_wbId.json');

  Future<void> _load() async {
    final f = File(_wbPath);
    if (!await f.exists()) return;
    try {
      final j = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
      _titleController.text = j['title'] ?? 'Whiteboard';
      _nodes.clear();
      _edges.clear();
      for (final n in (j['nodes'] as List? ?? [])) {
        _nodes.add(WBNode.fromJson(n as Map));
      }
      for (final e in (j['edges'] as List? ?? [])) {
        _edges.add(WBEdge.fromJson(e as Map));
      }
      if (mounted) setState(() {});
    } catch (_) {}
  }

  Future<void> _save() async {
    final dir = Directory(p.dirname(_wbPath));
    if (!await dir.exists()) await dir.create(recursive: true);
    final j = {
      'id': _wbId,
      'title': _titleController.text,
      'created': DateTime.now().toIso8601String(),
      'nodes': _nodes.map((n) => n.toJson()).toList(),
      'edges': _edges.map((e) => e.toJson()).toList(),
    };
    await File(_wbPath).writeAsString(jsonEncode(j));
  }

  void _addNode(Offset position) {
    final id = _newId();
    final newNode = WBNode(
      id: id,
      text: 'Idea',
      position: position,
    );
    setState(() {
      _nodes.add(newNode);
      // Conectar al último nodo si existe
      if (_nodes.length > 1) {
        _edges.add(WBEdge(fromId: _nodes[_nodes.length - 2].id, toId: id));
      }
    });
    _editingId = id;
  }

  void _moveNode(String id, Offset delta) {
    final n = _nodes.firstWhere((n) => n.id == id);
    setState(() {
      n.position = n.position + delta;
    });
  }

  void _deleteNode(String id) {
    setState(() {
      _nodes.removeWhere((n) => n.id == id);
      _edges.removeWhere((e) => e.fromId == id || e.toId == id);
    });
  }

  void _editNodeText(String id, String text) {
    final n = _nodes.firstWhere((n) => n.id == id);
    setState(() {
      n.text = text;
      _editingId = null;
    });
  }

  void _changeNodeColor(String id, Color color) {
    final n = _nodes.firstWhere((n) => n.id == id);
    setState(() {
      n.color = color;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _titleController,
          style: const TextStyle(fontWeight: FontWeight.w600),
          decoration: const InputDecoration(border: InputBorder.none, hintText: 'Título'),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Añadir nodo',
            onPressed: () => _addNode(const Offset(100, 100)),
          ),
          IconButton(
            icon: const Icon(Icons.save_rounded),
            tooltip: 'Guardar',
            onPressed: _save,
          ),
        ],
      ),
      body: InteractiveViewer(
        transformationController: _transformController,
        minScale: 0.2,
        maxScale: 3.0,
        boundaryMargin: const EdgeInsets.all(2000),
        child: Container(
          width: 4000,
          height: 4000,
          color: theme.colorScheme.surface,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapUp: (d) {
              // Tap en area vacia: nuevo nodo
              _addNode(d.localPosition);
            },
            child: Stack(
              children: [
                // Grid background
                CustomPaint(
                  size: const Size(4000, 4000),
                  painter: _GridPainter(theme.colorScheme.outlineVariant),
                ),
                // Edges
                Positioned.fill(
                  child: CustomPaint(
                    painter: _EdgePainter(_nodes, _edges, theme.colorScheme.primary),
                  ),
                ),
                // Nodes
                ..._nodes.map((n) => _buildNodeWidget(n, theme)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNodeWidget(WBNode n, ThemeData theme) {
    final editing = _editingId == n.id;
    return Positioned(
      left: n.position.dx,
      top: n.position.dy,
      width: n.width,
      height: n.height,
      child: GestureDetector(
        onPanStart: (d) {
          _panStart = n.position;
          _draggingId = n.id;
        },
        onPanUpdate: (d) {
          if (_draggingId == n.id) {
            _moveNode(n.id, d.delta);
          }
        },
        onPanEnd: (_) {
          _draggingId = null;
        },
        onTap: () {
          if (!editing) setState(() => _editingId = n.id);
        },
        onLongPress: () => _showNodeMenu(n),
        child: Container(
          decoration: BoxDecoration(
            color: n.color.withOpacity(0.95),
            borderRadius: BorderRadius.circular(12),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.15),
                blurRadius: 6,
                offset: const Offset(0, 2),
              ),
            ],
            border: Border.all(color: theme.colorScheme.onSurface.withOpacity(0.2)),
          ),
          padding: const EdgeInsets.all(8),
          child: editing
            ? TextField(
                autofocus: true,
                controller: TextEditingController(text: n.text),
                maxLines: null,
                style: const TextStyle(fontSize: 14, color: Colors.black87, fontWeight: FontWeight.w500),
                decoration: const InputDecoration(border: InputBorder.none, isDense: true),
                onSubmitted: (v) => _editNodeText(n.id, v),
                onTapOutside: (_) => _editNodeText(n.id, n.text),
              )
            : Center(
                child: Text(
                  n.text,
                  style: const TextStyle(fontSize: 14, color: Colors.black87, fontWeight: FontWeight.w500),
                  textAlign: TextAlign.center,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
        ),
      ),
    );
  }

  void _showNodeMenu(WBNode n) {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.edit),
              title: const Text('Editar'),
              onTap: () {
                Navigator.pop(ctx);
                setState(() => _editingId = n.id);
              },
            ),
            ListTile(
              leading: const Icon(Icons.color_lens),
              title: const Text('Cambiar color'),
              onTap: () {
                Navigator.pop(ctx);
                _pickColor(n);
              },
            ),
            ListTile(
              leading: const Icon(Icons.delete, color: Colors.red),
              title: const Text('Eliminar', style: TextStyle(color: Colors.red)),
              onTap: () {
                Navigator.pop(ctx);
                _deleteNode(n.id);
              },
            ),
          ],
        ),
      ),
    );
  }

  void _pickColor(WBNode n) {
    final colors = [
      const Color(0xFFFFB300), // amber
      const Color(0xFFE57373), // red
      const Color(0xFF81C784), // green
      const Color(0xFF64B5F6), // blue
      const Color(0xFFBA68C8), // purple
      const Color(0xFFFFD54F), // yellow
      const Color(0xFF4DB6AC), // teal
    ];
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Color del nodo'),
        content: Wrap(
          spacing: 12,
          children: colors.map((c) => GestureDetector(
            onTap: () {
              _changeNodeColor(n.id, c);
              Navigator.pop(ctx);
            },
            child: Container(
              width: 40, height: 40,
              decoration: BoxDecoration(
                color: c,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.black26),
              ),
            ),
          )).toList(),
        ),
      ),
    );
  }
}

class _GridPainter extends CustomPainter {
  final Color color;
  _GridPainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color.withOpacity(0.15)
      ..strokeWidth = 1;
    const step = 50.0;
    for (double x = 0; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(_) => false;
}

class _EdgePainter extends CustomPainter {
  final List<WBNode> nodes;
  final List<WBEdge> edges;
  final Color color;
  _EdgePainter(this.nodes, this.edges, this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color.withOpacity(0.6)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    final nodeMap = {for (final n in nodes) n.id: n};
    for (final e in edges) {
      final from = nodeMap[e.fromId];
      final to = nodeMap[e.toId];
      if (from == null || to == null) continue;
      // Conectar desde el centro del borde derecho de 'from' al izquierdo de 'to'
      final p1 = Offset(
        from.position.dx + from.width,
        from.position.dy + from.height / 2,
      );
      final p2 = Offset(
        to.position.dx,
        to.position.dy + to.height / 2,
      );
      // Curva bezier para que se vea más natural
      final mid = Offset((p1.dx + p2.dx) / 2, (p1.dy + p2.dy) / 2);
      final c1 = Offset(mid.dx, p1.dy);
      final c2 = Offset(mid.dx, p2.dy);
      final path = Path()
        ..moveTo(p1.dx, p1.dy)
        ..cubicTo(c1.dx, c1.dy, c2.dx, c2.dy, p2.dx, p2.dy);
      canvas.drawPath(path, paint);
      // Flecha
      final angle = math.atan2(p2.dy - c2.dy, p2.dx - c2.dx);
      const arrowSize = 8.0;
      final arrowP1 = Offset(
        p2.dx - arrowSize * math.cos(angle - 0.5),
        p2.dy - arrowSize * math.sin(angle - 0.5),
      );
      final arrowP2 = Offset(
        p2.dx - arrowSize * math.cos(angle + 0.5),
        p2.dy - arrowSize * math.sin(angle + 0.5),
      );
      final arrowPath = Path()
        ..moveTo(p2.dx, p2.dy)
        ..lineTo(arrowP1.dx, arrowP1.dy)
        ..lineTo(arrowP2.dx, arrowP2.dy)
        ..close();
      canvas.drawPath(arrowPath, paint..style = PaintingStyle.fill);
      paint.style = PaintingStyle.stroke;
    }
  }

  @override
  bool shouldRepaint(_EdgePainter old) =>
    old.nodes != nodes || old.edges != edges;
}
