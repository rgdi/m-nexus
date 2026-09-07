// study_stats_service.dart: agregador de stats para UI (Fase 3.D.1 + 3.F.1).
//
// v0.46: wrapper de HeatmapService.backend para uso en app.
// Mismas estructuras + computa heatmap aggregation desde eventos.

import '../../services/heatmap_service.dart';
import '../../models/heatmap.dart';

class StudyStatsService {
  /// Computa stats agregadas desde una lista de ReviewEvent.
  /// El backend (Fase 3.D) ya retorna StudyStats; este wrapper se usa
  /// para stats locales en el cliente.
  static StudyStats compute(List<ReviewEvent> events) {
    return HeatmapService.compute(events);
  }

  /// Computa daily stats agrupadas por dia.
  static Map<String, DailyStat> computeDaily(List<ReviewEvent> events) {
    final stats = HeatmapService.compute(events);
    return {for (final d in stats.daily) d.date: d};
  }

  /// Agrupa reviews en buckets para heatmap.
  /// Devuelve Map<date, count> para los ultimos N dias.
  static Map<String, int> lastNDayCounts(List<ReviewEvent> events, {int days = 365}) {
    final today = DateTime.now();
    final start = today.subtract(Duration(days: days - 1));
    final out = <String, int>{};

    for (var i = 0; i < days; i++) {
      final d = start.add(Duration(days: i));
      out[_dateKey(d)] = 0;
    }
    for (final e in events) {
      final d = DateTime.fromMillisecondsSinceEpoch(e.timestamp);
      if (d.isBefore(start) || d.isAfter(today)) continue;
      out[_dateKey(d)] = (out[_dateKey(d)] ?? 0) + 1;
    }
    return out;
  }

  static String _dateKey(DateTime d) {
    return '${d.year.toString().padLeft(4, "0")}-${d.month.toString().padLeft(2, "0")}-${d.day.toString().padLeft(2, "0")}';
  }
}
