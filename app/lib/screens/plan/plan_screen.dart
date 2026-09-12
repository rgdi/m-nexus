// PlanScreen v0.62.11 — vista unificada de tareas, exámenes, pruebas.
//
// Diseño: header con hero + countdown al próximo examen + tabs de scope
// (Todo / Pendiente / Hoy) + lista timeline con:
//   - Exámenes (gradient rojo, countdown grande)
//   - Tareas urgentes (priority >= 2)
//   - Tareas normales
//   - Pruebas (mock tests)
//
// Tap en un examen abre detail; tap en tarea abre la nota origen.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/design_tokens.dart';
import '../../core/theme.dart';
import '../../services/exams_service.dart';
import '../../services/global_tasks_service.dart';
import '../../services/subjects_service.dart';
import '../../services/system_calendar_service.dart';
import '../../services/vault_detector.dart';
import '../../services/logger.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/glass_widgets.dart';
import '../note/note_view.dart';
import '../exams/timeline_view.dart';

class PlanScreen extends StatefulWidget {
  const PlanScreen({super.key});
  @override
  State<PlanScreen> createState() => _PlanScreenState();
}

class _PlanScreenState extends State<PlanScreen>
    with SingleTickerProviderStateMixin {
  final _examsSvc = ExamsService();
  final _subjectsSvc = SubjectsService();
  final _systemCal = SystemCalendarService();
  String? _vaultPath;

  List<Exam> _exams = [];
  List<Subject> _subjects = [];
  List<GlobalTask> _tasks = [];
  List<SystemCalendarEvent> _systemEvents = [];
  bool _calendarPermissionAsked = false;

  bool _loading = true;
  late TabController _tab;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging) setState(() {});
    });
    _load();
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final log = AdvancedLogger.instance;
    try {
      final detector = VaultDetector();
      final vaults = await detector.detectVaults();
      if (!mounted) return;
      if (vaults.isEmpty) {
        setState(() { _loading = false; });
        return;
      }
      _vaultPath = vaults.first.path;
      _exams = await _examsSvc.loadAll(_vaultPath!);
      _subjects = await _subjectsSvc.loadAll(_vaultPath!);
      final tasksSvc = GlobalTasksService(_vaultPath!);
      _tasks = await tasksSvc.all(includeDone: false);
      // v0.62.13: autosync con calendar del sistema. Si no tenemos permiso,
      // pedimos una sola vez al cargar.
      await _syncSystemCalendar();
      log.debug('plan', 'loaded', context: {
        'exams': _exams.length,
        'tasks': _tasks.length,
        'systemEvents': _systemEvents.length,
      });
    } catch (e, s) {
      log.error('plan', 'load failed', error: e, stack: s);
    }
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  /// v0.62.13: pide permiso al calendar del sistema Android y carga
  /// eventos. Si no hay permiso, queda vacío (sin spammear al usuario).
  Future<void> _syncSystemCalendar() async {
    final hasPerm = await _systemCal.hasPermission();
    if (!hasPerm) {
      if (!_calendarPermissionAsked) {
        _calendarPermissionAsked = true;
        await _systemCal.requestPermission();
        // Re-check después de pedir.
        final hasNow = await _systemCal.hasPermission();
        if (!hasNow) return;
      } else {
        return;
      }
    }
    _systemEvents = await _systemCal.listEvents(
      // v0.62.13: rango de 6 meses atrás + 1 año adelante. Eventos
      // académicos suelen estar en calendarios escolares que se planifican
      // con meses de anticipación.
      from: DateTime.now().subtract(const Duration(days: 180)),
      to: DateTime.now().add(const Duration(days: 365)),
    );
  }

  Subject? _subjectById(String id) {
    for (final s in _subjects) {
      if (s.id == id) return s;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando plan…');
    if (_vaultPath == null) {
      return const EmptyState(icon: Icons.folder_off, title: 'Sin vault');
    }
    final upcoming = _exams.where((e) => !e.isPast(DateTime.now())).toList()
      ..sort((a, b) => a.date.compareTo(b.date));
    final nextExam = upcoming.isEmpty ? null : upcoming.first;

    return Scaffold(
      // v0.62.11: SafeArea(top:true) como en flashcards_list, esta pantalla
      // tampoco usa AppBar propio.
      body: SafeArea(
        top: true,
        bottom: false,
        child: Column(
          children: [
            _buildHeader(context, nextExam),
            _buildTabs(context),
            const Divider(height: 1),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
      floatingActionButton: _buildFab(),
    );
  }

  // ── HEADER ───────────────────────────────────────────────────────────

  Widget _buildHeader(BuildContext context, Exam? nextExam) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final pendingTasks = _tasks.where((t) => !t.done).length;
    final upcomingExams = _exams.where((e) => !e.isPast(DateTime.now())).length;

    return Container(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, MxSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36, height: 36,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFFB923C), Color(0xFFEA580C)],
                  ),
                  borderRadius: BorderRadius.circular(MxRadius.sm),
                ),
                alignment: Alignment.center,
                child: const Icon(Icons.event_note_rounded, size: 20, color: Colors.white),
              ),
              const SizedBox(width: MxSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Plan',
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.4,
                      ),
                    ),
                  ],
                ),
              ),
              if (nextExam != null)
                _ExamCountdownChip(exam: nextExam, subject: _subjectById(nextExam.subjectId)),
            ],
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 46),
            child: Text(
              '$upcomingExams exámenes próximos · $pendingTasks tareas pendientes',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
                fontSize: 11,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabs(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
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
          controller: _tab,
          indicator: BoxDecoration(
            color: scheme.surface,
            borderRadius: BorderRadius.circular(MxRadius.sm),
            boxShadow: MxShadows.sm,
          ),
          indicatorSize: TabBarIndicatorSize.tab,
          dividerColor: Colors.transparent,
          labelColor: const Color(0xFFEA580C),
          unselectedLabelColor: scheme.onSurfaceVariant,
          labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
          unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w500, fontSize: 12),
          tabs: const [
            Tab(text: 'Todo'),
            Tab(text: 'Pendiente'),
            Tab(text: 'Hoy'),
          ],
        ),
      ),
    );
  }

  // ── BODY ─────────────────────────────────────────────────────────────

  Widget _buildBody() {
    final now = DateTime.now();
    final upcomingExams = _exams.where((e) => !e.isPast(now)).toList()
      ..sort((a, b) => a.date.compareTo(b.date));
    final pendingTasks = _tasks.where((t) => !t.done).toList()
      ..sort((a, b) => b.priority.compareTo(a.priority));
    final todayTasks = pendingTasks.where((t) {
      // Heurística: tareas sin fecha → hoy; con fecha → hoy.
      return true;
    }).toList();

    final items = <_TimelineItem>[];
    for (final e in upcomingExams) {
      items.add(_TimelineItem(
        kind: _TimelineKind.exam,
        exam: e,
        subject: _subjectById(e.subjectId),
        date: e.date,
      ));
    }
    // v0.62.13: eventos académicos del calendar del sistema se mezclan
    // con los exams manuales. Si ya existe un exam manual con el mismo
    // título+día, no duplicamos.
    final examKeys = upcomingExams
        .map((e) => '${e.title.toLowerCase().trim()}-${e.date.day}-${e.date.month}')
        .toSet();
    for (final ev in _systemEvents.where((e) => e.isAcademic)) {
      final key = '${ev.title.toLowerCase().trim()}-${ev.dtStart.day}-${ev.dtStart.month}';
      if (examKeys.contains(key)) continue;
      items.add(_TimelineItem(
        kind: _TimelineKind.calendarEvent,
        systemEvent: ev,
        date: ev.dtStart,
      ));
    }
    for (final t in pendingTasks) {
      items.add(_TimelineItem(
        kind: _TimelineKind.task,
        task: t,
        date: now,
      ));
    }
    // Ordenar: exámenes por fecha asc, luego tareas urgentes
    // v0.62.13: comparación de sort defensiva. Los items pueden ser exam,
    // task o calendarEvent — no todos tienen task, así que evitamos null
    // check. Los exam/calendarEvent van primero (por fecha), luego tasks
    // urgentes, luego tasks normales.
    items.sort((a, b) {
      if (a.kind == _TimelineKind.task && b.kind == _TimelineKind.task) {
        return b.task!.priority.compareTo(a.task!.priority);
      }
      if (a.kind == _TimelineKind.task) return 1;
      if (b.kind == _TimelineKind.task) return -1;
      return a.date.compareTo(b.date);
    });

    if (_tab.index == 1) {
      items.removeWhere((it) => it.kind == _TimelineKind.task && it.task!.done);
    }
    if (_tab.index == 2) {
      // Solo items "para hoy": exámenes en próximos 7 días + tareas urgentes
      items.removeWhere((it) {
        if (it.kind == _TimelineKind.exam) {
          final days = it.date.difference(now).inDays;
          return days > 7;
        }
        return it.task!.priority < 2;
      });
    }

    if (items.isEmpty) {
      return EmptyState(
        icon: Icons.celebration_rounded,
        title: _tab.index == 2 ? 'Nada para hoy' : 'Plan vacío',
        subtitle: _tab.index == 2
            ? 'No hay exámenes en los próximos 7 días ni tareas urgentes.'
            : 'Creá exámenes y tareas para verlos acá.',
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, 96),
      itemCount: items.length,
      separatorBuilder: (_, __) => const SizedBox(height: MxSpacing.sm),
      itemBuilder: (ctx, i) {
        final it = items[i];
        if (it.kind == _TimelineKind.exam) {
          return _ExamCard(
            exam: it.exam!,
            subject: it.subject,
            onTap: () => _openExamTimeline(it.exam!),
          );
        }
        if (it.kind == _TimelineKind.calendarEvent) {
          return _CalendarEventCard(
            event: it.systemEvent!,
            onTap: () => _openCalendarEvent(it.systemEvent!),
          );
        }
        return _TaskCard(
          task: it.task!,
          onTap: () => _openTaskSource(it.task!),
          onToggle: () async {
            await GlobalTasksService(_vaultPath!).toggleDone(it.task!);
            _load();
          },
        );
      },
    );
  }

  // ── ACTIONS ──────────────────────────────────────────────────────────

  void _openExamTimeline(Exam exam) {
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => TimelineView(vaultPath: _vaultPath!, focusExamId: exam.id),
    ));
  }

  /// v0.62.13: abre el evento del calendar del sistema en la app nativa
  /// de Calendar (no en M-NEXUS, porque los datos viven en el system
  /// Content Provider).
  void _openCalendarEvent(SystemCalendarEvent ev) async {
    try {
      const ch = MethodChannel('com.mnexus.app/calendar');
      await ch.invokeMethod('openEvent', {'eventId': ev.id});
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se pudo abrir el evento: $e')),
      );
    }
  }

  void _openTaskSource(GlobalTask task) {
    if (_vaultPath == null) return;
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => NoteView(notePath: task.notePath, vaultPath: _vaultPath!),
    ));
  }

  Widget _buildFab() {
    return FloatingActionButton.extended(
      onPressed: () async {
        if (_vaultPath == null) return;
        await Navigator.push(context, MaterialPageRoute(
          builder: (_) => TimelineView(vaultPath: _vaultPath!),
        ));
        _load();
      },
      icon: const Icon(Icons.add_rounded),
      label: const Text('Nuevo examen'),
      backgroundColor: const Color(0xFFEA580C),
      foregroundColor: Colors.white,
    );
  }
}

// ── MODELS ─────────────────────────────────────────────────────────────

enum _TimelineKind { exam, task, calendarEvent }

class _TimelineItem {
  final _TimelineKind kind;
  final Exam? exam;
  final Subject? subject;
  final GlobalTask? task;
  final SystemCalendarEvent? systemEvent;
  final DateTime date;
  _TimelineItem({
    required this.kind,
    this.exam,
    this.subject,
    this.task,
    this.systemEvent,
    required this.date,
  });
}

// ── WIDGETS ────────────────────────────────────────────────────────────

class _ExamCountdownChip extends StatelessWidget {
  final Exam exam;
  final Subject? subject;
  const _ExamCountdownChip({required this.exam, this.subject});
  @override
  Widget build(BuildContext context) {
    final days = exam.daysUntil(DateTime.now());
    final theme = Theme.of(context);
    final color = days <= 3
        ? const Color(0xFFEF4444)
        : days <= 14
            ? const Color(0xFFF59E0B)
            : const Color(0xFF06B6D4);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: MxSpacing.md, vertical: MxSpacing.sm),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(MxRadius.md),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.bolt_rounded, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            days == 0 ? '¡HOY!' : '$days días',
            style: theme.textTheme.labelLarge?.copyWith(
              color: color,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ExamCard extends StatelessWidget {
  final Exam exam;
  final Subject? subject;
  final VoidCallback onTap;
  const _ExamCard({required this.exam, required this.subject, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final days = exam.daysUntil(DateTime.now());
    final color = days <= 3
        ? const Color(0xFFEF4444)
        : days <= 14
            ? const Color(0xFFF59E0B)
            : const Color(0xFF6366F1);
    final colorInt = subject?.color ?? 0xFF6366F1;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(MxRadius.lg),
      child: Container(
        padding: const EdgeInsets.all(MxSpacing.md),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow.withOpacity(0.4),
          borderRadius: BorderRadius.circular(MxRadius.lg),
          border: Border.all(color: color.withOpacity(0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Day badge
            Container(
              width: 60, height: 64,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    color.withOpacity(0.20),
                    color.withOpacity(0.08),
                  ],
                ),
                borderRadius: BorderRadius.circular(MxRadius.md),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    days == 0 ? 'HOY' : '$days',
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: days == 0 ? 18 : 24,
                      color: color,
                      height: 1.0,
                    ),
                  ),
                  Text(
                    days == 0 ? '' : 'días',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: color,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: MxSpacing.md),
            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (subject != null) ...[
                        Container(
                          width: 6, height: 6,
                          decoration: BoxDecoration(
                            color: Color(colorInt),
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          subject!.name,
                          style: theme.textTheme.labelMedium?.copyWith(
                            color: Color(colorInt),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(width: MxSpacing.sm),
                        Container(
                          width: 3, height: 3,
                          decoration: BoxDecoration(
                            color: scheme.onSurfaceVariant.withOpacity(0.4),
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: MxSpacing.sm),
                      ],
                      Icon(
                        Icons.event_rounded,
                        size: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _fmtDate(exam.date),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    exam.title,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (exam.topics.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 4,
                      runSpacing: 4,
                      children: exam.topics.take(3).map((t) => Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: scheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(MxRadius.pill),
                        ),
                        child: Text(
                          t,
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                            fontSize: 10,
                          ),
                        ),
                      )).toList(),
                    ),
                  ],
                ],
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: scheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }

  String _fmtDate(DateTime d) {
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return '${d.day} ${months[d.month - 1]} ${d.year}';
  }
}

class _TaskCard extends StatelessWidget {
  final GlobalTask task;
  final VoidCallback onTap;
  final VoidCallback onToggle;
  const _TaskCard({required this.task, required this.onTap, required this.onToggle});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final priorityColor = task.priority >= 2
        ? const Color(0xFFEF4444)
        : task.priority == 1
            ? const Color(0xFFF59E0B)
            : const Color(0xFF94A3B8);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(MxRadius.md),
      child: Container(
        padding: const EdgeInsets.all(MxSpacing.md),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow.withOpacity(0.3),
          borderRadius: BorderRadius.circular(MxRadius.md),
          border: Border.all(
            color: priorityColor.withOpacity(task.priority >= 2 ? 0.4 : 0.2),
          ),
        ),
        child: Row(
          children: [
            // Checkbox
            InkWell(
              onTap: onToggle,
              borderRadius: BorderRadius.circular(20),
              child: Container(
                width: 22, height: 22,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: priorityColor,
                    width: 2,
                  ),
                ),
                child: task.done
                    ? Icon(Icons.check_rounded, size: 16, color: priorityColor)
                    : null,
              ),
            ),
            const SizedBox(width: MxSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    task.text,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      decoration: task.done ? TextDecoration.lineThrough : null,
                      color: task.done ? scheme.onSurfaceVariant : null,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (task.tags.isNotEmpty || task.notePath.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        if (task.notePath.isNotEmpty) ...[
                          Icon(
                            Icons.description_outlined,
                            size: 11,
                            color: scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 3),
                          Flexible(
                            child: Text(
                              task.notePath.split('/').last,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: scheme.onSurfaceVariant,
                                fontSize: 10,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        if (task.tags.isNotEmpty) ...[
                          const SizedBox(width: MxSpacing.sm),
                          Icon(
                            Icons.tag_rounded,
                            size: 11,
                            color: scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 3),
                          Flexible(
                            child: Text(
                              task.tags.take(2).join(' '),
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: scheme.onSurfaceVariant,
                                fontSize: 10,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ],
              ),
            ),
            // Priority indicator
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: priorityColor.withOpacity(0.15),
                borderRadius: BorderRadius.circular(MxRadius.pill),
              ),
              child: Text(
                task.priority >= 2 ? '!' : task.priority == 1 ? '·' : '·',
                style: TextStyle(
                  color: priorityColor,
                  fontWeight: FontWeight.w800,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// v0.62.13: card para eventos académicos del calendar del sistema.
/// Se distingue de `_ExamCard` por el ícono (calendar vs school) y porque
/// NO tiene día countdown grande — muestra la fecha real del evento.
class _CalendarEventCard extends StatelessWidget {
  final SystemCalendarEvent event;
  final VoidCallback onTap;
  const _CalendarEventCard({required this.event, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final d = event.dtStart;
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(MxRadius.lg),
      child: Container(
        padding: const EdgeInsets.all(MxSpacing.md),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow.withOpacity(0.4),
          borderRadius: BorderRadius.circular(MxRadius.lg),
          border: Border.all(
            color: const Color(0xFF06B6D4).withOpacity(0.35),  // cyan = calendar system
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Date badge: día + mes (no countdown, es evento real)
            Container(
              width: 60, height: 64,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    const Color(0xFF06B6D4).withOpacity(0.20),
                    const Color(0xFF06B6D4).withOpacity(0.08),
                  ],
                ),
                borderRadius: BorderRadius.circular(MxRadius.md),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    '${d.day}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 24,
                      color: Color(0xFF06B6D4),
                      height: 1.0,
                    ),
                  ),
                  Text(
                    months[d.month - 1],
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF06B6D4),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: MxSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.calendar_today_rounded,
                        size: 11,
                        color: Color(0xFF06B6D4),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Del calendario · ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: const Color(0xFF06B6D4),
                          fontWeight: FontWeight.w700,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    event.title,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (event.location.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(
                          Icons.location_on_outlined,
                          size: 11,
                          color: scheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 3),
                        Flexible(
                          child: Text(
                            event.location,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                              fontSize: 10,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            Icon(
              Icons.open_in_new_rounded,
              size: 16,
              color: scheme.onSurfaceVariant.withOpacity(0.5),
            ),
          ],
        ),
      ),
    );
  }
}
