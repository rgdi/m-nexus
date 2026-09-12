// database_screen.dart — pantalla principal de una Database con multi-view.
//
// v0.62.14: implementación estilo AFFiNE Database block. Header con título
// editable + 4 tabs (table, kanban, calendar, gallery) + botón "+ Row".
// Cada vista renderiza las rows según el property type.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/design_tokens.dart';
import '../../services/database_service.dart';
import '../../services/vault_detector.dart';
import '../../services/logger.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/glass_widgets.dart';

class DatabaseScreen extends StatefulWidget {
  final String databaseId;
  final String vaultPath;
  const DatabaseScreen({super.key, required this.databaseId, required this.vaultPath});

  @override
  State<DatabaseScreen> createState() => _DatabaseScreenState();
}

class _DatabaseScreenState extends State<DatabaseScreen> {
  DatabaseDoc? _doc;
  String _view = 'table';
  bool _loading = true;
  late DatabaseService _svc;

  @override
  void initState() {
    super.initState();
    _svc = DatabaseService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final d = await _svc.getById(widget.databaseId);
    if (!mounted) return;
    setState(() {
      _doc = d;
      _view = d?.defaultView ?? 'table';
      _loading = false;
    });
  }

  Future<void> _save() async {
    if (_doc == null) return;
    await _svc.save(_doc!);
  }

  Future<void> _addRow() async {
    if (_doc == null) return;
    final newRow = _svc.addRow(_doc!, {
      _doc!.primaryProperty: 'Nueva fila',
    });
    setState(() {});
    await _save();
    _openRowEditor(newRow);
  }

  void _openRowEditor(Map<String, dynamic> row) async {
    if (_doc == null) return;
    final updated = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _RowEditorSheet(
        doc: _doc!,
        row: Map<String, dynamic>.from(row),
      ),
    );
    if (updated != null) {
      // Merge by 'id' so existing keys are replaced.
      final idx = _doc!.rows.indexWhere((r) => r['id'] == row['id']);
      if (idx >= 0) {
        _doc!.rows[idx] = {..._doc!.rows[idx], ...updated};
        setState(() {});
        await _save();
      }
    }
  }

  Future<void> _deleteRow(Map<String, dynamic> row) async {
    if (_doc == null) return;
    _svc.removeRow(_doc!, row['id'] as String);
    setState(() {});
    await _save();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando base de datos…');
    if (_doc == null) return const EmptyState(icon: Icons.error_outline, title: 'Base no encontrada');
    final doc = _doc!;
    return Scaffold(
      body: SafeArea(
        top: true,
        bottom: false,
        child: Column(
          children: [
            _buildHeader(context, doc),
            _buildViewTabs(context, doc),
            const Divider(height: 1),
            Expanded(child: _buildBody(doc)),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _addRow,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Fila'),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, DatabaseDoc doc) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, MxSpacing.sm),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back_rounded),
            onPressed: () => Navigator.pop(context),
          ),
          const SizedBox(width: MxSpacing.sm),
          Expanded(
            child: GestureDetector(
              onTap: () => _editTitle(doc),
              child: Text(
                doc.title,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700, letterSpacing: -0.4,
                ),
                maxLines: 1, overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.view_column_outlined),
            onPressed: () => _addProperty(doc),
            tooltip: 'Añadir propiedad',
          ),
          IconButton(
            icon: const Icon(Icons.more_horiz_rounded),
            onPressed: () => _showMenu(doc),
          ),
        ],
      ),
    );
  }

  Widget _buildViewTabs(BuildContext context, DatabaseDoc doc) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: MxSpacing.lg),
      child: Container(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest.withOpacity(0.5),
          borderRadius: BorderRadius.circular(MxRadius.md),
          border: Border.all(color: scheme.outlineVariant.withOpacity(0.3)),
        ),
        padding: const EdgeInsets.all(3),
        child: TabBar(
          onTap: (i) {
            setState(() {
              _view = ['table', 'kanban', 'calendar', 'gallery'][i];
            });
            final newDoc = doc.mutate(defaultView: _view);
            setState(() { _doc = newDoc; });
            _save();
          },
          indicator: BoxDecoration(
            color: scheme.surface,
            borderRadius: BorderRadius.circular(MxRadius.sm),
            boxShadow: MxShadows.sm,
          ),
          indicatorSize: TabBarIndicatorSize.tab,
          dividerColor: Colors.transparent,
          labelColor: MxColors.indigoDeep,
          unselectedLabelColor: scheme.onSurfaceVariant,
          labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
          unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w500, fontSize: 12),
          tabs: [
            const Tab(icon: Icon(Icons.table_chart_outlined, size: 16), text: 'Tabla'),
            const Tab(icon: Icon(Icons.view_kanban_outlined, size: 16), text: 'Kanban'),
            const Tab(icon: Icon(Icons.calendar_today_outlined, size: 16), text: 'Calendar'),
            const Tab(icon: Icon(Icons.grid_view_outlined, size: 16), text: 'Galería'),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(DatabaseDoc doc) {
    if (doc.rows.isEmpty) {
      return EmptyState(
        icon: Icons.table_chart_outlined,
        title: 'Sin filas',
        subtitle: 'Tocá + para añadir la primera fila.',
      );
    }
    switch (_view) {
      case 'kanban': return _KanbanView(doc: doc, onTap: _openRowEditor, onDelete: _deleteRow);
      case 'calendar': return _CalendarView(doc: doc, onTap: _openRowEditor);
      case 'gallery': return _GalleryView(doc: doc, onTap: _openRowEditor, onDelete: _deleteRow);
      case 'table':
      default: return _TableView(doc: doc, onTap: _openRowEditor, onDelete: _deleteRow);
    }
  }

  void _editTitle(DatabaseDoc doc) async {
    final ctrl = TextEditingController(text: doc.title);
    final r = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Título de la base'),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    if (r != null && r.isNotEmpty) {
      final newDoc = doc.mutate(title: r);
      setState(() { _doc = newDoc; });
      await _save();
    }
  }

  void _addProperty(DatabaseDoc doc) async {
    final ctrl = TextEditingController();
    final r = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nueva propiedad'),
        content: StatefulBuilder(
          builder: (ctx, setSt) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: ctrl, autofocus: true,
                decoration: const InputDecoration(labelText: 'Nombre')),
              const SizedBox(height: 16),
              DropdownButtonFormField<DbPropertyType>(
                value: DbPropertyType.text,
                items: DbPropertyType.values.map((t) =>
                  DropdownMenuItem(value: t, child: Text(t.jsonKey))
                ).toList(),
                onChanged: (v) => setSt(() {}),
                decoration: const InputDecoration(labelText: 'Tipo'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('Añadir'),
          ),
        ],
      ),
    );
    if (r != null && r.isNotEmpty) {
      doc.properties.add(DbProperty(name: r, type: DbPropertyType.text));
      setState(() {});
      await _save();
    }
  }

  void _showMenu(DatabaseDoc doc) async {
    await showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Colors.red),
              title: const Text('Eliminar base', style: TextStyle(color: Colors.red)),
              onTap: () async {
                Navigator.pop(ctx);
                await _svc.delete(doc.id);
                if (mounted) Navigator.pop(context);
              },
            ),
          ],
        ),
      ),
    );
  }
}

// ── VIEWS ───────────────────────────────────────────────────────────────

class _TableView extends StatelessWidget {
  final DatabaseDoc doc;
  final void Function(Map<String, dynamic>) onTap;
  final void Function(Map<String, dynamic>) onDelete;
  const _TableView({required this.doc, required this.onTap, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        columnSpacing: MxSpacing.lg,
        headingTextStyle: theme.textTheme.labelLarge?.copyWith(
          fontWeight: FontWeight.w700, color: scheme.onSurface,
        ),
        dataRowMinHeight: 44,
        dataRowMaxHeight: 56,
        columns: [
          DataColumn(label: Text(doc.primaryProperty)),
          ...doc.properties.where((p) => p.name != doc.primaryProperty).map(
            (p) => DataColumn(label: Text(p.name)),
          ),
          const DataColumn(label: Text('')),
        ],
        rows: doc.rows.map((row) {
          return DataRow(
            onSelectChanged: (_) => onTap(row),
            cells: [
              DataCell(Text(
                row[doc.primaryProperty]?.toString() ?? '',
                style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
              )),
              ...doc.properties.where((p) => p.name != doc.primaryProperty).map(
                (p) => DataCell(_PropertyValueCell(prop: p, value: row[p.name])),
              ),
              DataCell(IconButton(
                icon: const Icon(Icons.delete_outline_rounded, size: 18),
                onPressed: () => onDelete(row),
              )),
            ],
          );
        }).toList(),
      ),
    );
  }
}

class _KanbanView extends StatelessWidget {
  final DatabaseDoc doc;
  final void Function(Map<String, dynamic>) onTap;
  final void Function(Map<String, dynamic>) onDelete;
  const _KanbanView({required this.doc, required this.onTap, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Encuentra la primera property select para agrupar.
    final groupProp = doc.properties.firstWhere(
      (p) => p.type == DbPropertyType.select,
      orElse: () => doc.properties.first,
    );
    final groups = <String, List<Map<String, dynamic>>>{};
    // Columnas predefinidas.
    for (final opt in groupProp.options) {
      groups[opt] = [];
    }
    groups['Sin valor'] = [];
    for (final row in doc.rows) {
      final key = row[groupProp.name]?.toString() ?? 'Sin valor';
      groups.putIfAbsent(key, () => []).add(row);
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.all(MxSpacing.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: groups.entries.map((entry) {
          return Container(
            width: 280,
            margin: const EdgeInsets.only(right: MxSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: MxSpacing.sm, vertical: MxSpacing.xs),
                  child: Row(
                    children: [
                      Text(entry.key, style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      )),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: scheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(MxRadius.pill),
                        ),
                        child: Text('${entry.value.length}', style: Theme.of(context).textTheme.labelSmall),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: MxSpacing.xs),
                ...entry.value.map((row) => Padding(
                  padding: const EdgeInsets.only(bottom: MxSpacing.xs),
                  child: InkWell(
                    onTap: () => onTap(row),
                    borderRadius: BorderRadius.circular(MxRadius.md),
                    child: Container(
                      padding: const EdgeInsets.all(MxSpacing.md),
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainerLow,
                        borderRadius: BorderRadius.circular(MxRadius.md),
                        border: Border.all(color: scheme.outlineVariant.withOpacity(0.2)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            row[doc.primaryProperty]?.toString() ?? '',
                            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                            maxLines: 2, overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 4),
                          ...doc.properties.where((p) =>
                            p.name != doc.primaryProperty && p.name != groupProp.name
                          ).take(2).map((p) => Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: _PropertyValueCell(prop: p, value: row[p.name]),
                          )),
                        ],
                      ),
                    ),
                  ),
                )),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _CalendarView extends StatelessWidget {
  final DatabaseDoc doc;
  final void Function(Map<String, dynamic>) onTap;
  const _CalendarView({required this.doc, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final theme = Theme.of(context);
    final dateProp = doc.properties.firstWhere(
      (p) => p.type == DbPropertyType.date,
      orElse: () => doc.properties.first,
    );
    final byMonth = <String, List<Map<String, dynamic>>>{};
    for (final row in doc.rows) {
      final raw = row[dateProp.name]?.toString();
      DateTime? d;
      if (raw != null && raw.isNotEmpty) {
        try { d = DateTime.parse(raw); } catch (_) {}
      }
      final key = d == null ? 'Sin fecha' : '${d.year}-${d.month.toString().padLeft(2, '0')}';
      byMonth.putIfAbsent(key, () => []).add(row);
    }
    final months = byMonth.keys.toList()..sort();
    return ListView(
      padding: const EdgeInsets.all(MxSpacing.lg),
      children: months.map((month) {
        final parts = month.split('-');
        final year = parts[0];
        final m = int.tryParse(parts[1]) ?? 1;
        const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(vertical: MxSpacing.sm),
              child: Text(
                '${monthNames[m-1]} $year',
                style: theme_textH3(scheme),
              ),
            ),
            ...byMonth[month]!.map((row) => Padding(
              padding: const EdgeInsets.only(bottom: MxSpacing.xs),
              child: InkWell(
                onTap: () => onTap(row),
                borderRadius: BorderRadius.circular(MxRadius.md),
                child: Container(
                  padding: const EdgeInsets.all(MxSpacing.md),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(MxRadius.md),
                    border: Border.all(color: scheme.outlineVariant.withOpacity(0.2)),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.event_rounded, size: 18, color: scheme.primary),
                      const SizedBox(width: MxSpacing.sm),
                      Expanded(child: Text(
                        row[doc.primaryProperty]?.toString() ?? '',
                        style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                      )),
                    ],
                  ),
                ),
              ),
            )),
          ],
        );
      }).toList(),
    );
  }

  TextStyle theme_textH3(ColorScheme s) =>
      TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: s.onSurface);
}

class _GalleryView extends StatelessWidget {
  final DatabaseDoc doc;
  final void Function(Map<String, dynamic>) onTap;
  final void Function(Map<String, dynamic>) onDelete;
  const _GalleryView({required this.doc, required this.onTap, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GridView.builder(
      padding: const EdgeInsets.all(MxSpacing.lg),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: MxSpacing.md,
        crossAxisSpacing: MxSpacing.md,
        childAspectRatio: 1.4,
      ),
      itemCount: doc.rows.length,
      itemBuilder: (ctx, i) {
        final row = doc.rows[i];
        return InkWell(
          onTap: () => onTap(row),
          onLongPress: () => onDelete(row),
          borderRadius: BorderRadius.circular(MxRadius.md),
          child: Container(
            padding: const EdgeInsets.all(MxSpacing.md),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  MxColors.indigoDeep.withOpacity(0.10),
                  MxColors.violet.withOpacity(0.05),
                ],
              ),
              borderRadius: BorderRadius.circular(MxRadius.md),
              border: Border.all(color: scheme.outlineVariant.withOpacity(0.2)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  row[doc.primaryProperty]?.toString() ?? '',
                  style: theme_textBody(scheme, weight: FontWeight.w700),
                  maxLines: 2, overflow: TextOverflow.ellipsis,
                ),
                const Spacer(),
                ...doc.properties.where((p) => p.name != doc.primaryProperty).take(2).map(
                  (p) => Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: _PropertyValueCell(prop: p, value: row[p.name]),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  TextStyle theme_textBody(ColorScheme s, {FontWeight weight = FontWeight.w500}) =>
      TextStyle(fontSize: 11, fontWeight: weight, color: s.onSurface);
}

// ── PROPERTY VALUE CELL ────────────────────────────────────────────────

class _PropertyValueCell extends StatelessWidget {
  final DbProperty prop;
  final dynamic value;
  const _PropertyValueCell({required this.prop, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    if (value == null || value.toString().isEmpty) {
      return Text('—', style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant));
    }
    switch (prop.type) {
      case DbPropertyType.checkbox:
        return Icon(value == true ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
            size: 18, color: value == true ? MxColors.indigoDeep : scheme.onSurfaceVariant);
      case DbPropertyType.select:
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: MxColors.indigoDeep.withOpacity(0.15),
            borderRadius: BorderRadius.circular(MxRadius.pill),
          ),
          child: Text(value.toString(), style: theme.textTheme.labelSmall?.copyWith(
            color: MxColors.indigoDeep, fontWeight: FontWeight.w600,
          )),
        );
      case DbPropertyType.multiSelect:
      case DbPropertyType.tags:
        final tags = (value as List).map((e) => e.toString()).toList();
        return Wrap(spacing: 4, runSpacing: 2, children: tags.map((t) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: MxColors.violet.withOpacity(0.15),
            borderRadius: BorderRadius.circular(MxRadius.pill),
          ),
          child: Text(t, style: theme.textTheme.labelSmall?.copyWith(
            color: MxColors.violet, fontWeight: FontWeight.w600,
          )),
        )).toList());
      case DbPropertyType.date:
        try {
          final d = DateTime.parse(value.toString());
          return Text(DateFormat('d MMM yyyy').format(d),
            style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500));
        } catch (_) {
          return Text(value.toString(), style: theme.textTheme.bodySmall);
        }
      case DbPropertyType.number:
        return Text(value.toString(),
          style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600));
      case DbPropertyType.url:
        return Text(value.toString(),
          style: theme.textTheme.bodySmall?.copyWith(
            color: scheme.primary,
            decoration: TextDecoration.underline,
          ));
      case DbPropertyType.email:
        return Text(value.toString(),
          style: theme.textTheme.bodySmall?.copyWith(
            color: scheme.primary,
            fontStyle: FontStyle.italic,
          ));
      default:
        return Text(value.toString(),
          style: theme.textTheme.bodySmall,
          maxLines: 2, overflow: TextOverflow.ellipsis);
    }
  }
}

// ── ROW EDITOR (bottom sheet) ──────────────────────────────────────────

class _RowEditorSheet extends StatefulWidget {
  final DatabaseDoc doc;
  final Map<String, dynamic> row;
  const _RowEditorSheet({required this.doc, required this.row});

  @override
  State<_RowEditorSheet> createState() => _RowEditorSheetState();
}

class _RowEditorSheetState extends State<_RowEditorSheet> {
  late Map<String, dynamic> _values;

  @override
  void initState() {
    super.initState();
    _values = Map<String, dynamic>.from(widget.row);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SafeArea(
        child: Container(
          decoration: BoxDecoration(
            color: scheme.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(MxRadius.xxl)),
          ),
          padding: const EdgeInsets.all(MxSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text('Editar fila', style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ))),
                  TextButton(
                    onPressed: () => Navigator.pop(context, _values),
                    child: const Text('Guardar'),
                  ),
                ],
              ),
              const SizedBox(height: MxSpacing.md),
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.of(context).size.height * 0.6,
                ),
                child: SingleChildScrollView(
                  child: Column(
                    children: widget.doc.properties.map((p) =>
                      _buildField(p),
                    ).toList(),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildField(DbProperty p) {
    final value = _values[p.name];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: MxSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(p.name, style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              )),
            ),
          ),
          const SizedBox(width: MxSpacing.sm),
          Expanded(child: _buildInput(p, value)),
        ],
      ),
    );
  }

  Widget _buildInput(DbProperty p, dynamic value) {
    switch (p.type) {
      case DbPropertyType.checkbox:
        return Switch(
          value: value == true,
          onChanged: (v) => setState(() => _values[p.name] = v),
        );
      case DbPropertyType.select:
        return DropdownButtonFormField<String>(
          value: p.options.contains(value) ? value : null,
          decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
          items: p.options.map((o) =>
            DropdownMenuItem(value: o, child: Text(o))
          ).toList(),
          onChanged: (v) => setState(() => _values[p.name] = v),
        );
      case DbPropertyType.multiSelect:
      case DbPropertyType.tags:
        final tags = (value is List)
          ? value.map((e) => e.toString()).toList()
          : <String>[];
        return Wrap(spacing: 4, children: [
          ...tags.map((t) => InputChip(
            label: Text(t),
            onDeleted: () => setState(() {
              tags.remove(t);
              _values[p.name] = tags;
            }),
          )),
          ActionChip(
            label: const Text('+'),
            onPressed: () async {
              final ctrl = TextEditingController();
              final r = await showDialog<String>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: Text('Nuevo ${p.name}'),
                  content: TextField(controller: ctrl, autofocus: true),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
                    FilledButton(
                      onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
                      child: const Text('Añadir'),
                    ),
                  ],
                ),
              );
              if (r != null && r.isNotEmpty && !tags.contains(r)) {
                setState(() {
                  tags.add(r);
                  _values[p.name] = tags;
                });
              }
            },
          ),
        ]);
      case DbPropertyType.date:
        final ctrl = TextEditingController(text: value?.toString() ?? '');
        return TextField(
          controller: ctrl,
          decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true,
            hintText: 'YYYY-MM-DD'),
          onChanged: (v) => _values[p.name] = v,
        );
      case DbPropertyType.number:
        return TextField(
          controller: TextEditingController(text: value?.toString() ?? ''),
          decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (v) => _values[p.name] = double.tryParse(v),
        );
      default:
        return TextField(
          controller: TextEditingController(text: value?.toString() ?? ''),
          decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
          onChanged: (v) => _values[p.name] = v,
        );
    }
  }
}
