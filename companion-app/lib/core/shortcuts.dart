// Shortcuts de teclado estilo Obsidian.
// Centralizados para fácil customización.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

class K {
  // Global
  static const cmd = SingleActivator(LogicalKeyboardKey.meta);
  static const ctrl = SingleActivator(LogicalKeyboardKey.control);
  static const escape = SingleActivator(LogicalKeyboardKey.escape);
  static const slash = SingleActivator(LogicalKeyboardKey.slash);

  // Navigation
  static final openVault = CharacterActivator('o', control: true); // Ctrl+O
  static final openSearch = SingleActivator(LogicalKeyboardKey.keyP, control: true, shift: true); // Ctrl+Shift+P
  static final newNote = CharacterActivator('n', control: true); // Ctrl+N
  static final newNoteAlt = CharacterActivator('n', meta: true); // Cmd+N (Mac)
  static final home = CharacterActivator('h', control: true); // Ctrl+H (home)
  static final closeTab = CharacterActivator('w', control: true); // Ctrl+W

  // Editor
  static final save = CharacterActivator('s', control: true); // Ctrl+S
  static final togglePreview = CharacterActivator('e', control: true); // Ctrl+E
  static final toggleSidebar = CharacterActivator('\\', control: true); // Ctrl+\
  static final search = CharacterActivator('f', control: true); // Ctrl+F
  static final replace = SingleActivator(LogicalKeyboardKey.keyH, control: true, shift: true); // Ctrl+Shift+H
  static final goLine = CharacterActivator('g', control: true); // Ctrl+G
  static final toggleBold = CharacterActivator('b', control: true); // Ctrl+B
  static final toggleItalic = CharacterActivator('i', control: true); // Ctrl+I
  static final toggleCode = SingleActivator(LogicalKeyboardKey.keyE, control: true, shift: true); // Ctrl+Shift+E
  static final insertLink = CharacterActivator('k', control: true); // Ctrl+K

  // Flashcards
  static final review = CharacterActivator('r', control: true); // Ctrl+R
}

/// Widget que captura shortcuts y los mapea a acciones.
class Shortcuts2 extends StatelessWidget {
  final Widget child;
  final Map<ShortcutActivator, Intent> shortcuts;
  final Map<Type, Action<Intent>> actions;

  const Shortcuts2({
    super.key,
    required this.child,
    this.shortcuts = const {},
    this.actions = const {},
  });

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: shortcuts,
      child: Actions(
        actions: actions,
        child: child,
      ),
    );
  }
}

/// Helper para mostrar un chip con un atajo de teclado.
class ShortcutChip extends StatelessWidget {
  final String label;
  const ShortcutChip({super.key, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
      ),
      child: Text(label,
        style: TextStyle(
          fontSize: 10,
          fontFamily: 'monospace',
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
