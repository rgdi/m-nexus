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

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:path/path.dart' as p;
import '../../services/ai_tutor_client.dart';
import '../../services/flashcard_service.dart';
import '../../services/fsrs_engine.dart';
import '../../services/fsrs_optimizer.dart';
import '../../services/settings_service.dart';
import '../../services/vault_service.dart';
import '../../widgets/empty_state.dart';
import 'dart:async';

class FlashcardReview extends StatefulWidget {
  final List<Flashcard> cards;
  final FlashcardService service;
  final FsrsEngine? fsrs; // Opcional: inyectar engine (default fsrs5)
  final VoidCallback? onFinish;
  // v0.48.3: callback cuando el usuario quiere abrir la nota fuente.
  final void Function(String sourceNotePath)? onNoteOpen;
  // v0.48.3: callback para abrir imagen/vídeo embebido en la card.
  final void Function(String mediaPath)? onMediaOpen;
  // v0.48.3: vaultPath para resolver sourceNote (puede ser absoluto o
  // relativo). Si no se da, sourceNote se trata como absoluto.
  final String? vaultPath;

  const FlashcardReview({
    super.key,
    required this.cards,
    required this.service,
    this.fsrs,
    this.onFinish,
    this.onNoteOpen,
    this.onMediaOpen,
    this.vaultPath,
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

  // ── FASE 3: state for note snippet, generate-more, and inline tutor ──
  String? _sourceNoteSnippet;
  bool _generatingMore = false;
  bool _tutorOpen = false;
  String? _tutorQuestion;
  final List<Map<String, String>> _tutorMessages = [];

  /// v0.48.3: nota fuente resuelta (absoluta) de la card actual.
  String? get _currentSourceNote {
    if (_index >= widget.cards.length) return null;
    final card = widget.cards[_index];
    final src = card.sourceNote;
    if (src == null || src.isEmpty) return null;
    if (widget.vaultPath == null || widget.vaultPath!.isEmpty) return src;
    // Si es relativa, unirla con vaultPath.
    if (!src.startsWith('/')) {
      return '${widget.vaultPath}/$src';
    }
    return src;
  }

  /// v0.48.3: path de media embebido de la card actual.
  String? get _currentMediaPath {
    if (_index >= widget.cards.length) return null;
    final card = widget.cards[_index];
    final mp = card.mediaPath;
    if (mp == null || mp.isEmpty) return null;
    if (widget.vaultPath == null || widget.vaultPath!.isEmpty) return mp;
    if (!mp.startsWith('/')) {
      return '${widget.vaultPath}/$mp';
    }
    return mp;
  }

  @override
  void initState() {
    super.initState();
    _fsrs = widget.fsrs ?? FsrsEngine.fsrs5();
    _cardStartTime = DateTime.now();
    // FASE 3: precarga snippet de la nota fuente de la primera card.
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadSourceNoteSnippet());
  }

  @override
  void dispose() {
    // Session tracking removed in v0.46.7 (drift DB was removed)
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
          // v0.48.3: botón para abrir la nota fuente de la card actual.
          if (widget.onNoteOpen != null && _currentSourceNote != null)
            IconButton(
              icon: const Icon(Icons.open_in_new),
              tooltip: 'Ver nota fuente',
              onPressed: () {
                final src = _currentSourceNote!;
                if (src.isEmpty) return;
                widget.onNoteOpen!(src);
              },
            ),
          // v0.48.3: botón para abrir media embebido en la card.
          if (widget.onMediaOpen != null && _currentMediaPath != null)
            IconButton(
              icon: const Icon(Icons.image),
              tooltip: 'Ver imagen',
              onPressed: () {
                final mp = _currentMediaPath!;
                if (mp.isEmpty) return;
                widget.onMediaOpen!(mp);
              },
            ),
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
            // FASE 3: snippet de la nota fuente arriba de la pregunta.
            if (!_showAnswer && _sourceNoteSnippet != null)
              _buildSourceSnippet(),
            const SizedBox(height: 8),
            Text(
              _showAnswer ? card.answer : card.question,
              style: const TextStyle(fontSize: 20, height: 1.4),
            ),
            const SizedBox(height: 16),
            if (!_showAnswer)
              const Text('👆 Tocá para voltear',
                style: TextStyle(color: Colors.grey, fontSize: 12)),
            // FASE 3: acciones contextuales (sólo si hay nota fuente).
            if (_currentSourceNote != null && !_showAnswer)
              _buildContextualActions(),
            // FASE 3: panel inline del tutor (3 respuestas).
            if (_tutorOpen) _buildInlineTutor(),
          ],
        ),
      ),
    );
  }

  /// FASE 3: snippet de la nota fuente como contexto arriba de la pregunta.
  Widget _buildSourceSnippet() {
    final src = _currentSourceNote;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface.withOpacity(0.55),
        borderRadius: BorderRadius.circular(8),
        border: Border(
          left: BorderSide(
            color: Theme.of(context).colorScheme.secondary,
            width: 3,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.article_outlined,
                  size: 14,
                  color: Theme.of(context).colorScheme.secondary),
              const SizedBox(width: 6),
              const Text('Contexto',
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: Colors.grey)),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            _sourceNoteSnippet ?? '',
            style: const TextStyle(
                fontSize: 12, fontStyle: FontStyle.italic, height: 1.35),
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
          ),
          if (src != null && widget.onNoteOpen != null)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () {
                  final p = _currentSourceNote;
                  if (p != null && p.isNotEmpty) widget.onNoteOpen!(p);
                },
                icon: const Icon(Icons.open_in_new, size: 12),
                label: const Text('Ver nota',
                    style: TextStyle(fontSize: 11)),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 6, vertical: 0),
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ),
        ],
      ),
    );
  }

  /// FASE 3: botones contextuales — Generar más / Tutor.
  Widget _buildContextualActions() {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _generatingMore ? null : _generateMoreQuestions,
              icon: _generatingMore
                  ? const SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(strokeWidth: 1.5))
                  : const Icon(Icons.auto_awesome, size: 14),
              label: Text(_generatingMore
                  ? 'Generando…'
                  : 'Generar más preguntas',
                  style: const TextStyle(fontSize: 11)),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 6),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _openTutor,
              icon: const Icon(Icons.psychology_outlined, size: 14),
              label: const Text('Tutor',
                  style: TextStyle(fontSize: 11)),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 6),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// FASE 3: panel inline de mini-tutor (3 respuestas contextuales).
  Widget _buildInlineTutor() {
    return Container(
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.psychology, size: 14),
              const SizedBox(width: 6),
              const Text('Mini-Tutor',
                  style: TextStyle(
                      fontSize: 12, fontWeight: FontWeight.bold)),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.close, size: 14),
                onPressed: () => setState(() {
                  _tutorOpen = false;
                  _tutorMessages.clear();
                }),
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                tooltip: 'Cerrar tutor',
              ),
            ],
          ),
          const SizedBox(height: 4),
          // Sugerencias contextuales (chips) — sólo si no hay respuestas.
          if (_tutorMessages.isEmpty) ...[
            const Text('Pregunta sugerida:',
                style: TextStyle(fontSize: 11, color: Colors.grey)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: const [
                '¿Podés explicarme con un ejemplo?',
                '¿Confusión típica?',
                '¿Cómo se conecta con el tema?',
              ].map((q) => ActionChip(
                label: Text(q, style: const TextStyle(fontSize: 11)),
                onPressed: () => _askTutor(q),
                visualDensity: VisualDensity.compact,
              )).toList(),
            ),
          ] else ...[
            // Hasta 3 últimas respuestas para mantenerlo compacto.
            for (final m in _tutorMessages.length > 3
                ? _tutorMessages.sublist(_tutorMessages.length - 3)
                : _tutorMessages)
              Container(
                margin: const EdgeInsets.symmetric(vertical: 4),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: m['role'] == 'user'
                      ? Theme.of(context).colorScheme.primaryContainer
                      : Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${m['role'] == 'user' ? 'Vos' : 'Tutor'}: ${m['content']}',
                  style: const TextStyle(fontSize: 12, height: 1.35),
                ),
              ),
          ],
        ],
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
      due: card.nextReview ?? DateTime.now(),
      stability: card.stability,
      difficulty: card.difficulty.toDouble(),
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

    // v0.60 (P0.8): log review for FSRS optimizer
    if (widget.vaultPath != null) {
      try {
        final optimizer = FsrsOptimizer(widget.vaultPath!);
        await optimizer.logReview(ReviewLog(
          cardId: card.id,
          rating: rating,
          reviewedAt: now,
          deltaDays: oldCard.elapsedDays,
          prevStability: oldCard.stability,
          prevDifficulty: oldCard.difficulty,
          nextStability: newCard.stability,
          nextDifficulty: newCard.difficulty,
          wasCorrect: rating != FsrsRating.again,
        ));
      } catch (e) {
        // Silencioso: el optimizer es best-effort
      }
    }

    // v0.46.7: DB persistence removed (drift/SQLite deprecated)
    // FSRS state is now managed entirely in-memory via widget.service
    // and re-persisted via the FlashcardService (markdown frontmatter).

    // v0.47.23: mounted check antes de _next() (que llama setState).
    if (!mounted) return;
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
      // FASE 3: limpia snippet y mini-tutor al pasar de card.
      _sourceNoteSnippet = null;
      _tutorOpen = false;
      _tutorMessages.clear();
      _tutorQuestion = null;
    });
    // FASE 3: recarga snippet para la nueva card.
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadSourceNoteSnippet());
  }

  // ── FASE 3: snippet de la nota fuente (2-3 líneas relevantes) ─────────

  Future<void> _loadSourceNoteSnippet() async {
    final src = _currentSourceNote;
    if (src == null) {
      if (mounted) setState(() => _sourceNoteSnippet = null);
      return;
    }
    if (widget.vaultPath == null || widget.vaultPath!.isEmpty) {
      // No hay vault: no podemos leer la nota.
      if (mounted) setState(() => _sourceNoteSnippet = null);
      return;
    }
    try {
      final vault = VaultService(widget.vaultPath!);
      final note = await vault.readNote(src);
      if (!mounted) return;
      if (note == null) {
        setState(() => _sourceNoteSnippet = null);
        return;
      }
      // Tomamos 2-3 líneas que contengan keywords de la pregunta.
      final card = widget.cards[_index];
      final snippet = _extractSnippet(note.content, card.question);
      setState(() => _sourceNoteSnippet = snippet);
    } catch (e) {
      if (!mounted) return;
      setState(() => _sourceNoteSnippet = null);
    }
  }

  /// Extrae 2-3 líneas relevantes del contenido de la nota que contengan
  /// keywords de la pregunta de la flashcard. Si no encuentra, devuelve el
  /// primer párrafo no-vacío.
  String _extractSnippet(String content, String question) {
    final lines = content.split('\n');
    // Quita frontmatter y headings muy largos; recoge keywords.
    final qWords = question
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-záéíóúñü\s]'), ' ')
        .split(RegExp(r'\s+'))
        .where((w) => w.length >= 4)
        .toSet();
    final scored = <_ScoredLine>[];
    for (var i = 0; i < lines.length; i++) {
      final line = lines[i].trim();
      if (line.isEmpty || line.startsWith('#')) continue;
      final lower = line.toLowerCase();
      var score = 0;
      for (final w in qWords) {
        if (lower.contains(w)) score++;
      }
      if (score > 0) scored.add(_ScoredLine(i, line, score));
    }
    if (scored.isNotEmpty) {
      scored.sort((a, b) => b.score.compareTo(a.score));
      final picked = scored.take(3).toList()
        ..sort((a, b) => a.index.compareTo(b.index));
      return picked.map((s) => s.text).join(' / ');
    }
    // Fallback: primer párrafo no-vacío.
    for (final line in lines) {
      final t = line.trim();
      if (t.isNotEmpty && !t.startsWith('#')) return t;
    }
    return content.length > 200 ? '${content.substring(0, 200)}…' : content;
  }

  // ── FASE 3: "Generar más preguntas sobre este tema" ──────────────────

  Future<void> _generateMoreQuestions() async {
    final src = _currentSourceNote;
    if (src == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Esta flashcard no tiene nota fuente.')),
      );
      return;
    }
    if (widget.vaultPath == null || widget.vaultPath!.isEmpty) return;

    final settings = await SettingsService.instance.load();
    final backendUrl = settings.backendUrl;
    if (backendUrl == null || backendUrl.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Configura la URL del backend primero.')),
      );
      return;
    }

    setState(() => _generatingMore = true);
    try {
      // Lee la nota fuente para mandarla al backend.
      final vault = VaultService(widget.vaultPath!);
      final note = await vault.readNote(src);
      if (note == null) throw Exception('No se pudo leer la nota fuente');
      final title = (note.title != null && note.title!.isNotEmpty)
          ? note.title!
          : p.basename(src);

      final body = jsonEncode({
        'noteTitle': title,
        'noteContent': note.content,
        'frontmatter': note.frontmatter,
        'style': 'generic',
        'maxCards': 5,
      });
      final resp = await http.post(
        Uri.parse('$backendUrl/api/v1/flashcards/generate'),
        headers: {'Content-Type': 'application/json'},
        body: body,
      ).timeout(const Duration(seconds: 60));

      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        final json = jsonDecode(resp.body) as Map<String, dynamic>;
        final cards = (json['cards'] as List?) ?? [];
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                'Se generaron ${cards.length} borradores. Andá a Pendientes de revisión para aprobarlas.'),
            duration: const Duration(seconds: 4),
          ),
        );
      } else {
        throw Exception('Backend ${resp.statusCode}: ${resp.body}');
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error generando: $e')),
      );
    } finally {
      if (mounted) setState(() => _generatingMore = false);
    }
  }

  // ── FASE 3: mini-tutor inline (3 respuestas contextuales) ────────────

  Future<void> _askTutor(String userQuestion) async {
    final settings = await SettingsService.instance.load();
    final backendUrl = settings.backendUrl;
    if (backendUrl == null || backendUrl.isEmpty) {
      setState(() {
        _tutorMessages.add({
          'role': 'assistant',
          'content': 'Configura la URL del backend en Ajustes para usar el tutor.',
        });
      });
      return;
    }
    setState(() {
      _tutorMessages.add({'role': 'user', 'content': userQuestion});
    });
    try {
      // Contexto: la card misma + el snippet de la nota fuente.
      final ctx = StringBuffer()
        ..writeln('Flashcard Q: ${widget.cards[_index].question}')
        ..writeln('Flashcard A: ${widget.cards[_index].answer}');
      if (_sourceNoteSnippet != null && _sourceNoteSnippet!.isNotEmpty) {
        ctx
          ..writeln()
          ..writeln('Contexto de la nota fuente:')
          ..writeln(_sourceNoteSnippet!);
      }
      final client = AiTutorClient(backendUrl: backendUrl);
      final resp = await client.ask(userQuestion, context: ctx.toString());
      if (!mounted) return;
      setState(() {
        _tutorMessages.add(
            {'role': 'assistant', 'content': resp.answer});
      });
      client.close();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _tutorMessages.add(
            {'role': 'assistant', 'content': 'Error: $e'});
      });
    }
  }

  void _openTutor() {
    setState(() {
      _tutorOpen = true;
      _tutorMessages.clear();
      _tutorQuestion = null;
    });
    // 3 preguntas semilla contextuales.
    final seedQuestions = <String>[
      '¿Podés explicarme esta respuesta con un ejemplo?',
      '¿Qué confusión común tiene la gente con este concepto?',
      '¿Cómo se conecta esto con el resto del tema?',
    ];
    setState(() => _tutorQuestion = seedQuestions.first);
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

/// FASE 3: helper para ordenar líneas relevantes para el snippet.
class _ScoredLine {
  final int index;
  final String text;
  final int score;
  const _ScoredLine(this.index, this.text, this.score);
}
