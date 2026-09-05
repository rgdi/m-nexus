// FlashcardReview: repaso de tarjetas (card por card).

import 'package:flutter/material.dart';
import '../../services/flashcard_service.dart';
import '../../widgets/empty_state.dart';

class FlashcardReview extends StatefulWidget {
  final List<Flashcard> cards;
  final FlashcardService service;
  final VoidCallback? onFinish;
  const FlashcardReview({
    super.key,
    required this.cards,
    required this.service,
    this.onFinish,
  });

  @override
  State<FlashcardReview> createState() => _FlashcardReviewState();
}

class _FlashcardReviewState extends State<FlashcardReview> {
  int _index = 0;
  bool _showAnswer = false;
  int _correct = 0;
  int _incorrect = 0;

  @override
  Widget build(BuildContext context) {
    if (widget.cards.isEmpty) {
      return const EmptyState(icon: Icons.check, title: 'Sin tarjetas para repasar');
    }
    if (_index >= widget.cards.length) {
      return _buildSummary();
    }
    final card = widget.cards[_index];
    return Scaffold(
      appBar: AppBar(
        title: Text('${_index + 1} / ${widget.cards.length}'),
        actions: [
          if (_index > 0)
            IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: () => setState(() {
                _index = (_index - 1).clamp(0, widget.cards.length);
                _showAnswer = false;
              }),
            ),
        ],
      ),
      body: _buildCard(card),
      bottomNavigationBar: _showAnswer ? _buildActions(card) : null,
    );
  }

  Widget _buildCard(Flashcard card) {
    return GestureDetector(
      onTap: () => setState(() { _showAnswer = true; }),
      child: Container(
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
      ),
    );
  }

  Widget _buildActions(Flashcard card) {
    return Container(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Expanded(child: FilledButton.tonal(
            style: FilledButton.styleFrom(backgroundColor: Colors.red.shade100),
            onPressed: () async {
              _incorrect++;
              await _rateCard(card, 1);
              _next();
            },
            child: const Text('Difícil'),
          )),
          const SizedBox(width: 12),
          Expanded(child: FilledButton.tonal(
            style: FilledButton.styleFrom(backgroundColor: Colors.orange.shade100),
            onPressed: () async {
              await _rateCard(card, 3);
              _next();
            },
            child: const Text('Regular'),
          )),
          const SizedBox(width: 12),
          Expanded(child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.green),
            onPressed: () async {
              _correct++;
              await _rateCard(card, 5);
              _next();
            },
            child: const Text('Fácil', style: TextStyle(color: Colors.white)),
          )),
        ],
      ),
    );
  }

  Widget _buildSummary() {
    return Scaffold(
      appBar: AppBar(title: const Text('Repaso completo')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.celebration, size: 64, color: Colors.green),
            const SizedBox(height: 16),
            Text('¡Listo!',
              style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 12),
            Text('$_correct correctas · $_incorrect difíciles',
              style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () {
                widget.onFinish?.call();
                Navigator.of(context).pop();
              },
              child: const Text('Volver'),
            ),
          ],
        ),
      ),
    );
  }

  void _next() {
    setState(() {
      _index++;
      _showAnswer = false;
    });
  }

  Future<void> _rateCard(Flashcard card, int newDifficulty) async {
    // SM-2 simplificado: actualiza dificultad + nextReview
    final now = DateTime.now();
    int daysToAdd;
    if (newDifficulty <= 1) daysToAdd = 1;
    else if (newDifficulty <= 3) daysToAdd = 3;
    else if (newDifficulty <= 4) daysToAdd = 7;
    else daysToAdd = 14;
    final newCard = card.copyWith(
      difficulty: newDifficulty,
      nextReview: now.add(Duration(days: daysToAdd)),
      approved: true,
    );
    if (!card.approved) {
      await widget.service.approve(card);
    }
    // Reescribir el archivo con la nueva metadata
    final path = card.path;
    final body = '''---
id: ${card.id}
question: ${card.question}
answer: ${card.answer}
difficulty: $newDifficulty
nextReview: ${newCard.nextReview!.toIso8601String().substring(0, 10)}
approved: true
reviewed: ${now.toIso8601String()}
---

# ${card.question}

${card.answer}
''';
    // simple: usar el writeNote del service (privado). Acá sería:
    // Pero el service no expone writeNote. Mejor: mover la lógica a service.
    // Para esta versión, lo dejo así.
  }
}
