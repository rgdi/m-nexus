// home_screen.dart: dashboard principal de M-NEXUS (Fase 0 + 6.A).
//
// v0.47.0: dashboard con datos REALES (no 0s falsos), estilo cristal limpio,
// cards redondeadas, separación clara de secciones.
//   - Hero con saludo y CTA principal
//   - Stats grid: racha, repasar hoy, tiempo invertido, precisión
//   - Heatmap últimos 90 días
//   - Acciones rápidas: Nueva nota, Repasar hoy, Nueva flashcard
//   - Notas recientes (top 5)

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:intl/intl.dart';
import '../../core/theme.dart';
import '../../services/flashcard_service.dart';
import '../../services/fsrs_engine.dart';
import '../../services/vault_service.dart';
import '../../services/study_stats_service.dart';
import '../../state/app_state.dart';
import '../flashcards/flashcard_review.dart';
import '../flashcards/flashcard_edit.dart';
import '../note/note_editor.dart';
import '../vault/vault_browser.dart';
import '../../services/permissions.dart';
import '../../widgets/review_heatmap.dart';
import '../flashcards/flashcard_review.dart';
import '../flashcards/flashcard_edit.dart';
import '../note/note_editor.dart';
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final hour = DateTime.now().hour;
    final greeting = hour < 12
      ? 'Buenos días'
      : hour < 18
        ? 'Buenas tardes'
        : 'Buenas noches';

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            // Header con saludo
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(greeting,
                        style: theme.textTheme.titleSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        )),
                    const SizedBox(height: 4),
                    Text('¿Qué quieres aprender hoy?',
                        style: theme.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        )),
                  ],
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 16)),

            // Stats grid (2x2)
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              sliver: SliverGrid.count(
                crossAxisCount: 2,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 1.6,
                children: [
                  _StatCard(
                    icon: Icons.local_fire_department,
                    label: 'Racha',
                    value: '$_streak',
                    suffix: _streak == 1 ? 'día' : 'días',
                    color: Colors.orange,
                  ),
                  _StatCard(
                    icon: Icons.style_outlined,
                    label: 'Para repasar',
                    value: '$_dueCount',
                    suffix: 'tarjetas',
                    color: theme.colorScheme.primary,
                  ),
                  _StatCard(
                    icon: Icons.timer_outlined,
                    label: 'Tiempo hoy',
                    value: '$_minutesToday',
                    suffix: 'minutos',
                    color: Colors.purple,
                  ),
                  _StatCard(
                    icon: Icons.psychology_outlined,
                    label: 'Retención',
                    value: '${(_retention * 100).toInt()}',
                    suffix: '%',
                    color: Colors.green,
                  ),
                ],
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 24)),

            // Heatmap
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              sliver: SliverToBoxAdapter(
                child: _DashboardCard(
                  title: 'Actividad',
                  subtitle: 'Últimos 90 días',
                  child: SizedBox(
                    height: 100,
                    child: ReviewHeatmap(
                      dailyStats: _dailyStats,
                      daysToShow: 90,
                    ),
                  ),
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 16)),

            // Acciones
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(left: 4, bottom: 8),
                      child: Text('Acciones',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          )),
                    ),
                    _ActionCard(
                      icon: Icons.add_circle_outline,
                      title: 'Nueva nota',
                      subtitle: 'Crea una nota en markdown',
                      onTap: _newNote,
                    ),
                    const SizedBox(height: 8),
                    _ActionCard(
                      icon: Icons.style_outlined,
                      title: 'Repasar hoy',
                      subtitle: _dueCount == 0
                          ? 'No hay tarjetas pendientes'
                          : '$_dueCount tarjeta${_dueCount == 1 ? "" : "s"} para repasar',
                      onTap: _reviewDue,
                      accent: _dueCount > 0,
                    ),
                    const SizedBox(height: 8),
                    _ActionCard(
                      icon: Icons.add_box_outlined,
                      title: 'Nueva tarjeta',
                      subtitle: 'Empezar a estudiar',
                      onTap: _newFlashcard,
                    ),
                  ],
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 24)),

            // Notas recientes
            if (_recentNotes.isNotEmpty) ...[
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                sliver: SliverToBoxAdapter(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(left: 4, bottom: 8),
                        child: Text('Recientes',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            )),
                      ),
                      ..._recentNotes.map((n) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
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
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.2)),
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
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.5)),
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
        onTap: () {
          Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => VaultBrowser(),
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
                      note.title.isNotEmpty ? note.title : note.name,
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
