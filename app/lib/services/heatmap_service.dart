// heatmap_service.dart: stub minimo para v0.47.0.
// El heatmap logic se movio a study_stats_service. Este archivo se mantiene
// para compatibilidad con imports legacy.

library;

class ReviewEvent {
  final int timestamp;
  ReviewEvent({required this.timestamp});
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
