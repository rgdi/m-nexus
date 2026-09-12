// ai_chat_screen.dart — chat con AI usando el workspace como contexto.
// v0.62.14: implementación estilo AFFiNE AI Chat. Sidebar con lista de
// conversaciones + chat panel. Cada mensaje envía contexto opcional
// (notas seleccionadas, flashcards, databases). Persistencia en
// _M-NEXUS/ai_chats/<id>.json.

import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:path/path.dart' as p;
import '../../core/design_tokens.dart';
import '../../services/ai_tutor_client.dart';
import '../../services/file_lock.dart';
import '../../services/logger.dart';
import '../../services/settings_service.dart';
import '../../services/vault_service.dart';
import '../../services/flashcard_service.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/glass_widgets.dart';

class AiChatSession {
  final String id;
  String title;
  final List<AiChatMessage> messages;
  final DateTime createdAt;
  DateTime updatedAt;

  AiChatSession({
    required this.id,
    required this.title,
    this.messages = const [],
    DateTime? createdAt,
    DateTime? updatedAt,
  }) : createdAt = createdAt ?? DateTime.now(),
       updatedAt = updatedAt ?? DateTime.now();

  Map<String, dynamic> toJson() => {
    'id': id, 'title': title,
    'messages': messages.map((m) => m.toJson()).toList(),
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt.toIso8601String(),
  };
  factory AiChatSession.fromJson(Map<String, dynamic> j) => AiChatSession(
    id: j['id'] as String,
    title: j['title'] as String,
    messages: ((j['messages'] as List?) ?? [])
      .map((e) => AiChatMessage.fromJson(e as Map<String, dynamic>))
      .toList(),
    createdAt: DateTime.parse(j['createdAt'] as String),
    updatedAt: DateTime.parse(j['updatedAt'] as String),
  );
}

class AiChatMessage {
  final String id;
  final String role; // 'user' | 'assistant'
  final String content;
  final DateTime at;
  final List<String> contextPaths; // paths de notas incluidas como contexto
  AiChatMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.at,
    this.contextPaths = const [],
  });
  Map<String, dynamic> toJson() => {
    'id': id, 'role': role, 'content': content, 'at': at.toIso8601String(),
    'contextPaths': contextPaths,
  };
  factory AiChatMessage.fromJson(Map<String, dynamic> j) => AiChatMessage(
    id: j['id'] as String,
    role: j['role'] as String,
    content: j['content'] as String,
    at: DateTime.parse(j['at'] as String),
    contextPaths: ((j['contextPaths'] as List?) ?? [])
      .map((e) => e.toString()).toList(),
  );
}

class AiChatService {
  final String vaultPath;
  static const _folder = 'ai_chats';
  AiChatService(this.vaultPath);

  Directory _ensure() {
    final d = Directory(p.join(vaultPath, '_M-NEXUS', _folder));
    if (!d.existsSync()) d.createSync(recursive: true);
    return d;
  }

  Future<List<AiChatSession>> listAll() async {
    try {
      final d = _ensure();
      final out = <AiChatSession>[];
      await for (final f in d.list()) {
        if (f is File && f.path.endsWith('.json')) {
          try {
            final raw = await f.readAsString();
            out.add(AiChatSession.fromJson(jsonDecode(raw)));
          } catch (_) {}
        }
      }
      out.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      return out;
    } catch (_) { return []; }
  }

  Future<void> save(AiChatSession s) async {
    final f = File(p.join(_ensure().path, '${s.id}.json'));
    await FileLock.run(f.path, () async {
      await f.writeAsString(jsonEncode(s.toJson()), flush: true);
    });
  }

  Future<void> delete(String id) async {
    final f = File(p.join(_ensure().path, '$id.json'));
    if (await f.exists()) await f.delete();
  }
}

class AiChatScreen extends StatefulWidget {
  final String vaultPath;
  const AiChatScreen({super.key, required this.vaultPath});

  @override
  State<AiChatScreen> createState() => _AiChatScreenState();
}

class _AiChatScreenState extends State<AiChatScreen> {
  late final AiChatService _svc = AiChatService(widget.vaultPath);
  late final VaultService _vault = VaultService(widget.vaultPath);
  final _inputCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  AiTutorClient? _tutor;

  List<AiChatSession> _sessions = [];
  AiChatSession? _current;
  bool _loading = false;
  bool _thinking = false;

  // Contexto RAG: paths de notas añadidas.
  final List<String> _contextPaths = [];

  @override
  void initState() {
    super.initState();
    _tutor = AiTutorClient(backendUrl: SettingsService.instance.current.backendUrl ?? '');
    _load();
  }

  @override
  void dispose() {
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    _sessions = await _svc.listAll();
    if (_sessions.isEmpty) {
      _current = await _newSession();
    } else {
      _current = _sessions.first;
    }
    if (mounted) setState(() {});
  }

  Future<AiChatSession> _newSession() async {
    final s = AiChatSession(
      id: 'chat-${DateTime.now().millisecondsSinceEpoch}',
      title: 'Nueva conversación',
    );
    await _svc.save(s);
    _sessions.insert(0, s);
    return s;
  }

  Future<void> _send() async {
    final text = _inputCtrl.text.trim();
    if (text.isEmpty || _current == null) return;
    final userMsg = AiChatMessage(
      id: 'm-${DateTime.now().microsecondsSinceEpoch}',
      role: 'user',
      content: text,
      at: DateTime.now(),
      contextPaths: List.from(_contextPaths),
    );
    _current!.messages.add(userMsg);
    _current!.title = _deriveTitle(text);
    _current!.updatedAt = DateTime.now();
    await _svc.save(_current!);
    _inputCtrl.clear();
    if (mounted) setState(() { _thinking = true; });
    _scrollToBottom();
    try {
      // Build context string.
      final ctx = await _buildContext(_contextPaths);
      final resp = await _tutor!.ask(text, context: ctx);
      final aiMsg = AiChatMessage(
        id: 'm-${DateTime.now().microsecondsSinceEpoch}',
        role: 'assistant',
        content: resp.answer,
        at: DateTime.now(),
      );
      _current!.messages.add(aiMsg);
      _current!.updatedAt = DateTime.now();
      await _svc.save(_current!);
    } catch (e) {
      final errMsg = AiChatMessage(
        id: 'm-${DateTime.now().microsecondsSinceEpoch}',
        role: 'assistant',
        content: '⚠️ Error: $e',
        at: DateTime.now(),
      );
      _current!.messages.add(errMsg);
    } finally {
      if (mounted) setState(() { _thinking = false; });
      _scrollToBottom();
    }
  }

  String _deriveTitle(String firstMsg) {
    final words = firstMsg.split(RegExp(r'\s+')).take(5).join(' ');
    return words.length > 40 ? '${words.substring(0, 40)}…' : words;
  }

  Future<String> _buildContext(List<String> paths) async {
    if (paths.isEmpty) return '';
    final buf = StringBuffer();
    for (final path in paths.take(5)) {
      try {
        final note = await _vault.readNote(path);
        if (note != null) {
          buf.writeln('### ${note.title ?? p.basename(path)}');
          buf.writeln(note.content.length > 2000
              ? '${note.content.substring(0, 2000)}…'
              : note.content);
          buf.writeln('');
        }
      } catch (_) {}
    }
    return buf.toString();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _addContext() async {
    // Pide al usuario path de nota a incluir.
    final ctrl = TextEditingController();
    final r = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Añadir contexto (nota)'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'ruta/nota.md',
            labelText: 'Path relativo de la nota',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('Añadir'),
          ),
        ],
      ),
    );
    if (r != null && r.isNotEmpty) {
      setState(() => _contextPaths.add(r));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        top: true, bottom: false,
        child: Row(
          children: [
            _buildSidebar(),
            const VerticalDivider(width: 1),
            Expanded(child: _buildChatPanel()),
          ],
        ),
      ),
    );
  }

  Widget _buildSidebar() {
    final theme = Theme.of(context);
    return Container(
      width: 260,
      color: theme.colorScheme.surfaceContainerLow.withOpacity(0.4),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 16, 12, 8),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_back_rounded),
                  onPressed: () => Navigator.pop(context),
                ),
                Expanded(
                  child: Text('AI Chat', style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  )),
                ),
                IconButton(
                  icon: const Icon(Icons.add_rounded),
                  onPressed: () async {
                    final s = await _newSession();
                    setState(() {
                      _current = s;
                      _contextPaths.clear();
                    });
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: _sessions.length,
              itemBuilder: (ctx, i) {
                final s = _sessions[i];
                final selected = _current?.id == s.id;
                return InkWell(
                  onTap: () => setState(() { _current = s; _contextPaths.clear(); }),
                  onLongPress: () async {
                    await _svc.delete(s.id);
                    setState(() => _sessions.removeWhere((x) => x.id == s.id));
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    color: selected ? MxColors.indigoDeep.withOpacity(0.10) : null,
                    child: Row(
                      children: [
                        const Icon(Icons.chat_bubble_outline, size: 16),
                        const SizedBox(width: 8),
                        Expanded(child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(s.title, maxLines: 1, overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodySmall?.copyWith(
                                fontWeight: FontWeight.w600,
                              )),
                            Text('${s.messages.length} mensajes',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                                fontSize: 10,
                              )),
                          ],
                        )),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChatPanel() {
    if (_current == null) return const LoadingState(message: 'Cargando...');
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Column(
      children: [
        // Header
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: scheme.outlineVariant.withOpacity(0.3))),
          ),
          child: Row(children: [
            const Icon(Icons.auto_awesome, color: MxColors.violet),
            const SizedBox(width: 8),
            Text(_current!.title, style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            )),
            const Spacer(),
            IconButton(
              icon: const Icon(Icons.cleaning_services_outlined),
              onPressed: () async {
                _current!.messages.clear();
                await _svc.save(_current!);
                setState(() {});
              },
              tooltip: 'Limpiar chat',
            ),
          ]),
        ),
        // Context chips
        if (_contextPaths.isNotEmpty)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Wrap(spacing: 6, runSpacing: 4, children: [
              ..._contextPaths.map((pathStr) => InputChip(
                label: Text(p.basename(pathStr), style: const TextStyle(fontSize: 11)),
                onDeleted: () => setState(() => _contextPaths.remove(pathStr)),
              )),
            ]),
          ),
        // Messages
        Expanded(
          child: ListView.builder(
            controller: _scrollCtrl,
            padding: const EdgeInsets.all(MxSpacing.lg),
            itemCount: _current!.messages.length + (_thinking ? 1 : 0),
            itemBuilder: (ctx, i) {
              if (i == _current!.messages.length && _thinking) {
                return _ThinkingBubble();
              }
              final m = _current!.messages[i];
              return _MessageBubble(msg: m);
            },
          ),
        ),
        // Input
        Container(
          padding: EdgeInsets.fromLTRB(12, 8, 12,
            8 + MediaQuery.of(context).viewInsets.bottom),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerLow.withOpacity(0.5),
            border: Border(top: BorderSide(color: scheme.outlineVariant.withOpacity(0.3))),
          ),
          child: Row(
            children: [
              IconButton(
                icon: const Icon(Icons.attachment_outlined),
                onPressed: _addContext,
                tooltip: 'Añadir contexto',
              ),
              Expanded(
                child: TextField(
                  controller: _inputCtrl,
                  minLines: 1,
                  maxLines: 4,
                  decoration: InputDecoration(
                    hintText: 'Pregúntale a M-NEXUS AI...',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(MxRadius.lg),
                    ),
                  ),
                  onSubmitted: (_) => _send(),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                onPressed: _thinking ? null : _send,
                icon: const Icon(Icons.send_rounded, size: 18),
                style: IconButton.styleFrom(backgroundColor: MxColors.indigoDeep),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final AiChatMessage msg;
  const _MessageBubble({required this.msg});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isUser = msg.role == 'user';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: MxSpacing.xs),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!isUser)
            Container(
              width: 28, height: 28,
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [Color(0xFFA78BFA), Color(0xFF8B5CF6)]),
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: const Icon(Icons.auto_awesome, color: Colors.white, size: 14),
            ),
          if (!isUser) const SizedBox(width: 8),
          Flexible(
            child: Container(
              padding: const EdgeInsets.all(MxSpacing.md),
              decoration: BoxDecoration(
                color: isUser
                    ? MxColors.indigoDeep
                    : theme.colorScheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(MxRadius.lg),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    msg.content,
                    style: TextStyle(
                      color: isUser ? Colors.white : theme.colorScheme.onSurface,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    DateFormat('HH:mm').format(msg.at),
                    style: TextStyle(
                      fontSize: 10,
                      color: (isUser ? Colors.white70 : theme.colorScheme.onSurfaceVariant),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ThinkingBubble extends StatefulWidget {
  @override
  State<_ThinkingBubble> createState() => _ThinkingBubbleState();
}

class _ThinkingBubbleState extends State<_ThinkingBubble>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: MxSpacing.xs),
      child: Row(children: [
        Container(
          width: 28, height: 28,
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [Color(0xFFA78BFA), Color(0xFF8B5CF6)]),
            borderRadius: BorderRadius.circular(8),
          ),
          alignment: Alignment.center,
          child: const Icon(Icons.auto_awesome, color: Colors.white, size: 14),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.all(MxSpacing.md),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHigh,
            borderRadius: BorderRadius.circular(MxRadius.lg),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var i = 0; i < 3; i++)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 3),
                  child: AnimatedBuilder(
                    animation: _ctrl,
                    builder: (_, __) {
                      final t = (_ctrl.value - i * 0.3).clamp(0.0, 1.0);
                      return Container(
                        width: 6, height: 6,
                        decoration: BoxDecoration(
                          color: MxColors.violet.withOpacity(0.4 + 0.6 * t),
                          shape: BoxShape.circle,
                        ),
                      );
                    },
                  ),
                ),
            ],
          ),
        ),
      ]),
    );
  }
}
