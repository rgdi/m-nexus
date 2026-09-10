// multi_model_ai.dart: AI Copilot con soporte multi-modelo.
//
// v0.51: en lugar de solo Ollama, ahora soporta:
//   - Ollama (local, default)
//   - OpenAI (gpt-4, gpt-3.5-turbo)
//   - Anthropic (claude-3-opus, claude-3-sonnet, claude-3-haiku)
//   - OpenRouter (cualquier modelo via API unificada)
//   - Mock (para tests)
//
// La configuracion se persiste en vault/.m-nexus-ai-config.json
// (API keys NO se guardan en vault; se leen de variables de entorno o
// SharedPreferences).

import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

enum AiProvider { ollama, openai, anthropic, openrouter, mock }

class AiConfig {
  AiProvider provider;
  String model;
  String? apiKey;
  String baseUrl;
  double temperature;
  int maxTokens;
  AiConfig({
    this.provider = AiProvider.ollama,
    this.model = 'llama3.2',
    this.apiKey,
    this.baseUrl = 'http://localhost:11434',
    this.temperature = 0.3,
    this.maxTokens = 2000,
  });
  Map<String, dynamic> toJson() => {
    'provider': provider.name,
    'model': model,
    'baseUrl': baseUrl,
    'temperature': temperature,
    'maxTokens': maxTokens,
  };
  factory AiConfig.fromJson(Map j) => AiConfig(
    provider: AiProvider.values.firstWhere(
      (p) => p.name == j['provider'], orElse: () => AiProvider.ollama),
    model: j['model'] as String? ?? 'llama3.2',
    baseUrl: j['baseUrl'] as String? ?? 'http://localhost:11434',
    temperature: (j['temperature'] as num?)?.toDouble() ?? 0.3,
    maxTokens: (j['maxTokens'] as int?) ?? 2000,
  );

  AiConfig copyWith({AiProvider? provider, String? model, String? apiKey, String? baseUrl}) =>
    AiConfig(
      provider: provider ?? this.provider,
      model: model ?? this.model,
      apiKey: apiKey ?? this.apiKey,
      baseUrl: baseUrl ?? this.baseUrl,
      temperature: temperature,
      maxTokens: maxTokens,
    );
}

class AiMessage {
  final String role; // 'system' | 'user' | 'assistant'
  final String content;
  const AiMessage({required this.role, required this.content});
  Map<String, dynamic> toJson() => {'role': role, 'content': content};
}

class AiResponse {
  final String content;
  final String model;
  final int promptTokens;
  final int completionTokens;
  final Duration latency;
  const AiResponse({
    required this.content,
    required this.model,
    this.promptTokens = 0,
    this.completionTokens = 0,
    this.latency = Duration.zero,
  });
}

class MultiModelAi {
  final AiConfig config;
  MultiModelAi(this.config);

  /// v0.51: cambia el provider y model
  void setProvider(AiProvider p, {String? model, String? apiKey, String? baseUrl}) {
    config.provider = p;
    if (model != null) config.model = model;
    if (apiKey != null) config.apiKey = apiKey;
    if (baseUrl != null) config.baseUrl = baseUrl;
  }

  /// v0.51: lista de modelos disponibles por provider
  static List<({String id, String name})> modelsFor(AiProvider provider) {
    switch (provider) {
      case AiProvider.ollama:
        return [
          (id: 'llama3.2', name: 'Llama 3.2 (3B)'),
          (id: 'llama3.2:70b', name: 'Llama 3.2 (70B)'),
          (id: 'qwen2.5:7b', name: 'Qwen 2.5 (7B)'),
          (id: 'mistral', name: 'Mistral 7B'),
          (id: 'phi3', name: 'Phi-3 (3.8B)'),
          (id: 'gemma2:9b', name: 'Gemma 2 (9B)'),
        ];
      case AiProvider.openai:
        return [
          (id: 'gpt-4o', name: 'GPT-4o'),
          (id: 'gpt-4o-mini', name: 'GPT-4o mini'),
          (id: 'gpt-4-turbo', name: 'GPT-4 Turbo'),
          (id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo'),
          (id: 'o1-preview', name: 'o1 Preview'),
        ];
      case AiProvider.anthropic:
        return [
          (id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet'),
          (id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku'),
          (id: 'claude-3-opus-20240229', name: 'Claude 3 Opus'),
          (id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet'),
        ];
      case AiProvider.openrouter:
        return [
          (id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (via OR)'),
          (id: 'openai/gpt-4o', name: 'GPT-4o (via OR)'),
          (id: 'google/gemini-pro-1.5', name: 'Gemini 1.5 Pro (via OR)'),
          (id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B (via OR)'),
          (id: 'mistralai/mistral-large', name: 'Mistral Large (via OR)'),
        ];
      case AiProvider.mock:
        return [
          (id: 'mock-fast', name: 'Mock (rapido)'),
        ];
    }
  }

  /// v0.51: chat principal, delega al provider correcto
  Future<AiResponse> chat(List<AiMessage> messages) async {
    final start = DateTime.now();
    switch (config.provider) {
      case AiProvider.ollama: return _chatOllama(messages, start);
      case AiProvider.openai: return _chatOpenAI(messages, start);
      case AiProvider.anthropic: return _chatAnthropic(messages, start);
      case AiProvider.openrouter: return _chatOpenRouter(messages, start);
      case AiProvider.mock: return _chatMock(messages, start);
    }
  }

  // ── Ollama ──
  Future<AiResponse> _chatOllama(List<AiMessage> messages, DateTime start) async {
    final res = await http.post(
      Uri.parse('${config.baseUrl}/api/chat'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'model': config.model,
        'messages': messages.map((m) => m.toJson()).toList(),
        'stream': false,
        'options': {
          'temperature': config.temperature,
          'num_predict': config.maxTokens,
        },
      }),
    ).timeout(const Duration(seconds: 60));
    if (res.statusCode != 200) {
      throw Exception('Ollama error ${res.statusCode}: ${res.body}');
    }
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    return AiResponse(
      content: j['message']?['content'] as String? ?? '',
      model: config.model,
      promptTokens: (j['prompt_eval_count'] as int?) ?? 0,
      completionTokens: (j['eval_count'] as int?) ?? 0,
      latency: DateTime.now().difference(start),
    );
  }

  // ── OpenAI ──
  Future<AiResponse> _chatOpenAI(List<AiMessage> messages, DateTime start) async {
    if (config.apiKey == null || config.apiKey!.isEmpty) {
      throw Exception('OpenAI API key not set');
    }
    final res = await http.post(
      Uri.parse('${config.baseUrl}/v1/chat/completions'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${config.apiKey}',
      },
      body: jsonEncode({
        'model': config.model,
        'messages': messages.map((m) => m.toJson()).toList(),
        'temperature': config.temperature,
        'max_tokens': config.maxTokens,
      }),
    ).timeout(const Duration(seconds: 60));
    if (res.statusCode != 200) {
      throw Exception('OpenAI error ${res.statusCode}: ${res.body}');
    }
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    final choice = (j['choices'] as List).first as Map<String, dynamic>;
    final usage = j['usage'] as Map<String, dynamic>?;
    return AiResponse(
      content: choice['message']?['content'] as String? ?? '',
      model: config.model,
      promptTokens: usage?['prompt_tokens'] as int? ?? 0,
      completionTokens: usage?['completion_tokens'] as int? ?? 0,
      latency: DateTime.now().difference(start),
    );
  }

  // ── Anthropic ──
  Future<AiResponse> _chatAnthropic(List<AiMessage> messages, DateTime start) async {
    if (config.apiKey == null || config.apiKey!.isEmpty) {
      throw Exception('Anthropic API key not set');
    }
    // Separar system message del resto (Anthropic lo quiere aparte)
    String? systemPrompt;
    final rest = <AiMessage>[];
    for (final m in messages) {
      if (m.role == 'system') {
        systemPrompt = m.content;
      } else {
        rest.add(m);
      }
    }
    final res = await http.post(
      Uri.parse('${config.baseUrl}/v1/messages'),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: jsonEncode({
        'model': config.model,
        'max_tokens': config.maxTokens,
        'system': systemPrompt ?? '',
        'messages': rest.map((m) => m.toJson()).toList(),
      }),
    ).timeout(const Duration(seconds: 60));
    if (res.statusCode != 200) {
      throw Exception('Anthropic error ${res.statusCode}: ${res.body}');
    }
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    final content = (j['content'] as List).first as Map<String, dynamic>;
    final usage = j['usage'] as Map<String, dynamic>?;
    return AiResponse(
      content: content['text'] as String? ?? '',
      model: config.model,
      promptTokens: usage?['input_tokens'] as int? ?? 0,
      completionTokens: usage?['output_tokens'] as int? ?? 0,
      latency: DateTime.now().difference(start),
    );
  }

  // ── OpenRouter ──
  Future<AiResponse> _chatOpenRouter(List<AiMessage> messages, DateTime start) async {
    if (config.apiKey == null || config.apiKey!.isEmpty) {
      throw Exception('OpenRouter API key not set');
    }
    final res = await http.post(
      Uri.parse('${config.baseUrl}/api/v1/chat/completions'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${config.apiKey}',
        'HTTP-Referer': 'https://github.com/rgdi/m-nexus',
        'X-Title': 'M-NEXUS',
      },
      body: jsonEncode({
        'model': config.model,
        'messages': messages.map((m) => m.toJson()).toList(),
        'temperature': config.temperature,
        'max_tokens': config.maxTokens,
      }),
    ).timeout(const Duration(seconds: 60));
    if (res.statusCode != 200) {
      throw Exception('OpenRouter error ${res.statusCode}: ${res.body}');
    }
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    final choice = (j['choices'] as List).first as Map<String, dynamic>;
    final usage = j['usage'] as Map<String, dynamic>?;
    return AiResponse(
      content: choice['message']?['content'] as String? ?? '',
      model: config.model,
      promptTokens: usage?['prompt_tokens'] as int? ?? 0,
      completionTokens: usage?['completion_tokens'] as int? ?? 0,
      latency: DateTime.now().difference(start),
    );
  }

  // ── Mock (para tests) ──
  Future<AiResponse> _chatMock(List<AiMessage> messages, DateTime start) async {
    await Future.delayed(const Duration(milliseconds: 100));
    final last = messages.lastOrNull?.content ?? '';
    return AiResponse(
      content: '**[MOCK ${config.model}]** Respuesta simulada para: "${last.substring(0, last.length.clamp(0, 60))}..."\n\nEsto seria una respuesta real del modelo seleccionado.',
      model: config.model,
      latency: DateTime.now().difference(start),
    );
  }
}

extension _ListLastOrNull<T> on List<T> {
  T? get lastOrNull => isEmpty ? null : last;
}
