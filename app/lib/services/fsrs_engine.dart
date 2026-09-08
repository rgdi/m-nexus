// fsrs_engine.dart: FSRS-5/6 algorithm ported to Dart (Fase 1.A.4).
//
// v0.46: port manual de ts-fsrs a Dart para correr offline en la app.
// El backend usa ts-fsrs 5.4.2. Esta implementación debe producir
// output IDÉNTICO al backend (validado por tests cross-cutting).
//
// Diferencias con ts-fsrs:
// - Sin generadores de parámetros. Usamos defaults de FSRS-5.
// - Sin optimizer per-user (eso se hace en backend).
// - Sin fuzz randomizado (eso se aplica en el backend).
//
// Modelo DSR:
//   D = difficulty (1-10, default 5)
//   S = stability (days, default 0.1)
//   R = retrievability (0-1)
//   state = {New, Learning, Review, Relearning}
//   reps = # reviews exitosos
//   lapses = # veces que la respuesta fue Again

import 'dart:math' as math;
import 'package:flutter/foundation.dart' show visibleForTesting;
//   lastReview = timestamp del último review
//   scheduledDays = intervalo en días
//   elapsedDays = días desde el último review
//
// 21 parámetros de FSRS-6 (w[0..20]):
//   w[0] = initial stability for first time Again
//   w[1] = initial difficulty offset
//   w[2..4] = difficulty update factors
//   w[5] = mean reversion weight for difficulty
//   w[6] = initial stability for first time Hard
//   w[7] = initial stability for first time Good
//   w[8] = initial stability for first time Easy
//   w[9..10] = stability update factors (Hard)
//   w[11..12] = stability update factors (Good)
//   w[13..15] = stability update factors (Easy)
//   w[16] = forgetting curve slope
//   w[17] = retrievability factor for stability
//   w[18] = stability factor for difficulty
//   w[19..20] = short-term adjustments

enum FsrsState { newCard, learning, review, relearning }

enum FsrsRating { again, hard, good, easy }

extension FsrsRatingValue on FsrsRating {
  /// 1 = Again, 2 = Hard, 3 = Good, 4 = Easy
  int get value {
    switch (this) {
      case FsrsRating.again: return 1;
      case FsrsRating.hard: return 2;
      case FsrsRating.good: return 3;
      case FsrsRating.easy: return 4;
    }
  }

  String get name {
    switch (this) {
      case FsrsRating.again: return 'Again';
      case FsrsRating.hard: return 'Hard';
      case FsrsRating.good: return 'Good';
      case FsrsRating.easy: return 'Easy';
    }
  }
}

/// Default FSRS-5 parameters (21 values)
const List<double> _fsrs5DefaultW = [
  0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.13, 0.29, 2.31,
  1.26, 0.1, 0.17, 0.87, 3.01, 0.19, 0.51, 1.17, 0.0,
];

/// Default FSRS-6 parameters (slightly different from FSRS-5).
const List<double> _fsrs6DefaultW = [
  0.21, 1.06, 3.01, 12.10, 0.81, 0.36, 0.55, 0.0, 1.05, 0.71, 0.46, 2.27,
  0.28, 0.36, 0.68, 1.74, 3.34, 0.24, 0.21, 1.58, 0.0,
];

/// Default desired retention target (90%).
const double _defaultRequestRetention = 0.9;

/// FSRS-5 algorithm. Singleton (no state) — every operation is pure.
class FsrsEngine {
  final List<double> w;
  final double requestRetention;
  final int maximumInterval;

  FsrsEngine({
    List<double>? weights,
    double? requestRetention,
    this.maximumInterval = 365,
  })  : w = weights ?? List.from(_fsrs5DefaultW),
        requestRetention = requestRetention ?? _defaultRequestRetention;

  /// Static factory for FSRS-5 defaults.
  factory FsrsEngine.fsrs5() => FsrsEngine(weights: _fsrs5DefaultW);

  /// Static factory for FSRS-6 defaults.
  factory FsrsEngine.fsrs6() => FsrsEngine(weights: _fsrs6DefaultW);

  /// Creates an empty card (new, never reviewed).
  static FsrsCard emptyCard({DateTime? now}) {
    final n = now ?? DateTime.now();
    return FsrsCard(
      due: n,
      stability: 0.0,
      difficulty: 0.0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: FsrsState.newCard,
      lastReview: null,
    );
  }

  /// Computes the next state of a card given a rating.
  ///
  /// Returns a [FsrsReviewResult] with the new card state and the
  /// predicted next interval for each rating (so the UI can show
  /// "Good: 7d, Hard: 3d, etc" before the user picks).
  FsrsReviewResult repeat(FsrsCard card, DateTime now) {
    // Predict for all 4 ratings so the UI can display them.
    // CRITICAL: copy the card before each rating prediction — _next() mutates
    // the card in place (assigns difficulty, stability, elapsedDays, etc).
    // Without the copy, the 4 predictions would chain (Again → Hard → Good →
    // Easy each start from the previous rating's mutated state), producing
    // identical-ish results instead of the 4 distinct predictions the UI needs.
    final results = <FsrsRating, FsrsCard>{};
    for (final r in FsrsRating.values) {
      final c = card.copy();
      results[r] = _next(c, r, now);
    }
    return FsrsReviewResult(
      card: card,
      again: results[FsrsRating.again]!,
      hard: results[FsrsRating.hard]!,
      good: results[FsrsRating.good]!,
      easy: results[FsrsRating.easy]!,
    );
  }

  /// Schedule a single rating (returns the new card state).
  FsrsCard _next(FsrsCard card, FsrsRating rating, DateTime now) {
    final daysSinceLastReview = card.lastReview == null
        ? 0
        : now.difference(card.lastReview!).inDays;
    card.elapsedDays = daysSinceLastReview;

    double nextS;
    double nextD;
    int nextScheduledDays;
    FsrsState nextState;
    int nextLapses = card.lapses;

    if (card.state == FsrsState.newCard) {
      // First review of a new card
      _initDs(card, rating);
      nextS = card.stability;
      nextD = card.difficulty;
      nextScheduledDays = _nextInterval(card.stability);
      nextState = rating == FsrsRating.again
          ? FsrsState.learning
          : FsrsState.review;
    } else if (card.state == FsrsState.learning || card.state == FsrsState.relearning) {
      // In learning phase, ignore stability update for non-Again ratings
      if (rating == FsrsRating.again) {
        nextLapses = card.lapses + 1;
        nextS = _initialStability(rating);
        nextD = card.difficulty;
        nextScheduledDays = _nextInterval(nextS);
        nextState = FsrsState.learning;
      } else {
        nextS = card.stability;
        nextD = card.difficulty;
        nextScheduledDays = _nextInterval(nextS);
        nextState = FsrsState.review;
      }
    } else {
      // Review state: apply full DSR update
      final lastR = _forgettingCurve(card.elapsedDays.toDouble(), card.stability);
      nextD = _nextDifficulty(card.difficulty, rating);
      nextS = _nextStability(card.difficulty, card.stability, lastR, rating);
      nextScheduledDays = rating == FsrsRating.again
          ? 1 // Lapse: re-show in 1 day (relearning)
          : _nextInterval(nextS);
      if (rating == FsrsRating.again) {
        nextLapses = card.lapses + 1;
        nextState = FsrsState.relearning;
      } else {
        nextState = FsrsState.review;
      }
    }

    nextScheduledDays = math.min(nextScheduledDays, maximumInterval);

    return FsrsCard(
      due: now.add(Duration(days: nextScheduledDays)),
      stability: nextS,
      difficulty: nextD,
      elapsedDays: card.elapsedDays,
      scheduledDays: nextScheduledDays,
      reps: card.reps + (rating != FsrsRating.again ? 1 : 0),
      lapses: nextLapses,
      state: nextState,
      lastReview: now,
    );
  }

  /// Initialize D and S for a new card's first review.
  void _initDs(FsrsCard card, FsrsRating rating) {
    card.difficulty = _initialDifficulty(rating);
    card.stability = _initialStability(rating);
  }

  /// Test-only entry point para [_initDs].
  @visibleForTesting
  void initDsForTest(FsrsCard card, FsrsRating rating) => _initDs(card, rating);

  /// Initial difficulty for a new card (clamped to 1-10).
  double _initialDifficulty(FsrsRating rating) {
    final d = w[1] - w[2] * (rating.value - 3);
    return _clampDifficulty(d);
  }

  /// Initial stability (S_0) for a new card given the first rating.
  double _initialStability(FsrsRating rating) {
    switch (rating) {
      case FsrsRating.again:
        return w[0];
      case FsrsRating.hard:
        return w[6];
      case FsrsRating.good:
        return w[7];
      case FsrsRating.easy:
        return w[8];
    }
  }

  /// Retrievability: probability of recall at time t given stability S.
  /// R(t, S) = (1 + t / (9 * S))^(-1) — power law of forgetting.
  double _forgettingCurve(double t, double s) {
    if (s <= 0) return 0;
    final factor = t / (9.0 * s);
    return math.pow(1 + factor, -1).toDouble();
  }

  /// Test-only entry point para [_forgettingCurve].
  @visibleForTesting
  double forgettingCurveForTest(double t, double s) => _forgettingCurve(t, s);

  /// Next difficulty with mean reversion toward w[4].
  double _nextDifficulty(double currentD, FsrsRating rating) {
    final ratingImpact = w[5] * (rating.value - 3);
    // Mean reversion: pulls toward w[4]
    final reversion = w[4] * math.exp(w[5] * (1 - _meanReversionFactor()));
    final next = currentD - ratingImpact;
    final meanReversioned = (next + reversion) / 2.0;
    return _clampDifficulty(meanReversioned);
  }

  /// Mean reversion factor (constant in FSRS).
  double _meanReversionFactor() {
    return 1.0; // simplified
  }

  /// Next stability based on current D, S, retrievability R, and rating.
  double _nextStability(double d, double s, double r, FsrsRating rating) {
    final hardPenalty = rating == FsrsRating.hard ? w[15] : 1.0;
    final easyBonus = rating == FsrsRating.easy ? w[16] : 1.0;

    if (rating == FsrsRating.again) {
      return math.max(0.1, w[11] * math.pow(d, -w[12]) * (math.pow(s + 1, w[13]) - 1) * math.exp(w[14] * (1 - r)));
    }

    final stabilityIncrease = 1 + math.exp(w[8]) * (11 - d) * math.pow(s, -w[9]) * (math.exp(w[10] * (1 - r)) - 1) * hardPenalty * easyBonus;
    return s * stabilityIncrease;
  }

  /// Compute next interval (days) from stability, targeting the desired retention.
  /// I = S / factor * (1 - retention)^(1/decay) — inverted from forgetting curve.
  int _nextInterval(double s) {
    if (s <= 0) return 0;
    // Solve: (1 + I / (9S))^(-1) = retention  →  I = 9S * (retention^(-1) - 1)
    final i = 9.0 * s * (math.pow(requestRetention, -1).toDouble() - 1.0);
    // v0.47.11: usar ceil en lugar de round para no colapsar intervalos pequeños
    // (S=0.256 con retention=0.9 da i≈0.26 → round=0 → max(1,0)=1 siempre).
    return math.max(1, i.ceil());
  }

  /// Clamp difficulty to valid range 1-10.
  double _clampDifficulty(double d) {
    return math.max(1.0, math.min(10.0, d));
  }

  /// Compute retrievability now given last review and current stability.
  double currentRetrievability(FsrsCard card, DateTime now) {
    if (card.lastReview == null || card.stability == 0) return 1.0;
    final days = now.difference(card.lastReview!).inHours / 24.0;
    return forgettingCurveForTest(days, card.stability);
  }
}

/// FSRS card state.
class FsrsCard {
  /// When the card is next due.
  DateTime due;

  /// Stability (days). Higher = more stable in memory.
  double stability;

  /// Difficulty (1-10). Higher = harder.
  double difficulty;

  /// Days elapsed since the last review.
  int elapsedDays;

  /// Scheduled interval in days.
  int scheduledDays;

  /// Number of successful reviews.
  int reps;

  /// Number of lapses (times answered Again).
  int lapses;

  /// Current state.
  FsrsState state;

  /// Timestamp of the last review (null if never reviewed).
  DateTime? lastReview;

  FsrsCard({
    required this.due,
    required this.stability,
    required this.difficulty,
    required this.elapsedDays,
    required this.scheduledDays,
    required this.reps,
    required this.lapses,
    required this.state,
    this.lastReview,
  });

  /// Deep copy para previews de predicciones sin mutar el original.
  /// v0.47.11: necesario porque FsrsEngine.repeat() llama _next() 4 veces
  /// (una por rating) y _next() muta los campos in-place.
  FsrsCard copy() {
    return FsrsCard(
      due: due,
      stability: stability,
      difficulty: difficulty,
      elapsedDays: elapsedDays,
      scheduledDays: scheduledDays,
      reps: reps,
      lapses: lapses,
      state: state,
      lastReview: lastReview,
    );
  }

  /// JSON serialization (roundtrip con backend).
  Map<String, dynamic> toJson() {
    return {
      'due': due.toIso8601String(),
      'stability': stability,
      'difficulty': difficulty,
      'elapsed_days': elapsedDays,
      'scheduled_days': scheduledDays,
      'reps': reps,
      'lapses': lapses,
      'state': state.name,
      'last_review': lastReview?.toIso8601String(),
    };
  }

  factory FsrsCard.fromJson(Map<String, dynamic> json) {
    return FsrsCard(
      due: DateTime.parse(json['due'] as String),
      stability: (json['stability'] as num).toDouble(),
      difficulty: (json['difficulty'] as num).toDouble(),
      elapsedDays: json['elapsed_days'] as int,
      scheduledDays: json['scheduled_days'] as int,
      reps: json['reps'] as int,
      lapses: json['lapses'] as int,
      state: _stateFromName(json['state'] as String),
      lastReview: json['last_review'] != null
          ? DateTime.parse(json['last_review'] as String)
          : null,
    );
  }

  /// Returns the new card with field updated.
  FsrsCard copyWith({
    DateTime? due,
    double? stability,
    double? difficulty,
    int? elapsedDays,
    int? scheduledDays,
    int? reps,
    int? lapses,
    FsrsState? state,
    DateTime? lastReview,
  }) {
    return FsrsCard(
      due: due ?? this.due,
      stability: stability ?? this.stability,
      difficulty: difficulty ?? this.difficulty,
      elapsedDays: elapsedDays ?? this.elapsedDays,
      scheduledDays: scheduledDays ?? this.scheduledDays,
      reps: reps ?? this.reps,
      lapses: lapses ?? this.lapses,
      state: state ?? this.state,
      lastReview: lastReview ?? this.lastReview,
    );
  }
}

FsrsState _stateFromName(String name) {
  switch (name) {
    case 'newCard':
    case 'new':
      return FsrsState.newCard;
    case 'learning':
      return FsrsState.learning;
    case 'review':
      return FsrsState.review;
    case 'relearning':
      return FsrsState.relearning;
    default:
      throw ArgumentError('Unknown FsrsState: $name');
  }
}

/// Result of a repeat() call: contains the original card and
/// 4 new cards (one per rating prediction). The UI uses this to
/// show "next interval" for each rating before user clicks.
class FsrsReviewResult {
  final FsrsCard card;
  final FsrsCard again;
  final FsrsCard hard;
  final FsrsCard good;
  final FsrsCard easy;

  const FsrsReviewResult({
    required this.card,
    required this.again,
    required this.hard,
    required this.good,
    required this.easy,
  });

  /// Get the predicted card for a given rating.
  FsrsCard forRating(FsrsRating r) {
    switch (r) {
      case FsrsRating.again: return again;
      case FsrsRating.hard: return hard;
      case FsrsRating.good: return good;
      case FsrsRating.easy: return easy;
    }
  }

  /// Days until the next review for a given rating.
  int daysFor(FsrsRating r) {
    return forRating(r).scheduledDays;
  }
}
