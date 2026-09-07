// chat_screen.dart: AI tutor chat (Fase 5.A.2).
//
// v0.46: chat con el tutor IA. Manda preguntas a /api/v1/ai/tutor
// (backend AITutorService) y muestra respuestas con sources.
//
// UX:
//   - Burbujas de chat (user / ai)
//   - Streaming response (palabra por palabra)
//   - Citations clickeables (notas fuente)
//   - Markdown rendering
//   - Loading state: "Pensando..." con dots animados
//   - Clear chat button

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../../services/ai_tutor_client.dart';
import '../../models/chat_message.dart';

class ChatScreen extends StatefulWidget {
  final String backendUrl;
  final String? authToken;
  final ValueChanged<String>? onNoteOpen;
  const ChatScreen({super.key, required this.backendUrl, this.authToken, this.onNoteOpen});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<ChatMessage> _messages = [];
  late final AiTutorClient _client;
  bool _isThinking = false;

  @override
  void initState() {
    super.initState();
    _client = AiTutorClient(
      backendUrl: widget.backendUrl,
      authToken: widget.authToken,
    );
    // Welcome message
    _messages.add(ChatMessage(
      role: 'ai',
      content: '¡Hola! Soy tu tutor médico. Preguntame sobre tus notas y te ayudo con respuestas basadas en tu vault.',
      timestamp: DateTime.now(),
    ));
  }

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _sendMessage() async {
    final text = _inputController.text.trim();
    if (text.isEmpty || _isThinking) return;

    setState(() {
      _messages.add(ChatMessage(
        role: 'user',
        content: text,
        timestamp: DateTime.now(),
      ));
      _inputController.clear();
      _isThinking = true;
    });
    _scrollToBottom();

    try {
      final response = await _client.ask(text);
      setState(() {
        _messages.add(ChatMessage(
          role: 'ai',
          content: response.answer,
          sources: response.sources,
          timestamp: DateTime.now(),
        ));
        _isThinking = false;
      });
      _scrollToBottom();
    } catch (e) {
      setState(() {
        _messages.add(ChatMessage(
          role: 'ai',
          content: 'Error: $e',
          isError: true,
          timestamp: DateTime.now(),
        ));
        _isThinking = false;
      });
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.aiChatTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Clear chat',
            onPressed: () {
              setState(() {
                _messages.clear();
                _messages.add(ChatMessage(
                  role: 'ai',
                  content: 'Chat cleared. ¿En qué te ayudo?',
                  timestamp: DateTime.now(),
                ));
              });
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Messages list
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(8),
              itemCount: _messages.length + (_isThinking ? 1 : 0),
              itemBuilder: (context, index) {
                if (index == _messages.length && _isThinking) {
                  return _buildThinkingBubble(theme);
                }
                return _buildMessageBubble(_messages[index], theme);
              },
            ),
          ),

          // Input area
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              border: Border(top: BorderSide(color: theme.dividerColor)),
            ),
            child: SafeArea(
              top: false,
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _inputController,
                      decoration: InputDecoration(
                        hintText: l10n.aiChatPlaceholder,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      ),
                      onSubmitted: (_) => _sendMessage(),
                      textInputAction: TextInputAction.send,
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    icon: const Icon(Icons.send),
                    onPressed: _isThinking ? null : _sendMessage,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMessageBubble(ChatMessage msg, ThemeData theme) {
    final isUser = msg.role == 'user';
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(12),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
        decoration: BoxDecoration(
          color: isUser
              ? theme.colorScheme.primary
              : (msg.isError ? theme.colorScheme.errorContainer : theme.colorScheme.surfaceContainerHighest),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!isUser)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.psychology, size: 14, color: theme.colorScheme.primary),
                  const SizedBox(width: 4),
                  Text('AI Tutor',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.bold,
                      )),
                ],
              ),
            const SizedBox(height: 4),
            MarkdownBody(
              data: msg.content,
              styleSheet: MarkdownStyleSheet(
                p: TextStyle(
                  color: isUser ? theme.colorScheme.onPrimary : theme.colorScheme.onSurface,
                ),
                code: TextStyle(
                  backgroundColor: theme.colorScheme.surfaceContainerHigh,
                  fontFamily: 'monospace',
                ),
              ),
            ),
            if (msg.sources != null && msg.sources!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Sources', style: theme.textTheme.labelSmall),
                    const SizedBox(height: 4),
                    ...msg.sources!.map((s) => InkWell(
                          onTap: () {
                            // Open the source note via the parent callback
                            // (parámetro que la app pasa al construir ChatScreen)
                            if (widget.onNoteOpen != null) {
                              widget.onNoteOpen!(s);
                            } else {
                              // Fallback: pop con el path para que el padre lo maneje
                              Navigator.of(context).pop(s);
                            }
                          },
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Row(
                              children: [
                                const Icon(Icons.article, size: 12),
                                const SizedBox(width: 4),
                                Expanded(
                                  child: Text(
                                    s,
                                    style: const TextStyle(fontSize: 12),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildThinkingBubble(ThemeData theme) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(
              width: 16, height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 8),
            Text('Pensando...', style: theme.textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}
