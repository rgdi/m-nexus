// mindmap_screen.dart — Genera un mind map desde una nota.
// v0.62.16: AFFiNE feature top — dado el outline de una nota, genera una
// estructura jerárquica de nodos (parent → children). Renderizado simple
// con CustomPaint (no CanvasRenderer como AFFiNE — eso requiere BlockSuite).

import 'package:flutter/material.dart';
import '../../core/design_tokens.dart';
import '../../services/ai_tutor_client.dart';
import '../../services/settings_service.dart';
import '../../services/vault_service.dart';
import '../../widgets/empty_state.dart';

class MindmapScreen extends StatefulWidget {
  final String vaultPath;
  final String sourceNotePath;
  const MindmapScreen({
    super.key,
    required this.vaultPath,
    required this.sourceNotePath,
  });
  @override
  State<MindmapScreen> createState() => _MindmapScreenState();
}

class _MindmapNode {
  final String text;
  final List<_MindmapNode> children;
  _MindmapNode(this.text, [this.children = const []]);
}

class _DrawnNode {
  final _MindmapNode node;
  final Offset pos;
  final _DrawnNode? parent;
  final int depth;
  _DrawnNode(this.node, this.pos, this.parent, this.depth);
  Offset? get parentPos => parent?.pos;
}

class _MindmapScreenState extends State<MindmapScreen> {
  AiTutorClient? _tutor;
  String? _sourceContent;
  _MindmapNode? _root;
  bool _generating = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tutor = AiTutorClient(
      backendUrl: SettingsService.instance.current.backendUrl ?? '',
    );
    _load();
  }

  Future<void> _load() async {
    final v = VaultService(widget.vaultPath);
    final note = await v.readNote(widget.sourceNotePath);
    if (note != null && mounted) {
      setState(() => _sourceContent = note.content);
    }
  }

  Future<void> _generate() async {
    if (_sourceContent == null || _tutor == null) return;
    setState(() {
      _generating = true;
      _error = null;
      _root = null;
    });
    try {
      final prompt = '''
Genera un mind map JSON jerárquico para el siguiente contenido.
Responde SOLO con JSON válido (sin markdown), con la estructura:
{
  "text": "Título central",
  "children": [
    {"text": "Subtítulo", "children": [...]}
  ]
}

Contenido:
${_sourceContent!.length > 3000 ? _sourceContent!.substring(0, 3000) : _sourceContent!}
''';
      final resp = await _tutor!.ask(prompt, context: '');
      final root = _parseMindmap(resp.answer);
      if (mounted) setState(() {
        _root = root;
        _generating = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        _error = '$e';
        _generating = false;
      });
    }
  }

  _MindmapNode _parseMindmap(String text) {
    final start = text.indexOf('{');
    final end = text.lastIndexOf('}');
    if (start < 0 || end < 0) {
      return _MindmapNode('Sin respuesta válida');
    }
    try {
      final json = text.substring(start, end + 1);
      return _parseNode(json);
    } catch (_) {
      return _MindmapNode(text.substring(start, (start + 80).clamp(0, text.length)));
    }
  }

  _MindmapNode _parseNode(String jsonStr) {
    final textMatch = RegExp(r'"text"\s*:\s*"([^"]+)"').firstMatch(jsonStr);
    final text = textMatch?.group(1) ?? '?';
    final children = <_MindmapNode>[];
    final childrenMatch = RegExp(r'"children"\s*:\s*\[(.*)\](?=\s*[,\}])',
        dotAll: true).firstMatch(jsonStr);
    if (childrenMatch != null) {
      final body = childrenMatch.group(1)!;
      int depth = 0;
      int objStart = -1;
      for (int i = 0; i < body.length; i++) {
        if (body[i] == '{') {
          if (depth == 0) objStart = i;
          depth++;
        } else if (body[i] == '}') {
          depth--;
          if (depth == 0 && objStart >= 0) {
            children.add(_parseNode(body.substring(objStart, i + 1)));
            objStart = -1;
          }
        }
      }
    }
    return _MindmapNode(text, children);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Mind Map', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _generating ? null : _generate,
            tooltip: 'Regenerar',
          ),
        ],
      ),
      body: SafeArea(
        top: true, bottom: false,
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLow.withOpacity(0.4),
                border: Border(bottom: BorderSide(color: Theme.of(context).dividerColor.withOpacity(0.2))),
              ),
              child: Row(
                children: [
                  const Icon(Icons.auto_awesome, color: MxColors.violet),
                  const SizedBox(width: 8),
                  Expanded(child: Text(
                    'Genera un mind map desde tu nota usando AI.',
                    style: Theme.of(context).textTheme.bodySmall,
                  )),
                  FilledButton.icon(
                    onPressed: _generating ? null : _generate,
                    icon: const Icon(Icons.play_arrow_rounded, size: 16),
                    label: Text(_generating ? 'Generando…' : 'Generar'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _error != null
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(MxSpacing.xl),
                        child: Text('Error: $_error',
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.red)),
                      ),
                    )
                  : _root == null
                      ? EmptyState(
                          icon: Icons.account_tree_outlined,
                          title: _generating ? 'Generando mind map...' : 'Sin mind map',
                          subtitle: _generating
                              ? 'Esto puede tardar unos segundos.'
                              : 'Toca "Generar" para crear uno desde esta nota.',
                        )
                      : InteractiveViewer(
                          minScale: 0.5,
                          maxScale: 3.0,
                          child: _MindmapCanvas(root: _root!),
                        ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MindmapCanvas extends StatelessWidget {
  final _MindmapNode root;
  const _MindmapCanvas({required this.root});
  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _MindmapPainter(root),
      size: Size.infinite,
    );
  }
}

class _MindmapPainter extends CustomPainter {
  final _MindmapNode root;
  _MindmapPainter(this.root);

  void _layout(_MindmapNode node, double x, double y, List<_DrawnNode> out,
      _DrawnNode? parent, int depth) {
    out.add(_DrawnNode(node, Offset(x, y), parent, depth));
    final childSpacing = 140.0;
    final startX = x - (node.children.length - 1) * childSpacing / 2;
    for (int i = 0; i < node.children.length; i++) {
      _layout(node.children[i], startX + i * childSpacing, y + 120, out, _DrawnNode(node, Offset(x, y), null, depth), depth + 1);
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    final drawn = <_DrawnNode>[];
    _layout(root, size.width / 2, 60, drawn, null, 0);
    final linePaint = Paint()
      ..color = MxColors.indigoDeep.withOpacity(0.4)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    final bgPaint = Paint()..color = MxColors.indigoDeep;
    final ringPaint = Paint()..color = MxColors.violet;
    final textStyle = TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600);

    for (final n in drawn) {
      if (n.parentPos != null) {
        canvas.drawLine(n.parentPos as Offset, n.pos, linePaint);
      }
    }
    for (final n in drawn) {
      final isRoot = n.parentPos == null;
      final r = isRoot ? 36.0 : 26.0;
      canvas.drawCircle(n.pos, r, isRoot ? bgPaint : ringPaint);
      final tp = TextPainter(
        text: TextSpan(text: n.node.text, style: textStyle),
        textDirection: TextDirection.ltr,
        maxLines: 2,
        textAlign: TextAlign.center,
        ellipsis: '…',
      )..layout(maxWidth: 120);
      tp.paint(canvas, n.pos - Offset(tp.width / 2, tp.height / 2));
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
