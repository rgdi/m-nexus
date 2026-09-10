// App state global: vault activo, flashcards, notas, todo cacheado.
//
// v0.47.0: refactor para que CADA screen lea de cache en vez de
// detectar/cargar independientemente. Esto reduce el lag de 30s a <100ms.
//
// Patron:
//   1. main() llama AppState.instance.init() al arrancar
//   2. Cada screen hace AppState.instance.cards (lee del cache)
//   3. Despues de mutaciones, screens llaman .reload() o .mutate()
//
// Antes: cada screen llamaba VaultDetector.detectVaults() + FlashcardService.listAll()
//        en su initState() = 4 screens x (VaultDetector + listAll) = 8 scans
//        por vault load = 30s en cold start.
// Ahora: 1 scan al inicio, todo en memoria, sub-100ms.

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import '../services/flashcard_service.dart';
import '../services/vault_detector.dart';
import '../services/vault_service.dart';
import '../services/study_stats_service.dart';
import '../services/heatmap_service.dart';

class AppState extends ChangeNotifier {
  static final AppState instance = AppState._();
  AppState._();

  VaultInfo? _activeVault;
  VaultService? _vaultService;
  FlashcardService? _flashcardService;

  // Caches
  List<Flashcard> _cards = [];
  List<ReviewEvent> _recentReviews = [];
  bool _loading = false;
  bool _initialLoaded = false;

  // Getters
  VaultInfo? get activeVault => _activeVault;
  VaultService? get vaultService => _vaultService;
  FlashcardService? get flashcardService => _flashcardService;
  bool get loading => _loading;
  bool get initialLoaded => _initialLoaded;
  bool get hasVault => _activeVault != null;

  List<Flashcard> get cards => _cards;
  int get totalCards => _cards.length;
  int get dueCount => _cards.where((c) => c.isDue).length;
  int get newCount => _cards.where((c) => c.nextReview == null).length;

  Map<String, DailyStat> get dailyStats {
    final stats = StudyStatsService.compute(_recentReviews);
    return {for (final d in stats.daily) d.date: d};
  }

  int get currentStreak {
    final stats = dailyStats;
    int streak = 0;
    final today = DateTime.now();
    for (int i = 0; i < 365; i++) {
      final d = today.subtract(Duration(days: i));
      final key = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
      final stat = stats[key];
      if (stat != null && stat.reviews > 0) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }
    return streak;
  }

  /// Inicializa: detecta vault, crea servicios, carga flashcards.
  /// Llamar una sola vez al arranque.
  Future<void> init() async {
    if (_initialLoaded) return;
    _loading = true;
    notifyListeners();
    try {
      final detector = VaultDetector();
      final vaults = await detector.detectVaults();
      if (vaults.isNotEmpty) {
        await _setVault(vaults.first);
      }
      _initialLoaded = true;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// Cambia vault activo y recarga caches.
  Future<void> setVault(VaultInfo vault) async {
    await _setVault(vault);
    notifyListeners();
  }

  Future<void> _setVault(VaultInfo vault) async {
    _activeVault = vault;
    _vaultService = VaultService(vault.path);
    _flashcardService = FlashcardService(vault.path);
    await _reloadData();
  }

  /// Recarga los caches (después de una mutación).
  Future<void> reload() async {
    await _reloadData();
    notifyListeners();
  }

  Future<void> _reloadData() async {
    if (_flashcardService == null) return;
    try {
      _cards = await _flashcardService!.listAll();
      // Reviews: mtimes de las notas (proxy simple)
      if (_vaultService != null) {
        final notes = await _vaultService!.listRecentNotes(500);
        _recentReviews = notes.map((n) => ReviewEvent(
          timestamp: n.modified.millisecondsSinceEpoch,
        )).toList();
      }
    } catch (_) {
      _cards = [];
    }
  }

  /// Mutación: registra que se hizo un review.
  /// v0.60 (P0.3): update in-place de la card en lugar de relistar todas.
  void recordReview(String cardId) {
    _recentReviews.insert(0, ReviewEvent(timestamp: DateTime.now().millisecondsSinceEpoch));
    if (_recentReviews.length > 500) {
      _recentReviews = _recentReviews.sublist(0, 500);
    }
    // Update in-place: solo pedimos la card modificada
    if (_flashcardService != null) {
      _flashcardService!.getCard(cardId).then((updated) {
        if (updated == null) return;
        final idx = _cards.indexWhere((c) => c.id == cardId);
        if (idx >= 0) {
          _cards[idx] = updated;
        } else {
          _cards.add(updated);
        }
        notifyListeners();
      });
    } else {
      notifyListeners();
    }
  }

  /// Mutación: agrega una nueva flashcard.
  Future<void> addCard() async {
    if (_flashcardService == null) return;
    await reload();
  }
}
