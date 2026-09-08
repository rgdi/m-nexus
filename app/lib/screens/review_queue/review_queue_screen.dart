// review_queue_screen.dart: cola de revisión de flashcards.
//
// v0.47.37: pantalla donde el usuario revisa flashcards generadas
// automáticamente o en estado Drafts. Cada tarjeta muestra:
//   - Source: la nota de la que se generó (con [[wikilink]])
//   - Question + answer preview
//   - Botones: Aprobar, Editar, Borrar
//
// Las flashcards aprobadas se mueven a Approved/ y aparecen en
// el repaso regular. Las borradas se eliminan.

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../../services/flashcard_service.dart';
import '../../services/vault_service.dart';
import '../note/note_view.dart';

class ReviewQueueScreen extends StatefulWidget {
  final String vaultPath;
  const ReviewQueueScreen({super.key, required this.vaultPath});

  @override
  State<ReviewQueueScreen> createState() => _ReviewQueueScreenState();
}

class _ReviewQueueScreenState extends State<ReviewQueueScreen> {
  late final FlashcardService _service;
  List<Flashcard> _drafts = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _service = FlashcardService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final all = await _service.listAll();
    final drafts = all.where((c) => !c.approved).toList();
    if (!mounted) return;
    setState(() {
      _drafts = drafts;
      _loading = false;
    });
  }

  Future<void> _approve(Flashcard c) async {
    await _service.approve(c);
    await _load();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('✅ Aprobada: ${c.question.substring(0, c.question.length.clamp(0, 40))}...')),
    );
  }

  Future<void> _delete(Flashcard c) async {
    await _service.delete(c);
    await _load();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('🗑 Borrada: ${c.question.substring(0, c.question.length.clamp(0, 40))}...')),
    );
  }

  Future<void> _openSource(Flashcard c) async {
    // v0.47.37: navegar a la nota fuente. Usamos VaultService directamente
    // para leer metadata, luego NoteView abre la nota.
    final vault = VaultService(widget.vaultPath);
    final note = await vault.readNote(c.path);
    if (note == null) return;
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => NoteView(
          notePath: c.path,
          vaultPath: widget.vaultPath,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pendientes de revisión'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refrescar',
            onPressed: _load,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _drafts.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.task_alt,
                          size: 64, color: theme.colorScheme.primary),
                      const SizedBox(height: 16),
                      Text('Sin flashcards pendientes',
                          style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Text('Genera nuevas desde Ajustes',
                          style: theme.textTheme.bodySmall),
                    ],
                  ),
                )
              : Column(
                  children: [
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      color: theme.colorScheme.primaryContainer.withOpacity(0.3),
                      child: Text(
                        '${_drafts.length} flashcard${_drafts.length == 1 ? "" : "s"} esperando revisión',
                        style: theme.textTheme.titleMedium,
                      ),
                    ),
                    Expanded(
                      child: ListView.builder(
                        itemCount: _drafts.length,
                        itemBuilder: (ctx, i) {
                          final c = _drafts[i];
                          final filename = p.basenameWithoutExtension(c.path);
                          return Card(
                            margin: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 6),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Icon(Icons.note_outlined,
                                          size: 16,
                                          color: theme.colorScheme.outline),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: Text(
                                          filename,
                                          style: theme.textTheme.bodySmall?.copyWith(
                                            fontStyle: FontStyle.italic,
                                            color: theme.colorScheme.outline,
                                          ),
                                        ),
                                      ),
                                      TextButton(
                                        onPressed: () => _openSource(c),
                                        child: const Text('Ver nota'),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    '❓ ${c.question}',
                                    style: theme.textTheme.titleSmall,
                                  ),
                                  const SizedBox(height: 4),
                                  Container(
                                    padding: const EdgeInsets.all(8),
                                    decoration: BoxDecoration(
                                      color: theme.colorScheme.surfaceContainerHigh,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Text(
                                      '✅ ${c.answer}',
                                      style: theme.textTheme.bodyMedium,
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.end,
                                    children: [
                                      TextButton.icon(
                                        onPressed: () => _delete(c),
                                        icon: const Icon(Icons.delete_outline, size: 18),
                                        label: const Text('Borrar'),
                                        style: TextButton.styleFrom(
                                          foregroundColor: theme.colorScheme.error,
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      FilledButton.icon(
                                        onPressed: () => _approve(c),
                                        icon: const Icon(Icons.check, size: 18),
                                        label: const Text('Aprobar'),
                                      ),
                                    ],
                                  ),
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
}
