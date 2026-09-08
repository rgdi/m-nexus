// subjects_screen.dart: gestión de asignaturas del usuario.
//
// v0.47.36: pantalla para crear, renombrar, activar/desactivar y
// borrar asignaturas. El usuario configura aquí sus estudios.

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import '../../services/subjects_service.dart';

class SubjectsScreen extends StatefulWidget {
  final String vaultPath;
  const SubjectsScreen({super.key, required this.vaultPath});

  @override
  State<SubjectsScreen> createState() => _SubjectsScreenState();
}

class _SubjectsScreenState extends State<SubjectsScreen> {
  final _service = SubjectsService();
  List<Subject> _subjects = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final all = await _service.loadAll(widget.vaultPath);
    if (!mounted) return;
    setState(() {
      _subjects = all;
      _loading = false;
    });
  }

  Future<void> _createSubject() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nueva asignatura'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'ej: Anatomía cardiovascular',
            border: OutlineInputBorder(),
          ),
          textInputAction: TextInputAction.done,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Crear'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    await _service.create(vaultPath: widget.vaultPath, name: name);
    if (!mounted) return;
    _load();
  }

  Future<void> _toggleActive(Subject s) async {
    final updated = s.copyWith(active: !s.active);
    await _service.update(widget.vaultPath, updated);
    if (!mounted) return;
    _load();
  }

  Future<void> _delete(Subject s) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('¿Borrar "${s.name}"?'),
        content: const Text('Las notas y flashcards en esa carpeta NO se borran, pero la asignatura deja de aparecer en el dashboard.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Borrar'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    await _service.delete(widget.vaultPath, s.id);
    if (!mounted) return;
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Asignaturas'),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createSubject,
        icon: const Icon(Icons.add),
        label: const Text('Nueva'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _subjects.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.school_outlined,
                          size: 64, color: theme.colorScheme.outline),
                      const SizedBox(height: 16),
                      Text('Sin asignaturas todavía',
                          style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Text('Toca "+ Nueva" para crear la primera',
                          style: theme.textTheme.bodySmall),
                    ],
                  ),
                )
              : ListView.builder(
                  itemCount: _subjects.length,
                  itemBuilder: (ctx, i) {
                    final s = _subjects[i];
                    return Card(
                      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: Color(s.color).withOpacity(0.2),
                          child: Icon(Icons.school,
                              color: Color(s.color), size: 20),
                        ),
                        title: Text(s.name,
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              decoration: s.active
                                  ? null
                                  : TextDecoration.lineThrough,
                            )),
                        subtitle: Text(s.active
                            ? 'Activa · creada ${s.createdAt.toIso8601String().substring(0, 10)}'
                            : 'Inactiva'),
                        trailing: PopupMenuButton<String>(
                          onSelected: (a) {
                            if (a == 'toggle') _toggleActive(s);
                            if (a == 'delete') _delete(s);
                          },
                          itemBuilder: (_) => [
                            PopupMenuItem(
                              value: 'toggle',
                              child: Text(s.active ? 'Desactivar' : 'Activar'),
                            ),
                            const PopupMenuItem(
                              value: 'delete',
                              child: Text('Borrar'),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
