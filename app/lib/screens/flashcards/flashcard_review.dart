// FlashcardReview: repaso de tarjetas con 4-button FSRS (Fase 1.A.5 + 3.E.1).
//
// v0.46: 4 buttons (Again/Hard/Good/Easy) con colores semánticos y haptic.
// Cada button muestra el intervalo predicho por FSRS antes de tap.
// Antes: 3 buttons (Difícil/Regular/Fácil) con SM-2 hardcoded (1/3/7/14d).
// Despues: FSRS-5 con DSR (Difficulty/Stability/Retrievability) real.
//
// Keyboard shortcuts estilo Anki:
//   Space: flip card
//   1: Again
//   2: Hard
//   3: Good
//   4: Easy
//   Esc: salir
//
// Requisitos:
//   - FsrsEngine (lib/services/fsrs_engine.dart)
//   - AppDb (lib/db/app_db.dart) para persistir reviews

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:drift/drift.dart' show Value;
import '../../services/flashcard_service.dart';
import '../../services/fsrs_engine.dart';
import '../../db/app_db.dart';
import '../../widgets/empty_state.dart';
import 'dart:async';

class FlashcardReview extends StatefulWidget {
  final List<Flashcard> cards;
  final FlashcardService service;
  final AppDb? db; // Opcional: si hay DB, persistir reviews
  final FsrsEngine? fsrs; // Opcional: inyectar engine (default fsrs5)
  final VoidCallback? onFinish;
  final int? sessionId; // Session ID para heatmap

  const FlashcardReview({
    super.key,
    required this.cards,
    required this.service,
    this.db,
    this.fsrs,
    this.onFinish,
    this.sessionId,
  });

  @override
  State<FlashcardReview> createState() => _FlashcardReviewState();
}

class _FlashcardReviewState extends State<FlashcardReview> {
  int _index = 0;
  bool _showAnswer = false;
  int _correct = 0;
  int _incorrect = 0;
  DateTime? _cardStartTime;
  late FsrsEngine _fsrs;

  @override
  void initState() {
    super.initState();
    _fsrs = widget.fsrs ?? FsrsEngine.fsrs5();
    _cardStartTime = DateTime.now();
  }

  @override
  void dispose() {
    // Save session on close
    if (widget.db != null && widget.sessionId != null) {
      widget.db!.endSession(widget.sessionId!, DateTime.now(), 0);
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.cards.isEmpty) {
      return const EmptyState(icon: Icons.check, title: 'Sin tarjetas para repasar');
    }
    if (_index >= widget.cards.length) {
      return _buildSummary();
    }
    final card = widget.cards[_index];
    // Predict intervals for all 4 ratings
    final prediction = _predictIntervals(card);
    return Scaffold(
      appBar: AppBar(
        title: Text('${_index + 1} / ${widget.cards.length}'),
        actions: [
          if (_index > 0)
            IconButton(
              icon: const Icon(Icons.arrow_back),
              tooltip: 'Anterior (Esc)',
              onPressed: () => setState(() {
                _index = (_index - 1).clamp(0, widget.cards.length);
                _showAnswer = false;
                _cardStartTime = DateTime.now();
              }),
            ),
        ],
      ),
      body: GestureDetector(
        onTap: () {
          if (!_showAnswer) {
            setState(() { _showAnswer = true; });
            HapticFeedback.lightImpact();
          }
        },
        child: _buildCard(card),
      ),
      bottomNavigationBar: _showAnswer
          ? _build4ButtonActions(card, prediction)
          : const SizedBox.shrink(),
    );
  }

  Widget _buildCard(Flashcard card) {
    return Container(
      margin: const EdgeInsets.all(20),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: _showAnswer
            ? Colors.green.shade50
            : Theme.of(context).colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: _showAnswer ? Colors.green : Theme.of(context).colorScheme.primary,
          width: 2,
        ),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _showAnswer ? 'Respuesta' : 'Pregunta',
              style: TextStyle(
                fontSize: 12, fontWeight: FontWeight.bold,
                color: _showAnswer
                    ? Colors.green.shade700
                    : Theme.of(context).colorScheme.primary,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              _showAnswer ? card.answer : card.question,
              style: const TextStyle(fontSize: 20, height: 1.4),
            ),
            const SizedBox(height: 16),
            if (!_showAnswer)
              const Text('👆 Tocá para voltear',
                style: TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  /// v0.46: 4 buttons con colores semánticos + intervalo predicho.
  /// Anki-style layout: button grande con label y "next interval" abajo.
  Widget _build4ButtonActions(Flashcard card, FsrsReviewResult prediction) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(top: BorderSide(color: Theme.of(context).dividerColor)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Mostrar FSRS info (current D/S/R)
            _buildFsrsInfo(prediction),
            const SizedBox(height: 12),
            Row(
              children: [
                _buildRatingButton(
                  context: context,
                  rating: FsrsRating.again,
                  label: 'Again',
                  shortcut: '1',
                  days: prediction.daysFor(FsrsRating.again),
                  color: _RatingColors.again,
                  icon: Icons.refresh,
                  onPressed: () => _rateCard(card, FsrsRating.again),
                ),
                _buildRatingButton(
                  context: context,
                  rating: FsrsRating.hard,
                  label: 'Hard',
                  shortcut: '2',
                  days: prediction.daysFor(FsrsRating.hard),
                  color: _RatingColors.hard,
                  icon: Icons.trending_down,
                  onPressed: () => _rateCard(card, FsrsRating.hard),
                ),
                _buildRatingButton(
                  context: context,
                  rating: FsrsRating.good,
                  label: 'Good',
                  shortcut: '3',
                  days: prediction.daysFor(FsrsRating.good),
                  color: _RatingColors.good,
                  icon: Icons.check,
                  onPressed: () => _rateCard(card, FsrsRating.good),
                ),
                _buildRatingButton(
                  context: context,
                  rating: FsrsRating.easy,
                  label: 'Easy',
                  shortcut: '4',
                  days: prediction.daysFor(FsrsRating.easy),
                  color: _RatingColors.easy,
                  icon: Icons.trending_up,
                  onPressed: () => _rateCard(card, FsrsRating.easy),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFsrsInfo(FsrsReviewResult prediction) {
    final card = widget.cards[_index];
    final r = _fsrs.currentRetrievability(_cardToFsrsCard(card), DateTime.now());
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _fsrsStat('S', card.stability.toStringAsFixed(1)),
          _fsrsStat('D', card.difficulty.toStringAsFixed(1)),
          _fsrsStat('R', '${(r * 100).toInt()}%'),
          _fsrsStat('Reps', card.reps.toString()),
        ],
      ),
    );
  }

  Widget _fsrsStat(String label, String value) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: const TextStyle(fontSize: 10, color: Colors.grey)),
        Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _buildRatingButton({
    required BuildContext context,
    required FsrsRating rating,
    required String label,
    required String shortcut,
    required int days,
    required Color color,
    required IconData icon,
    required VoidCallback onPressed,
  }) {
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Material(
          color: color,
          borderRadius: BorderRadius.circular(12),
          elevation: 2,
          child: InkWell(
            onTap: onPressed,
            onLongPress: () {
              // Long press: show details
              showDialog(
                context: context,
                builder: (_) => AlertDialog(
                  title: Text('$label (shortcut: $shortcut)'),
                  content: Text('Next review in: $days days\n\n'
                      'Tap to choose this rating.'),
                  actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
                ),
              );
            },
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, color: Colors.white, size: 22),
                  const SizedBox(height: 4),
                  Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    days >= 365 ? '${(days / 365).toStringAsFixed(1)}y' :
                    days >= 30 ? '${(days / 30).toStringAsFixed(1)}mo' : '${days}d',
                    style: const TextStyle(color: Colors.white70, fontSize: 11),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSummary() {
    final total = _correct + _incorrect;
    final accuracy = total == 0 ? 0 : ((_correct / total) * 100).toInt();
    return Scaffold(
      appBar: AppBar(title: const Text('Repaso completado')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.celebration, size: 80, color: Colors.green),
            const SizedBox(height: 20),
            Text('¡Buen trabajo!', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
            Text('Repasaste $total tarjetas'),
            Text('Precisión: $accuracy%'),
            const SizedBox(height: 32),
            FilledButton.icon(
              icon: const Icon(Icons.home),
              label: const Text('Volver'),
              onPressed: () {
                if (widget.onFinish != null) widget.onFinish!();
                Navigator.of(context).pop();
              },
            ),
          ],
        ),
      ),
    );
  }

  // ── FSRS logic ─────────────────────────────────

  /// Convert legacy Flashcard to FsrsCard.
  FsrsCard _cardToFsrsCard(Flashcard card) {
    return FsrsCard(
      due: card.nextReview,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsedDays,
      scheduledDays: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      state: FsrsState.values[card.state],
      lastReview: card.lastReview,
    );
  }

  /// Predict next interval for all 4 ratings.
  FsrsReviewResult _predictIntervals(Flashcard card) {
    return _fsrs.repeat(_cardToFsrsCard(card), DateTime.now());
  }

  /// v0.46: rate card with FSRS instead of SM-2.
  Future<void> _rateCard(Flashcard card, FsrsRating rating) async {
    final now = DateTime.now();
    final duration = now.difference(_cardStartTime ?? now).inMilliseconds;

    // Haptic feedback diferenciado
    HapticFeedback.mediumImpact();
    if (rating == FsrsRating.again) {
      HapticFeedback.heavyImpact(); // Extra fuerte para lapse
    }

    // 1) Compute new state via FSRS
    final oldCard = _cardToFsrsCard(card);
    final result = _fsrs.repeat(oldCard, now);
    final newCard = result.forRating(rating);

    // 2) Update legacy Flashcard fields (para compat con backend/UI existente)
    final newDifficulty = _mapFsrsDifficultyToLegacy(newCard.difficulty);
    final newNextReview = newCard.due;

    // 3) Update via service
    if (rating == FsrsRating.again) {
      _incorrect++;
    } else {
      _correct++;
    }
    if (!card.approved) {
      await widget.service.approve(card);
    }
    await widget.service.updateMetadata(
      card,
      difficulty: newDifficulty,
      nextReview: newNextReview,
    );

    // 4) Persist in DB if available
    if (widget.db != null) {
      try {
        await widget.db!.updateCardState(
          cardId: card.id,
          stability: newCard.stability,
          difficulty: newCard.difficulty,
          retrievability: _fsrs.currentRetrievability(newCard, now),
          state: newCard.state.index,
          due: newCard.due,
          scheduledDays: newCard.scheduledDays,
          elapsedDays: newCard.elapsedDays,
          reps: newCard.reps,
          lapses: newCard.lapses,
          lastReview: now,
        );
        await widget.db!.insertReview(
          ReviewsCompanion.insert(
            cardId: card.id,
            rating: rating.value,
            durationMs: Value(duration),
            reviewedAt: now,
            prevState: oldCard.state.index,
            newState: newCard.state.index,
            prevStability: oldCard.stability,
            newStability: newCard.stability,
            prevDifficulty: oldCard.difficulty,
            newDifficulty: newCard.difficulty,
          ),
        );
      } catch (e) {
        // DB errors shouldn't block the review flow
        debugPrint('DB write failed (non-fatal): $e');
      }
    }

    _next();
  }

  /// Map FSRS difficulty (1-10) to legacy 1-5 scale for Flashcard.difficulty.
  int _mapFsrsDifficultyToLegacy(double fsrsD) {
    return (fsrsD / 2).round().clamp(1, 5);
  }

  void _next() {
    _cardStartTime = DateTime.now();
    setState(() {
      _index++;
      _showAnswer = false;
    });
  }
}

/// Colores semánticos para ratings (Material 3 compatible).
/// Sigue convención de Anki: Again=red, Hard=orange, Good=green, Easy=blue.
class _RatingColors {
  static const again = Color(0xFFE53935); // red 600
  static const hard = Color(0xFFFB8C00);  // orange 600
  static const good = Color(0xFF43A047);  // green 600
  static const easy = Color(0xFF1E88E5);  // blue 600
}
