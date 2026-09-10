// kanban_screen.dart: vista Kanban estilo Trello/Notion Board.
//
// v0.60 (P1.9): cada nota con `status: <col>` aparece en su columna.
// Drag&drop actualiza el status. Tap en card = abrir nota.

import 'package:flutter/material.dart';
import '../../services/kanban_service.dart';
import '../note/note_view.dart';

class KanbanScreen extends StatefulWidget {
  final String vaultPath;
  const KanbanScreen({super.key, required this.vaultPath});

  @override
  State<KanbanScreen> createState() => _KanbanScreenState();
}

class _KanbanScreenState extends State<KanbanScreen> {
  Map<String, List<KanbanCard>> _board = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final svc = KanbanService(widget.vaultPath);
    final b = await svc.board();
    if (!mounted) return;
    setState(() {
      _board = b;
      _loading = false;
    });
  }

  Future<void> _move(KanbanCard card, String toCol) async {
    final svc = KanbanService(widget.vaultPath);
    await svc.moveCard(card.path, toCol);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Kanban'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _board.keys.map((col) {
                return DragTarget<KanbanCard>(
                  onAcceptWithDetails: (d) => _move(d.data, col),
                  builder: (ctx, candidates, rejected) {
                    final cards = _board[col] ?? [];
                    return _buildColumn(col, cards);
                  },
                );
              }).toList(),
            ),
          ),
    );
  }

  Widget _buildColumn(String col, List<KanbanCard> cards) {
    return Container(
      width: 280,
      margin: const EdgeInsets.all(8),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(col, style: const TextStyle(fontWeight: FontWeight.bold)),
                Chip(label: Text('${cards.length}')),
              ],
            ),
          ),
          ...cards.map((c) => Draggable<KanbanCard>(
            data: c,
            feedback: Material(
              color: Colors.transparent,
              child: Container(
                width: 264,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(c.title),
              ),
            ),
            childWhenDragging: Opacity(opacity: 0.3, child: _buildCard(c)),
            child: _buildCard(c),
          )),
        ],
      ),
    );
  }

  Widget _buildCard(KanbanCard c) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: InkWell(
        onTap: () => Navigator.push(context, MaterialPageRoute(
          builder: (_) => NoteView(notePath: c.path, vaultPath: widget.vaultPath),
        )),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(c.title, maxLines: 2, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w600)),
              if (c.folder != null)
                Text(c.folder!, style: TextStyle(fontSize: 11, color: Colors.grey[600])),
              if (c.tags.isNotEmpty)
                Wrap(spacing: 4, children: c.tags.take(3).map((t) => Chip(
                  label: Text('#$t', style: const TextStyle(fontSize: 10)),
                  visualDensity: VisualDensity.compact,
                )).toList()),
            ],
          ),
        ),
      ),
    );
  }
}
