// Tests para FsrsEngine (Fase 1.A.4 + 1.A.7).
//
// Validan que el port a Dart produce los mismos valores que el backend
// (ts-fsrs 5.4.2). Cross-cutting test: dado el mismo input, el output
// debe ser identico al del backend.

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus/services/fsrs_engine.dart';

void main() {
  group('FsrsCard JSON roundtrip', () {
    test('preserves all fields through toJson/fromJson', () {
      final now = DateTime(2026, 9, 7, 12, 0, 0);
      final original = FsrsCard(
        due: now.add(const Duration(days: 7)),
        stability: 14.2,
        difficulty: 4.0,
        elapsedDays: 0,
        scheduledDays: 7,
        reps: 3,
        lapses: 1,
        state: FsrsState.review,
        lastReview: now,
      );
      final json = original.toJson();
      final restored = FsrsCard.fromJson(json);
      expect(restored.due, original.due);
      expect(restored.stability, original.stability);
      expect(restored.difficulty, original.difficulty);
      expect(restored.scheduledDays, original.scheduledDays);
      expect(restored.reps, original.reps);
      expect(restored.lapses, original.lapses);
      expect(restored.state, original.state);
      expect(restored.lastReview, original.lastReview);
    });
  });

  group('emptyCard', () {
    test('creates card in newCard state with zero stability', () {
      final card = FsrsEngine.emptyCard();
      expect(card.state, FsrsState.newCard);
      expect(card.stability, 0.0);
      expect(card.difficulty, 0.0);
      expect(card.reps, 0);
      expect(card.lapses, 0);
    });
  });

  group('initial difficulty (clamp 1-10)', () {
    test('Again rating: D = 5.4 (no clamp needed)', () {
      // 0.6 - 2.4 * (1-3) = 0.6 + 4.8 = 5.4
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      fsrs._initDsForTest(card, FsrsRating.again);
      expect(card.difficulty, closeTo(5.4, 0.01));
    });

    test('Hard rating: D = 3.0', () {
      // 0.6 - 2.4 * (2-3) = 0.6 + 2.4 = 3.0
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      fsrs._initDsForTest(card, FsrsRating.hard);
      expect(card.difficulty, closeTo(3.0, 0.01));
    });

    test('Good rating: D clamped to 1.0 (formula gives 0.6)', () {
      // 0.6 - 2.4 * 0 = 0.6 → clamped to 1.0
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      fsrs._initDsForTest(card, FsrsRating.good);
      expect(card.difficulty, closeTo(1.0, 0.01));
    });

    test('Easy rating: D clamped to 1.0 (formula gives -1.8)', () {
      // 0.6 - 2.4 * 1 = -1.8 → clamped to 1.0
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      fsrs._initDsForTest(card, FsrsRating.easy);
      expect(card.difficulty, closeTo(1.0, 0.01));
    });
  });

  group('initial stability (S_0)', () {
    test('Again: S0 = w[0] = 0.4', () {
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      fsrs._initDsForTest(card, FsrsRating.again);
      expect(card.stability, closeTo(0.4, 0.01));
    });

    test('Hard: S0 = w[6] = 0.86', () {
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      fsrs._initDsForTest(card, FsrsRating.hard);
      expect(card.stability, closeTo(0.86, 0.01));
    });

    test('Good: S0 = w[7] = 0.01', () {
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      fsrs._initDsForTest(card, FsrsRating.good);
      expect(card.stability, closeTo(0.01, 0.01));
    });

    test('Easy: S0 = w[8] = 1.49', () {
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      fsrs._initDsForTest(card, FsrsRating.easy);
      expect(card.stability, closeTo(1.49, 0.01));
    });
  });

  group('forgetting curve R(t, S)', () {
    test('R(0, S) = 1.0 (no time elapsed = perfect recall)', () {
      final fsrs = FsrsEngine.fsrs5();
      expect(fsrs._forgettingCurveForTest(0, 10), closeTo(1.0, 0.001));
    });

    test('R(t=9S, S) = 0.5 (half-life)', () {
      // 9S is the half-life of the curve
      final fsrs = FsrsEngine.fsrs5();
      expect(fsrs._forgettingCurveForTest(90, 10), closeTo(0.5, 0.001));
    });

    test('R(S=0, t) = 0 (no stability = instant forgetting)', () {
      final fsrs = FsrsEngine.fsrs5();
      expect(fsrs._forgettingCurveForTest(1, 0), 0.0);
    });
  });

  group('repeat() — first review of new card', () {
    test('Again on new card: state=learning, low S, short interval', () {
      final fsrs = FsrsEngine.fsrs5();
      final card = FsrsEngine.emptyCard();
      final now = DateTime(2026, 9, 7);
      final result = fsrs.repeat(card, now);
      final newCard = result.forRating(FsrsRating.again);
      expect(newCard.state, FsrsState.learning);
      expect(newCard.stability, closeTo(0.4, 0.01)); // w[0]
      expect(newCard.scheduledDays, 1);
      expect(newCard.lapses, 0); // First time, no lapse yet
    });

    test('Good on new card: state=review, interval based on S0=0.01', () {
      final fsrs = FsrsEngine.fsrs5();
      final card = FsrsEngine.emptyCard();
      final now = DateTime(2026, 9, 7);
      final result = fsrs.repeat(card, now);
      final newCard = result.forRating(FsrsRating.good);
      expect(newCard.state, FsrsState.review);
      expect(newCard.stability, closeTo(0.01, 0.01)); // w[7]
    });

    test('repeat() returns 4 predicted cards (one per rating)', () {
      final fsrs = FsrsEngine.fsrs5();
      final card = FsrsEngine.emptyCard();
      final result = fsrs.repeat(card, DateTime(2026, 9, 7));
      expect(result.again.state, isNot(equals(result.good.state)));
      expect(result.good.scheduledDays, isNot(equals(result.easy.scheduledDays)));
    });
  });

  group('repeat() — consecutive reviews', () {
    test('3x Good reviews: stability grows, interval grows', () {
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      final t0 = DateTime(2026, 9, 7);

      // 1st review: Good
      final r1 = fsrs.repeat(card, t0);
      card = r1.good;

      // 2nd review at due date: Good
      final t1 = card.due;
      final r2 = fsrs.repeat(card, t1);
      card = r2.good;

      // 3rd review at due date: Good
      final t2 = card.due;
      final r3 = fsrs.repeat(card, t2);
      card = r3.good;

      // Stability should grow
      expect(card.stability, greaterThan(r1.good.stability));
      expect(r2.good.scheduledDays, greaterThan(r1.good.scheduledDays));
      expect(r3.good.scheduledDays, greaterThan(r2.good.scheduledDays));
    });

    test('lapse: Again after several Goods: stability drops, lapses++', () {
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      final t0 = DateTime(2026, 9, 7);

      // Build up stability with 2 Goods
      card = fsrs.repeat(card, t0).good;
      card = fsrs.repeat(card, card.due).good;

      // Now lapse (Again)
      final beforeLapse = card.lapses;
      final beforeS = card.stability;
      card = fsrs.repeat(card, card.due).again;
      expect(card.lapses, beforeLapse + 1);
      expect(card.state, FsrsState.relearning);
    });
  });

  group('CRITICAL: Cross-cutting parity with backend', () {
    // Si el backend hace repeat() con los mismos inputs, debe obtener
    // los mismos outputs. Estos tests son regression tests para
    // detectar drift entre los dos implementations.
    test('parity: Good on new card with FSRS-5 defaults', () {
      final fsrs = FsrsEngine.fsrs5();
      final card = FsrsEngine.emptyCard();
      final t = DateTime.utc(2026, 9, 7, 12, 0, 0);
      final newCard = fsrs.repeat(card, t).good;
      // Backend equivalent (ts-fsrs fsrs5 default) gives:
      // stability: 0.01, difficulty: clamped to 1, scheduledDays: 1
      // (S=0.01 → I = 9*0.01*0.111 = 0.01 → max(1, 0) = 1)
      expect(newCard.stability, closeTo(0.01, 0.001));
      expect(newCard.difficulty, 1.0);
      expect(newCard.scheduledDays, 1);
    });

    test('parity: Easy on new card with FSRS-5 defaults', () {
      final fsrs = FsrsEngine.fsrs5();
      final card = FsrsEngine.emptyCard();
      final t = DateTime.utc(2026, 9, 7, 12, 0, 0);
      final newCard = fsrs.repeat(card, t).easy;
      // stability: 1.49, difficulty: clamped to 1
      // I = 9*1.49*0.111 = 1.49 → 1
      expect(newCard.stability, closeTo(1.49, 0.01));
      expect(newCard.scheduledDays, 1);
    });
  });

  group('currentRetrievability', () {
    test('returns 1.0 for new card (never reviewed)', () {
      final fsrs = FsrsEngine.fsrs5();
      final card = FsrsEngine.emptyCard();
      final t = DateTime(2026, 9, 7);
      expect(fsrs.currentRetrievability(card, t), 1.0);
    });

    test('decays over time after review', () {
      final fsrs = FsrsEngine.fsrs5();
      var card = FsrsEngine.emptyCard();
      final t0 = DateTime(2026, 9, 7);
      card = fsrs.repeat(card, t0).good;

      // Right after review
      expect(fsrs.currentRetrievability(card, t0), closeTo(1.0, 0.001));

      // 9*S days later (half-life): R = 0.5
      final halfLife = t0.add(Duration(days: 9 * card.stability.round()));
      expect(fsrs.currentRetrievability(card, halfLife), closeTo(0.5, 0.05));
    });
  });
}

// Extension para acceder a metodos privados en tests (white-box)
extension FsrsTestAccess on FsrsEngine {
  void _initDsForTest(FsrsCard card, FsrsRating rating) {
    _initDs(card, rating);
  }

  double _forgettingCurveForTest(double t, double s) {
    return _forgettingCurve(t, s);
  }
}
