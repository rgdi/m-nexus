// HandwritingCanvas: widget para dibujar sobre notas (Samsung Notes style).
//
// v0.48: permite al usuario:
//   - Dibujar trazos libres (Custom Painter, GestureDetector)
//   - 5 colores (negro, azul, rojo, verde, amarillo)
//   - 3 grosores (1.0, 3.0, 6.0)
//   - 2 herramientas (pen, highlighter — alta transparencia)
//   - Eraser (borrado lógico — elimina trazo entero)
//   - Undo/Redo (pila de strokes)
//   - Persistencia: lista de strokes en JSON dentro del frontmatter
//
// Uso:
//   HandwritingCanvas(
//     strokes: noteStrokes,
//     onChanged: (strokes) => noteService.updateStrokes(strokes),
//   )

import 'dart:math' as math;
import 'package:flutter/material.dart';

class Stroke {
  final List<Offset> points;
  final Color color;
  final double width;
  // 'pen' o 'highlighter' (alpha 0.4). Si es 'eraser', width=20 y color=transparent.
  final String tool;

  const Stroke({
    required this.points,
    required this.color,
    required this.width,
    required this.tool,
  });

  Map<String, dynamic> toJson() => {
        'tool': tool,
        'color': color.value,
        'width': width,
        'points': points.map((p) => {'x': p.dx, 'y': p.dy}).toList(),
      };

  static Stroke fromJson(Map<String, dynamic> j) => Stroke(
        tool: j['tool'] as String,
        color: Color(j['color'] as int),
        width: (j['width'] as num).toDouble(),
        points: (j['points'] as List)
            .map((p) => Offset((p['x'] as num).toDouble(), (p['y'] as num).toDouble()))
            .toList(),
      );
}

class HandwritingCanvas extends StatefulWidget {
  final List<Stroke> initialStrokes;
  // v0.48: callback cuando la lista cambia (para guardar en frontmatter).
  final void Function(List<Stroke> strokes)? onChanged;
  // v0.48: si true, renderiza en modo read-only.
  final bool readOnly;
  // v0.48: tamaño del canvas. Si null, se expande.
  final Size? size;

  const HandwritingCanvas({
    super.key,
    this.initialStrokes = const [],
    this.onChanged,
    this.readOnly = false,
    this.size,
  });

  @override
  State<HandwritingCanvas> createState() => HandwritingCanvasState();
}

class HandwritingCanvasState extends State<HandwritingCanvas> {
  // v0.48: lista activa de trazos. Se persiste via onChanged.
  late List<Stroke> _strokes = List.of(widget.initialStrokes);
  // v0.48: pila de undo/redo.
  final List<List<Stroke>> _undoStack = [];
  final List<List<Stroke>> _redoStack = [];
  // v0.48: estado del trazo en curso.
  List<Offset> _current = [];
  Color _color = Colors.black;
  String _tool = 'pen';
  static const _widths = [1.0, 3.0, 6.0];

  double get _width => _tool == 'highlighter'
      ? 16.0
      : _tool == 'eraser'
          ? 20.0
          : _widths[_widthIdx];

  int _widthIdx = 1;

  /// v0.48 API: obtiene los strokes actuales.
  List<Stroke> get strokes => List.unmodifiable(_strokes);

  /// v0.48 API: limpia todo el lienzo.
  void clear() {
    _pushHistory();
    setState(() => _strokes.clear());
    widget.onChanged?.call(strokes);
  }

  /// v0.48 API: deshacer.
  void undo() {
    if (_undoStack.isEmpty) return;
    setState(() {
      _redoStack.add(_strokes);
      _strokes = _undoStack.removeLast();
    });
    widget.onChanged?.call(strokes);
  }

  /// v0.48 API: rehacer.
  void redo() {
    if (_redoStack.isEmpty) return;
    setState(() {
      _undoStack.add(_strokes);
      _strokes = _redoStack.removeLast();
    });
    widget.onChanged?.call(strokes);
  }

  void _pushHistory() {
    _undoStack.add(List.of(_strokes));
    if (_undoStack.length > 50) _undoStack.removeAt(0);
    _redoStack.clear();
  }

  void _setTool(String tool) => setState(() => _tool = tool);

  void _setColor(Color c) => setState(() => _color = c);

  void _setWidth(int idx) => setState(() => _widthIdx = idx);

  void _onPanStart(DragStartDetails d) {
    if (widget.readOnly) return;
    _pushHistory();
    setState(() => _current = [d.localPosition]);
  }

  void _onPanUpdate(DragUpdateDetails d) {
    if (widget.readOnly || _current.isEmpty) return;
    setState(() => _current.add(d.localPosition));
  }

  void _onPanEnd(DragEndDetails d) {
    if (widget.readOnly || _current.isEmpty) return;
    final color = _tool == 'highlighter'
        ? _color.withAlpha(100)
        : _tool == 'eraser'
            ? const Color(0x00000000)
            : _color;
    setState(() {
      _strokes.add(Stroke(
        points: List.of(_current),
        color: color,
        width: _width,
        tool: _tool,
      ));
      _current = [];
    });
    widget.onChanged?.call(strokes);
  }

  @override
  Widget build(BuildContext context) {
    final colors = [Colors.black, Colors.blue, Colors.red, Colors.green, Colors.orange];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!widget.readOnly)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Wrap(
              spacing: 4,
              runSpacing: 4,
              children: [
                _toolBtn('pen', Icons.edit, 'Lápiz'),
                _toolBtn('highlighter', Icons.brush, 'Marcador'),
                _toolBtn('eraser', Icons.cleaning_services, 'Borrar'),
                const VerticalDivider(width: 16),
                for (final c in colors)
                  GestureDetector(
                    onTap: () => _setColor(c),
                    child: Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: c,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: _color.value == c.value
                              ? Theme.of(context).colorScheme.primary
                              : Colors.grey.shade400,
                          width: _color.value == c.value ? 3 : 1,
                        ),
                      ),
                    ),
                  ),
                const VerticalDivider(width: 16),
                for (int i = 0; i < _widths.length; i++)
                  GestureDetector(
                    onTap: () => _setWidth(i),
                    child: Container(
                      width: 32,
                      height: 32,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        border: Border.all(
                          color: _widthIdx == i
                              ? Theme.of(context).colorScheme.primary
                              : Colors.grey.shade400,
                          width: _widthIdx == i ? 2 : 1,
                        ),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Container(
                        width: _widths[i] * 2 + 4,
                        height: _widths[i] * 2 + 4,
                        decoration: BoxDecoration(
                          color: _color,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                  ),
                const VerticalDivider(width: 16),
                IconButton(
                  icon: const Icon(Icons.undo),
                  tooltip: 'Deshacer',
                  onPressed: _undoStack.isEmpty ? null : undo,
                ),
                IconButton(
                  icon: const Icon(Icons.redo),
                  tooltip: 'Rehacer',
                  onPressed: _redoStack.isEmpty ? null : redo,
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: 'Limpiar todo',
                  onPressed: _strokes.isEmpty ? null : clear,
                ),
              ],
            ),
          ),
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: Colors.grey.shade300),
              borderRadius: BorderRadius.circular(8),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onPanStart: _onPanStart,
                onPanUpdate: _onPanUpdate,
                onPanEnd: _onPanEnd,
                child: CustomPaint(
                  painter: _StrokePainter(
                    strokes: _strokes,
                    current: _current,
                    currentColor: _color,
                    currentTool: _tool,
                    currentWidth: _width,
                  ),
                  size: widget.size ?? Size.infinite,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _toolBtn(String id, IconData icon, String tip) {
    return IconButton(
      icon: Icon(icon),
      tooltip: tip,
      isSelected: _tool == id,
      color: _tool == id ? Theme.of(context).colorScheme.primary : null,
      onPressed: () => _setTool(id),
    );
  }
}

class _StrokePainter extends CustomPainter {
  final List<Stroke> strokes;
  final List<Offset> current;
  final Color currentColor;
  final String currentTool;
  final double currentWidth;

  _StrokePainter({
    required this.strokes,
    required this.current,
    required this.currentColor,
    required this.currentTool,
    required this.currentWidth,
  });

  void _paintStroke(Canvas canvas, Stroke s) {
    if (s.points.isEmpty) return;
    final paint = Paint()
      ..color = s.color
      ..strokeWidth = s.width
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    // v0.48: blendMode para highlighter (multiply) o eraser (clear).
    if (s.tool == 'highlighter') {
      paint.blendMode = BlendMode.multiply;
    } else if (s.tool == 'eraser') {
      paint.blendMode = BlendMode.clear;
    }
    if (s.points.length == 1) {
      canvas.drawCircle(s.points.first, s.width / 2, paint);
      return;
    }
    final path = Path()..moveTo(s.points.first.dx, s.points.first.dy);
    for (int i = 1; i < s.points.length - 1; i++) {
      // Suavizar con quadTo entre puntos consecutivos
      final p1 = s.points[i];
      final p2 = s.points[i + 1];
      final mid = Offset((p1.dx + p2.dx) / 2, (p1.dy + p2.dy) / 2);
      path.quadraticBezierTo(p1.dx, p1.dy, mid.dx, mid.dy);
    }
    path.lineTo(s.points.last.dx, s.points.last.dy);
    canvas.drawPath(path, paint);
  }

  @override
  void paint(Canvas canvas, Size size) {
    for (final s in strokes) {
      _paintStroke(canvas, s);
    }
    if (current.isNotEmpty) {
      final color = currentTool == 'highlighter'
          ? currentColor.withAlpha(100)
          : currentColor;
      _paintStroke(
        canvas,
        Stroke(points: current, color: color, width: currentWidth, tool: currentTool),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _StrokePainter old) =>
      old.strokes != strokes ||
      old.current != current ||
      old.currentColor != currentColor ||
      old.currentTool != currentTool ||
      old.currentWidth != currentWidth;
}
