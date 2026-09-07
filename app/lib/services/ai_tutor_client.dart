// ai_tutor_client.dart: cliente HTTP para AI tutor backend (Fase 5.A.2).
//
// v0.46: integra con AITutorService.ts del backend.
//   POST /api/v1/ai/tutor
//   Body: { question, context?, history? }
//   Response: { answer, sources, model, tokens }

import 'dart:convert';
import 'package:http/http.dart' as http;

class AiTutorResponse {
  final String answer;
  final List<String> sources;
  final String? model;
  final int? tokens;

  const AiTutorResponse({
    required this.answer,
    required this.sources,
    this.model,
    this.tokens,
  });

  factory AiTutorResponse.fromJson(Map<String, dynamic> json) {
    return AiTutorResponse(
      answer: json['answer'] as String? ?? '',
      sources: ((json['sources'] as List?) ?? []).map((e) => e.toString()).toList(),
      model: json['model'] as String?,
      tokens: json['tokens'] as int?,
    );
  }
}

class AiTutorException implements Exception {
  final String message;
  final int? statusCode;
  AiTutorException(this.message, {this.statusCode});
  @override
  String toString() => 'AiTutorException($statusCode): $message';
}

class AiTutorClient {
  final String backendUrl;
  final String? authToken;
  final http.Client _http;

  AiTutorClient({
    required this.backendUrl,
    this.authToken,
    http.Client? client,
  }) : _http = client ?? http.Client();

  Future<AiTutorResponse> ask(
    String question, {
    String? context,
    List<Map<String, String>>? history,
  }) async {
    final uri = Uri.parse('$backendUrl/api/v1/ai/tutor');
    final body = {
      'question': question,
      if (context != null) 'context': context,
      if (history != null) 'history': history,
    };
    final headers = {
      'Content-Type': 'application/json',
      if (authToken != null) 'Authorization': 'Bearer $authToken',
    };

    final response = await _http.post(uri, headers: headers, body: jsonEncode(body));
    if (response.statusCode >= 200 && response.statusCode < 300) {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      return AiTutorResponse.fromJson(json);
    }
    throw AiTutorException(
      response.body,
      statusCode: response.statusCode,
    );
  }

  void close() => _http.close();
}
