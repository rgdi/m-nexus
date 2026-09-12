// home_screen.dart: dashboard principal de M-NEXUS (Fase 0 + 6.A).
//
// v0.47.0: dashboard con datos REALES (no 0s falsos), estilo cristal limpio,
// cards redondeadas, separación clara de secciones.
//   - Hero con saludo y CTA principal
//   - Stats grid: racha, repasar hoy, tiempo invertido, precisión
//   - Heatmap últimos 90 días
//   - Acciones rápidas: Nueva nota, Repasar hoy, Nueva flashcard
//   - Notas recientes (top 5)

import 'dart:io';
import 'package:flutter/material.dart';
import '../../l10n/app_localizations.dart';
import 'package:intl/intl.dart';
import '../../core/design_tokens.dart';
import '../../services/flashcard_service.dart';
import '../../services/fsrs_engine.dart';
import '../../services/heatmap_service.dart';
import '../../services/vault_service.dart';
import '../../services/study_stats_service.dart';
import '../../services/exams_service.dart';
import '../../services/subjects_service.dart';
import '../../state/app_state.dart';
import '../../widgets/glass_widgets.dart';
import '../../widgets/sync_status_indicator.dart';
import '../flashcards/flashcard_review.dart';
import '../flashcards/flashcard_edit.dart';
import '../note/note_editor.dart';
import '../note/note_view.dart';
import '../recording/recording_screen.dart';
import '../attachments/attachments_screen.dart';
import '../whiteboard/whiteboards_list_screen.dart';
import '../../services/permissions.dart';
import '../../widgets/review_heatmap.dart';
import '../../services/daily_note_service.dart';
import '../../widgets/command_palette_dialog.dart';

class HomeScreen extends StatefulWidget {
  final VaultService? vault;
  final FlashcardService? flashcards;
  const HomeScreen({super.key, this.vault, this.flashcards});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _loading = true;
  int _streak = 0;
  int _dueCount = 0;
  int _newCount = 0;
  int _totalCards = 0;
  int _reviewsToday = 0;
  int _minutesToday = 0;
  double _retention = 0.90;
  List<_RecentNote> _recentNotes = [];
  Map<String, DailyStat> _dailyStats = {};
  // v0.49.5: subject-of-the-day, tasks, next exam
  List<Subject> _subjects = [];
  List<Exam> _exams = [];
  List<_TaskItem> _todayTasks = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // v0.47.0: leemos de AppState (cargado UNA vez al arranque)
    final app = AppState.instance;
    if (!app.hasVault) {
      setState(() {
        _loading = false;
        _recentNotes = [];
      });
      return;
    }
    final dailyStats = app.dailyStats;
    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    setState(() {
      _loading = false;
      _streak = app.currentStreak;
      _dueCount = app.dueCount;
      _newCount = app.newCount;
      _totalCards = app.totalCards;
      _reviewsToday = dailyStats[today]?.reviews ?? 0;
      _minutesToday = (dailyStats[today]?.studyTimeSec ?? 0) ~/ 60;
      _dailyStats = dailyStats;
    });
    // Carga notas recientes (separada porque es async)
    if (app.vaultService != null) {
      final notes = await app.vaultService!.listRecentNotes(5);
      if (mounted) {
        setState(() {
          _recentNotes = notes.map((n) => _RecentNote(
            name: n.name,
            path: n.path,
            title: n.title,
            modified: n.modified,
          )).toList();
        });
      }
    }
    // v0.49.5: cargar subjects, exams, tasks de la daily note
    await _loadTodayContext(app);
  }

  /// v0.49.5: subject-of-the-day + tareas pendientes + próximo examen
  Future<void> _loadTodayContext(AppState app) async {
    try {
      // 1) Subjects
      final subjects = await SubjectsService().load(app.activeVault!.path);
      // 2) Exams (futuros)
      final allExams = await ExamsService().load(app.activeVault!.path);
      final upcoming = allExams
        .where((e) => !e.isPast(DateTime.now()))
        .toList()
        ..sort((a, b) => a.date.compareTo(b.date));
      // 3) Tasks de la daily note
      final dailySvc = DailyNoteService(app.activeVault!.path);
      final dailyPath = await dailySvc.openOrCreate();
      final dailyContent = await File(dailyPath).readAsString();
      final tasks = _parseTasks(dailyContent);
      if (!mounted) return;
      setState(() {
        _subjects = subjects.where((s) => s.active).toList();
        _exams = upcoming;
        _todayTasks = tasks;
      });
    } catch (e) {
      // No fatal — home sigue funcionando sin subject context
    }
  }

  /// v0.49.5: extrae tareas (checkbox markdown) de un texto
  List<_TaskItem> _parseTasks(String md) {
    final out = <_TaskItem>[];
    for (final line in md.split('\n')) {
      final m = RegExp(r'^\s*-\s*\[(x| )\]\s*(.+)$', caseSensitive: false).firstMatch(line);
      if (m != null) {
        out.add(_TaskItem(
          text: m.group(2)!.trim(),
          done: m.group(1)!.toLowerCase() == 'x',
        ));
      }
    }
    return out;
  }

  /// v0.49.5: subject-of-the-day (rotacion determinista por dia)
  Subject? _subjectOfDay() {
    if (_subjects.isEmpty) return null;
    final dow = DateTime.now().weekday; // 1..7
    // Distribuir asignaturas entre L-V
    final active = _subjects.where((s) => s.active).toList();
    if (active.isEmpty) return null;
    final idx = (dow - 1) % active.length;
    return active[idx];
  }

  /// v0.49.5: formatea la fecha del dia en español sin depender
  /// de initializeDateFormatting (que no se llama en arranque).
  String _formatToday() {
    final now = DateTime.now();
    const days = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return '${days[now.weekday - 1]} ${now.day} de ${months[now.month - 1]}';
  }

  Future<void> _newNote() async {
    final app = AppState.instance;
    if (!app.hasVault) {
      _showSnack('Configura un vault primero');
      return;
    }
    final result = await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => NoteEditor(
        vaultPath: app.activeVault!.path,
        // notePath: null = crear nueva
      )),
    );
    if (result == true) await app.reload();
  }

  Future<void> _newFlashcard() async {
    final app = AppState.instance;
    if (app.flashcardService == null) {
      _showSnack('Servicio de flashcards no disponible');
      return;
    }
    final result = await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => FlashcardEdit(
        service: app.flashcardService!,
        onSaved: () => app.reload(),
      )),
    );
    if (result != null) await app.reload();
  }

  /// v0.48: abrir la nota diaria de hoy (crea si no existe).
  Future<void> _openDailyNote() async {
    final app = AppState.instance;
    if (!app.hasVault) {
      _showSnack('Configura un vault primero');
      return;
    }
    final svc = DailyNoteService(app.activeVault!.path);
    final path = await svc.openOrCreate();
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => NoteView(
        notePath: path,
        vaultPath: app.activeVault!.path,
      )),
    );
    if (mounted) await app.reload();
  }

  /// v0.49.12: abre el grabador de clases
  Future<void> _openRecorder() async {
    final app = AppState.instance;
    if (!app.hasVault) {
      _showSnack('Configura un vault primero');
      return;
    }
    await Navigator.push(context, MaterialPageRoute(
      builder: (_) => RecordingScreen(vaultPath: app.activeVault!.path),
    ));
    if (mounted) await app.reload();
  }

  /// v0.49.11: abre la galeria de adjuntos
  Future<void> _openAttachments() async {
    final app = AppState.instance;
    if (!app.hasVault) {
      _showSnack('Configura un vault primero');
      return;
    }
    await Navigator.push(context, MaterialPageRoute(
      builder: (_) => AttachmentsScreen(vaultPath: app.activeVault!.path),
    ));
  }

  /// v0.49.17: abre la lista de whiteboards
  Future<void> _openWhiteboards() async {
    final app = AppState.instance;
    if (!app.hasVault) {
      _showSnack('Configura un vault primero');
      return;
    }
    await Navigator.push(context, MaterialPageRoute(
      builder: (_) => WhiteboardsListScreen(vaultPath: app.activeVault!.path),
    ));
  }

  /// v0.48: command palette (Ctrl+K) — acciones rápidas.
  Future<void> _showCommandPalette() async {
    final app = AppState.instance;
    if (!app.hasVault) {
      _showSnack('Configura un vault primero');
      return;
    }
    final action = await showDialog<String>(
      context: context,
      builder: (_) => const CommandPaletteDialog(),
    );
    if (action == null || !mounted) return;
    switch (action) {
      case 'new_note':
        await _newNote();
        break;
      case 'open_daily':
        await _openDailyNote();
        break;
      case 'review_due':
        await _reviewDue();
        break;
      case 'new_flashcard':
        await _newFlashcard();
        break;
      case 'open_vault':
        // Cambiar a tab Vault (índice 1).
        // Lo hacemos a través del shell si está disponible.
        // Por simplicidad, navegamos manualmente.
        Navigator.of(context).pushNamed('/vault');
        break;
      case 'settings':
        Navigator.of(context).pushNamed('/settings');
        break;
    }
  }

  Future<void> _reviewDue() async {
    final app = AppState.instance;
    if (app.flashcardService == null) {
      _showSnack('Servicio de flashcards no disponible');
      return;
    }
    final cards = await app.flashcardService!.getDue();
    if (cards.isEmpty) {
      _showSnack('No hay tarjetas pendientes');
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => FlashcardReview(
        cards: cards,
        service: app.flashcardService!,
        onFinish: () => app.reload(),
      )),
    );
    await app.reload();
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg)),
    );
  }

  /// v0.49.5: card "Hoy" con subject del dia + tareas + proximo examen
  Widget _buildTodayCard(ThemeData theme, ColorScheme scheme) {
    final subject = _subjectOfDay();
    final nextExam = _exams.isNotEmpty ? _exams.first : null;
    final pendingTasks = _todayTasks.where((t) => !t.done).toList();
    final completedTasks = _todayTasks.where((t) => t.done).toList();
    final today = _formatToday();
    final capitalize = today.isEmpty
        ? today
        : today[0].toUpperCase() + today.substring(1);

    return GlassCard(
      borderRadius: MxRadius.xl,
      padding: const EdgeInsets.all(MxSpacing.lg),
      shadows: MxShadows.sm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.today_rounded, size: 18),
              const SizedBox(width: MxSpacing.sm),
              Text(
                'Hoy · $capitalize',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              // v0.62.10: SyncStatusIndicator movido aquí desde el FAB
              // flotante (tapaba la última stat card). Modo compacto para
              // integrarse con el header sin robar protagonismo.
              const Spacer(),
              const SyncStatusIndicator(compact: true),
            ],
          ),
          const SizedBox(height: MxSpacing.md),
          // Asignatura del dia
          if (subject != null)
            Row(
              children: [
                Container(
                  width: 8,
                  height: 36,
                  decoration: BoxDecoration(
                    color: Color(subject.color),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Asignatura del día',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                      Text(
                        subject.name,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            )
          else
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Text(
                'Configura asignaturas en Ajustes para ver tu subject-of-the-day',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ),
          if (nextExam != null) ...[
            const SizedBox(height: MxSpacing.md),
            Row(
              children: [
                Icon(Icons.event_rounded, size: 18, color: scheme.tertiary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Próximo examen: ${nextExam.title} en ${nextExam.daysUntil(DateTime.now())} día${nextExam.daysUntil(DateTime.now()) == 1 ? "" : "s"}',
                    style: theme.textTheme.bodyMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
          if (pendingTasks.isNotEmpty) ...[
            const SizedBox(height: MxSpacing.md),
            Text(
              'Tareas pendientes (${pendingTasks.length})',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            ...pendingTasks.take(3).map((t) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check_box_outline_blank, size: 14, color: Colors.grey),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      t.text,
                      style: theme.textTheme.bodySmall,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            )),
            if (pendingTasks.length > 3)
              Text(
                '+${pendingTasks.length - 3} más en tu daily note',
                style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
          ] else if (completedTasks.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Icon(Icons.check_circle, size: 16, color: scheme.primary),
                  const SizedBox(width: 6),
                  Text(
                    'Todas las tareas hechas 🎉',
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.primary),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final hour = DateTime.now().hour;
    final greeting = hour < 12
      ? 'Buenos días'
      : hour < 18
        ? 'Buenas tardes'
        : 'Buenas noches';

    final subtitle = _dueCount > 0
        ? '$_dueCount tarjeta${_dueCount == 1 ? "" : "s"} para repasar hoy'
        : _streak > 0
            ? 'Llevas $_streak día${_streak == 1 ? "" : "s"} de racha 🔥'
            : 'Empieza con una sesión corta de 5 minutos';

    return Scaffold(
      // v0.62.10: el SyncStatusIndicator antes iba como FAB flotante en
      // bottom-right (top:80dp) pero tapaba la última stat card del grid
      // y competía con el FloatingDock. Lo movemos al header de la sección
      // "Hoy" como un IconButton compacto: ahí tiene contexto (sincronizar
      // el daily note) y no estorba visualmente.
      body: RefreshIndicator(
        onRefresh: _load,
        color: scheme.primary,
        child: CustomScrollView(
          slivers: [
            // ── HERO BANNER ──
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                  MxSpacing.lg, MxSpacing.lg, MxSpacing.lg, MxSpacing.lg),
              sliver: SliverToBoxAdapter(
                child: HeroCard(
                  gradient: scheme.brightness == Brightness.dark
                      ? MxColors.heroGradientDark
                      : MxColors.heroGradientLight,
                  height: 200,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Row(
                                  children: [
                                    Icon(
                                      Icons.wb_sunny_outlined,
                                      color: Colors.white.withOpacity(0.7),
                                      size: 16,
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      greeting,
                                      style: theme.textTheme.bodyMedium?.copyWith(
                                        color: Colors.white.withOpacity(0.85),
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  '¿Qué quieres aprender hoy?',
                                  style: theme.textTheme.headlineMedium?.copyWith(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: -0.5,
                                    height: 1.15,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.18),
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: Colors.white.withOpacity(0.3),
                                width: 1.5,
                              ),
                            ),
                            child: const Center(
                              child: Text('🧠', style: TextStyle(fontSize: 20)),
                            ),
                          ),
                        ],
                      ),
                      Row(
                        children: [
                          Icon(Icons.auto_awesome, color: Colors.white.withOpacity(0.7), size: 14),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              subtitle,
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: Colors.white.withOpacity(0.92),
                                fontWeight: FontWeight.w500,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // ── HOY (subject + tasks + next exam) ──
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(MxSpacing.lg, 0, MxSpacing.lg, 0),
              sliver: SliverToBoxAdapter(
                child: _buildTodayCard(theme, scheme),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: MxSpacing.md)),

            // ── STATS GRID 2×2 ──
            // v0.62.10: aspectRatio 1.30 (era 1.45 → overflow 0.725px, luego
            // 1.20 → cards muy altos tipo ladrillo). FittedBox dentro del
            // StatCard hace de red de seguridad: si los valores son anchos
            // (ej. "999 tarjetas"), el número reduce tamaño en vez de
            // desbordar.
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: MxSpacing.lg),
              sliver: SliverGrid.count(
                crossAxisCount: 2,
                mainAxisSpacing: MxSpacing.md,
                crossAxisSpacing: MxSpacing.md,
                childAspectRatio: 1.30,
                children: [
                  StatCard(
                    icon: Icons.local_fire_department_rounded,
                    label: 'Racha',
                    value: '$_streak',
                    suffix: _streak == 1 ? 'día' : 'días',
                    gradient: MxColors.statStreak,
                  ),
                  StatCard(
                    icon: Icons.style_rounded,
                    label: 'Para repasar',
                    value: '$_dueCount',
                    suffix: 'tarjetas',
                    gradient: MxColors.statCards,
                    onTap: _dueCount > 0 ? _reviewDue : null,
                  ),
                  StatCard(
                    icon: Icons.timer_outlined,
                    label: 'Tiempo hoy',
                    value: '$_minutesToday',
                    suffix: 'min',
                    gradient: MxColors.statTime,
                  ),
                  StatCard(
                    icon: Icons.psychology_rounded,
                    label: 'Retención',
                    value: '${(_retention * 100).toInt()}',
                    suffix: '%',
                    gradient: MxColors.statRetention,
                  ),
                ],
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: MxSpacing.xl)),

            // ── HEATMAP ──
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: MxSpacing.lg),
              sliver: SliverToBoxAdapter(
                child: GlassCard(
                  borderRadius: MxRadius.xl,
                  padding: const EdgeInsets.all(MxSpacing.lg),
                  shadows: MxShadows.sm,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.calendar_view_month_rounded, size: 18),
                          const SizedBox(width: MxSpacing.sm),
                          Text(
                            'Actividad',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            'Últimos 90 días',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: MxSpacing.md),
                      SizedBox(
                        height: 7 * 14.0 + 8 + 24,
                        child: SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: ReviewHeatmap(
                            dailyStats: _dailyStats,
                            daysToShow: 90,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: MxSpacing.xl)),

            // ── ACCIONES ──
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: MxSpacing.lg),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(
                          left: MxSpacing.xs, bottom: MxSpacing.md),
                      child: SectionHeader(
                        title: 'Acciones rápidas',
                        subtitle: 'Empieza una sesión o crea contenido',
                      ),
                    ),
                    ActionCard(
                      icon: Icons.add_circle_outline_rounded,
                      title: 'Nueva nota',
                      subtitle: 'Markdown con cloze, imágenes y dibujo',
                      onTap: _newNote,
                    ),
                    const SizedBox(height: MxSpacing.sm),
                    ActionCard(
                      icon: Icons.style_rounded,
                      title: 'Repasar hoy',
                      subtitle: _dueCount == 0
                          ? 'No hay tarjetas pendientes'
                          : '$_dueCount tarjeta${_dueCount == 1 ? "" : "s"} listas',
                      trailing: _dueCount > 0 ? '$_dueCount' : null,
                      accent: _dueCount > 0,
                      onTap: _reviewDue,
                    ),
                    const SizedBox(height: MxSpacing.sm),
                    ActionCard(
                      icon: Icons.today_outlined,
                      title: 'Nota diaria',
                      subtitle: DateFormat('EEEE d MMMM', 'es_ES')
                          .format(DateTime.now()),
                      onTap: _openDailyNote,
                    ),
                    const SizedBox(height: MxSpacing.sm),
                    // v0.49.12: grabar clase con contexto automatico
                    ActionCard(
                      icon: Icons.mic_rounded,
                      title: 'Grabar clase',
                      subtitle: 'Audio + asignatura + examen',
                      accent: true,
                      onTap: _openRecorder,
                    ),
                    const SizedBox(height: MxSpacing.sm),
                    // v0.49.11: adjuntos del vault
                    ActionCard(
                      icon: Icons.attach_file_rounded,
                      title: 'Adjuntos',
                      subtitle: 'PDFs, presentaciones, imagenes',
                      onTap: _openAttachments,
                    ),
                    const SizedBox(height: MxSpacing.sm),
                    // v0.49.17: whiteboards / mind maps
                    ActionCard(
                      icon: Icons.account_tree_rounded,
                      title: 'Whiteboards',
                      subtitle: 'Mapas mentales y diagramas',
                      onTap: _openWhiteboards,
                    ),
                    const SizedBox(height: MxSpacing.sm),
                    ActionCard(
                      icon: Icons.add_box_outlined,
                      title: 'Nueva tarjeta',
                      subtitle: 'Añade una flashcard manualmente',
                      onTap: _newFlashcard,
                    ),
                    const SizedBox(height: MxSpacing.sm),
                    ActionCard(
                      icon: Icons.keyboard_command_key_rounded,
                      title: 'Command palette',
                      subtitle: 'Ctrl+K para acciones rápidas',
                      onTap: _showCommandPalette,
                    ),
                  ],
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: MxSpacing.xl)),

            // ── NOTAS RECIENTES ──
            if (_recentNotes.isNotEmpty) ...[
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                    MxSpacing.lg, 0, MxSpacing.lg, MxSpacing.xl),
                sliver: SliverToBoxAdapter(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(
                            left: MxSpacing.xs, bottom: MxSpacing.md),
                        child: SectionHeader(
                          title: 'Recientes',
                          subtitle: 'Notas que tocaste recientemente',
                        ),
                      ),
                      ..._recentNotes.map((n) => Padding(
                            padding: const EdgeInsets.only(
                                bottom: MxSpacing.sm),
                            child: _RecentNoteCard(note: n),
                          )),
                    ],
                  ),
                ),
              ),
            ],

            const SliverToBoxAdapter(child: SizedBox(height: 100)),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String suffix;
  final Color color;
  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.suffix,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // v0.47.34: gradient sutil + shadow para look cristal. Antes era color plano.
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            color.withOpacity(0.12),
            color.withOpacity(0.06),
          ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.25)),
        boxShadow: [
          BoxShadow(
            color: color.withOpacity(0.08),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 32, height: 32,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: color, size: 18),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(label, style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ), maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(value,
                  style: theme.textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: color,
                  )),
              const SizedBox(width: 4),
              Text(suffix,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  )),
            ],
          ),
        ],
      ),
    );
  }
}

class _DashboardCard extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget child;
  const _DashboardCard({required this.title, this.subtitle, required this.child});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // v0.47.34: gradient sutil + rounded 16px para look moderno cristal.
    // Antes era surface plano con border gris. Ahora tiene un gradient
    // diagonal surface→surfaceContainerLow que da profundidad sin
    // perder legibilidad.
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            theme.colorScheme.surface,
            theme.colorScheme.surfaceContainerLow,
          ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.4)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(title, style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w600,
              )),
              if (subtitle != null) ...[
                const Spacer(),
                Text(subtitle!, style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                )),
              ],
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool accent;
  const _ActionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.accent = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = accent ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant;
    return Material(
      color: theme.colorScheme.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.5)),
          ),
          child: Row(
            children: [
              Container(
                width: 40, height: 40,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    )),
                    Text(subtitle, style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    )),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

class _RecentNote {
  final String name;
  final String path;
  final String? title;
  final DateTime modified;
  const _RecentNote({required this.name, required this.path, required this.title, required this.modified});
}

// v0.49.5: task item parsed from checkbox markdown
class _TaskItem {
  final String text;
  final bool done;
  const _TaskItem({required this.text, required this.done});
}

class _RecentNoteCard extends StatelessWidget {
  final _RecentNote note;
  const _RecentNoteCard({required this.note});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        // v0.47.31: tap del recientes ahora navega a NoteView con la
        // nota específica, en lugar de abrir el VaultBrowser genérico.
        // Bug previo: onTap: () => Navigator.push(VaultBrowser()) — abría
        // la lista de archivos sin llevar al usuario a su nota.
        onTap: () {
          final app = AppState.instance;
          final vault = app.activeVault;
          if (vault == null) return;
          Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => NoteView(
              notePath: note.path,
              vaultPath: vault.path,
            ),
          ));
        },
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.3)),
          ),
          child: Row(
            children: [
              Icon(Icons.description_outlined,
                  color: theme.colorScheme.onSurfaceVariant, size: 18),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (note.title?.isNotEmpty ?? false) ? note.title! : note.name,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                      maxLines: 1, overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      _formatRelative(note.modified),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatRelative(DateTime d) {
    final now = DateTime.now();
    final diff = now.difference(d);
    if (diff.inMinutes < 1) return 'ahora';
    if (diff.inMinutes < 60) return 'hace ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'hace ${diff.inHours} h';
    if (diff.inDays < 7) return 'hace ${diff.inDays} d';
    return DateFormat('d MMM').format(d);
  }
}
