// timeline_view.dart: timeline / Gantt para examenes y tareas.
//
// v0.60 (P1.6): scroll horizontal con eventos. Cada examen es una bar.
// Tap en bar = abrir detalle. Drag para reagendar (con confirm).

import 'package:flutter/material.dart';
import '../../services/exams_service.dart';
import '../../state/app_state.dart';
import '../../services/logger.dart';
import 'exams_screen.dart';

class TimelineView extends StatefulWidget {
  final String vaultPath;
  const TimelineView({super.key, required this.vaultPath});

  @override
  State<TimelineView> createState() => _TimelineViewState();
}

class _TimelineViewState extends State<TimelineView> {
  List<Exam> _exams = [];
  bool _loading = true;
  late DateTime _start;
  late DateTime _end;
  double _pixelsPerDay = 18.0;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _start = DateTime(now.year, now.month, now.day).subtract(const Duration(days: 14));
    _end = _start.add(const Duration(days: 90));
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final svc = ExamsService();
    final all = await svc.all(widget.vaultPath);
    if (!mounted) return;
    setState(() {
      _exams = all;
      _loading = false;
    });
  }

  double _xForDate(DateTime d) {
    final days = d.difference(_start).inDays;
    return days * _pixelsPerDay;
  }

  Future<void> _reagendar(Exam exam, DateTime newDate) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reagendar examen?'),
        content: Text('Mover "${exam.title}" de ${exam.date.day}/${exam.date.month} a '
          '${newDate.day}/${newDate.month}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Mover')),
        ],
      ),
    );
    if (ok != true) return;
    exam.date = newDate;
    final svc = ExamsService();
    final all = await svc.all(widget.vaultPath);
    final idx = all.indexWhere((e) => e.id == exam.id);
    if (idx >= 0) all[idx] = exam;
    await svc.save(widget.vaultPath, all);
    await _load();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Examen reagendado')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Timeline'),
        actions: [
          IconButton(
            icon: const Icon(Icons.zoom_in),
            onPressed: () => setState(() => _pixelsPerDay = (_pixelsPerDay * 1.25).clamp(4, 60)),
          ),
          IconButton(
            icon: const Icon(Icons.zoom_out),
            onPressed: () => setState(() => _pixelsPerDay = (_pixelsPerDay / 1.25).clamp(4, 60)),
          ),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              _buildHeader(),
              Expanded(child: _buildTimeline()),
              Container(
                padding: const EdgeInsets.all(8),
                color: Theme.of(context).colorScheme.surfaceContainerHigh,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('${_exams.length} examenes', style: const TextStyle(fontSize: 12)),
                    Text('${_end.difference(_start).inDays} dias · ${_pixelsPerDay.toStringAsFixed(1)}px/dia',
                      style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
            ],
          ),
    );
  }

  Widget _buildHeader() {
    final totalDays = _end.difference(_start).inDays;
    return Container(
      height: 32,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainer,
        border: Border(bottom: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        reverse: true,
        child: Row(
          children: List.generate(totalDays + 1, (i) {
            final d = _start.add(Duration(days: i));
            final isMonday = d.weekday == DateTime.monday;
            final isFirstOfMonth = d.day == 1;
            return Container(
              width: _pixelsPerDay,
              decoration: BoxDecoration(
                border: Border(
                  right: BorderSide(
                    color: isMonday ? Colors.orange : Colors.transparent,
                    width: 1,
                  ),
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (isMonday)
                    Text('${d.day}/${d.month}', style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold)),
                  if (isFirstOfMonth)
                    Text(d.year.toString(), style: const TextStyle(fontSize: 8, color: Colors.grey)),
                ],
              ),
            );
          }),
        ),
      ),
    );
  }

  Widget _buildTimeline() {
    final totalDays = _end.difference(_start).inDays;
    final width = totalDays * _pixelsPerDay;
    final today = DateTime.now();
    final todayX = _xForDate(today);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SizedBox(
        width: width + 100,
        height: double.infinity,
        child: Stack(
          children: [
            // Linea de "hoy"
            Positioned(
              left: todayX,
              top: 0, bottom: 0,
              child: Container(width: 2, color: Colors.red),
            ),
            // Eventos
            ..._exams.where((e) => e.date.isAfter(_start) && e.date.isBefore(_end.add(const Duration(days: 1)))).map((e) {
              final x = _xForDate(e.date);
              final daysLeft = e.date.difference(today).inDays;
              final color = daysLeft < 0
                ? Colors.grey
                : daysLeft < 7
                  ? Colors.red
                  : daysLeft < 30
                    ? Colors.orange
                    : Colors.blue;
              return Positioned(
                left: x,
                top: 16,
                child: Draggable<Exam>(
                  data: e,
                  feedback: Material(
                    color: Colors.transparent,
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: 0.9),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(e.title, style: const TextStyle(color: Colors.white, fontSize: 12)),
                    ),
                  ),
                  childWhenDragging: Opacity(opacity: 0.4, child: _buildExamBar(e, color)),
                  child: GestureDetector(
                    onTap: () => _showExamDetail(e),
                    child: _buildExamBar(e, color),
                  ),
                ),
              );
            }),
            // Drop target invisible en todo el area
            Positioned.fill(
              child: DragTarget<Exam>(
                onAcceptWithDetails: (details) {
                  final newDate = _start.add(Duration(days: (details.offset.dx / _pixelsPerDay).round()));
                  _reagendar(details.data, newDate);
                },
                builder: (ctx, candidates, rejected) => Container(color: Colors.transparent),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildExamBar(Exam e, Color color) {
    return Tooltip(
      message: '${e.title}\n${e.date.year}-${e.date.month.toString().padLeft(2, '0')}-${e.date.day.toString().padLeft(2, '0')}\n${e.topics.isNotEmpty ? 'Topics: ${e.topics.join(', ')}' : ''}',
      child: Container(
        width: _pixelsPerDay * 0.85,
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(4),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.1), blurRadius: 2, offset: const Offset(0, 1))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(e.title, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
            if (e.topics.isNotEmpty)
              Text('${e.topics.length} temas', style: const TextStyle(color: Colors.white70, fontSize: 9)),
          ],
        ),
      ),
    );
  }

  void _showExamDetail(Exam e) {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(e.title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text('Fecha: ${e.date.year}-${e.date.month.toString().padLeft(2, '0')}-${e.date.day.toString().padLeft(2, '0')}'),
            if (e.topics.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Topics: ${e.topics.join(', ')}'),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(
              icon: const Icon(Icons.edit),
              label: const Text('Editar examen'),
              onPressed: () {
                Navigator.pop(ctx);
                Navigator.push(context, MaterialPageRoute(
                  builder: (_) => ExamsScreen(vaultPath: widget.vaultPath),
                ));
              },
            ),
          ],
        ),
      ),
    );
  }
}
