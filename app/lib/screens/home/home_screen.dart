// home_screen.dart: dashboard minimalista RemNote-style de M-NEXUS.
//
// v0.62.12: filosofía RemNote — minimalismo radical.
//   - Sin hero card gigante. Sin grid 2×2 de stat cards. Sin heatmap 90d.
//   - Una sola acción primaria (Repasar X) que ocupa el foco.
//   - 4 quick actions en command bar horizontal.
//   - Inbox row (tareas pendientes del daily note) en una línea.
//   - Notas recientes como lista plana.
//   - Stats/heatmap/actividad viven en su propio screen (Stats).
//
// Mantiene toda la lógica de carga (_load, _loadTodayContext, _parseTasks)
// y los handlers (_newNote, _reviewDue, _openDailyNote, _openRecorder, etc.).

import 'dart:io';
import 'package:flutter/material.dart';
import '../../l10n/app_localizations.dart';
import 'package:intl/intl.dart';
import 'package:path/path.dart' as p;
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
import '../flashcards/flashcard_review.dart';
import '../flashcards/flashcard_edit.dart';
import '../note/note_editor.dart';
import '../note/note_view.dart';
import '../database/databases_list_screen.dart';
import '../recording/recording_screen.dart';
import '../attachments/attachments_screen.dart';
import '../whiteboard/whiteboards_list_screen.dart';
import '../../services/permissions.dart';
import '../../services/daily_note_service.dart';
import '../../widgets/command_palette_dialog.dart';
import '../vault/vault_browser.dart';

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
  List<Subject> _subjects = [];
  List<Exam> _exams = [];
  List<_TaskItem> _todayTasks = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
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
    if (app.vaultService != null) {
      final notes = await app.vaultService!.listRecentNotes(5);
      if (mounted) {
        setState(() {
          _recentNotes = notes.map((n) => _RecentNote(
            name: n.name,
            path: n.path,
            title: n.title ?? '',
            modified: n.modified,
          )).toList();
        });
      }
    }
    await _loadTodayContext(app);
  }

  Future<void> _loadTodayContext(AppState app) async {
    try {
      final subjects = await SubjectsService().load(app.activeVault!.path);
      final allExams = await ExamsService().load(app.activeVault!.path);
      final upcoming = allExams
        .where((e) => !e.isPast(DateTime.now()))
        .toList()
        ..sort((a, b) => a.date.compareTo(b.date));
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
    } catch (_) {}
  }

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

  Subject? _subjectOfDay() {
    if (_subjects.isEmpty) return null;
    final dow = DateTime.now().weekday;
    final active = _subjects.where((s) => s.active).toList();
    if (active.isEmpty) return null;
    return active[(dow - 1) % active.length];
  }

  String _firstName() {
    final app = AppState.instance;
    final vp = app.activeVault?.path;
    if (vp == null || vp.isEmpty) return 'estudiante';
    return p.basename(vp);
  }

  // ── HANDLERS ─────────────────────────────────────────────────────────

  Future<void> _newNote() async {
    final app = AppState.instance;
    if (!app.hasVault) return;
    final result = await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => NoteEditor(vaultPath: app.activeVault!.path)),
    );
    if (result == true) await app.reload();
  }

  Future<void> _newFlashcard() async {
    final app = AppState.instance;
    if (app.flashcardService == null) return;
    final result = await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => FlashcardEdit(
        service: app.flashcardService!,
        onSaved: () => app.reload(),
      )),
    );
    if (result != null) await app.reload();
  }

  Future<void> _reviewDue() async {
    final app = AppState.instance;
    if (app.flashcardService == null || _dueCount == 0) return;
    final cards = await app.flashcardService!.dueCards();
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => FlashcardReview(
        cards: cards,
        service: app.flashcardService!,
        onFinish: _load,
      )),
    );
    await app.reload();
  }

  Future<void> _openDailyNote() async {
    final app = AppState.instance;
    if (!app.hasVault) return;
    final dailySvc = DailyNoteService(app.activeVault!.path);
    final path = await dailySvc.openOrCreate();
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => NoteView(
        notePath: path, vaultPath: app.activeVault!.path,
      )),
    );
    await app.reload();
  }

  Future<void> _openRecorder() async {
    final app = AppState.instance;
    if (!app.hasVault) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => RecordingScreen(vaultPath: app.activeVault!.path)),
    );
  }

  Future<void> _openAttachments() async {
    final app = AppState.instance;
    if (!app.hasVault) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => AttachmentsScreen(vaultPath: app.activeVault!.path)),
    );
  }

  Future<void> _openWhiteboards() async {
    final app = AppState.instance;
    if (!app.hasVault) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => WhiteboardsListScreen(vaultPath: app.activeVault!.path)),
    );
  }

  Future<void> _showCommandPalette() async {
    await showDialog(context: context, builder: (_) => const CommandPaletteDialog());
  }

  /// v0.62.14: bottom sheet "Crear" con todas las opciones AFFiNE-like
  /// (nota, tarjeta, base de datos).
  Future<void> _showCreateSheet() async {
    final app = AppState.instance;
    final vp = app.activeVault?.path;
    if (vp == null) return;
    await showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.note_add_outlined),
              title: const Text('Nueva nota'),
              subtitle: const Text('Markdown con cloze, imágenes, dibujo'),
              onTap: () { Navigator.pop(ctx); _newNote(); },
            ),
            ListTile(
              leading: const Icon(Icons.style_outlined),
              title: const Text('Nueva tarjeta'),
              subtitle: const Text('Cloze flashcard con FSRS'),
              onTap: () { Navigator.pop(ctx); _newFlashcard(); },
            ),
            ListTile(
              leading: const Icon(Icons.table_chart_outlined),
              title: const Text('Nueva base de datos'),
              subtitle: const Text('Tabla relacional con vistas (AFFiNE-style)'),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.push(context, MaterialPageRoute(
                  builder: (_) => DatabasesListScreen(vaultPath: vp),
                ));
              },
            ),
          ],
        ),
      ),
    );
  }

  void _openVault() {
    // El dock navega; este atajo simplemente fuerza el tab.
    DefaultTabController.maybeOf(context)?.animateTo(1);
  }

  void _openNote(_RecentNote n) {
    final app = AppState.instance;
    if (!app.hasVault) return;
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => NoteView(
        notePath: n.path, vaultPath: app.activeVault!.path,
      )),
    );
  }

  // ── BUILD ────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final hour = DateTime.now().hour;
    final greeting = hour < 12
      ? 'Buenos días'
      : hour < 18
        ? 'Buenas tardes'
        : 'Buenas noches';

    return Scaffold(
      // v0.62.12: RemNote minimal — sin hero card, sin stat cards,
      // sin heatmap. Stats viven en su propio screen.
      body: RefreshIndicator(
        onRefresh: _load,
        color: scheme.primary,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            // ── GREETING (one line) ──
            SliverPadding(
              padding: EdgeInsets.fromLTRB(
                  MxSpacing.xl,
                  MxSpacing.lg + MediaQuery.of(context).padding.top,
                  MxSpacing.xl,
                  MxSpacing.md),
              sliver: SliverToBoxAdapter(
                child: Row(
                  children: [
                    Text(
                      greeting,
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(width: MxSpacing.sm),
                    Text(
                      '·',
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: scheme.onSurfaceVariant.withOpacity(0.4),
                      ),
                    ),
                    const SizedBox(width: MxSpacing.sm),
                    Flexible(
                      child: Text(
                        _firstName(),
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.3,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // ── PRIMARY CTA: Repasar (RemNote: el foco es "review now") ──
            if (_dueCount > 0)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                    MxSpacing.lg, 0, MxSpacing.lg, MxSpacing.md),
                sliver: SliverToBoxAdapter(
                  child: _PrimaryCta(
                    count: _dueCount,
                    onTap: _reviewDue,
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                    MxSpacing.lg, 0, MxSpacing.lg, MxSpacing.md),
                sliver: SliverToBoxAdapter(
                  child: _EmptyCta(onTap: _newNote),
                ),
              ),

            // ── COMMAND BAR (4 quick actions) ──
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: MxSpacing.lg),
              sliver: SliverToBoxAdapter(
                child: _CommandBar(
                  actions: [
                    _QuickAction(
                      icon: Icons.add_rounded,
                      label: 'Nota',
                      onTap: _newNote,
                    ),
                    _QuickAction(
                      icon: Icons.style_outlined,
                      label: 'Tarjeta',
                      onTap: _newFlashcard,
                    ),
                    _QuickAction(
                      icon: Icons.today_outlined,
                      label: 'Daily',
                      onTap: _openDailyNote,
                    ),
                    _QuickAction(
                      icon: Icons.mic_none_rounded,
                      label: 'Grabar',
                      onTap: _openRecorder,
                    ),
                  ],
                ),
              ),
            ),

            // ── INBOX ROW (pending tasks, one line) ──
            if (_todayTasks.isNotEmpty)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                    MxSpacing.lg, MxSpacing.md, MxSpacing.lg, 0),
                sliver: SliverToBoxAdapter(
                  child: _InboxRow(
                    tasks: _todayTasks.take(3).toList(),
                    extra: _todayTasks.length - 3,
                    onTap: _openDailyNote,
                  ),
                ),
              ),

            // ── RECENT NOTES (flat list) ──
            if (_recentNotes.isNotEmpty) ...[
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                    MxSpacing.lg, MxSpacing.md, MxSpacing.lg, 0),
                sliver: SliverToBoxAdapter(
                  child: Row(
                    children: [
                      Text(
                        'Recientes',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.2,
                        ),
                      ),
                      const Spacer(),
                      TextButton(
                        onPressed: () {
                          // Cambiar al tab Vault del dock — el MainShell
                          // gestiona la navegación entre tabs vía _index.
                          final shell = context.findAncestorStateOfType<State>();
                          // Fallback simple: dejar que el dock funcione.
                          // El usuario puede tocar el dock item Vault.
                        },
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                              horizontal: MxSpacing.sm),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          visualDensity: VisualDensity.compact,
                        ),
                        child: const Text('Ver todo', style: TextStyle(fontSize: 12)),
                      ),
                    ],
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                    MxSpacing.lg, MxSpacing.sm, MxSpacing.lg, MxSpacing.xxxl),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (ctx, i) => _RecentRow(
                      note: _recentNotes[i],
                      onTap: () => _openNote(_recentNotes[i]),
                    ),
                    childCount: _recentNotes.length,
                  ),
                ),
              ),
            ],

            const SliverToBoxAdapter(child: SizedBox(height: MxSpacing.xl)),
          ],
        ),
      ),
    );
  }
}

// ── SUBCOMPONENTES ────────────────────────────────────────────────────

class _PrimaryCta extends StatelessWidget {
  final int count;
  final VoidCallback onTap;
  const _PrimaryCta({required this.count, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(MxRadius.lg),
        child: Ink(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                MxColors.indigoDeep.withOpacity(0.95),
                MxColors.violet.withOpacity(0.85),
              ],
            ),
            borderRadius: BorderRadius.circular(MxRadius.lg),
            boxShadow: MxShadows.md,
          ),
          padding: const EdgeInsets.symmetric(
              horizontal: MxSpacing.xl, vertical: MxSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Repasar',
                      style: theme.textTheme.headlineSmall?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$count tarjeta${count == 1 ? "" : "s"} para hoy',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: Colors.white.withOpacity(0.85),
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                width: 44, height: 44,
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.18),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.play_arrow_rounded,
                  color: Colors.white,
                  size: 26,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyCta extends StatelessWidget {
  final VoidCallback onTap;
  const _EmptyCta({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(MxRadius.lg),
        child: Ink(
          decoration: BoxDecoration(
            color: scheme.surfaceContainerLow.withOpacity(0.5),
            borderRadius: BorderRadius.circular(MxRadius.lg),
            border: Border.all(
              color: scheme.outlineVariant.withOpacity(0.4),
              width: 1,
            ),
          ),
          padding: const EdgeInsets.symmetric(
              horizontal: MxSpacing.xl, vertical: MxSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Al día',
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Empezá una nueva nota o grabá una clase',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                width: 44, height: 44,
                decoration: BoxDecoration(
                  color: MxColors.indigoDeep.withOpacity(0.12),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.add_rounded,
                  color: MxColors.indigoSoft,
                  size: 24,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CommandBar extends StatelessWidget {
  final List<_QuickAction> actions;
  const _CommandBar({required this.actions});
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow.withOpacity(0.4),
        borderRadius: BorderRadius.circular(MxRadius.md),
        border: Border.all(color: scheme.outlineVariant.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          for (var i = 0; i < actions.length; i++) ...[
            if (i > 0)
              Container(
                width: 1,
                height: 32,
                color: scheme.outlineVariant.withOpacity(0.4),
              ),
            Expanded(child: actions[i]),
          ],
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _QuickAction({required this.icon, required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(MxRadius.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: MxSpacing.md),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 20, color: scheme.onSurface),
            const SizedBox(height: 4),
            Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InboxRow extends StatelessWidget {
  final List<_TaskItem> tasks;
  final int extra;
  final VoidCallback onTap;
  const _InboxRow({
    required this.tasks,
    required this.extra,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final pending = tasks.where((t) => !t.done).toList();
    if (pending.isEmpty) return const SizedBox.shrink();
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(MxRadius.md),
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: MxSpacing.md, vertical: MxSpacing.sm),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow.withOpacity(0.4),
          borderRadius: BorderRadius.circular(MxRadius.md),
          border: Border.all(
            color: const Color(0xFFFBBF24).withOpacity(0.3),
          ),
        ),
        child: Row(
          children: [
            const Icon(Icons.check_box_outline_blank_rounded,
                size: 18, color: Color(0xFFFBBF24)),
            const SizedBox(width: MxSpacing.sm),
            Expanded(
              child: Text(
                pending.map((t) => t.text).join(' · '),
                style: theme.textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (extra > 0) ...[
              const SizedBox(width: MxSpacing.sm),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFFBBF24).withOpacity(0.15),
                  borderRadius: BorderRadius.circular(MxRadius.pill),
                ),
                child: Text(
                  '+$extra',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: const Color(0xFFFBBF24),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
            const SizedBox(width: MxSpacing.sm),
            Icon(
              Icons.chevron_right_rounded,
              size: 16,
              color: scheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}

class _RecentRow extends StatelessWidget {
  final _RecentNote note;
  final VoidCallback onTap;
  const _RecentRow({required this.note, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(MxRadius.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(
            vertical: MxSpacing.sm, horizontal: MxSpacing.xs),
        child: Row(
          children: [
            Icon(
              Icons.description_outlined,
              size: 18,
              color: scheme.onSurfaceVariant,
            ),
            const SizedBox(width: MxSpacing.md),
            Expanded(
              child: Text(
                note.title.isEmpty ? note.name.replaceAll('.md', '') : note.title,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: MxSpacing.sm),
            Text(
              _relTime(note.modified),
              style: theme.textTheme.labelSmall?.copyWith(
                color: scheme.onSurfaceVariant,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _relTime(DateTime d) {
    final diff = DateTime.now().difference(d);
    if (diff.inMinutes < 60) return 'hace ${diff.inMinutes}m';
    if (diff.inHours < 24) return 'hace ${diff.inHours}h';
    return 'hace ${diff.inDays}d';
  }
}

// ── MODELOS ────────────────────────────────────────────────────────────

class _RecentNote {
  final String name;
  final String path;
  final String title;
  final DateTime modified;
  _RecentNote({
    required this.name,
    required this.path,
    required this.title,
    required this.modified,
  });
}

class _TaskItem {
  final String text;
  final bool done;
  _TaskItem({required this.text, required this.done});
}
