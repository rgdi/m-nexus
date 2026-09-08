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

  /// Racha actual (dias consecutivos con reviews, terminada en hoy).
  /// Calculada al vuelo desde [daily]; no se persiste para evitar desincronizar.
  int get currentStreak {
    if (daily.isEmpty) return 0;
    final dates = daily.map((d) => d.date).toSet();
    final today = DateTime.now();
    String fmt(DateTime d) =>
        '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    var streak = 0;
    var cursor = DateTime(today.year, today.month, today.day);
    // Si hoy no tiene review, permitimos empezar desde ayer (la racha "vive" hasta mañana).
    if (!dates.contains(fmt(cursor))) {
      cursor = cursor.subtract(const Duration(days: 1));
    }
    while (dates.contains(fmt(cursor))) {
      streak++;
      cursor = cursor.subtract(const Duration(days: 1));
    }
    return streak;
  }

  /// Racha historica mas larga (en cualquier ventana del historico).
  int get longestStreak {
    if (daily.isEmpty) return 0;
    final sorted = [...daily]..sort((a, b) => a.date.compareTo(b.date));
    var best = 1;
    var run = 1;
    for (var i = 1; i < sorted.length; i++) {
      final prev = DateTime.parse(sorted[i - 1].date);
      final curr = DateTime.parse(sorted[i].date);
      if (curr.difference(prev).inDays == 1) {
        run++;
        if (run > best) best = run;
      } else {
        run = 1;
      }
    }
    return best;
  }

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
