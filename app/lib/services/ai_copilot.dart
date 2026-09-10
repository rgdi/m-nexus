// ai_copilot.dart: AI helpers para el block editor (slash menu).
//
// v0.49.18: comandos AI que se insertan como bloques:
//   /ai summarize   - resume el vault
//   /ai explain X   - explica un concepto
//   /ai questions   - genera preguntas de estudio
//   /ai translate   - traduce a otro idioma
//   /ai outline     - genera outline del tema
//
// Usa el backend /api/v1/llm o fallback a respuestas heuristicas.

import 'dart:convert';
import 'package:http/http.dart' as http;

class AICopilot {
  final String? backendUrl;
  final String? authToken;
  // Contexto del vault
  final String? vaultContext;

  AICopilot({this.backendUrl, this.authToken, this.vaultContext});

  /// Procesa un comando AI y devuelve el texto a insertar.
  /// Si el backend no responde, usa fallback heuristico.
  Future<String> run(String prompt, {String? targetLang}) async {
    if (backendUrl != null && backendUrl!.isNotEmpty) {
      try {
        final res = await http.post(
          Uri.parse('$backendUrl/api/v1/llm/chat'),
          headers: {
            'Content-Type': 'application/json',
            if (authToken != null) 'Authorization': 'Bearer $authToken',
          },
          body: jsonEncode({
            'messages': [
              {'role': 'system', 'content': 'Eres un asistente de estudio. Responde conciso y claro.'},
              {'role': 'user', 'content': _buildPrompt(prompt, targetLang)},
            ],
          }),
        ).timeout(const Duration(seconds: 30));
        if (res.statusCode == 200) {
          final j = jsonDecode(res.body) as Map<String, dynamic>;
          return j['content']?.toString() ?? j['message']?.toString() ?? '';
        }
      } catch (_) {
        // Fallback
      }
    }
    return _fallback(prompt, targetLang);
  }

  String _buildPrompt(String prompt, String? targetLang) {
    final ctx = vaultContext != null && vaultContext!.isNotEmpty
      ? '\n\nContexto del vault:\n${vaultContext!.substring(0, vaultContext!.length.clamp(0, 2000))}'
      : '';
    if (targetLang != null) {
      return 'Traduce a $targetLang: $prompt$ctx';
    }
    return '$prompt$ctx';
  }

  String _fallback(String prompt, String? targetLang) {
    // Heuristico: devuelve el prompt como bloque "pendiente" para que el
    // usuario lo complete manualmente
    if (prompt.startsWith('/ai summarize') || prompt.contains('resum')) {
      return '_[Pendiente: resumen automatico. Pulsa generar cuando el backend LLM este disponible.]_';
    }
    if (prompt.startsWith('/ai questions') || prompt.contains('pregunt')) {
      return '''- [ ] ¿Pregunta 1 sobre el tema?
- [ ] ¿Pregunta 2?
- [ ] ¿Pregunta 3?''';
    }
    if (prompt.startsWith('/ai outline') || prompt.contains('outline')) {
      return '''- Concepto principal
  - Sub-concepto A
  - Sub-concepto B
- Aplicaciones
- Ejemplos''';
    }
    if (targetLang != null) {
      return '_[Traduccion pendiente a $targetLang]_';
    }
    return '_[AI pendiente: $prompt]_';
  }
}
