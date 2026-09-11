// cloze_editor.dart: editor visual para cloze deletion (Fase 3.A.1).
//
// v0.46: usa syntax {{c1::texto::hint}} estilo Anki.
// El editor permite:
//   - Escribir markdown con cloze syntax
//   - Ver preview en tiempo real con [___] por cloze
//   - Count de clozes unicos
//   - Insertar cloze template con boton
//   - Toggle entre edit/preview mode
//
// v0.46: usa ClozeService (Fase 3.A backend) + el parser en app.

import 'package:flutter/material.dart';
import '../../l10n/app_localizations.dart';
import '../../models/cloze.dart';
import '../../services/cloze_service.dart';

class ClozeEditor extends StatefulWidget {
  final String? initialContent;
  final ValueChanged<String> onContentChanged;
  final VoidCallback? onSave;

  const ClozeEditor({
    super.key,
    this.initialContent,
    required this.onContentChanged,
    this.onSave,
  });

  @override
  State<ClozeEditor> createState() => _ClozeEditorState();
}

class _ClozeEditorState extends State<ClozeEditor> with SingleTickerProviderStateMixin {
  late TextEditingController _controller;
  late FocusNode _focusNode;
  bool _showPreview = false;
  late TabController _tabController;
  List<ClozeInfo> _clozes = [];

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialContent ?? '');
    _focusNode = FocusNode();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(_onTabChanged);
    _controller.addListener(_onTextChanged);
    _reparseClozes();
  }

  @override
  void dispose() {
    _tabController.removeListener(_onTabChanged);
    _controller.removeListener(_onTextChanged);
    _controller.dispose();
    _focusNode.dispose();
    _tabController.dispose();
    super.dispose();
  }

  void _onTabChanged() {
    setState(() {
      _showPreview = _tabController.index == 1;
    });
  }

  void _onTextChanged() {
    _reparseClozes();
    widget.onContentChanged(_controller.text);
  }

  void _reparseClozes() {
    setState(() {
      _clozes = ClozeService.parseCloze(_controller.text);
    });
  }

  void _insertCloze() {
    final nextNum = _clozes.isEmpty
        ? 1
        : _clozes.map((c) => c.number).reduce((a, b) => a > b ? a : b) + 1;
    final snippet = '{{c$nextNum::respuesta}}';
    final current = _controller.text;
    final selection = _controller.selection;
    final insertAt = selection.isValid ? selection.start : current.length;
    final newText = current.substring(0, insertAt) + snippet + current.substring(insertAt);
    _controller.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(offset: insertAt + snippet.length - 11), // pos inside
    );
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final cards = ClozeService.generateCards(_controller.text);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Tab bar
        TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.edit), text: 'Edit'),
            Tab(icon: Icon(Icons.preview), text: 'Preview'),
          ],
        ),

        // Content
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _buildEditor(theme),
              _buildPreview(theme, cards),
            ],
          ),
        ),

        // Footer
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest,
            border: Border(top: BorderSide(color: theme.dividerColor)),
          ),
          child: Row(
            children: [
              IconButton(
                icon: const Icon(Icons.add_box_outlined),
                tooltip: 'Insert cloze',
                onPressed: _insertCloze,
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  l10n.clozeCount(ClozeService.count(_controller.text)),
                  style: TextStyle(
                    fontSize: 12,
                    color: theme.colorScheme.onPrimaryContainer,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: theme.colorScheme.secondaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '${cards.length} card${cards.length == 1 ? '' : 's'}',
                  style: TextStyle(
                    fontSize: 12,
                    color: theme.colorScheme.onSecondaryContainer,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              const Spacer(),
              if (widget.onSave != null)
                FilledButton.icon(
                  icon: const Icon(Icons.save, size: 18),
                  label: Text(l10n.commonSave),
                  onPressed: widget.onSave,
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEditor(ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: TextField(
        controller: _controller,
        focusNode: _focusNode,
        maxLines: null,
        expands: true,
        textAlignVertical: TextAlignVertical.top,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 14, height: 1.5),
        decoration: InputDecoration(
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
          hintText: 'Escribe tu texto aquí. Envuelve con {{c1::respuesta}} para crear un cloze.',
          helperText: 'Tip: clic en + para insertar un cloze',
        ),
      ),
    );
  }

  Widget _buildPreview(ThemeData theme, List<ClozeCard> cards) {
    if (cards.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.visibility_off, size: 64, color: theme.disabledColor),
            const SizedBox(height: 12),
            Text(
              'No hay clozes en este texto',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Agrega {{c1::texto}} a tu texto para ver el preview',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: cards.length,
      itemBuilder: (context, index) {
        final card = cards[index];
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 12,
                      backgroundColor: theme.colorScheme.primary,
                      child: Text(
                        '${card.number}',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.colorScheme.onPrimary,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text('Card ${card.number}',
                        style: theme.textTheme.titleSmall),
                    if (card.hint != null) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.tertiaryContainer,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          'Hint: ${card.hint}',
                          style: TextStyle(
                            fontSize: 11,
                            color: theme.colorScheme.onTertiaryContainer,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),
                _renderTextWithCloze(card.textWithCloze, card.number, theme),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _renderTextWithCloze(String text, int activeCloze, ThemeData theme) {
    // Render: oculta el clozoe activo, muestra el resto en negrita.
    final clozeRegex = RegExp(r'\{\{c(\d+)::([^}:]+)(?:::([^}]*))?\}\}');
    final spans = <InlineSpan>[];
    int lastEnd = 0;
    for (final match in clozeRegex.allMatches(text)) {
      if (match.start > lastEnd) {
        spans.add(TextSpan(text: text.substring(lastEnd, match.start)));
      }
      final num = int.parse(match.group(1)!);
      final hidden = match.group(2)!;
      final hint = match.group(3);
      if (num == activeCloze) {
        // Hide this cloze
        spans.add(TextSpan(
          text: hint != null ? '[...] ($hint)' : '[...]',
          style: TextStyle(
            backgroundColor: theme.colorScheme.errorContainer,
            color: theme.colorScheme.onErrorContainer,
            fontWeight: FontWeight.bold,
          ),
        ));
      } else {
        // Show this cloze
        spans.add(TextSpan(
          text: hidden,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ));
      }
      lastEnd = match.end;
    }
    if (lastEnd < text.length) {
      spans.add(TextSpan(text: text.substring(lastEnd)));
    }
    return Text.rich(TextSpan(
      children: spans,
      style: theme.textTheme.bodyLarge,
    ));
  }
}
