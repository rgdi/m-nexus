// FlashcardsViewerPage: lista y muestra las flashcards del vault.
//
// v0.40 standalone: lee de:
//   - {vault}/_M-NEXUS/Flashcards/Approved/*.md
//   - {vault}/_M-NEXUS/Flashcards/Drafts/*.md
//
// Formato esperado (compatible con el plugin):
//   ---
//   id: <uuid>
//   question: |
//     Texto de la pregunta
//   answer: |
//     Texto de la respuesta
//   difficulty: 1-5
//   nextReview: 2026-09-10
//   ---

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import '../services/logger.dart';

class FlashcardsViewerPage extends StatefulWidget {
  final String vaultPath;
  const FlashcardsViewerPage({super.key, required this.vaultPath});

  @override
  State<FlashcardsViewerPage> createState() => _FlashcardsViewerPageState();
}

class _FlashcardsViewerPageState extends State<FlashcardsViewerPage> {
  List<_Flashcard> _all = [];
  List<_Flashcard> _filtered = [];
  bool _loading = true;
  String? _error;
  String _search = '';
  bool _showAnswers = false;
  int? _currentIndex;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    final log = AdvancedLogger.instance;
    try {
      final approvedDir = Directory(p.join(widget.vaultPath, '_M-NEXUS', 'Flashcards', 'Approved'));
      final draftsDir = Directory(p.join(widget.vaultPath, '_M-NEXUS', 'Flashcards', 'Drafts'));

      final all = <_Flashcard>[];
      if (await approvedDir.exists()) {
        await _loadDir(approvedDir, all, approved: true);
      }
      if (await draftsDir.exists()) {
        await _loadDir(draftsDir, all, approved: false);
      }

      _all = all;
      _applyFilter();
      log.info('flashcards', 'Loaded',
        context: {'total': _all.length, 'approved': _all.where((c) => c.approved).length, 'drafts': _all.where((c) => !c.approved).length});
    } catch (e, s) {
      log.error('flashcards', 'Load failed', error: e, stack: s);
      _error = e.toString();
    }
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  Future<void> _loadDir(Directory dir, List<_Flashcard> into, {required bool approved}) async {
    final files = await dir.list().toList();
    for (final f in files) {
      if (f is! File || p.extension(f.path) != '.md') continue;
      try {
        final raw = await f.readAsString();
        final card = _parseFlashcard(raw, sourcePath: f.path, approved: approved);
        if (card != null) into.add(card);
      } catch (_) {
        // Skip broken files
      }
    }
  }

  _Flashcard? _parseFlashcard(String raw, {required String sourcePath, required bool approved}) {
    // Frontmatter simple
    if (!raw.startsWith('---')) return null;
    final lines = raw.split('\n');
    if (lines.length < 3 || lines[0].trim() != '---') return null;
    final endIdx = lines.indexWhere((l) => l.trim() == '---', 1);
    if (endIdx == -1) return null;

    final fmLines = lines.sublist(1, endIdx);
    final body = lines.sublist(endIdx + 1).join('\n');
    final fm = <String, String>{};
    for (final line in fmLines) {
      final m = RegExp(r'^(\w+)\s*:\s*(.*)$').firstMatch(line.trim());
      if (m != null) {
        fm[m.group(1)!] = m.group(2)!.trim();
      }
    }
    return _Flashcard(
      id: fm['id'] ?? p.basenameWithoutExtension(sourcePath),
      question: fm['question'] ?? body.trim().split('\n').first,
      answer: fm['answer'] ?? '',
      difficulty: int.tryParse(fm['difficulty'] ?? '3') ?? 3,
      nextReview: DateTime.tryParse(fm['nextReview'] ?? '') ?? DateTime.now(),
      sourcePath: sourcePath,
      approved: approved,
    );
  }

  void _applyFilter() {
    if (_search.isEmpty) {
      _filtered = List.of(_all);
    } else {
      final q = _search.toLowerCase();
      _filtered = _all.where((c) =>
        c.question.toLowerCase().contains(q) ||
        c.answer.toLowerCase().contains(q) ||
        c.id.toLowerCase().contains(q)
      ).toList();
    }
    _filtered.sort((a, b) => a.nextReview.compareTo(b.nextReview));
  }

  void _openReview() {
    if (_filtered.isEmpty) return;
    setState(() => _currentIndex = 0);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Flashcards', style: TextStyle(fontSize: 16)),
            Text('${_filtered.length} de ${_all.length}',
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.normal)),
          ],
        ),
        actions: [
          if (_currentIndex == null && _filtered.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.play_arrow, size: 22),
              tooltip: 'Revisar (${_filtered.length})',
              onPressed: _openReview,
            ),
          IconButton(
            icon: const Icon(Icons.refresh, size: 20),
            onPressed: _load,
          ),
        ],
      ),
      body: _currentIndex != null
          ? _buildReviewMode()
          : _buildList(),
    );
  }

  Widget _buildList() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Buscar...',
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(20)),
            ),
            onChanged: (v) {
              setState(() {
                _search = v;
                _applyFilter();
              });
            },
          ),
        ),
        if (_loading)
          const Expanded(child: Center(child: CircularProgressIndicator()))
        else if (_error != null)
          Expanded(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline, color: Colors.red, size: 48),
                  const SizedBox(height: 8),
                  Text(_error!),
                ],
              ),
            ),
          )
        else if (_filtered.isEmpty)
          const Expanded(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.style, size: 48, color: Colors.grey),
                  SizedBox(height: 8),
                  Text('No hay flashcards todavía'),
                  Text('Crea una en Obsidian o graba una clase', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ),
          )
        else
          Expanded(
            child: ListView.builder(
              itemCount: _filtered.length,
              itemBuilder: (ctx, i) {
                final c = _filtered[i];
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: c.approved ? Colors.green : Colors.orange,
                    child: Text('${c.difficulty}',
                      style: const TextStyle(color: Colors.white, fontSize: 12)),
                  ),
                  title: Text(c.question, maxLines: 2, overflow: TextOverflow.ellipsis),
                  subtitle: Text(
                    c.approved
                        ? '✓ Aprobada · rev. ${_formatDate(c.nextReview)}'
                        : '📝 Borrador',
                    style: const TextStyle(fontSize: 11),
                  ),
                  trailing: Icon(
                    c.approved ? Icons.check_circle : Icons.edit_note,
                    color: c.approved ? Colors.green : Colors.orange,
                    size: 18,
                  ),
                  onTap: () {
                    setState(() {
                      _currentIndex = _filtered.indexOf(c);
                    });
                  },
                );
              },
            ),
          ),
      ],
    );
  }

  Widget _buildReviewMode() {
    if (_currentIndex! >= _filtered.length) {
      _currentIndex = null;
      return _buildList();
    }
    final card = _filtered[_currentIndex!];
    return Column(
      children: [
        // Header
        Container(
          padding: const EdgeInsets.all(12),
          color: Colors.blue.shade50,
          child: Row(
            children: [
              Text('${_currentIndex! + 1} / ${_filtered.length}',
                style: const TextStyle(fontWeight: FontWeight.bold)),
              const Spacer(),
              if (!card.approved)
                const Chip(label: Text('Borrador', style: TextStyle(fontSize: 10)))
              else
                Chip(label: Text('✓ Aprobada', style: const TextStyle(fontSize: 10)),
                  backgroundColor: Colors.green.shade100),
              const SizedBox(width: 8),
              Text('D${card.difficulty}',
                style: TextStyle(color: Colors.amber.shade700, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
        // Card
        Expanded(
          child: GestureDetector(
            onTap: () => setState(() => _showAnswers = !_showAnswers),
            child: Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: _showAnswers ? Colors.green.shade50 : Colors.blue.shade50,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _showAnswers ? Colors.green : Colors.blue,
                  width: 2,
                ),
              ),
              child: Center(
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _showAnswers ? 'Respuesta:' : 'Pregunta:',
                        style: TextStyle(
                          color: _showAnswers ? Colors.green.shade700 : Colors.blue.shade700,
                          fontSize: 12, fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _showAnswers ? card.answer : card.question,
                        style: const TextStyle(fontSize: 18, height: 1.4),
                      ),
                      if (!_showAnswers) ...[
                        const SizedBox(height: 24),
                        const Text('👆 Toca para ver la respuesta',
                          style: TextStyle(color: Colors.grey, fontSize: 12)),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        // Nav
        Container(
          padding: const EdgeInsets.all(12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton.filledTonal(
                onPressed: _currentIndex! > 0
                    ? () => setState(() {
                        _currentIndex = _currentIndex! - 1;
                        _showAnswers = false;
                      })
                    : null,
                icon: const Icon(Icons.arrow_back),
              ),
              FilledButton.icon(
                onPressed: () => setState(() => _showAnswers = !_showAnswers),
                icon: Icon(_showAnswers ? Icons.visibility_off : Icons.visibility),
                label: Text(_showAnswers ? 'Pregunta' : 'Respuesta'),
              ),
              IconButton.filledTonal(
                onPressed: _currentIndex! < _filtered.length - 1
                    ? () => setState(() {
                        _currentIndex = _currentIndex! + 1;
                        _showAnswers = false;
                      })
                    : null,
                icon: const Icon(Icons.arrow_forward),
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _formatDate(DateTime d) {
    final now = DateTime.now();
    final diff = d.difference(now).inDays;
    if (diff < 0) return 'vencida';
    if (diff == 0) return 'hoy';
    if (diff == 1) return 'mañana';
    return '${d.day}/${d.month}';
  }
}

class _Flashcard {
  final String id;
  final String question;
  final String answer;
  final int difficulty;
  final DateTime nextReview;
  final String sourcePath;
  final bool approved;

  const _Flashcard({
    required this.id,
    required this.question,
    required this.answer,
    required this.difficulty,
    required this.nextReview,
    required this.sourcePath,
    required this.approved,
  });
}
