// chat_message.dart: modelo de mensaje de chat (Fase 5.A.2).
//
// v0.49.4: añadido toJson/fromJson para persistir historial en vault.

class ChatMessage {
  final String role; // 'user' | 'ai'
  final String content;
  final List<String>? sources;
  final bool isError;
  final DateTime timestamp;

  const ChatMessage({
    required this.role,
    required this.content,
    this.sources,
    this.isError = false,
    required this.timestamp,
  });

  Map<String, dynamic> toJson() => {
    'role': role,
    'content': content,
    'sources': sources,
    'isError': isError,
    'timestamp': timestamp.toIso8601String(),
  };

  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
    role: j['role'] as String,
    content: j['content'] as String,
    sources: (j['sources'] as List?)?.cast<String>(),
    isError: (j['isError'] as bool?) ?? false,
    timestamp: DateTime.parse(j['timestamp'] as String),
  );
}
