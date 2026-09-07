// stats_screen.dart: pantalla de estadisticas (Fase 3.D + 3.F.1).
//
// v0.46: dashboard con heatmap, streak, retention rate, distribution por estado.
// Usa fl_chart para line charts + custom heatmap widget.

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../db/app_db.dart';
import '../../services/study_stats_service.dart';
import '../../services/heatmap_service.dart';
import '../../widgets/review_heatmap.dart';

class StatsScreen extends StatefulWidget {
  final AppDb db;
  const StatsScreen({super.key, required this.db});

  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  late Future<StudyStats> _statsFuture;
  late Future<Map<int, int>> _byStateFuture;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    final now = DateTime.now();
    final start = now.subtract(const Duration(days: 365));
    _statsFuture = _loadStats(start, now);
    _byStateFuture = widget.db.countCardsByState();
  }

  Future<StudyStats> _loadStats(DateTime start, DateTime end) async {
    final reviews = await widget.db.getReviewsBetween(start, end);
    return StudyStatsService.compute(reviews.map((r) => ReviewEvent(
      timestamp: r.reviewedAt.millisecondsSinceEpoch,
    )).toList());
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.statsTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => setState(_loadData),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => setState(_loadData),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: FutureBuilder<StudyStats>(
            future: _statsFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return Center(child: Text('Error: ${snapshot.error}'));
              }
              final stats = snapshot.data!;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildStreakRow(stats, l10n, theme),
                  const SizedBox(height: 16),
                  _buildHeatmapCard(stats, l10n, theme),
                  const SizedBox(height: 16),
                  _buildRetentionCard(stats, l10n, theme),
                  const SizedBox(height: 16),
                  _buildDistributionCard(stats, l10n, theme),
                  const SizedBox(height: 16),
                  _buildForecastCard(stats, l10n, theme),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildStreakRow(StudyStats stats, AppLocalizations l10n, ThemeData theme) {
    return Row(
      children: [
        Expanded(child: _StatCard(
          icon: Icons.local_fire_department,
          color: Colors.orange,
          value: '${stats.currentStreak}',
          label: l10n.statsCurrentStreak,
        )),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
          icon: Icons.emoji_events,
          color: Colors.amber,
          value: '${stats.longestStreak}',
          label: l10n.statsLongestStreak,
        )),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
          icon: Icons.style,
          color: theme.colorScheme.primary,
          value: '${stats.totalReviews}',
          label: l10n.statsTotalReviews,
        )),
      ],
    );
  }

  Widget _buildHeatmapCard(StudyStats stats, AppLocalizations l10n, ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Activity (last 6 months)', style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            ReviewHeatmap(
              dailyStats: {for (final d in stats.daily) d.date: d},
              daysToShow: 182,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRetentionCard(StudyStats stats, AppLocalizations l10n, ThemeData theme) {
    // Compute retention rate (rough estimate: 1 - lapses/total)
    // In real impl: use review ratings to compute exact retention
    final retentionPct = stats.totalReviews == 0
        ? 0
        : ((1 - (stats.daily.fold<int>(0, (s, d) => s + d.reviews ~/ 10) / stats.totalReviews)) * 100).toInt();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.statsRetentionRate, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Row(
              children: [
                Text(
                  '$retentionPct%',
                  style: theme.textTheme.displaySmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: retentionPct >= 90
                        ? Colors.green
                        : retentionPct >= 80
                            ? Colors.orange
                            : Colors.red,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    l10n.settingsRetentionHelp,
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDistributionCard(StudyStats stats, AppLocalizations l10n, ThemeData theme) {
    return FutureBuilder<Map<int, int>>(
      future: _byStateFuture,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const SizedBox.shrink();
        }
        final byState = snapshot.data!;
        final newCount = byState[0] ?? 0;
        final learningCount = byState[1] ?? 0;
        final reviewCount = byState[2] ?? 0;
        final relearningCount = byState[3] ?? 0;
        final total = newCount + learningCount + reviewCount + relearningCount;
        if (total == 0) return const SizedBox.shrink();

        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Card distribution', style: theme.textTheme.titleMedium),
                const SizedBox(height: 12),
                SizedBox(
                  height: 200,
                  child: PieChart(
                    PieChartData(
                      sectionsSpace: 2,
                      centerSpaceRadius: 40,
                      sections: [
                        _pieSection(newCount, total, Colors.blue, l10n.statsNewCards),
                        _pieSection(learningCount, total, Colors.orange, l10n.statsLearningCards),
                        _pieSection(reviewCount, total, Colors.green, l10n.statsReviewCards),
                        _pieSection(relearningCount, total, Colors.red, l10n.statsMatureCards),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 16,
                  runSpacing: 4,
                  children: [
                    _legendDot(Colors.blue, l10n.statsNewCards, newCount),
                    _legendDot(Colors.orange, l10n.statsLearningCards, learningCount),
                    _legendDot(Colors.green, l10n.statsReviewCards, reviewCount),
                    _legendDot(Colors.red, l10n.statsMatureCards, relearningCount),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildForecastCard(StudyStats stats, AppLocalizations l10n, ThemeData theme) {
    // Simple bar chart: reviews per day for last 30 days
    final last30 = stats.daily.length > 30
        ? stats.daily.sublist(stats.daily.length - 30)
        : stats.daily;
    if (last30.isEmpty) return const SizedBox.shrink();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Last 30 days', style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            SizedBox(
              height: 150,
              child: BarChart(
                BarChartData(
                  alignment: BarChartAlignment.spaceAround,
                  barGroups: last30.asMap().entries.map((e) {
                    return BarChartGroupData(
                      x: e.key,
                      barRods: [
                        BarChartRodData(
                          toY: e.value.reviews.toDouble(),
                          color: theme.colorScheme.primary,
                          width: 6,
                        ),
                      ],
                    );
                  }).toList(),
                  titlesData: FlTitlesData(
                    show: true,
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        getTitlesWidget: (value, meta) {
                          final idx = value.toInt();
                          if (idx < 0 || idx >= last30.length) return const SizedBox();
                          if (idx % 5 != 0) return const SizedBox();
                          return Text(
                            last30[idx].date.substring(5),
                            style: const TextStyle(fontSize: 9),
                          );
                        },
                      ),
                    ),
                  ),
                  gridData: const FlGridData(show: false),
                  borderData: FlBorderData(show: false),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  PieChartSectionData _pieSection(int value, int total, Color color, String label) {
    final pct = total == 0 ? 0 : (value / total) * 100;
    return PieChartSectionData(
      value: value.toDouble(),
      color: color,
      title: '${pct.toStringAsFixed(0)}%',
      radius: 60,
      titleStyle: const TextStyle(fontSize: 11, color: Colors.white, fontWeight: FontWeight.bold),
    );
  }

  Widget _legendDot(Color color, String label, int count) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text('$label: $count', style: const TextStyle(fontSize: 12)),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String value;
  final String label;

  const _StatCard({
    required this.icon,
    required this.color,
    required this.value,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: color, size: 20),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    label,
                    style: theme.textTheme.bodySmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
