// FlashcardEdit: crear/editar flashcard.
//
// v0.47.0: rediseño completo con estilo cristal limpio.
// v0.47.0: la "dificultad" ahora es solo orientativa, se evalúa automáticamente
//          con FSRS después de varios ciclos. El usuario puede dejar el default.
// v0.49.7: soporta edicion (parametro optional 'existing').

import 'package:flutter/material.dart';
import '../../l10n/app_localizations.dart';
import '../../services/flashcard_service.dart';
import '../../state/app_state.dart';

class FlashcardEdit extends StatefulWidget {
  final FlashcardService service;
  final VoidCallback? onSaved;
  /// v0.49.7: si se pasa, se edita; si no, se crea.
  final Flashcard? existing;
  const FlashcardEdit({super.key, required this.service, this.onSaved, this.existing});

  @override
  State<FlashcardEdit> createState() => _FlashcardEditState();
}

class _FlashcardEditState extends State<FlashcardEdit> {
  final _question = TextEditingController();
  final _answer = TextEditingController();
  bool _saving = false;
  bool _deleting = false;
  String? _questionError;
  String? _answerError;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    if (widget.existing != null) {
      _question.text = widget.existing!.question;
      _answer.text = widget.existing!.answer;
    }
  }

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
      if (_isEditing) {
        // v0.49.7: edit - delete old + create new (no update method yet)
        await widget.service.delete(widget.existing!);
        await widget.service.create(
          question: q,
          answer: a,
          difficulty: 3,
        );
      } else {
        await widget.service.create(
          question: q,
          answer: a,
          difficulty: 3,
        );
      }
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

  Future<void> _delete() async {
    if (!_isEditing) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Eliminar tarjeta?'),
        content: const Text('Se eliminará permanentemente.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _deleting = true);
    try {
      await widget.service.delete(widget.existing!);
      await AppState.instance.reload();
      widget.onSaved?.call();
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _deleting = false);
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
        title: Text(_isEditing ? 'Editar tarjeta' : 'Nueva tarjeta'),
        actions: [
          if (_isEditing)
            IconButton(
              icon: const Icon(Icons.delete_outline, color: Colors.red),
              onPressed: _deleting ? null : _delete,
              tooltip: 'Eliminar',
            ),
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
              autofocus: !_isEditing,
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

            // v0.49.7: stats si estamos editando
            if (_isEditing) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: theme.colorScheme.secondaryContainer.withOpacity(0.5),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.analytics_outlined,
                            color: theme.colorScheme.secondary, size: 20),
                        const SizedBox(width: 12),
                        Text(
                          'Estadísticas',
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    _StatRow('Estado', _stateLabel(widget.existing!.state)),
                    _StatRow('Repasos', '${widget.existing!.reps}'),
                    _StatRow('Fallos', '${widget.existing!.lapses}'),
                    _StatRow('Estabilidad (S)', widget.existing!.stability.toStringAsFixed(2)),
                    _StatRow('Próximo repaso',
                      widget.existing!.nextReview == null
                        ? 'nunca'
                        : '${widget.existing!.nextReview!.difference(DateTime.now()).inDays} días'),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 16),
            Text(
              _isEditing
                ? 'ID: ${widget.existing!.id}'
                : 'Guardada en _M-NEXUS/Flashcards/Approved',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _stateLabel(int s) {
    switch (s) {
      case 0: return 'Nueva';
      case 1: return 'Aprendiendo';
      case 2: return 'Repaso';
      case 3: return 'Re-aprendizaje';
      default: return 'Desconocido ($s)';
    }
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

class _StatRow extends StatelessWidget {
  final String label;
  final String value;
  const _StatRow(this.label, this.value);
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: theme.textTheme.bodySmall),
          Text(value, style: theme.textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.w600,
          )),
        ],
      ),
    );
  }
}
