// CommandPaletteDialog: paleta de acciones estilo Ctrl+K (RemNote/Obsidian).
//
// v0.48: lista de acciones rápidas que el usuario puede buscar y ejecutar.
//   - Nueva nota
//   - Abrir nota diaria
//   - Repasar tarjetas
//   - Nueva flashcard
//   - Ir a vault
//   - Settings
//
// Diseño:
//   - Búsqueda fuzzy sobre title/subtitle
//   - Enter para ejecutar, Esc para cerrar
//   - Item seleccionado destacado

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class _CommandItem {
  final String id;
  final String title;
  final String subtitle;
  final IconData icon;

  const _CommandItem({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.icon,
  });
}

class CommandPaletteDialog extends StatefulWidget {
  const CommandPaletteDialog({super.key});

  @override
  State<CommandPaletteDialog> createState() => _CommandPaletteDialogState();
}

class _CommandPaletteDialogState extends State<CommandPaletteDialog> {
  final _searchCtrl = TextEditingController();
  final _focusNode = FocusNode();
  int _selectedIdx = 0;

  static const _commands = [
    _CommandItem(
      id: 'new_note',
      title: 'Nueva nota',
      subtitle: 'Crear una nota markdown',
      icon: Icons.note_add_outlined,
    ),
    _CommandItem(
      id: 'open_daily',
      title: 'Abrir nota diaria',
      subtitle: 'Crea la nota de hoy si no existe',
      icon: Icons.today_outlined,
    ),
    _CommandItem(
      id: 'review_due',
      title: 'Repasar tarjetas pendientes',
      subtitle: 'Sesión FSRS con tarjetas vencidas',
      icon: Icons.style_outlined,
    ),
    _CommandItem(
      id: 'new_flashcard',
      title: 'Nueva tarjeta',
      subtitle: 'Crear flashcard manualmente',
      icon: Icons.add_box_outlined,
    ),
    _CommandItem(
      id: 'open_vault',
      title: 'Abrir vault',
      subtitle: 'Explorar estructura de carpetas',
      icon: Icons.folder_open,
    ),
    _CommandItem(
      id: 'settings',
      title: 'Ajustes',
      subtitle: 'Backend, vault, apariencia',
      icon: Icons.settings,
    ),
  ];

  List<_CommandItem> get _filtered {
    final q = _searchCtrl.text.toLowerCase().trim();
    if (q.isEmpty) return _commands.toList();
    return _commands.where((c) =>
        c.title.toLowerCase().contains(q) ||
        c.subtitle.toLowerCase().contains(q) ||
        c.id.contains(q)
    ).toList();
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _execute(_CommandItem cmd) {
    Navigator.of(context).pop(cmd.id);
  }

  @override
  Widget build(BuildContext context) {
    final items = _filtered;
    if (_selectedIdx >= items.length) _selectedIdx = 0;

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 80),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 600),
        decoration: BoxDecoration(
          // v0.48: glass effect (semi-transparent surface).
          color: Theme.of(context).colorScheme.surface.withAlpha(240),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: TextField(
                controller: _searchCtrl,
                focusNode: _focusNode,
                decoration: InputDecoration(
                  hintText: 'Buscar acción...',
                  prefixIcon: const Icon(Icons.search),
                  border: InputBorder.none,
                  suffixIcon: _searchCtrl.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () => _searchCtrl.clear(),
                        )
                      : null,
                ),
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) {
                  if (items.isNotEmpty) _execute(items[_selectedIdx]);
                },
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: items.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(32),
                      child: Text(
                        'No hay acciones para "${_searchCtrl.text}"',
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: items.length,
                      itemBuilder: (_, i) {
                        final c = items[i];
                        final selected = i == _selectedIdx;
                        return InkWell(
                          onTap: () => _execute(c),
                          onHover: (_) => setState(() => _selectedIdx = i),
                          child: Container(
                            color: selected
                                ? Theme.of(context).colorScheme.primaryContainer.withAlpha(128)
                                : Colors.transparent,
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                            child: Row(
                              children: [
                                Icon(c.icon,
                                    color: selected
                                        ? Theme.of(context).colorScheme.primary
                                        : Theme.of(context).colorScheme.onSurfaceVariant),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(c.title,
                                          style: Theme.of(context).textTheme.bodyLarge),
                                      Text(c.subtitle,
                                          style: Theme.of(context).textTheme.bodySmall),
                                    ],
                                  ),
                                ),
                                if (selected)
                                  const Icon(Icons.arrow_forward, size: 16),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// v0.48: helper para registrar Ctrl+K en cualquier widget que tenga acceso
/// al FocusScope. Devuelve un [Shortcuts] widget para envolver.
class CommandPaletteShortcuts extends StatelessWidget {
  final VoidCallback onOpen;

  const CommandPaletteShortcuts({super.key, required this.onOpen, required Widget child})
      : _child = child;

  final Widget _child;

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: {
        LogicalKeySet(LogicalKeyboardKey.control, LogicalKeyboardKey.keyK):
            const _OpenPaletteIntent(),
      },
      child: Actions(
        actions: {
          _OpenPaletteIntent: CallbackAction<_OpenPaletteIntent>(
            onInvoke: (_) {
              onOpen();
              return null;
            },
          ),
        },
        child: _child,
      ),
    );
  }
}

class _OpenPaletteIntent extends Intent {
  const _OpenPaletteIntent();
}
