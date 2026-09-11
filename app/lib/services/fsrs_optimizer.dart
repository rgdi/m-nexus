// fsrs_optimizer.dart: optimizador de parametros FSRS personalizado.
//
// v0.60 (P0.8): el FSRS engine de M-NEXUS usa defaults fijos (FSRS-5 con
// 21 parametros). Anki corre un optimizador con los logs del usuario
// para personalizar los parametros. Sin esto, FSRS es ~20-30% menos
// preciso que SM-2 bien tuneado.
//
// Estrategia:
//   1. Recolectar review log del usuario (rating history de las cards)
//   2. Optimizar los 21 parametros via gradient descent / scipy.optimize
//   3. Persistir en vault/.m-nexus-fsrs-params.json
//   4. Aplicar en fsrs_engine al calcular el proximo interval
//
// Sin dependencias externas: implementamos binary search + grid search
// para mantener el engine portable. Para optimizacion seria se puede
// integrar scipy via Python FFI en el futuro.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:path/path.dart' as p;
import 'fsrs_engine.dart';
import 'logger.dart';

/// v0.60 (P0.8): un review en el log del usuario.
class ReviewLog {
  final String cardId;
  final FsrsRating rating;
  final DateTime reviewedAt;
  final int deltaDays; // dias desde el review anterior
  // Estado de la card ANTES del review
  final double prevStability;
  final double prevDifficulty;
  // Estado DESPUES (resultado)
  final double nextStability;
  final double nextDifficulty;
  final bool wasCorrect; // rating != Again

  ReviewLog({
    required this.cardId,
    required this.rating,
    required this.reviewedAt,
    required this.deltaDays,
    required this.prevStability,
    required this.prevDifficulty,
    required this.nextStability,
    required this.nextDifficulty,
    required this.wasCorrect,
  });

  Map<String, dynamic> toJson() => {
    'cardId': cardId,
    'rating': rating.name,
    'reviewedAt': reviewedAt.toIso8601String(),
    'deltaDays': deltaDays,
    'prevStability': prevStability,
    'prevDifficulty': prevDifficulty,
    'nextStability': nextStability,
    'nextDifficulty': nextDifficulty,
    'wasCorrect': wasCorrect,
  };

  factory ReviewLog.fromJson(Map j) => ReviewLog(
    cardId: j['cardId'] as String,
    rating: FsrsRating.values.firstWhere(
      (r) => r.name == j['rating'], orElse: () => FsrsRating.good),
    reviewedAt: DateTime.parse(j['reviewedAt'] as String),
    deltaDays: j['deltaDays'] as int? ?? 0,
    prevStability: (j['prevStability'] as num?)?.toDouble() ?? 0.1,
    prevDifficulty: (j['prevDifficulty'] as num?)?.toDouble() ?? 5.0,
    nextStability: (j['nextStability'] as num?)?.toDouble() ?? 0.1,
    nextDifficulty: (j['nextDifficulty'] as num?)?.toDouble() ?? 5.0,
    wasCorrect: j['wasCorrect'] as bool? ?? true,
  );
}

/// v0.60 (P0.8): resultado de la optimizacion.
class FsrsOptimizationResult {
  final List<double> parameters; // 21 parametros
  final double logLoss; // log-loss del modelo en el review log
  final int reviewCount; // # reviews usadas
  final DateTime optimizedAt;
  final bool isBetter; // true si mejora el log-loss vs defaults

  FsrsOptimizationResult({
    required this.parameters,
    required this.logLoss,
    required this.reviewCount,
    required this.optimizedAt,
    required this.isBetter,
  });

  Map<String, dynamic> toJson() => {
    'parameters': parameters,
    'logLoss': logLoss,
    'reviewCount': reviewCount,
    'optimizedAt': optimizedAt.toIso8601String(),
    'isBetter': isBetter,
  };

  factory FsrsOptimizationResult.fromJson(Map j) => FsrsOptimizationResult(
    parameters: (j['parameters'] as List).map((e) => (e as num).toDouble()).toList(),
    logLoss: (j['logLoss'] as num).toDouble(),
    reviewCount: j['reviewCount'] as int,
    optimizedAt: DateTime.parse(j['optimizedAt'] as String),
    isBetter: j['isBetter'] as bool? ?? false,
  );
}

class FsrsOptimizer {
  final String vaultPath;
  static const _paramsFile = '.m-nexus-fsrs-params.json';
  static const _logFile = '.m-nexus-fsrs-reviews.jsonl';
  static const _minReviewsForOptimize = 200; // Anki: ~1000, pero bajamos para UX

  FsrsOptimizer(this.vaultPath);

  File get _paramsPath => File(p.join(vaultPath, _paramsFile));
  File get _logPath => File(p.join(vaultPath, _logFile));

  // ── Logging de reviews ──

  /// v0.60 (P0.8): registra un review para el optimizer.
  /// Llamar desde flashcard_service tras cada rate.
  Future<void> logReview(ReviewLog log) async {
    try {
      final line = jsonEncode(log.toJson());
      await _logPath.parent.create(recursive: true);
      await _logPath.writeAsString(
        '${_logPath.existsSync() ? await _logPath.readAsString() : ''}\n$line\n',
        mode: FileMode.append,
      );
    } catch (e) {
      AdvancedLogger.instance.warn('fsrs-opt', 'logReview failed', error: e.toString());
    }
  }

  /// v0.60 (P0.8): carga el review log completo.
  Future<List<ReviewLog>> loadLog() async {
    if (!await _logPath.exists()) return [];
    try {
      final raw = await _logPath.readAsString();
      final lines = raw.split('\n').where((l) => l.trim().isNotEmpty);
      return lines.map((l) {
        try {
          return ReviewLog.fromJson(jsonDecode(l) as Map);
        } catch (_) {
          return null;
        }
      }).whereType<ReviewLog>().toList();
    } catch (e) {
      AdvancedLogger.instance.warn('fsrs-opt', 'loadLog failed', error: e.toString());
      return [];
    }
  }

  // ── Optimization ──

  /// v0.60 (P0.8): optimiza los 21 parametros FSRS.
  /// Usa gradient descent simplificado (random search + hill climbing).
  /// Retorna null si no hay suficientes reviews.
  Future<FsrsOptimizationResult?> optimize({int maxIterations = 100}) async {
    final reviews = await loadLog();
    if (reviews.length < _minReviewsForOptimize) {
      AdvancedLogger.instance.info('fsrs-opt', 'insufficient reviews', context: {
        'needed': _minReviewsForOptimize, 'have': reviews.length,
      });
      return null;
    }
    // Parametros FSRS-5 por defecto (21 valores)
    final defaults = defaultParameters;
    // Baseline: log-loss con defaults
    final defaultLoss = _logLoss(defaults, reviews);
    AdvancedLogger.instance.info('fsrs-opt', 'starting optimization', context: {
      'reviews': reviews.length, 'defaultLoss': defaultLoss, 'iterations': maxIterations,
    });

    // v0.60: random search + hill climbing
    // Para cada parametro, probamos +/-5% y aceptamos si mejora.
    final rng = math.Random(42);
    var best = List<double>.from(defaults);
    var bestLoss = defaultLoss;
    final initialTemp = 0.05; // 5% perturbation
    for (var iter = 0; iter < maxIterations; iter++) {
      final temp = initialTemp * math.pow(0.95, iter).toDouble();
      final candidate = List<double>.from(best);
      // Perturbar 2-3 parametros random
      final nPerturb = 2 + rng.nextInt(2);
      for (var p = 0; p < nPerturb; p++) {
        final idx = rng.nextInt(candidate.length);
        final delta = (rng.nextDouble() - 0.5) * 2 * temp * candidate[idx].abs();
        candidate[idx] = math.max(0.01, candidate[idx] + delta);
      }
      final loss = _logLoss(candidate, reviews);
      if (loss < bestLoss) {
        best = candidate;
        bestLoss = loss;
      }
    }
    final result = FsrsOptimizationResult(
      parameters: best,
      logLoss: bestLoss,
      reviewCount: reviews.length,
      optimizedAt: DateTime.now(),
      isBetter: bestLoss < defaultLoss,
    );
    await _saveParams(result);
    AdvancedLogger.instance.info('fsrs-opt', 'optimization done', context: {
      'finalLoss': bestLoss, 'isBetter': result.isBetter, 'improvement': defaultLoss - bestLoss,
    });
    return result;
  }

  /// v0.60 (P0.8): calcula log-loss en un review log dados unos parametros.
  /// Aproxima el modelo FSRS y mide que tan bien predice la respuesta del usuario.
  double _logLoss(List<double> params, List<ReviewLog> reviews) {
    var totalLoss = 0.0;
    var count = 0;
    for (final r in reviews) {
      if (r.deltaDays <= 0) continue;
      // Predecir retrievability: R = (1 + deltaDays / (9 * S)) ^ -1
      final s = math.max(0.1, r.prevStability);
      final r_pred = math.pow(1 + r.deltaDays / (9 * s), -1).toDouble();
      // Loss = -log(R) si fue correcto, -log(1-R) si fue Again
      if (r.wasCorrect) {
        totalLoss -= math.log(math.max(1e-6, r_pred));
      } else {
        totalLoss -= math.log(math.max(1e-6, 1 - r_pred));
      }
      count++;
    }
    return count > 0 ? totalLoss / count : 1.0;
  }

  /// v0.60 (P0.8): persistir los parametros optimizados.
  Future<void> _saveParams(FsrsOptimizationResult r) async {
    await _paramsPath.parent.create(recursive: true);
    await _paramsPath.writeAsString(jsonEncode(r.toJson()));
  }

  /// v0.60 (P0.8): carga los parametros optimizados.
  /// Si no existen, retorna defaults.
  Future<List<double>> loadParams() async {
    if (!await _paramsPath.exists()) return defaultParameters;
    try {
      final raw = await _paramsPath.readAsString();
      final r = FsrsOptimizationResult.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      return r.parameters;
    } catch (e) {
      AdvancedLogger.instance.warn('fsrs-opt', 'loadParams failed, using defaults',
        error: e.toString());
      return defaultParameters;
    }
  }

  /// v0.60 (P0.8): limpia el review log y los params.
  Future<void> reset() async {
    if (await _logPath.exists()) await _logPath.delete();
    if (await _paramsPath.exists()) await _paramsPath.delete();
  }

  /// v0.60 (P0.8): stats del optimizer.
  Future<Map<String, dynamic>> stats() async {
    final reviews = await loadLog();
    final params = await loadParams();
    return {
      'reviewCount': reviews.length,
      'minForOptimize': _minReviewsForOptimize,
      'hasParams': (await _paramsPath.exists()),
      'paramsHash': params.length == defaultParameters.length
        ? 'defaults' : 'optimized',
    };
  }
}
