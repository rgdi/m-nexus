// local_tutor_service.dart: AI tutor simulado que corre en cliente.
//
// v0.47.33: implementación LOCAL del RAG tutor que NO requiere backend.
// v0.60 (P0.7): usa SemanticSearch (TF-IDF + RRF) en vez de substring matching.
// El index persiste en disco y se reusa entre sesiones.
//
// Estrategia:
//   1. Usuario pregunta algo
//   2. SemanticSearch.index() construye/reusa el TF-IDF index
//   3. search() devuelve los top-K resultados combinados (TF-IDF + keyword)
//   4. Si hay resultados: retornamos snippets con score combinado
//   5. Si no hay resultados: retornamos respuesta socrática
//
// Esta clase se puede inyectar en lugar de AiTutorClient en chat_screen.

import 'dart:math';
import '../services/semantic_search.dart';
import '../services/vault_service.dart';

class LocalTutorResponse {
  final String answer;
  final List<String> sources;
  final double confidence;
  final String mode; // 'extractive', 'socratic', 'empty'

  const LocalTutorResponse({
    required this.answer,
    required this.sources,
    required this.confidence,
    required this.mode,
  });
}

class LocalTutorService {
  final String vaultPath;
  final SemanticSearch _search;
  LocalTutorService(this.vaultPath) : _search = SemanticSearch(vaultPath);

  /// Pregunta al tutor local. Busca notas relevantes y construye respuesta.
  Future<LocalTutorResponse> ask(String question) async {
    final q = question.trim();
    if (q.isEmpty) {
      return const LocalTutorResponse(
        answer: '¿Qué quieres saber?',
        sources: [],
        confidence: 0.0,
        mode: 'empty',
      );
    }

    // 1) v0.60 (P0.7): busqueda hibrida TF-IDF + keyword + RRF
    final results = await _search.search(q, topK: 5);
    if (results.isEmpty) {
      return LocalTutorResponse(
        answer: _socraticReply(q),
        sources: [],
        confidence: 0.1,
        mode: 'socratic',
      );
    }

    // 2) Construir respuesta extractiva con los mejores snippets
    final answer = StringBuffer()
      ..writeln('Basándome en tus notas, encontré esto relevante:')
      ..writeln('');

    for (var i = 0; i < results.length; i++) {
      final r = results[i];
      final title = r.meta['title'] as String? ?? r.notePath.split('/').last;
      final tfidf = r.meta['tfidf'] as double? ?? 0.0;
      final kw = r.meta['keyword'] as double? ?? 0.0;
      answer
        ..writeln('📄 **$title** (RRF: ${r.score.toStringAsFixed(3)}, tf-idf: ${tfidf.toStringAsFixed(2)}, kw: ${kw.toStringAsFixed(0)})')
        ..writeln('   ${r.snippet}')
        ..writeln('');
    }

    // 3) Pregunta de seguimiento socrática
    final topTitle = results.first.meta['title'] as String? ?? results.first.notePath.split('/').last;
    answer
      ..writeln('---')
      ..writeln(_socraticFollowUp(q, topTitle));

    return LocalTutorResponse(
      answer: answer.toString(),
      sources: results.map((r) => r.notePath).toList(),
      confidence: min(1.0, results.first.score * 2),
      mode: 'extractive',
    );
  }

  List<String> _extractKeywords(String question) {
    // Eliminar stopwords en español + signos de puntuación
    const stopwords = {
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
      'de', 'del', 'en', 'a', 'al', 'con', 'por', 'para',
      'que', 'qué', 'como', 'cómo', 'donde', 'cuál', 'cuáles',
      'es', 'son', 'ser', 'estar', 'está', 'están',
      'y', 'o', 'pero', 'si', 'no', 'sí', 'mas', 'más', 'menos',
      'me', 'te', 'se', 'le', 'lo', 'mi', 'tu', 'su',
      'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
      'sobre', 'entre', 'hasta', 'desde', 'cuando',
      'yo', 'tú', 'él', 'ella', 'nosotros', 'vosotros', 'ellos',
    };
    final words = question
        .toLowerCase()
        .replaceAll(RegExp(r'[^\wáéíóúñü\s]'), '')
        .split(RegExp(r'\s+'))
        .where((w) => w.length > 2 && !stopwords.contains(w))
        .toSet();
    return words.toList();
  }

  // v0.60 (P0.7): _makePreview y _NoteScore fueron reemplazados por
  // SemanticSearch. Las dejo comentadas para referencia historica.
  /*
  String _makePreview(String content, List<String> keywords) {
    ...
  }
  */

  String _socraticReply(String question) {
    return 'No encuentro notas sobre "${_trimForEcho(question)}" en tu vault. '
        '¿Qué sabes tú sobre esto? Empieza por la definición y luego dame '
        'un ejemplo concreto. Cuando escribas tu respuesta, puedo ayudarte a '
        'verificar si está alineada con el temario.';
  }

  String _socraticFollowUp(String question, String noteTitle) {
    final r = Random();
    final prompts = [
      '¿Cómo se relaciona "$noteTitle" con lo que ya sabías antes?',
      '¿Qué pasaría si "$noteTitle" se aplicara a un caso clínico real?',
      '¿Puedes explicar el mecanismo subyacente de "$noteTitle" sin usar el término técnico?',
      '¿Cuál es el error más común que comete un estudiante al aprender "$noteTitle"?',
    ];
    return prompts[r.nextInt(prompts.length)];
  }

  String _trimForEcho(String s) {
    if (s.length > 60) return '${s.substring(0, 57)}…';
    return s;
  }
}

