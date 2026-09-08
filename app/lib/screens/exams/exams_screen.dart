// exams_screen.dart: gestión de exámenes programados.
//
// v0.47.38: pantalla para crear exámenes con fecha + lista oficial
// de temas. Estos exámenes se usan para:
//   1. Mostrar "examen en X días" en el dashboard
//   2. Priorizar tarjetas en el repaso (FSRS boost)
//   3. Generar flashcards automáticamente desde notas que coincidan

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import '../../services/exams_service.dart';
import '../../services/subjects_service.dart';

class ExamsScreen extends StatefulWidget {
  final String vaultPath;
  const ExamsScreen({super.key, required this.vaultPath});

  @override
  State<ExamsScreen> createState() => _ExamsScreenState();
}

class _ExamsScreenState extends State<ExamsScreen> {
  final _exams = ExamsService();
  final _subjects = SubjectsService();
  List<Exam> _examsList = [];
  List<Subject> _subjectsList = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final e = await _exams.loadAll(widget.vaultPath);
    final s = await _subjects.loadAll(widget.vaultPath);
    if (!mounted) return;
    setState(() {
      _examsList = e;
      _subjectsList = s.where((x) => x.active).toList();
      _loading = false;
    });
  }

  Future<void> _createExam() async {
    if (_subjectsList.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Primero crea al menos una asignatura en Ajustes → Asignaturas'),
          duration: Duration(seconds: 4),
        ),
      );
      return;
    }

    final result = await showDialog<Exam>(
      context: context,
      builder: (ctx) => _ExamForm(subjects: _subjectsList),
    );
    if (result == null) return;
    await _exams.create(
      vaultPath: widget.vaultPath,
      subjectId: result.subjectId,
      title: result.title,
      date: result.date,
      topics: result.topics,
    );
    if (!mounted) return;
    _load();
  }

  Future<void> _delete(Exam exam) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('¿Borrar "${exam.title}"?'),
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
    await _exams.delete(widget.vaultPath, exam.id);
    if (!mounted) return;
    _load();
  }

  String _subjectName(String id) {
    final s = _subjectsList.firstWhere(
      (x) => x.id == id,
      orElse: () => Subject(
        id: id,
        name: id,
        color: 0xFF888888,
        createdAt: DateTime.now(),
      ),
    );
    return s.name;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final now = DateTime.now();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Exámenes'),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createExam,
        icon: const Icon(Icons.add),
        label: const Text('Programar'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _examsList.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.event_note_outlined,
                          size: 64, color: theme.colorScheme.outline),
                      const SizedBox(height: 16),
                      Text('Sin exámenes programados',
                          style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Text('Programa exámenes para priorizar el repaso',
                          style: theme.textTheme.bodySmall),
                    ],
                  ),
                )
              : ListView.builder(
                  itemCount: _examsList.length,
                  itemBuilder: (ctx, i) {
                    final exam = _examsList[i];
                    final daysUntil = exam.daysUntil(now);
                    final isPast = exam.isPast(now);
                    final isToday = exam.isToday(now);

                    final priorityColor = isPast
                        ? Colors.grey
                        : isToday
                            ? Colors.red
                            : daysUntil <= 3
                                ? Colors.deepOrange
                                : daysUntil <= 7
                                    ? Colors.orange
                                    : daysUntil <= 30
                                        ? Colors.amber
                                        : theme.colorScheme.primary;

                    return Card(
                      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: priorityColor.withOpacity(0.2),
                          child: Text(
                            isPast
                                ? '✓'
                                : isToday
                                    ? '!'
                                    : '${daysUntil}d',
                            style: TextStyle(
                              color: priorityColor,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                        ),
                        title: Text(exam.title,
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${_subjectName(exam.subjectId)} · ${exam.date.toIso8601String().substring(0, 10)}'),
                            if (exam.topics.isNotEmpty)
                              Text('${exam.topics.length} temas en temario',
                                  style: theme.textTheme.bodySmall),
                          ],
                        ),
                        trailing: PopupMenuButton<String>(
                          onSelected: (a) {
                            if (a == 'delete') _delete(exam);
                          },
                          itemBuilder: (_) => [
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

class _ExamForm extends StatefulWidget {
  final List<Subject> subjects;
  const _ExamForm({required this.subjects});

  @override
  State<_ExamForm> createState() => _ExamFormState();
}

class _ExamFormState extends State<_ExamForm> {
  final _titleController = TextEditingController();
  String? _selectedSubjectId;
  DateTime _date = DateTime.now().add(const Duration(days: 14));
  final _topicsController = TextEditingController();

  @override
  void dispose() {
    _titleController.dispose();
    _topicsController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
    );
    if (picked != null) setState(() => _date = picked);
  }

  void _submit() {
    if (_titleController.text.trim().isEmpty || _selectedSubjectId == null) {
      return;
    }
    final topics = _topicsController.text
        .split(RegExp(r'[\n,]'))
        .map((t) => t.trim())
        .where((t) => t.isNotEmpty)
        .toList();

    Navigator.pop(
      context,
      Exam(
        id: 'temp',
        subjectId: _selectedSubjectId!,
        title: _titleController.text.trim(),
        date: _date,
        topics: topics,
        createdAt: DateTime.now(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Programar examen'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Asignatura'),
            DropdownButton<String>(
              isExpanded: true,
              value: _selectedSubjectId,
              hint: const Text('Selecciona...'),
              items: widget.subjects
                  .map((s) => DropdownMenuItem(value: s.id, child: Text(s.name)))
                  .toList(),
              onChanged: (v) => setState(() => _selectedSubjectId = v),
            ),
            const SizedBox(height: 12),
            const Text('Título'),
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                hintText: 'ej: Parcial 1',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            const Text('Fecha'),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(_date.toIso8601String().substring(0, 10)),
              trailing: const Icon(Icons.calendar_month),
              onTap: _pickDate,
            ),
            const SizedBox(height: 12),
            const Text('Temario oficial (uno por línea)'),
            TextField(
              controller: _topicsController,
              maxLines: 6,
              minLines: 3,
              decoration: const InputDecoration(
                hintText: 'corazón\ncirculación pulmonar\n...',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _submit,
          child: const Text('Programar'),
        ),
      ],
    );
  }
}
