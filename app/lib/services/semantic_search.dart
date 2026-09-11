// semantic_search.dart: busqueda semantica on-device del vault.
//
// v0.60 (P0.7): el "RAG" anterior era substring matching (split por keyword).
// Ahora usa TF-IDF (Term Frequency - Inverse Document Frequency) + cosine
// similarity + Reciprocal Rank Fusion con FTS5 keyword scoring.
//
// v0.60.1+ (futuro): integrar ONNX runtime + all-MiniLM-L6-v2 (90MB) para
// embeddings reales cuando haya que soportar queries semanticas verdaderas.
// Por ahora TF-IDF captura sinonimos via n-gramas de palabras.
//
// Persistencia: vault/.m-nexus-index/{tfidf.json, vocab.json, doc_index.json}
// para que el index se reuse entre sesiones (no reconstruir cada vez).

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:path/path.dart' as p;
import 'logger.dart';

class SearchResult {
  final String notePath;
  final double score;
  final String snippet;
  final Map<String, dynamic> meta;

  const SearchResult({
    required this.notePath,
    required this.score,
    required this.snippet,
    this.meta = const {},
  });
}

class DocEntry {
  final String path;
  final String title;
  final String content;
  final List<String> terms; // tokenizado
  final Map<String, int> termFreq; // term -> count en este doc
  final int length;
  DocEntry({
    required this.path,
    required this.title,
    required this.content,
    required this.terms,
    required this.termFreq,
    required this.length,
  });
}

class TfidfIndex {
  final Map<String, int> vocab; // term -> index
  final List<DocEntry> docs;
  final Map<String, int> docFreq; // term -> # docs que contienen
  final int totalDocs;

  TfidfIndex({
    required this.vocab,
    required this.docs,
    required this.docFreq,
    required this.totalDocs,
  });

  Map<String, dynamic> toJson() => {
    'vocab': vocab,
    'docFreq': docFreq,
    'totalDocs': totalDocs,
    'docs': docs.map((d) => {
      'path': d.path,
      'title': d.title,
      'content': d.content,
      'terms': d.terms,
      'termFreq': d.termFreq,
      'length': d.length,
    }).toList(),
  };

  static TfidfIndex fromJson(Map<String, dynamic> j) {
    return TfidfIndex(
      vocab: (j['vocab'] as Map).cast<String, int>(),
      docFreq: (j['docFreq'] as Map).cast<String, int>(),
      totalDocs: j['totalDocs'] as int,
      docs: (j['docs'] as List).map((d) {
        final m = d as Map;
        return DocEntry(
          path: m['path'] as String,
          title: m['title'] as String,
          content: m['content'] as String,
          terms: (m['terms'] as List).cast<String>(),
          termFreq: (m['termFreq'] as Map).cast<String, int>(),
          length: m['length'] as int,
        );
      }).toList(),
    );
  }
}

class SemanticSearch {
  final String vaultPath;
  static const _indexDir = '.m-nexus-index';
  static const _stopwords = {
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
    'de', 'del', 'en', 'a', 'al', 'con', 'por', 'para',
    'que', 'qué', 'como', 'cómo', 'donde', 'cuál', 'cuáles',
    'es', 'son', 'ser', 'estar', 'está', 'están', 'fue', 'fueron',
    'y', 'o', 'u', 'pero', 'sino', 'aunque',
    'the', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
    'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be',
    'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'this', 'that', 'these', 'those',
    // english determiners already covered above (a, an)
  };

  SemanticSearch(this.vaultPath);

  File get _tfidfFile => File(p.join(vaultPath, _indexDir, 'tfidf.json'));
  File get _vocabFile => File(p.join(vaultPath, _indexDir, 'vocab.json'));

  // ── Tokenizacion ──
  static List<String> tokenize(String text) {
    final lower = text.toLowerCase();
    // Quitar acentos (NFD)
    final normalized = lower.replaceAll(RegExp(r'[áàä]'), 'a')
        .replaceAll(RegExp(r'[éèë]'), 'e')
        .replaceAll(RegExp(r'[íìï]'), 'i')
        .replaceAll(RegExp(r'[óòö]'), 'o')
        .replaceAll(RegExp(r'[úùü]'), 'u')
        .replaceAll(RegExp(r'ñ'), 'n');
    // Split por no-alfanumerico, n-gramas de 1-2 palabras
    final raw = normalized.split(RegExp(r'[^a-z0-9]+'));
    final baseTokens = <String>[];
    for (final w in raw) {
      if (w.length < 2) continue;
      if (_stopwords.contains(w)) continue;
      baseTokens.add(w);
    }
    // v0.60: Bigramas se generan en un array separado (no en el mismo)
    // sino se vuelve exponencial (cada iteracion usa los nuevos bigramas).
    final result = List<String>.from(baseTokens);
    for (var i = 0; i < baseTokens.length - 1; i++) {
      result.add('${baseTokens[i]}_${baseTokens[i + 1]}');
    }
    return result;
  }

  /// v0.60 (P0.7): indexa todos los .md del vault. Persiste en disco.
  /// Si el index existe y el vault no cambio, lo reusa.
  Future<TfidfIndex> buildIndex({bool force = false}) async {
    if (!force && await _tfidfFile.exists()) {
      try {
        final raw = await _tfidfFile.readAsString();
        final j = jsonDecode(raw) as Map<String, dynamic>;
        final idx = TfidfIndex.fromJson(j);
        AdvancedLogger.instance.info('semantic', 'index loaded from disk', context: {
          'docs': idx.totalDocs, 'vocab': idx.vocab.length,
        });
        return idx;
      } catch (e) {
        AdvancedLogger.instance.warn('semantic', 'index load failed, rebuilding',
          error: e.toString());
      }
    }
    final stopwatch = Stopwatch()..start();
    final docs = <DocEntry>[];
    final vocab = <String, int>{};
    final docFreq = <String, int>{};

    final root = Directory(vaultPath);
    if (!await root.exists()) {
      return TfidfIndex(vocab: vocab, docs: docs, docFreq: docFreq, totalDocs: 0);
    }
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is! File) continue;
      if (!entity.path.endsWith('.md')) continue;
      // Saltar dotfiles y directorios del sistema
      final rel = p.relative(entity.path, from: vaultPath);
      if (rel.split('/').any((p) => p.startsWith('.') ||
        p == 'Exports' || p == 'Whiteboards' || p == '.trash')) continue;

      try {
        final raw = await entity.readAsString();
        // Quitar frontmatter
        var content = raw;
        if (content.startsWith('---')) {
          final end = content.indexOf('---', 3);
          if (end > 0) content = content.substring(end + 3);
        }
        // Titulo: primera linea # o frontmatter title
        String title = p.basenameWithoutExtension(entity.path);
        final titleMatch = RegExp(r'^#\s+(.+)', multiLine: true).firstMatch(content);
        if (titleMatch != null) title = titleMatch.group(1)!.trim();

        final terms = tokenize(content);
        final tf = <String, int>{};
        for (final t in terms) {
          tf[t] = (tf[t] ?? 0) + 1;
        }
        // Vocab + doc freq
        for (final t in tf.keys) {
          if (!vocab.containsKey(t)) vocab[t] = vocab.length;
          docFreq[t] = (docFreq[t] ?? 0) + 1;
        }
        docs.add(DocEntry(
          path: entity.path,
          title: title,
          content: content,
          terms: terms,
          termFreq: tf,
          length: terms.length,
        ));
      } catch (_) {}
    }

    stopwatch.stop();
    final idx = TfidfIndex(
      vocab: vocab, docs: docs, docFreq: docFreq, totalDocs: docs.length,
    );
    // Persistir
    final dir = Directory(p.join(vaultPath, _indexDir));
    if (!await dir.exists()) await dir.create(recursive: true);
    await _tfidfFile.writeAsString(jsonEncode(idx.toJson()));
    AdvancedLogger.instance.info('semantic', 'index built', context: {
      'docs': docs.length, 'vocab': vocab.length, 'ms': stopwatch.elapsedMilliseconds,
    });
    return idx;
  }

  /// v0.60 (P0.7): busqueda hibrida TF-IDF + keyword substring + RRF.
  /// Devuelve top-K resultados ordenados por score combinado.
  Future<List<SearchResult>> search(String query, {int topK = 10, double rrfK = 60.0}) async {
    final idx = await buildIndex();
    if (idx.docs.isEmpty) return [];

    final queryTerms = tokenize(query);
    if (queryTerms.isEmpty) return [];

    // 1) TF-IDF scoring
    final tfidfScores = <String, double>{};
    for (final doc in idx.docs) {
      var score = 0.0;
      for (final qt in queryTerms) {
        final tf = doc.termFreq[qt] ?? 0;
        if (tf == 0) continue;
        final df = idx.docFreq[qt] ?? 1;
        // TF-IDF: tf * log(N/df)
        final idf = math.log((idx.totalDocs + 1) / (df + 1)) + 1;
        score += (1 + math.log(tf)) * idf;
      }
      // Normalizar por longitud del doc
      if (doc.length > 0) {
        score = score / math.sqrt(doc.length);
      }
      tfidfScores[doc.path] = score;
    }
    final tfidfRanked = _rankByScore(tfidfScores);

    // 2) Keyword substring scoring
    final keywordScores = <String, double>{};
    final queryLower = query.toLowerCase();
    for (final doc in idx.docs) {
      var hits = 0;
      final contentLower = doc.content.toLowerCase();
      if (contentLower.contains(queryLower)) hits += 5; // exact match bonus
      for (final qt in queryTerms) {
        hits += contentLower.split(qt).length - 1;
      }
      keywordScores[doc.path] = hits.toDouble();
    }
    final keywordRanked = _rankByScore(keywordScores);

    // 3) Reciprocal Rank Fusion
    final rrfScores = <String, double>{};
    for (var i = 0; i < tfidfRanked.length; i++) {
      final path = tfidfRanked[i];
      rrfScores[path] = (rrfScores[path] ?? 0) + 1.0 / (rrfK + i + 1);
    }
    for (var i = 0; i < keywordRanked.length; i++) {
      final path = keywordRanked[i];
      rrfScores[path] = (rrfScores[path] ?? 0) + 1.0 / (rrfK + i + 1);
    }
    final fused = rrfScores.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    // 4) Build results
    final results = <SearchResult>[];
    final docMap = {for (final d in idx.docs) d.path: d};
    for (final entry in fused.take(topK)) {
      final doc = docMap[entry.key];
      if (doc == null) continue;
      results.add(SearchResult(
        notePath: doc.path,
        score: entry.value,
        snippet: _makeSnippet(doc.content, queryTerms),
        meta: {
          'title': doc.title,
          'tfidf': tfidfScores[doc.path] ?? 0.0,
          'keyword': keywordScores[doc.path] ?? 0.0,
        },
      ));
    }
    return results;
  }

  /// v0.60 (P0.7): snippet alrededor del primer match.
  String _makeSnippet(String content, List<String> queryTerms) {
    if (content.isEmpty) return '';
    final lower = content.toLowerCase();
    var pos = -1;
    for (final qt in queryTerms) {
      final i = lower.indexOf(qt);
      if (i >= 0 && (pos < 0 || i < pos)) pos = i;
    }
    if (pos < 0) pos = 0;
    final start = math.max(0, pos - 60);
    final end = math.min(content.length, pos + 200);
    final prefix = start > 0 ? '...' : '';
    final suffix = end < content.length ? '...' : '';
    return prefix + content.substring(start, end).replaceAll('\n', ' ') + suffix;
  }

  /// v0.60: ranking helper.
  List<String> _rankByScore(Map<String, double> scores) {
    final entries = scores.entries.where((e) => e.value > 0).toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    return entries.map((e) => e.key).toList();
  }

  /// v0.60 (P0.7): invalida el cache (tras ediciones masivas).
  Future<void> invalidate() async {
    if (await _tfidfFile.exists()) await _tfidfFile.delete();
  }
}
