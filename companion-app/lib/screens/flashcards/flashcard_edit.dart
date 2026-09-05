// FlashcardEdit: crear nueva flashcard.

import 'package:flutter/material.dart';
import '../../services/flashcard_service.dart';

class FlashcardEdit extends StatefulWidget {
  final FlashcardService service;
  final VoidCallback? onSaved;
  const FlashcardEdit({super.key, required this.service, this.onSaved});

  @override
  State<FlashcardEdit> createState() => _FlashcardEditState();
}

class _FlashcardEditState extends State<FlashcardEdit> {
  final _question = TextEditingController();
  final _answer = TextEditingController();
  int _difficulty = 3;
  bool _saving = false;

  @override
  void dispose() {
    _question.dispose();
    _answer.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_question.text.trim().isEmpty || _answer.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pregunta y respuesta son obligatorias')),
      );
      return;
    }
    setState(() { _saving = true; });
    await widget.service.create(
      question: _question.text.trim(),
      answer: _answer.text.trim(),
      difficulty: _difficulty,
    );
    widget.onSaved?.call();
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Nueva tarjeta'),
        actions: [
          FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(width: 16, height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save, size: 18),
            label: const Text('Guardar'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Pregunta',
              style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            TextField(
              controller: _question,
              maxLines: 3,
              minLines: 2,
              decoration: const InputDecoration(
                hintText: '¿Cuál es la…?',
              ),
            ),
            const SizedBox(height: 16),
            const Text('Respuesta',
              style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            TextField(
              controller: _answer,
              maxLines: 6,
              minLines: 3,
              decoration: const InputDecoration(
                hintText: 'La respuesta es…',
              ),
            ),
            const SizedBox(height: 16),
            const Text('Dificultad inicial',
              style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Row(
              children: [
                for (var i = 1; i <= 5; i++)
                  Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: ChoiceChip(
                      label: Text('$i'),
                      selected: _difficulty == i,
                      onSelected: (_) => setState(() { _difficulty = i; }),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Row(
                children: [
                  Icon(Icons.info_outline, size: 16),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Se guarda en _M-NEXUS/Flashcards/Drafts. '
                      'Mover a Approved desde la lista para que aparezca en repasos.',
                      style: TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
