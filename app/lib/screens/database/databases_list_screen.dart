// databases_list_screen.dart — listado de todas las databases del vault.
// v0.62.14: lista plana con card por database, búsqueda + FAB crear nueva.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/design_tokens.dart';
import '../../services/database_service.dart';
import '../../services/vault_detector.dart';
import '../../widgets/empty_state.dart';
import 'database_screen.dart';

class DatabasesListScreen extends StatefulWidget {
  final String vaultPath;
  const DatabasesListScreen({super.key, required this.vaultPath});

  @override
  State<DatabasesListScreen> createState() => _DatabasesListScreenState();
}

class _DatabasesListScreenState extends State<DatabasesListScreen> {
  late DatabaseService _svc;
  List<DatabaseDoc> _all = [];
  bool _loading = true;
  String _filter = '';

  @override
  void initState() {
    super.initState();
    _svc = DatabaseService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    _all = await _svc.listAll();
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  Future<void> _newDatabase() async {
    final ctrl = TextEditingController();
    final r = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nueva base de datos'),
        content: TextField(controller: ctrl, autofocus: true,
          decoration: const InputDecoration(hintText: 'Ej: Tareas, Películas, etc')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('Crear'),
          ),
        ],
      ),
    );
    if (r == null || r.isEmpty) return;
    final db = await _svc.create(title: r);
    if (!mounted) return;
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => DatabaseScreen(databaseId: db.id, vaultPath: widget.vaultPath),
    )).then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando bases…');
    final filtered = _filter.isEmpty
      ? _all
      : _all.where((d) => d.title.toLowerCase().contains(_filter.toLowerCase())).toList();
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Scaffold(
      body: SafeArea(
        top: true, bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, MxSpacing.sm),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back_rounded),
                    onPressed: () => Navigator.pop(context),
                  ),
                  const SizedBox(width: MxSpacing.sm),
                  Text('Bases de datos',
                    style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.4)),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(MxSpacing.lg, 0, MxSpacing.lg, MxSpacing.sm),
              child: TextField(
                decoration: InputDecoration(
                  hintText: 'Buscar…',
                  prefixIcon: const Icon(Icons.search_rounded, size: 18),
                  isDense: true,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(MxRadius.md)),
                ),
                onChanged: (v) => setState(() => _filter = v),
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: filtered.isEmpty
                ? EmptyState(
                    icon: Icons.table_chart_outlined,
                    title: _filter.isNotEmpty ? 'Sin resultados' : 'Sin bases',
                    subtitle: 'Tocá + para crear la primera.',
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, 96),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const SizedBox(height: MxSpacing.sm),
                    itemBuilder: (ctx, i) {
                      final d = filtered[i];
                      return InkWell(
                        onTap: () => Navigator.push(context, MaterialPageRoute(
                          builder: (_) => DatabaseScreen(
                            databaseId: d.id, vaultPath: widget.vaultPath,
                          ),
                        )).then((_) => _load()),
                        borderRadius: BorderRadius.circular(MxRadius.lg),
                        child: Container(
                          padding: const EdgeInsets.all(MxSpacing.md),
                          decoration: BoxDecoration(
                            color: scheme.surfaceContainerLow.withOpacity(0.4),
                            borderRadius: BorderRadius.circular(MxRadius.lg),
                            border: Border.all(color: scheme.outlineVariant.withOpacity(0.2)),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 40, height: 40,
                                decoration: BoxDecoration(
                                  gradient: const LinearGradient(
                                    colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)]),
                                  borderRadius: BorderRadius.circular(MxRadius.md),
                                ),
                                alignment: Alignment.center,
                                child: const Icon(Icons.table_chart_rounded, size: 20, color: Colors.white),
                              ),
                              const SizedBox(width: MxSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(d.title,
                                      style: theme.textTheme.titleSmall?.copyWith(
                                        fontWeight: FontWeight.w700,
                                      )),
                                    const SizedBox(height: 2),
                                    Text(
                                      '${d.rows.length} filas · ${d.properties.length} columnas',
                                      style: theme.textTheme.labelSmall?.copyWith(
                                        color: scheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _newDatabase,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Nueva base'),
      ),
    );
  }
}
