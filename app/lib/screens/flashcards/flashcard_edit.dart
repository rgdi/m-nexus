// FlashcardEdit: crear nueva flashcard.
//
// v0.47.0: rediseño completo con estilo cristal limpio.
// v0.47.0: la "dificultad" ahora es solo orientativa, se evalúa automáticamente
//          con FSRS después de varios ciclos. El usuario puede dejar el default.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import '../../services/flashcard_service.dart';
import '../../state/app_state.dart';

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
  bool _saving = false;
  String? _questionError;
  String? _answerError;

  @override
  void dispose() {
    _question.dispose();
    _answer.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final q = _question.text.trim();
    final a = _answer.text.trim();
    setState(() {
      _questionError = q.isEmpty ? 'La pregunta es obligatoria' : null;
      _answerError = a.isEmpty ? 'La respuesta es obligatoria' : null;
    });
    if (q.isEmpty || a.isEmpty) return;

    setState(() => _saving = true);
    try {
      await widget.service.create(
        question: q,
        answer: a,
        difficulty: 3, // default; FSRS recalcula después
      );
      // Recarga el cache global
      await AppState.instance.reload();
      widget.onSaved?.call();
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Nueva tarjeta'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(width: 16, height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.save, size: 18),
              label: const Text('Guardar'),
              style: FilledButton.styleFrom(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Pregunta
            _Label('Pregunta'),
            const SizedBox(height: 8),
            TextField(
              controller: _question,
              maxLines: 3,
              minLines: 2,
              autofocus: true,
              style: theme.textTheme.bodyLarge,
              decoration: InputDecoration(
                hintText: '¿Cuál es la función principal del diafragma?',
                errorText: _questionError,
                filled: true,
                fillColor: theme.colorScheme.surfaceContainerLow,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.all(16),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Tip: usa {{c1::texto oculto}} para cloze',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),

            const SizedBox(height: 24),

            // Respuesta
            _Label('Respuesta'),
            const SizedBox(height: 8),
            TextField(
              controller: _answer,
              maxLines: 8,
              minLines: 4,
              style: theme.textTheme.bodyLarge,
              decoration: InputDecoration(
                hintText: 'Separar torax y abdomen, permite la respiración',
                errorText: _answerError,
                filled: true,
                fillColor: theme.colorScheme.surfaceContainerLow,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.all(16),
              ),
            ),

            const SizedBox(height: 24),

            // Info FSRS
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer.withOpacity(0.5),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  Icon(Icons.psychology_outlined,
                      color: theme.colorScheme.primary, size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Dificultad auto-evaluada',
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'FSRS calcula la dificultad real después de unos ciclos. '
                          'No tienes que configurar nada.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),
            Text(
              'Guardada en _M-NEXUS/Flashcards/Approved',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Label extends StatelessWidget {
  final String text;
  const _Label(this.text);
  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: Theme.of(context).textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w600,
          ),
    );
  }
}
