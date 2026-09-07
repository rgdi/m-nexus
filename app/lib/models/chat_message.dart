// chat_message.dart: modelo de mensaje de chat (Fase 5.A.2).

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
}
