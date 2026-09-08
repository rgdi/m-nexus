// review_heatmap.dart: heatmap de repasas estilo GitHub (Fase 3.D.1 + 3.F.1).
//
// v0.46: visualizacion de la actividad del usuario en los ultimos 365 dias.
// Usa fl_chart's heatmap o implementacion custom con CustomPaint.
// 5 niveles de intensidad (0 = sin actividad, 4 = 100+ repasas/dia).

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import '../services/heatmap_service.dart';
import '../services/study_stats_service.dart';

class ReviewHeatmap extends StatelessWidget {
  final Map<String, DailyStat> dailyStats; // date (YYYY-MM-DD) → stat
  final int daysToShow;
  final ValueChanged<DateTime>? onDayTap;

  const ReviewHeatmap({
    super.key,
    required this.dailyStats,
    this.daysToShow = 182, // 6 meses por defecto
    this.onDayTap,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final today = DateTime.now();
    final start = today.subtract(Duration(days: daysToShow - 1));

    // Agrupa por semanas (columnas)
    final weeks = <List<DateTime>>[];
    var currentWeek = <DateTime>[];
    var current = start;
    while (current.isBefore(today) || current.isAtSameMomentAs(today)) {
      currentWeek.add(current);
      if (currentWeek.length == 7 || current.weekday == DateTime.sunday) {
        weeks.add(currentWeek);
        currentWeek = [];
      }
      current = current.add(const Duration(days: 1));
    }
    if (currentWeek.isNotEmpty) weeks.add(currentWeek);

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: weeks.map((week) {
              return Padding(
                padding: const EdgeInsets.only(right: 2),
                child: Column(
                  children: week.map((day) {
                    final key = _dateKey(day);
                    final stat = dailyStats[key];
                    final reviews = stat?.reviews ?? 0;
                    final intensity = HeatmapService.intensityBucket(reviews);
                    return _HeatmapCell(
                      day: day,
                      reviews: reviews,
                      intensity: intensity,
                      theme: theme,
                      onTap: onDayTap,
                    );
                  }).toList(),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 8),
          _buildLegend(theme, l10n),
        ],
      ),
    );
  }

  Widget _buildLegend(ThemeData theme, AppLocalizations l10n) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('Less', style: theme.textTheme.bodySmall),
        const SizedBox(width: 4),
        for (var i = 0; i <= 4; i++)
          Padding(
            padding: const EdgeInsets.only(right: 2),
            child: Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                color: _colorForIntensity(i, theme),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
        const SizedBox(width: 4),
        Text('More', style: theme.textTheme.bodySmall),
      ],
    );
  }

  static String _dateKey(DateTime d) {
    return '${d.year.toString().padLeft(4, "0")}-${d.month.toString().padLeft(2, "0")}-${d.day.toString().padLeft(2, "0")}';
  }

  static Color _colorForIntensity(int intensity, ThemeData theme) {
    final base = theme.colorScheme.primary;
    if (intensity == 0) return theme.colorScheme.surfaceContainerHighest;
    final alpha = 0.2 + (intensity * 0.2);
    return base.withValues(alpha: alpha);
  }
}

class _HeatmapCell extends StatelessWidget {
  final DateTime day;
  final int reviews;
  final int intensity;
  final ThemeData theme;
  final ValueChanged<DateTime>? onTap;

  const _HeatmapCell({
    required this.day,
    required this.reviews,
    required this.intensity,
    required this.theme,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = ReviewHeatmap._colorForIntensity(intensity, theme);
    return Padding(
      padding: const EdgeInsets.all(1),
      child: InkWell(
        onTap: onTap != null ? () => onTap!(day) : null,
        child: Tooltip(
          message: '${day.toIso8601String().slice(0, 10)}\n$reviews repasas',
          child: Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
      ),
    );
  }
}
