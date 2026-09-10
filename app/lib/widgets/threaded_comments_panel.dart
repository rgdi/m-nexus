// threaded_comments_panel.dart: panel de comentarios en una nota.
//
// v0.50: muestra todos los comentarios agrupados por bloque.
// Permite anadir respuestas (threaded).

import 'package:flutter/material.dart';
import '../services/comments_service.dart';
import '../screens/note/block_editor.dart' show BlockComment;

class ThreadedCommentsPanel extends StatefulWidget {
  final String notePath;
  /// Map<blockId, blockText> para mostrar contexto
  final Map<String, String> blockContexts;
  final VoidCallback? onClose;
  const ThreadedCommentsPanel({
    super.key,
    required this.notePath,
    required this.blockContexts,
    this.onClose,
  });

  @override
  State<ThreadedCommentsPanel> createState() => _ThreadedCommentsPanelState();
}

class _ThreadedCommentsPanelState extends State<ThreadedCommentsPanel> {
  late final CommentsService _service;
  Map<String, List<BlockComment>> _comments = {};
  bool _loading = true;
  String _newCommentText = '';
  String? _replyingTo;

  @override
  void initState() {
    super.initState();
    _service = CommentsService(widget.notePath);
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final c = await _service.loadForNote(widget.notePath);
    if (!mounted) return;
    setState(() {
      _comments = c;
      _loading = false;
    });
  }

  Future<void> _addComment(String blockId, String text, {String? replyTo}) async {
    if (text.trim().isEmpty) return;
    final all = await _service.loadForNote(widget.notePath);
    final list = all[blockId] ?? <BlockComment>[];
    list.add(BlockComment(
      id: 'c-${DateTime.now().microsecondsSinceEpoch}',
      text: text,
      author: 'me',
      createdAt: DateTime.now(),
      replyTo: replyTo,
    ));
    all[blockId] = list;
    await _service.saveForNote(widget.notePath, all);
    _newCommentText = '';
    _replyingTo = null;
    await _load();
  }

  Future<void> _deleteComment(String blockId, String commentId) async {
    await _service.deleteComment(widget.notePath, blockId, commentId);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final total = _comments.values.fold(0, (s, l) => s + l.length);
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        border: Border(left: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: theme.colorScheme.outlineVariant)),
            ),
            child: Row(
              children: [
                Icon(Icons.forum_outlined, color: theme.colorScheme.primary, size: 18),
                const SizedBox(width: 8),
                Text('Comentarios ($total)',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const Spacer(),
                if (widget.onClose != null)
                  IconButton(icon: const Icon(Icons.close, size: 18), onPressed: widget.onClose),
              ],
            ),
          ),
          Expanded(
            child: _loading
              ? const Center(child: CircularProgressIndicator())
              : total == 0
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        'No hay comentarios todavia.\nSelecciona un bloque y anade uno.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.all(8),
                    children: _comments.entries.expand((entry) {
                      return [
                        _buildBlockHeader(entry.key, entry.value.length, theme),
                        ...entry.value.map((c) => _buildComment(c, entry.key, theme)),
                        _buildAddCommentField(entry.key, theme),
                        const SizedBox(height: 12),
                      ];
                    }).toList(),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildBlockHeader(String blockId, int count, ThemeData theme) {
    final ctx = widget.blockContexts[blockId] ?? '(bloque sin texto)';
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Icon(Icons.short_text, size: 14, color: theme.colorScheme.primary),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              ctx.length > 80 ? '${ctx.substring(0, 80)}...' : ctx,
              style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text('$count', style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  Widget _buildComment(BlockComment c, String blockId, ThemeData theme) {
    return Container(
      margin: const EdgeInsets.only(left: 16, top: 4, bottom: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 10,
                backgroundColor: theme.colorScheme.primaryContainer,
                child: Text(
                  c.author.isEmpty ? '?' : c.author[0].toUpperCase(),
                  style: TextStyle(fontSize: 10, color: theme.colorScheme.onPrimaryContainer),
                ),
              ),
              const SizedBox(width: 6),
              Text(c.author.isEmpty ? 'Anonimo' : c.author,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: theme.colorScheme.onSurface)),
              const Spacer(),
              Text(_ago(c.createdAt),
                style: TextStyle(fontSize: 10, color: theme.colorScheme.onSurfaceVariant)),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 12),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                onPressed: () => _deleteComment(blockId, c.id),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(c.text, style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurface)),
          if (c.replyTo != null)
            Padding(
              padding: const EdgeInsets.only(top: 4, left: 8),
              child: Text('reply to ${c.replyTo}',
                style: TextStyle(fontSize: 10, color: theme.colorScheme.onSurfaceVariant, fontStyle: FontStyle.italic)),
            ),
        ],
      ),
    );
  }

  Widget _buildAddCommentField(String blockId, ThemeData theme) {
    final isReplying = _replyingTo != null;
    return Padding(
      padding: const EdgeInsets.only(left: 16, top: 4),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              decoration: InputDecoration(
                hintText: isReplying ? 'Reply...' : 'Anadir comentario a este bloque...',
                isDense: true,
                filled: true,
                fillColor: theme.colorScheme.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(6),
                  borderSide: BorderSide(color: theme.colorScheme.outlineVariant),
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              ),
              onChanged: (v) => _newCommentText = v,
              onSubmitted: (v) => _addComment(blockId, v, replyTo: isReplying ? _replyingTo : null),
            ),
          ),
          const SizedBox(width: 4),
          IconButton(
            icon: const Icon(Icons.send, size: 16),
            onPressed: () => _addComment(blockId, _newCommentText, replyTo: isReplying ? _replyingTo : null),
          ),
        ],
      ),
    );
  }

  String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inSeconds < 60) return 'ahora';
    if (d.inMinutes < 60) return 'hace ${d.inMinutes}m';
    if (d.inHours < 24) return 'hace ${d.inHours}h';
    return 'hace ${d.inDays}d';
  }
}
