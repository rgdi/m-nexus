// global_tasks_screen.dart: vista global de tasks del vault.
//
// v0.60 (P1.7): lista plana de todas las tasks (todo) en el vault.
// Filtro por estado (done/pending/urgent) y por tag.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../services/global_tasks_service.dart';
import '../note/note_view.dart';

class GlobalTasksScreen extends StatefulWidget {
  final String vaultPath;
  const GlobalTasksScreen({super.key, required this.vaultPath});

  @override
  State<GlobalTasksScreen> createState() => _GlobalTasksScreenState();
}

class _GlobalTasksScreenState extends State<GlobalTasksScreen> {
  List<GlobalTask> _tasks = [];
  bool _loading = true;
  String _filter = 'all'; // all, pending, done, urgent
  String? _tagFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final svc = GlobalTasksService(widget.vaultPath);
    final all = await svc.all(includeDone: _filter == 'done' || _filter == 'all');
    if (!mounted) return;
    setState(() {
      _tasks = all;
      _loading = false;
    });
  }

  List<GlobalTask> get _filtered {
    var list = _tasks;
    if (_filter == 'pending') list = list.where((t) => !t.done).toList();
    if (_filter == 'done') list = list.where((t) => t.done).toList();
    if (_filter == 'urgent') list = list.where((t) => t.priority >= 2).toList();
    if (_tagFilter != null) {
      list = list.where((t) => t.tags.contains(_tagFilter)).toList();
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tasks globales'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              _buildFilterChips(),
              _buildTagFilters(),
              const Divider(height: 1),
              Expanded(
                child: _filtered.isEmpty
                  ? const Center(child: Text('Sin tasks'))
                  : ListView.builder(
                      itemCount: _filtered.length,
                      itemBuilder: (ctx, i) {
                        final t = _filtered[i];
                        return _buildTaskTile(t);
                      },
                    ),
              ),
            ],
          ),
    );
  }

  Widget _buildFilterChips() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.all(8),
      child: Row(
        children: [
          _chip('all', 'Todas', Icons.list),
          _chip('pending', 'Pendientes', Icons.radio_button_unchecked),
          _chip('done', 'Hechas', Icons.check_circle_outline),
          _chip('urgent', 'Urgentes', Icons.priority_high),
        ],
      ),
    );
  }

  Widget _buildTagFilters() {
    final tags = <String>{};
    for (final t in _tasks) tags.addAll(t.tags);
    if (tags.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 32,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
            child: FilterChip(
              label: const Text('Todos los tags'),
              selected: _tagFilter == null,
              onSelected: (_) => setState(() => _tagFilter = null),
            ),
          ),
          for (final t in tags)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
              child: FilterChip(
                label: Text('#$t'),
                selected: _tagFilter == t,
                onSelected: (sel) => setState(() => _tagFilter = sel ? t : null),
              ),
            ),
        ],
      ),
    );
  }

  Widget _chip(String value, String label, IconData icon) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: ChoiceChip(
        label: Text(label),
        avatar: Icon(icon, size: 16),
        selected: _filter == value,
        onSelected: (_) {
          setState(() => _filter = value);
          _load();
        },
      ),
    );
  }

  Widget _buildTaskTile(GlobalTask t) {
    final dateFmt = DateFormat('yyyy-MM-dd');
    final isOverdue = t.dueDate != null && t.dueDate!.isBefore(DateTime.now()) && !t.done;
    // v0.62.7: CheckboxListTile no soporta onTap. Envuelto en InkWell.
    return InkWell(
      onTap: () {
        Navigator.push(context, MaterialPageRoute(
          builder: (_) => NoteView(notePath: t.notePath, vaultPath: widget.vaultPath),
        ));
      },
      child: CheckboxListTile(
        value: t.done,
        onChanged: (v) async {
          final svc = GlobalTasksService(widget.vaultPath);
          await svc.toggleDone(t);
          await _load();
        },
        controlAffinity: ListTileControlAffinity.leading,
        title: Text(
          t.text,
          style: TextStyle(
            decoration: t.done ? TextDecoration.lineThrough : null,
            color: t.done ? Colors.grey : null,
          ),
        ),
        subtitle: Row(
          children: [
            Icon(Icons.note, size: 12, color: Colors.grey[600]),
            const SizedBox(width: 4),
            Expanded(
              child: Text(t.noteTitle, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, color: Colors.grey[600])),
            ),
            if (t.dueDate != null) ...[
              const SizedBox(width: 4),
              Icon(Icons.event, size: 12, color: isOverdue ? Colors.red : Colors.grey[600]),
              const SizedBox(width: 2),
              Text(dateFmt.format(t.dueDate!),
                style: TextStyle(fontSize: 11, color: isOverdue ? Colors.red : Colors.grey[600])),
            ],
            if (t.priority >= 2) ...[
              const SizedBox(width: 4),
              const Text('🔺', style: TextStyle(fontSize: 14)),
            ],
          ],
        ),
      ),
    );
  }
}
