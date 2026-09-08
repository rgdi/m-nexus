// local_tutor_service.dart: AI tutor simulado que corre en cliente.
//
// v0.47.33: implementación LOCAL del RAG tutor que NO requiere backend.
// Usa las notas del vault como contexto y responde con heurísticas
// (extracción de keywords + construcción de respuesta con fragmentos).
//
// El usuario pidió:
//   "simulación de rag ia (sin llm real), pero pregunta y respuesta
//    en la app (tutor socratico, chat de ia, sobre un concepto o
//    semejante que basado en las notas del vault guardadas)"
//
// Estrategia:
//   1. Usuario pregunta algo
//   2. Buscamos notas relevantes (FTS-style: substring match)
//   3. Si hay notas: retornamos el mejor snippet + links + explicación heurística
//   4. Si no hay notas: retornamos respuesta socrática tipo "qué sabes tú sobre X?"
//
// Esta clase se puede inyectar en lugar de AiTutorClient en chat_screen.

import 'dart:math';
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
  final VaultService _vault;
  LocalTutorService(this.vaultPath) : _vault = VaultService(vaultPath);

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

    // 1) Listar todas las notas y buscar matches por keyword
    final notes = await _vault.listRecentNotes(1000);
    if (notes.isEmpty) {
      return LocalTutorResponse(
        answer: _socraticReply(q),
        sources: [],
        confidence: 0.1,
        mode: 'socratic',
      );
    }

    // 2) Scoring: contar cuántas keywords de la pregunta aparecen en cada nota
    final keywords = _extractKeywords(q);
    if (keywords.isEmpty) {
      return LocalTutorResponse(
        answer: _socraticReply(q),
        sources: [],
        confidence: 0.1,
        mode: 'socratic',
      );
    }

    final scored = <_NoteScore>[];
    for (final note in notes) {
      final content = (note.content + ' ' + (note.title ?? '')).toLowerCase();
      var score = 0;
      final hits = <String>{};
      for (final kw in keywords) {
        if (content.contains(kw)) {
          score += content.split(kw).length - 1;
          hits.add(kw);
        }
      }
      if (score > 0) {
        scored.add(_NoteScore(note, score, hits));
      }
    }

    // 3) Si no hay matches: socrático
    if (scored.isEmpty) {
      return LocalTutorResponse(
        answer: _socraticReply(q),
        sources: [],
        confidence: 0.1,
        mode: 'socratic',
      );
    }

    // 4) Ordenar por score y tomar top-3
    scored.sort((a, b) => b.score.compareTo(a.score));
    final top = scored.take(3).toList();

    // 5) Construir respuesta extractiva con los mejores snippets
    final answer = StringBuffer()
      ..writeln('Basándome en tus notas, encontré esto relevante:')
      ..writeln('');

    for (var i = 0; i < top.length; i++) {
      final s = top[i];
      final preview = _makePreview(s.note.content, keywords);
      answer
        ..writeln('📄 **${s.note.title ?? s.note.name}** (${s.hits.length}/${keywords.length} keywords)')
        ..writeln('   $preview')
        ..writeln('');
    }

    // 6) Pregunta de seguimiento socrática para profundizar
    answer
      ..writeln('---')
      ..writeln(_socraticFollowUp(q, top.first.note.title ?? top.first.note.name));

    return LocalTutorResponse(
      answer: answer.toString(),
      sources: top.map((s) => s.note.relPath).toList(),
      confidence: min(1.0, top.first.score / keywords.length / 2),
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

  String _makePreview(String content, List<String> keywords) {
    // Encontrar la primera línea que contenga alguna keyword
    final lines = content.split('\n');
    for (final line in lines) {
      final lower = line.toLowerCase();
      for (final kw in keywords) {
        if (lower.contains(kw)) {
          // Limpiar markdown básico
          var clean = line
              .replaceAll(RegExp(r'#+\s'), '')
              .replaceAll(RegExp(r'\*+'), '')
              .replaceAll(RegExp(r'`'), '')
              .trim();
          if (clean.length > 200) {
            clean = '${clean.substring(0, 200)}…';
          }
          return clean;
        }
      }
    }
    // Si no encuentra nada, mostrar las primeras 200 chars
    var clean = content.replaceAll(RegExp(r'#+\s'), '').trim();
    if (clean.length > 200) clean = '${clean.substring(0, 200)}…';
    return clean;
  }

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

class _NoteScore {
  final Note note;
  final int score;
  final Set<String> hits;
  _NoteScore(this.note, this.score, this.hits);
}
