// chat_screen.dart: AI tutor chat (Fase 5.A.2).
//
// v0.46: chat con el tutor IA. Manda preguntas a /api/v1/ai/tutor
// (backend AITutorService) y muestra respuestas con sources.
//
// v0.47.33: LocalTutorService cuando no hay backend.
// v0.49.4: Historial persistente, generar flashcards/tests/esquemas
//          desde cualquier respuesta AI, share/continue conversation,
//          markdown rendering rico, "abrir nota" por source.

import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:path/path.dart' as p;
import '../../services/ai_tutor_client.dart';
import '../../services/local_tutor_service.dart';
import '../../services/flashcard_service.dart';
import '../../services/logger.dart';
import '../../models/chat_message.dart';

class ChatScreen extends StatefulWidget {
  final String backendUrl;
  final String? authToken;
  final ValueChanged<String>? onNoteOpen;
  final String? vaultPath;
  // v0.49.4: callback para abrir el editor de flashcards con un texto base
  final ValueChanged<String>? onCreateFlashcard;
  const ChatScreen({super.key, required this.backendUrl, this.authToken, this.onNoteOpen, this.vaultPath, this.onCreateFlashcard});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<ChatMessage> _messages = [];
  late final AiTutorClient _client;
  bool _isThinking = false;
  static const _historyFile = '.m-nexus-chat-history.json';

  @override
  void initState() {
    super.initState();
    _client = AiTutorClient(
      backendUrl: widget.backendUrl,
      authToken: widget.authToken,
    );
    _loadHistory();
  }

  @override
  void dispose() {
    _saveHistory();
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  // v0.49.4: persist chat history in vault/.m-nexus-chat-history.json
  File? _historyFile() {
    if (widget.vaultPath == null) return null;
    return File(p.join(widget.vaultPath!, _historyFile));
  }

  void _loadHistory() {
    final f = _historyFile();
    if (f == null || !f.existsSync()) {
      _messages.add(ChatMessage(
        role: 'ai',
        content: '¡Hola! Soy tu tutor. Preguntame sobre tus notas y te ayudo con respuestas basadas en tu vault.',
        timestamp: DateTime.now(),
      ));
      return;
    }
    try {
      final raw = f.readAsStringSync();
      final list = json.decode(raw) as List<dynamic>;
      setState(() {
        _messages.clear();
        for (final j in list) {
          _messages.add(ChatMessage.fromJson(j as Map<String, dynamic>));
        }
        if (_messages.isEmpty) {
          _messages.add(ChatMessage(
            role: 'ai',
            content: '¡Hola! Soy tu tutor. Preguntame sobre tus notas y te ayudo con respuestas basadas en tu vault.',
            timestamp: DateTime.now(),
          ));
        }
      });
    } catch (e) {
      log.warn('chat', 'Failed to load history', context: {'err': e.toString()});
      _messages.add(ChatMessage(
        role: 'ai',
        content: '¡Hola! Soy tu tutor. Preguntame sobre tus notas y te ayudo con respuestas basadas en tu vault.',
        timestamp: DateTime.now(),
      ));
    }
  }

  void _saveHistory() {
    final f = _historyFile();
    if (f == null) return;
    try {
      final list = _messages.map((m) => m.toJson()).toList();
      f.writeAsStringSync(json.encode(list));
    } catch (e) {
      log.warn('chat', 'Failed to save history', context: {'err': e.toString()});
    }
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
    _saveHistory();
    _scrollToBottom();

    try {
      String answer;
      List<String> sources;
      if (widget.vaultPath != null) {
        final localTutor = LocalTutorService(widget.vaultPath!);
        final localResp = await localTutor.ask(text);
        answer = localResp.answer;
        sources = localResp.sources;
      } else {
        final response = await _client.ask(text);
        answer = response.answer;
        sources = response.sources;
      }
      if (!mounted) return;
      setState(() {
        _messages.add(ChatMessage(
          role: 'ai',
          content: answer,
          sources: sources,
          timestamp: DateTime.now(),
        ));
        _isThinking = false;
      });
      _saveHistory();
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _messages.add(ChatMessage(
          role: 'ai',
          content: 'Error: $e',
          isError: true,
          timestamp: DateTime.now(),
        ));
        _isThinking = false;
      });
      _saveHistory();
    }
  }

  /// v0.49.4: crea una flashcard a partir de la respuesta AI.
  /// Usa el formato "Q: ... A: ..." extraido heurísticamente.
  Future<void> _createFlashcardFromMessage(ChatMessage msg) async {
    if (widget.vaultPath == null) {
      _toast('Necesitas un vault para guardar flashcards');
      return;
    }
    final card = _extractFlashcard(msg.content);
    if (card == null) {
      _toast('No se pudo extraer un par Q/A de la respuesta. Edita manualmente.');
      return;
    }
    try {
      final service = FlashcardService(widget.vaultPath!);
      final fc = await service.create(
        question: card.$1,
        answer: card.$2,
        approved: true,
      );
      _toast('Flashcard creada: ${fc.question.substring(0, fc.question.length.clamp(0, 40))}');
    } catch (e) {
      _toast('Error: $e');
    }
  }

  /// v0.49.4: genera un test (lista de flashcards) a partir de la respuesta.
  Future<void> _createTestFromMessage(ChatMessage msg) async {
    if (widget.vaultPath == null) {
      _toast('Necesitas un vault para guardar tests');
      return;
    }
    // Heurística: dividir por puntos/secciones y crear una flashcard por par
    final cards = _extractMultipleFlashcards(msg.content);
    if (cards.isEmpty) {
      _toast('No se encontraron suficientes Q/A en la respuesta');
      return;
    }
    try {
      final service = FlashcardService(widget.vaultPath!);
      int created = 0;
      for (final c in cards.take(10)) {
        await service.create(
          question: c.$1,
          answer: c.$2,
          approved: true,
        );
        created++;
      }
      _toast('Test creado con $created flashcards');
    } catch (e) {
      _toast('Error: $e');
    }
  }

  /// v0.49.4: extrae Q: ... A: ... de un texto markdown
  /// Acepta: Question, Pregunta, Q / Answer, Respuesta, A (case insensitive, con/sin **)
  (String, String)? _extractFlashcard(String text) {
    final qMatch = RegExp(
      r'(?:^|\n)\s*[*_]*\s*(?:Question|Pregunta|Q)\s*[:\-]?\s*[*_]*\s*(.+?)(?:\n|$)',
      caseSensitive: false,
    ).firstMatch(text);
    final aMatch = RegExp(
      r'(?:^|\n)\s*[*_]*\s*(?:Answer|Respuesta|A)\s*[:\-]?\s*[*_]*\s*(.+?)(?:\n\n|$)',
      dotMatch: true,
      caseSensitive: false,
    ).firstMatch(text);
    if (qMatch != null && aMatch != null) {
      return (qMatch.group(1)!.trim(), aMatch.group(1)!.trim());
    }
    // Fallback: primera frase = front, resto = back
    final sentences = text.split(RegExp(r'[.!?]\s+'));
    if (sentences.length >= 2) {
      return (sentences[0].trim(), sentences.skip(1).take(3).join('. ').trim());
    }
    return null;
  }

  /// v0.49.4: extrae múltiples pares Q/A de un texto
  List<(String, String)> _extractMultipleFlashcards(String text) {
    final out = <(String, String)>[];
    // Patrón 1: pares Q:/A: consecutivos
    final pattern = RegExp(
      r'(?:^|\n)\s*[*_]*\s*(?:Question|Pregunta|Q)\s*[:\-]?\s*(.+?)\s*\n+\s*[*_]*\s*(?:Answer|Respuesta|A)\s*[:\-]?\s*(.+?)(?=\n+\s*[*_]*\s*(?:Question|Pregunta|Q)|$)',
      dotMatch: true,
      multiLine: true,
      caseSensitive: false,
    );
    for (final m in pattern.allMatches(text)) {
      out.add((m.group(1)!.trim(), m.group(2)!.trim()));
    }
    // Patrón 2: preguntas con ? + respuesta después
    if (out.isEmpty) {
      final lines = text.split('\n');
      String? pendingQ;
      for (final l in lines) {
        final t = l.trim();
        if (t.isEmpty) continue;
        if (t.contains('?') && t.length < 200) {
          pendingQ = t;
        } else if (pendingQ != null && t.length > 10) {
          out.add((pendingQ, t));
          pendingQ = null;
        }
      }
    }
    return out;
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 3)),
    );
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

  void _clearChat() {
    setState(() {
      _messages.clear();
      _messages.add(ChatMessage(
        role: 'ai',
        content: 'Chat cleared. ¿En qué te ayudo?',
        timestamp: DateTime.now(),
      ));
    });
    _saveHistory();
  }

  /// v0.49.4: regenera con la última pregunta del usuario
  Future<void> _regenerateLast() async {
    if (_isThinking) return;
    // Buscar la última pregunta del usuario
    for (int i = _messages.length - 1; i >= 0; i--) {
      if (_messages[i].role == 'user') {
        final text = _messages[i].content;
        // Eliminar la última respuesta AI
        for (int j = _messages.length - 1; j > i; j--) {
          _messages.removeAt(j);
        }
        _inputController.text = text;
        await _sendMessage();
        return;
      }
    }
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
            icon: const Icon(Icons.refresh),
            tooltip: 'Regenerar última',
            onPressed: _isThinking ? null : _regenerateLast,
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Clear chat',
            onPressed: _clearChat,
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
                            if (widget.onNoteOpen != null) {
                              widget.onNoteOpen!(s);
                            } else {
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
            // v0.49.4: action buttons en respuestas AI
            if (!isUser && !msg.isError) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                children: [
                  _actionChip(theme, Icons.style, 'Flashcard', () => _createFlashcardFromMessage(msg)),
                  _actionChip(theme, Icons.quiz, 'Test', () => _createTestFromMessage(msg)),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _actionChip(ThemeData theme, IconData icon, String label, VoidCallback onTap) {
    return ActionChip(
      avatar: Icon(icon, size: 16),
      label: Text(label),
      onPressed: onTap,
      visualDensity: VisualDensity.compact,
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
