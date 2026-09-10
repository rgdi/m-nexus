// graph_view_screen.dart: visualizacion del knowledge graph.
//
// v0.60 (P1.5): implementa un simple force-directed layout (Fruchterman-Reingold)
// sobre los nodos del vault. Permite:
//   - Zoom y pan con InteractiveViewer
//   - Tap en nodo para navegar a la nota
//   - Filtro por tag/folder
//   - Toggle local (solo nodos conectados a una nota) vs global
//
// Nota: layout force-directed corre en CPU. Para 500 nodos tarda ~2s.
// En el futuro se puede mover a un Isolate.

import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../services/graph_view_service.dart';
import '../note/note_view.dart';

class GraphViewScreen extends StatefulWidget {
  final String vaultPath;
  const GraphViewScreen({super.key, required this.vaultPath});

  @override
  State<GraphViewScreen> createState() => _GraphViewScreenState();
}

class _GraphViewScreenState extends State<GraphViewScreen> {
  GraphData? _graph;
  bool _loading = true;
  String _filter = '';
  bool _localOnly = false;
  String? _focusedNode;
  final _transformController = TransformationController();
  Map<String, Offset> _positions = {};
  Map<String, double> _sizes = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _transformController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final svc = GraphViewService(widget.vaultPath);
    final graph = await svc.build();
    if (!mounted) return;
    setState(() {
      _graph = graph;
      _loading = false;
    });
    _layout();
  }

  /// v0.60 (P1.5): Fruchterman-Reingold force-directed layout simple.
  void _layout({int iterations = 200}) {
    final g = _graph;
    if (g == null || g.nodes.isEmpty) return;
    final width = 1000.0;
    final height = 1000.0;
    final k = 80.0; // distancia ideal
    final pos = <String, Offset>{};
    final vel = <String, Offset>{};
    final rng = math.Random(42);
    for (final n in g.nodes) {
      pos[n.path] = Offset(rng.nextDouble() * width, rng.nextDouble() * height);
      vel[n.path] = Offset.zero;
    }
    final adj = <String, Set<String>>{};
    for (final e in g.edges) {
      adj.putIfAbsent(e.from, () => {}).add(e.to);
      adj.putIfAbsent(e.to, () => {}).add(e.from);
    }
    double t = width / 10;
    final cooling = t / iterations;
    for (var iter = 0; iter < iterations; iter++) {
      // Repulsion
      final disp = <String, Offset>{};
      for (final n in g.nodes) {
        disp[n.path] = Offset.zero;
        for (final m in g.nodes) {
          if (n.path == m.path) continue;
          final delta = pos[n.path]! - pos[m.path]!;
          final dist = math.max(0.01, delta.distance);
          final force = (k * k) / dist;
          disp[n.path] = disp[n.path]! + Offset(delta.dx / dist * force, delta.dy / dist * force);
        }
      }
      // Atraccion
      for (final e in g.edges) {
        final delta = pos[e.from]! - pos[e.to]!;
        final dist = math.max(0.01, delta.distance);
        final force = (dist * dist) / k;
        disp[e.from] = disp[e.from]! - Offset(delta.dx / dist * force, delta.dy / dist * force);
        disp[e.to] = disp[e.to]! + Offset(delta.dx / dist * force, delta.dy / dist * force);
      }
      // Aplicar
      for (final n in g.nodes) {
        final d = disp[n.path]!;
        final dist = math.max(0.01, d.distance);
        final limited = math.min(dist, t);
        vel[n.path] = Offset(vel[n.path]!.dx + d.dx / dist * limited, vel[n.path]!.dy + d.dy / dist * limited);
        pos[n.path] = pos[n.path]! + vel[n.path]!;
        // Limites
        pos[n.path] = Offset(pos[n.path]!.dx.clamp(50, width - 50), pos[n.path]!.dy.clamp(50, height - 50));
        vel[n.path] = Offset(vel[n.path]!.dx * 0.85, vel[n.path]!.dy * 0.85);
      }
      t = math.max(1, t - cooling);
    }
    // Tamano de nodo: sqrt(degree + 1) * 4
    final sizes = <String, double>{};
    for (final n in g.nodes) {
      sizes[n.path] = (4 + math.sqrt(n.degree) * 4).clamp(5, 30);
    }
    if (mounted) {
      setState(() {
        _positions = pos;
        _sizes = sizes;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Grafo del vault'),
        actions: [
          IconButton(
            icon: Icon(_localOnly ? Icons.center_focus_strong : Icons.public),
            onPressed: () => setState(() {
              _localOnly = !_localOnly;
              _focusedNode = null;
            }),
            tooltip: _localOnly ? 'Ver todo' : 'Ver local',
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _graph == null || _graph!.nodes.isEmpty
          ? const Center(child: Text('No hay notas'))
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: TextField(
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search),
                      hintText: 'Filtrar por titulo...',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    onChanged: (v) => setState(() => _filter = v.toLowerCase()),
                  ),
                ),
                Expanded(
                  child: InteractiveViewer(
                    transformationController: _transformController,
                    minScale: 0.1,
                    maxScale: 4.0,
                    boundaryMargin: const EdgeInsets.all(200),
                    child: GraphHitTestWrapper(
                      nodes: _filterGraph().nodes,
                      positions: _positions,
                      sizes: _sizes,
                      onNodeTap: (path) {
                        if (_localOnly) {
                          setState(() => _focusedNode = path);
                        } else {
                          Navigator.push(context, MaterialPageRoute(
                            builder: (_) => NoteView(notePath: path, vaultPath: widget.vaultPath),
                          ));
                        }
                      },
                      child: CustomPaint(
                        size: const Size(1000, 1000),
                        painter: _GraphPainter(
                          graph: _filterGraph(),
                          positions: _positions,
                          sizes: _sizes,
                          focusedNode: _focusedNode,
                          onNodeTap: (_) {},
                        ),
                      ),
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.all(8),
                  color: Theme.of(context).colorScheme.surfaceContainerHigh,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('${_graph!.nodes.length} notas, ${_graph!.edges.length} enlaces',
                        style: const TextStyle(fontSize: 12)),
                      Text(_localOnly ? 'Modo local' : 'Modo global',
                        style: const TextStyle(fontSize: 12)),
                    ],
                  ),
                ),
              ],
            ),
    );
  }

  GraphData _filterGraph() {
    final g = _graph!;
    if (_localOnly && _focusedNode != null) {
      // Vecinos directos
      final neighbors = <String>{_focusedNode!};
      for (final e in g.edges) {
        if (e.from == _focusedNode) neighbors.add(e.to);
        if (e.to == _focusedNode) neighbors.add(e.from);
      }
      return GraphData(
        nodes: g.nodes.where((n) => neighbors.contains(n.path)).toList(),
        edges: g.edges.where((e) => neighbors.contains(e.from) && neighbors.contains(e.to)).toList(),
      );
    }
    if (_filter.isEmpty) return g;
    return GraphData(
      nodes: g.nodes.where((n) => n.title.toLowerCase().contains(_filter)).toList(),
      edges: g.edges.where((e) {
        final from = g.nodes.firstWhere((n) => n.path == e.from, orElse: () => g.nodes.first);
        final to = g.nodes.firstWhere((n) => n.path == e.to, orElse: () => g.nodes.first);
        return from.title.toLowerCase().contains(_filter) || to.title.toLowerCase().contains(_filter);
      }).toList(),
    );
  }
}

class _GraphPainter extends CustomPainter {
  final GraphData graph;
  final Map<String, Offset> positions;
  final Map<String, double> sizes;
  final String? focusedNode;
  final void Function(String) onNodeTap;

  _GraphPainter({
    required this.graph,
    required this.positions,
    required this.sizes,
    this.focusedNode,
    required this.onNodeTap,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Aristas
    final edgePaint = Paint()
      ..color = Colors.grey.withValues(alpha: 0.4)
      ..strokeWidth = 1.0
      ..style = PaintingStyle.stroke;
    for (final e in graph.edges) {
      final p1 = positions[e.from];
      final p2 = positions[e.to];
      if (p1 == null || p2 == null) continue;
      canvas.drawLine(p1, p2, edgePaint);
    }
    // Nodos
    for (final n in graph.nodes) {
      final pos = positions[n.path];
      if (pos == null) continue;
      final r = sizes[n.path] ?? 8.0;
      final isFocused = n.path == focusedNode;
      final color = isFocused
        ? Colors.purple
        : _colorForFolder(n.folder);
      final fill = Paint()..color = color.withValues(alpha: 0.8);
      canvas.drawCircle(pos, r, fill);
      // Borde
      final border = Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = isFocused ? 3 : 1.5;
      canvas.drawCircle(pos, r, border);
      // Label si tiene grado alto
      if (n.degree >= 2 || isFocused) {
        final tp = TextPainter(
          text: TextSpan(
            text: n.title.length > 20 ? '${n.title.substring(0, 18)}…' : n.title,
            style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
          ),
          textDirection: TextDirection.ltr,
        )..layout();
        tp.paint(canvas, pos + Offset(-tp.width / 2, r + 2));
      }
    }
  }

  Color _colorForFolder(String? folder) {
    if (folder == null) return Colors.blueGrey;
    final hash = folder.hashCode;
    final hue = (hash % 360).toDouble();
    return HSVColor.fromAHSV(1.0, hue, 0.6, 0.7).toColor();
  }

  @override
  bool shouldRepaint(_GraphPainter old) => true;

  @override
  bool? hitTest(Offset position) => null; // Custom hit-testing abajo
}

class GraphHitTestWrapper extends StatelessWidget {
  final Widget child;
  final List<GraphNode> nodes;
  final Map<String, Offset> positions;
  final Map<String, double> sizes;
  final void Function(String) onNodeTap;
  const GraphHitTestWrapper({
    super.key,
    required this.child,
    required this.nodes,
    required this.positions,
    required this.sizes,
    required this.onNodeTap,
  });

  @override
  Widget build(BuildContext context) {
    return Stack(children: [
      child,
      for (final n in nodes)
        if (positions.containsKey(n.path))
          Positioned(
            left: positions[n.path]!.dx - (sizes[n.path] ?? 8),
            top: positions[n.path]!.dy - (sizes[n.path] ?? 8),
            width: (sizes[n.path] ?? 8) * 2,
            height: (sizes[n.path] ?? 8) * 2,
            child: GestureDetector(
              onTap: () => onNodeTap(n.path),
              child: Container(color: Colors.transparent),
            ),
          ),
    ]);
  }
}
