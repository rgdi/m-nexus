// heatmap_service.dart: stub minimo para v0.47.0.
// v0.47.4: agregada StudyStats class para compatibilidad con study_stats_service.

library;

class ReviewEvent {
  final int timestamp;
  final String? cardId;
  final int? rating;
  final int? elapsedMs;
  ReviewEvent({
    required this.timestamp,
    this.cardId,
    this.rating,
    this.elapsedMs,
  });
}

class DailyStat {
  final String date;
  final int reviews;
  final int newCards;
  final int studyTimeSec;
  DailyStat({
    required this.date,
    required this.reviews,
    required this.newCards,
    required this.studyTimeSec,
  });
}

class StudyStats {
  final List<DailyStat> daily;
  final int totalReviews;
  final int totalMinutes;
  StudyStats({
    required this.daily,
    required this.totalReviews,
    required this.totalMinutes,
  });

  /// Compute StudyStats from a list of events.
  /// v0.47.4: implementacion minima para que el codigo compile.
  static StudyStats compute(List<ReviewEvent> events) {
    final byDate = <String, DailyStat>{};
    for (final e in events) {
      final dt = DateTime.fromMillisecondsSinceEpoch(e.timestamp);
      final key = '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
      final existing = byDate[key];
      final reviews = (existing?.reviews ?? 0) + 1;
      final secs = (existing?.studyTimeSec ?? 0) + ((e.elapsedMs ?? 0) ~/ 1000);
      byDate[key] = DailyStat(
        date: key,
        reviews: reviews,
        newCards: existing?.newCards ?? 0,
        studyTimeSec: secs,
      );
    }
    final daily = byDate.values.toList()..sort((a, b) => a.date.compareTo(b.date));
    final totalReviews = events.length;
    final totalMinutes = daily.fold<int>(0, (acc, d) => acc + d.studyTimeSec) ~/ 60;
    return StudyStats(
      daily: daily,
      totalReviews: totalReviews,
      totalMinutes: totalMinutes,
    );
  }
}
