// heatmap.dart: modelos de heatmap (Fase 3.D.1).

class DailyStat {
  final String date;
  final int reviews;
  final int newCards;
  final int studyTimeSec;

  const DailyStat({
    required this.date,
    required this.reviews,
    required this.newCards,
    required this.studyTimeSec,
  });
}
