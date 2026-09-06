// FlashcardsList: lista de flashcards.

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../../services/flashcard_service.dart';
import '../../services/vault_detector.dart';
import '../../widgets/empty_state.dart';
import 'flashcard_review.dart';
import 'flashcard_edit.dart';

class FlashcardsList extends StatefulWidget {
  const FlashcardsList({super.key});
  @override
  State<FlashcardsList> createState() => _FlashcardsListState();
}

class _FlashcardsListState extends State<FlashcardsList> {
  FlashcardService? _service;
  List<Flashcard> _all = [];
  List<Flashcard> _filtered = [];
  bool _loading = true;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final detector = VaultDetector();
    final vaults = await detector.detectVaults();
    if (!mounted) return;
    if (vaults.isEmpty) {
      setState(() { _loading = false; });
      return;
    }
    _service = FlashcardService(vaults.first.path);
    _all = await _service!.listAll();
    if (!mounted) return;
    _applyFilter();
    setState(() { _loading = false; });
  }

  void _applyFilter() {
    if (_search.isEmpty) {
      _filtered = List.of(_all);
    } else {
      final q = _search.toLowerCase();
      _filtered = _all.where((c) =>
        c.question.toLowerCase().contains(q) ||
        c.answer.toLowerCase().contains(q)).toList();
    }
    _filtered.sort((a, b) {
      if (a.isDue != b.isDue) return a.isDue ? -1 : 1;
      return a.question.compareTo(b.question);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando tarjetas…');
    if (_service == null) {
      return const EmptyState(icon: Icons.folder_off, title: 'Sin vault');
    }
    final dueCount = _all.where((c) => c.isDue).length;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Tarjetas', style: TextStyle(fontSize: 16)),
            Text(
              '${_all.length} total · $dueCount para repasar',
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.normal),
            ),
          ],
        ),
        actions: [
          if (dueCount > 0)
            IconButton(
              icon: const Icon(Icons.play_arrow),
              onPressed: () {
                Navigator.push(context, MaterialPageRoute(
                  builder: (_) => FlashcardReview(
                    cards: _all.where((c) => c.isDue).toList(),
                    service: _service!,
                    onFinish: _load,
                  ),
                ));
              },
              tooltip: 'Repasar ($dueCount)',
            ),
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              Navigator.push(context, MaterialPageRoute(
                builder: (_) => FlashcardEdit(
                  service: _service!,
                  onSaved: _load,
                ),
              )).then((_) => _load());
            },
            tooltip: 'Nueva tarjeta',
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              decoration: const InputDecoration(
                hintText: 'Buscar…',
                prefixIcon: Icon(Icons.search, size: 20),
                isDense: true,
              ),
              onChanged: (v) {
                setState(() {
                  _search = v;
                  _applyFilter();
                });
              },
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _filtered.isEmpty
                ? EmptyState(
                    icon: Icons.style,
                    title: 'Sin tarjetas',
                    subtitle: 'Andá a Flashcards → + para crear una',
                    action: FilledButton.icon(
                      onPressed: () {
                        Navigator.push(context, MaterialPageRoute(
                          builder: (_) => FlashcardEdit(
                            service: _service!,
                            onSaved: _load,
                          ),
                        ));
                      },
                      icon: const Icon(Icons.add),
                      label: const Text('Crear primera'),
                    ),
                  )
                : ListView.builder(
                    itemCount: _filtered.length,
                    itemBuilder: (ctx, i) {
                      final c = _filtered[i];
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundColor: c.approved
                              ? Colors.green.shade100
                              : Colors.orange.shade100,
                          radius: 16,
                          child: Text('${c.difficulty}',
                            style: TextStyle(
                              fontSize: 12,
                              color: c.approved
                                  ? Colors.green.shade900
                                  : Colors.orange.shade900,
                            )),
                        ),
                        title: Text(c.question,
                          maxLines: 2, overflow: TextOverflow.ellipsis),
                        subtitle: Text(
                          c.isDue
                              ? 'Vencida · rev. ${_fmt(c.nextReview)}'
                              : 'Próxima: ${_fmt(c.nextReview)}',
                          style: TextStyle(
                            fontSize: 11,
                            color: c.isDue ? Colors.red : null,
                          ),
                        ),
                        trailing: PopupMenuButton<String>(
                          onSelected: (a) async {
                            if (a == 'delete') {
                              await _service!.delete(c);
                              _load();
                            } else if (a == 'approve' && !c.approved) {
                              await _service!.approve(c);
                              _load();
                            }
                          },
                          itemBuilder: (_) => [
                            if (!c.approved)
                              const PopupMenuItem(
                                value: 'approve',
                                child: Text('Aprobar'),
                              ),
                            const PopupMenuItem(
                              value: 'delete',
                              child: Text('Borrar'),
                            ),
                          ],
                        ),
                        onTap: () {
                          Navigator.push(context, MaterialPageRoute(
                            builder: (_) => FlashcardReview(
                              cards: [c],
                              service: _service!,
                              onFinish: _load,
                            ),
                          ));
                        },
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  String _fmt(DateTime? d) {
    if (d == null) return '—';
    final diff = d.difference(DateTime.now()).inDays;
    if (diff < 0) return 'hace ${-diff}d';
    if (diff == 0) return 'hoy';
    if (diff == 1) return 'mañana';
    return 'en ${diff}d';
  }
}
