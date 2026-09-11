// databases_screen.dart: linked databases estilo Notion sobre el vault.
//
// v0.51: cada DatabaseQuery es una vista filtrada del vault.
// UI: lista lateral de databases + tabla principal con resultados.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import '../../services/database_query_service.dart';
import '../note/note_view.dart';

class DatabasesScreen extends StatefulWidget {
  final String vaultPath;
  const DatabasesScreen({super.key, required this.vaultPath});

  @override
  State<DatabasesScreen> createState() => _DatabasesScreenState();
}

class _DatabasesScreenState extends State<DatabasesScreen> {
  late final DatabaseQueryService _service;
  List<DatabaseQuery> _queries = [];
  List<QueryResult> _results = [];
  DatabaseQuery? _selected;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _service = DatabaseQueryService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    var queries = await _service.load();
    if (queries.isEmpty) {
      // Sembrar con suggested
      for (final q in DatabaseQueryService.suggested()) {
        await _service.create(
          name: q.name, field: q.field, value: q.value, tags: q.tags,
          sortBy: q.sortBy, order: q.order, limit: q.limit,
        );
      }
      queries = await _service.load();
    }
    setState(() {
      _queries = queries;
      _selected = queries.isNotEmpty ? queries.first : null;
      _loading = false;
    });
    if (_selected != null) await _run(_selected!);
  }

  Future<void> _run(DatabaseQuery q) async {
    setState(() {
      _selected = q;
      _results = [];
      _loading = true;
    });
    final results = await _service.run(q);
    if (!mounted) return;
    setState(() {
      _results = results;
      _loading = false;
    });
  }

  Future<void> _newDatabase() async {
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final c = TextEditingController(text: 'Nueva database');
        return AlertDialog(
          title: const Text('Nueva database'),
          content: TextField(controller: c, autofocus: true,
            decoration: const InputDecoration(labelText: 'Nombre')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()),
              child: const Text('Crear')),
          ],
        );
      },
    );
    if (name == null || name.isEmpty) return;
    final q = await _service.create(name: name);
    await _load();
    await _run(q);
  }

  Future<void> _editDatabase(DatabaseQuery q) async {
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final c = TextEditingController(text: q.name);
        return AlertDialog(
          title: const Text('Editar nombre'),
          content: TextField(controller: c, autofocus: true),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()),
              child: const Text('Guardar')),
          ],
        );
      },
    );
    if (name == null || name.isEmpty) return;
    q.name = name;
    await _service.update(q);
    await _load();
  }

  Future<void> _deleteDatabase(DatabaseQuery q) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Eliminar "${q.name}"?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _service.delete(q.id);
    await _load();
  }

  Future<void> _editFilters(DatabaseQuery q) async {
    final valueC = TextEditingController(text: q.value ?? '');
    final tagsC = TextEditingController(text: q.tags.join(', '));
    DbField field = q.field;
    DbField sortBy = q.sortBy;
    DbOrder order = q.order;
    int limit = q.limit;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setState) {
        return AlertDialog(
          title: const Text('Filtros y orden'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<DbField>(
                  value: field,
                  decoration: const InputDecoration(labelText: 'Buscar por'),
                  items: DbField.values.map((f) => DropdownMenuItem(value: f,
                    child: Text(_fieldLabel(f)))).toList(),
                  onChanged: (v) => setState(() => field = v!),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: valueC,
                  decoration: const InputDecoration(labelText: 'Valor'),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: tagsC,
                  decoration: const InputDecoration(
                    labelText: 'Tags (separados por coma)',
                    hintText: 'anatomia, importante',
                  ),
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<DbField>(
                  value: sortBy,
                  decoration: const InputDecoration(labelText: 'Ordenar por'),
                  items: DbField.values.map((f) => DropdownMenuItem(value: f,
                    child: Text(_fieldLabel(f)))).toList(),
                  onChanged: (v) => setState(() => sortBy = v!),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<DbOrder>(
                        value: order,
                        decoration: const InputDecoration(labelText: 'Orden'),
                        items: DbOrder.values.map((o) => DropdownMenuItem(value: o,
                          child: Text(o == DbOrder.asc ? 'Ascendente' : 'Descendente'))).toList(),
                        onChanged: (v) => setState(() => order = v!),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 100,
                      child: TextField(
                        controller: TextEditingController(text: '$limit'),
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Limite'),
                        onChanged: (v) => limit = int.tryParse(v) ?? 50,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Aplicar')),
          ],
        );
      }),
    );
    if (ok != true) return;
    q.field = field;
    q.value = valueC.text.trim().isEmpty ? null : valueC.text.trim();
    q.tags = tagsC.text.split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).toList();
    q.sortBy = sortBy;
    q.order = order;
    q.limit = limit;
    await _service.update(q);
    await _run(q);
    await _load();
  }

  String _fieldLabel(DbField f) {
    switch (f) {
      case DbField.title: return 'Titulo';
      case DbField.tag: return 'Tag';
      case DbField.folder: return 'Carpeta';
      case DbField.modified: return 'Modificado';
      case DbField.created: return 'Creado';
      case DbField.type: return 'Tipo';
      case DbField.source: return 'Path';
      case DbField.size: return 'Tamaño';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Bases de datos'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: _newDatabase,
            tooltip: 'Nueva database',
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () async {
              if (_selected != null) await _run(_selected!);
            },
          ),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : Row(
            children: [
              // Sidebar: lista de queries
              Container(
                width: 240,
                decoration: BoxDecoration(
                  border: Border(right: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
                ),
                child: ListView(
                  children: _queries.map((q) {
                    final selected = _selected?.id == q.id;
                    return ListTile(
                      dense: true,
                      selected: selected,
                      leading: const Icon(Icons.table_chart_outlined, size: 18),
                      title: Text(q.name, maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('${q.lastResultCount} resultados',
                        style: const TextStyle(fontSize: 11)),
                      onTap: () => _run(q),
                      trailing: PopupMenuButton<String>(
                        onSelected: (a) {
                          if (a == 'edit') _editDatabase(q);
                          if (a == 'filters') _editFilters(q);
                          if (a == 'delete') _deleteDatabase(q);
                        },
                        itemBuilder: (_) => const [
                          PopupMenuItem(value: 'edit', child: Text('Renombrar')),
                          PopupMenuItem(value: 'filters', child: Text('Filtros')),
                          PopupMenuItem(value: 'delete', child: Text('Eliminar')),
                        ],
                      ),
                    );
                  }).toList(),
                ),
              ),
              // Main: tabla de resultados
              Expanded(child: _buildResultsTable()),
            ],
          ),
    );
  }

  Widget _buildResultsTable() {
    if (_results.isEmpty) {
      return Center(
        child: Text('Sin resultados. Ajusta los filtros.',
          style: Theme.of(context).textTheme.bodyMedium),
      );
    }
    return SingleChildScrollView(
      child: DataTable(
        columns: const [
          DataColumn(label: Text('Titulo')),
          DataColumn(label: Text('Tipo')),
          DataColumn(label: Text('Tags')),
          DataColumn(label: Text('Modificado')),
        ],
        rows: _results.map((r) {
          return DataRow(cells: [
            DataCell(Text(
              r.title ?? r.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            )),
            DataCell(Text(r.type ?? 'note', style: const TextStyle(fontSize: 12))),
            DataCell(Text(r.tags.take(3).join(', '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11))),
            DataCell(Text(_fmtDate(r.modified), style: const TextStyle(fontSize: 11))),
          ], onSelectChanged: (_) {
            Navigator.push(context, MaterialPageRoute(
              builder: (_) => NoteView(notePath: r.notePath, vaultPath: widget.vaultPath),
            ));
          });
        }).toList(),
      ),
    );
  }

  String _fmtDate(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
