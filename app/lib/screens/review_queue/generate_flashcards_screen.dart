// generate_flashcards_screen.dart: genera flashcards automáticamente.
//
// v0.47.37: escanea las notas del vault, extrae cloze deletions y
// patterns Q/A, genera flashcards candidatas y las guarda como
// Drafts (no Approved). El usuario revisa después en la cola de revisión.
//
// El botón "Generar" hace el escaneo y muestra cuántas flashcards
// se generaron. El botón "Ir a revisar" navega a ReviewQueueScreen.

import 'package:flutter/material.dart';
import '../../services/auto_flashcard_service.dart';
import 'review_queue_screen.dart';

class GenerateFlashcardsScreen extends StatefulWidget {
  final String vaultPath;
  final String? subjectPath; // opcional: asignatura específica
  const GenerateFlashcardsScreen({
    super.key,
    required this.vaultPath,
    this.subjectPath,
  });

  @override
  State<GenerateFlashcardsScreen> createState() => _GenerateFlashcardsScreenState();
}

class _GenerateFlashcardsScreenState extends State<GenerateFlashcardsScreen> {
  final _auto = AutoFlashcardService();
  bool _scanning = false;
  bool _done = false;
  int _generated = 0;
  String? _error;
  final List<GeneratedFlashcard> _cards = [];

  Future<void> _generate() async {
    setState(() {
      _scanning = true;
      _done = false;
      _error = null;
      _cards.clear();
      _generated = 0;
    });

    try {
      final candidates = await _auto.generate(
        vaultPath: widget.vaultPath,
        folder: widget.subjectPath ?? '',
      );
      final saved = await _auto.persistDrafts(
        vaultPath: widget.vaultPath,
        cards: candidates,
      );
      if (!mounted) return;
      setState(() {
        _scanning = false;
        _done = true;
        _cards.addAll(candidates);
        _generated = saved;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _scanning = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.subjectPath ?? 'Generar flashcards'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer.withOpacity(0.4),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.auto_awesome,
                          color: theme.colorScheme.primary),
                      const SizedBox(width: 8),
                      Text(
                        'Generación automática',
                        style: theme.textTheme.titleMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Escanea las notas del vault y extrae:\n'
                    '• Cloze deletions {{c1::texto}}\n'
                    '• Definitions "término: definición"\n'
                    '• Headings + siguiente línea como Q/A',
                    style: theme.textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _scanning ? null : _generate,
              icon: _scanning
                  ? const SizedBox(
                      width: 16, height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.auto_awesome),
              label: Text(_scanning ? 'Escaneando...' : 'Generar flashcards'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
            const SizedBox(height: 24),
            if (_error != null)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text('Error: $_error',
                    style: TextStyle(color: theme.colorScheme.onErrorContainer)),
              ),
            if (_done) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: theme.colorScheme.tertiaryContainer.withOpacity(0.5),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  children: [
                    Icon(Icons.check_circle,
                        size: 48, color: theme.colorScheme.tertiary),
                    const SizedBox(height: 8),
                    Text('$_generated flashcards generadas',
                        style: theme.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text('Se guardaron en Drafts. Revísalas antes de aprobar.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () {
                  Navigator.pushReplacement(
                    context,
                    MaterialPageRoute(
                      builder: (_) => ReviewQueueScreen(vaultPath: widget.vaultPath),
                    ),
                  );
                },
                icon: const Icon(Icons.task_alt),
                label: const Text('Ir a revisar'),
              ),
            ],
            if (_cards.isNotEmpty) ...[
              const SizedBox(height: 24),
              Text('Preview de las generadas:',
                  style: theme.textTheme.titleSmall),
              const SizedBox(height: 8),
              ..._cards.take(20).map((c) => Card(
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    child: ListTile(
                      leading: CircleAvatar(
                        radius: 14,
                        backgroundColor: theme.colorScheme.primaryContainer,
                        child: Icon(
                          c.generationType == 'cloze'
                              ? Icons.code
                              : c.generationType == 'definition'
                                  ? Icons.menu_book
                                  : Icons.psychology,
                          size: 14,
                        ),
                      ),
                      title: Text(c.question,
                          maxLines: 2, overflow: TextOverflow.ellipsis),
                      subtitle: Text(c.answer,
                          maxLines: 1, overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall),
                      trailing: Text(c.generationType,
                          style: theme.textTheme.labelSmall),
                    ),
                  )),
              if (_cards.length > 20)
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: Text('... y ${_cards.length - 20} más',
                      style: theme.textTheme.bodySmall),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
